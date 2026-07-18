import { expect } from 'chai';
import { beforeEach, describe, it } from 'mocha';
import proxyquire from 'proxyquire';
import sinon from 'sinon';

const slackFetch = sinon.stub();
const slackGetAll = sinon.stub();

// Load the provider with the Slack API + config + route side-effects stubbed out — mirrors
// slackEventProcessing.spec. The provider believes Slack is fully configured.
const providerModule = proxyquire.noCallThru().load('../../../../../app/connectors/server/providers/SlackProvider', {
	'@rocket.chat/server-fetch': { serverFetch: sinon.stub() },
	'./slack/config': {
		getSlackConfig: () => ({ clientId: 'client-id', clientSecret: 'client-secret' }),
		isSlackConfigured: () => true,
		isSlackEventsConfigured: () => true,
		SLACK_TOKEN_ENDPOINT: 'https://slack.example/api/oauth.v2.access',
		redirectUri: () => 'https://mc.example/_slack/oauth/callback',
		SLACK_USER_SCOPES: ['channels:read'],
	},
	'./slack/slackApi': { slackFetch, slackGetAll },
	'./slack/routes': {},
});

const { SlackProvider, extractMentionIds } = providerModule;

const connection = {
	connectionId: 'conn-1',
	ownerUserId: 'user-1',
	externalOrgId: 'T123',
	credentials: { accessToken: 'xoxp-test', externalSlackUserId: 'U-self' },
};

/** Drain an async iterable into an array. */
const collect = async <T>(iter: AsyncIterable<T>): Promise<T[]> => {
	const out: T[] = [];
	for await (const item of iter) {
		out.push(item);
	}
	return out;
};

describe('Slack message enrichment', () => {
	beforeEach(() => {
		slackFetch.reset();
		slackGetAll.reset();
	});

	describe('extractMentionIds (pure)', () => {
		it('extracts and dedupes U/W mention tokens', () => {
			expect(extractMentionIds('hi <@U08DD11QC1F> and <@W024BE7LH> and <@U08DD11QC1F> again')).to.deep.equal(['U08DD11QC1F', 'W024BE7LH']);
		});

		it('ignores channel mentions, special mentions, links, and plain @names', () => {
			expect(extractMentionIds('see <#C123ABC|general>, <!here>, <https://x.example>, @alice')).to.deep.equal([]);
			expect(extractMentionIds('')).to.deep.equal([]);
		});
	});

	describe('syncMessages author + mention enrichment', () => {
		const profiles: Record<string, unknown> = {
			U1: { user: { profile: { display_name: 'Alice Attorney', image_72: 'https://avatars.example/u1-72.png' } } },
			U2: { user: { real_name: 'Bob Barrister' } },
		};

		beforeEach(() => {
			slackFetch.callsFake(async (method: string, _tokens: unknown, options: { params?: Record<string, unknown> } = {}) => {
				if (method === 'conversations.history') {
					return {
						messages: [
							{ ts: '1752700000.000200', user: 'U2', text: 'hello <@U1> and <@U1> and <@U404>' },
							{ ts: '1752700000.000100', user: 'U1', text: 'plain text' },
						],
					};
				}
				if (method === 'users.info') {
					const id = String(options.params?.user);
					if (profiles[id]) {
						return profiles[id];
					}
					throw new Error('slack_error:user_not_found');
				}
				throw new Error(`unexpected slackFetch: ${method}`);
			});
		});

		it('yields authorDisplayName + authorAvatarUrl and a resolved mentions map', async () => {
			const provider = new SlackProvider();
			const messages = await collect(provider.syncMessages(connection, 'C0123456789'));

			expect(messages).to.have.length(2);

			// Newest-first: U2's message with mentions.
			expect(messages[0].authorExternalId).to.equal('U2');
			expect(messages[0].authorDisplayName).to.equal('Bob Barrister');
			expect(messages[0].authorAvatarUrl).to.equal(undefined);
			// Text is NOT rewritten — the client renderer owns presentation.
			expect(messages[0].text).to.equal('hello <@U1> and <@U1> and <@U404>');
			// U404 is unresolvable (users.info fails) → falls back to the id → omitted from the map.
			expect(messages[0].mentions).to.deep.equal({ U1: 'Alice Attorney' });

			expect(messages[1].authorExternalId).to.equal('U1');
			expect(messages[1].authorDisplayName).to.equal('Alice Attorney');
			expect(messages[1].authorAvatarUrl).to.equal('https://avatars.example/u1-72.png');
			expect(messages[1].mentions).to.equal(undefined);
		});

		it('caches profile lookups per call — one users.info per unique user', async () => {
			const provider = new SlackProvider();
			await collect(provider.syncMessages(connection, 'C0123456789'));

			// U1 appears as a mention (twice) AND as an author, U2 as an author, U404 as a mention:
			// exactly one users.info per unique id.
			const lookedUp = slackFetch
				.getCalls()
				.filter((c) => c.args[0] === 'users.info')
				.map((c) => c.args[2].params.user)
				.sort();
			expect(lookedUp).to.deep.equal(['U1', 'U2', 'U404']);
		});

		it('never fails the sync over an unresolvable author — falls back to the raw id', async () => {
			slackFetch.callsFake(async (method: string) => {
				if (method === 'conversations.history') {
					return { messages: [{ ts: '1752700000.000300', user: 'U404', text: 'hi' }] };
				}
				if (method === 'users.info') {
					throw new Error('slack_error:user_not_found');
				}
				throw new Error(`unexpected slackFetch: ${method}`);
			});

			const provider = new SlackProvider();
			const messages = await collect(provider.syncMessages(connection, 'C0123456789'));
			expect(messages).to.have.length(1);
			expect(messages[0].authorExternalId).to.equal('U404');
			// Fallback resolved to the id itself → authorDisplayName omitted (client shows the raw id).
			expect(messages[0].authorDisplayName).to.equal(undefined);
			expect(messages[0].authorAvatarUrl).to.equal(undefined);
		});
	});

	describe('postMessage instant-echo ts', () => {
		it('echoes the created message ts alongside the externalId', async () => {
			slackFetch.callsFake(async (method: string) => {
				if (method === 'chat.postMessage') {
					return { ts: '1752700001.000100' };
				}
				throw new Error(`unexpected slackFetch: ${method}`);
			});

			const provider = new SlackProvider();
			const created = await provider.postMessage(connection, 'C0123456789', { text: 'hello' });
			expect(created).to.deep.equal({ externalId: '1752700001.000100', ts: '1752700001.000100' });
		});
	});

	describe('listDirectChats still resolves profiles through the shared helper', () => {
		it('resolves the 1:1 peer name + avatar via users.info', async () => {
			slackGetAll.resolves([{ id: 'D111', is_im: true, user: 'U1' }]);
			slackFetch.callsFake(async (method: string, _tokens: unknown, options: { params?: Record<string, unknown> } = {}) => {
				if (method === 'users.info' && options.params?.user === 'U1') {
					return { user: { profile: { display_name: 'Alice Attorney', image_72: 'https://avatars.example/u1-72.png' } } };
				}
				if (method === 'users.getPresence') {
					return { presence: 'active' };
				}
				if (method === 'conversations.info') {
					return { channel: { unread_count_display: 2, latest: { ts: '1752700000.000100' } } };
				}
				if (method === 'auth.test') {
					return { user_id: 'U-self' };
				}
				throw new Error(`unexpected slackFetch: ${method}`);
			});

			const provider = new SlackProvider();
			const chats = await provider.listDirectChats(connection);
			expect(chats).to.have.length(1);
			expect(chats[0].name).to.equal('Alice Attorney');
			expect(chats[0].avatarUrl).to.equal('https://avatars.example/u1-72.png');
			expect(chats[0].presence).to.equal('active');
		});
	});
});
