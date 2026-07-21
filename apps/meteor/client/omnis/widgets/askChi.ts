import { sdk } from '../../../app/utils/client/lib/SDKClient';

/**
 * The Chi orb's `ask` adapter: routes a prompt through the EXISTING `@chi.bot` DM pipeline rather
 * than a parallel endpoint — so every reply rides the same caller-scoped tools, confirm/park flow
 * and #chi-admin-audit trail the DM already enforces. We open (or reuse) the caller's chi.bot DM,
 * post the message as the user, then wait for chi.bot's reply.
 *
 * Chi posts a placeholder (THINKING) and edits it in place to the final answer, so we poll the DM
 * history and return the newest chi.bot message once it is no longer the placeholder.
 */
const CHI_BOT_USERNAME = 'chi.bot';
const THINKING = '⏳ _Chi is working on it…_';
const POLL_INTERVAL_MS = 1200;
const MAX_WAIT_MS = 60_000;

let cachedRoomId: string | undefined;

async function chiDmRoomId(): Promise<string> {
	if (cachedRoomId) {
		return cachedRoomId;
	}
	const res = (await sdk.rest.post('/v1/im.create', { username: CHI_BOT_USERNAME })) as { room?: { _id?: string } };
	const rid = res?.room?._id;
	if (!rid) {
		throw new Error('Could not open the Chi conversation');
	}
	cachedRoomId = rid;
	return rid;
}

type HistoryMessage = { _id: string; msg?: string; ts?: string; u?: { username?: string } };

async function latestBotReply(roomId: string, afterTs: number): Promise<string | undefined> {
	const res = (await sdk.rest.get('/v1/im.history', { roomId, count: 10 })) as { messages?: HistoryMessage[] };
	const messages = res?.messages ?? [];
	// history returns newest-first; find the freshest chi.bot message posted after our prompt.
	const reply = messages.find(
		(m) => m.u?.username === CHI_BOT_USERNAME && m.msg && m.msg !== THINKING && new Date(m.ts ?? 0).getTime() >= afterTs,
	);
	return reply?.msg;
}

const wait = (ms: number): Promise<void> =>
	new Promise((resolve) => {
		setTimeout(resolve, ms);
	});

export async function askChi(text: string): Promise<string> {
	const roomId = await chiDmRoomId();
	const sentAt = Date.now();
	await sdk.rest.post('/v1/chat.postMessage', { roomId, text });

	const deadline = Date.now() + MAX_WAIT_MS;
	while (Date.now() < deadline) {
		await wait(POLL_INTERVAL_MS);
		try {
			const reply = await latestBotReply(roomId, sentAt);
			if (reply) {
				return reply;
			}
		} catch {
			// transient; keep polling until the deadline
		}
	}
	return 'Chi is taking longer than usual — check the chi.bot direct message for the reply.';
}
