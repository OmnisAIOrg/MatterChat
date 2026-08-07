import { canPostToChannel, dispatchBot } from './client';
import { resolveCaseNotesConfig } from './config';
import { caseNotesTransport } from './transport';
import { isClientChannel } from '../omnis/matter';

jest.mock('./config', () => ({ resolveCaseNotesConfig: jest.fn() }));
jest.mock('./transport', () => ({
	caseNotesTransport: jest.fn(),
	isSupportedMeetingUrl: jest.requireActual('./transport').isSupportedMeetingUrl,
}));
jest.mock('../omnis/matter', () => ({ isClientChannel: jest.fn(), matterDisplayName: jest.fn(async () => 'Alvarez v. Diaz') }));
jest.mock('../omnis/receipt', () => ({ postOmnisReceipt: jest.fn(async () => true) }));
jest.mock('../boards/casepro/client', () => ({ caseProClient: { updateMatter: jest.fn(async () => ({})) } }));
jest.mock('../logger/system', () => ({ SystemLogger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() } }));

// The audit collection writes through raw Mongo; stub the whole db handle.
jest.mock('../../database/utils', () => ({
	db: {
		collection: () => ({
			createIndexes: jest.fn(async () => undefined),
			insertOne: jest.fn(async () => ({})),
			updateOne: jest.fn(async () => ({})),
			findOne: jest.fn(async () => null),
		}),
	},
}));

const configMock = resolveCaseNotesConfig as jest.Mock;
const transportMock = caseNotesTransport as jest.Mock;
const isClientChannelMock = isClientChannel as jest.Mock;

const baseConfig = {
	enabled: true,
	transport: 'stub' as const,
	baseUrl: '',
	authMode: 'internal-key' as const,
	apiKey: '',
	orgId: '',
	webUrl: '',
	recordingDisclosure: 'This meeting is being recorded.',
	botDisplayName: 'CaseNotes Notetaker',
};

const meeting = { id: 'm1', title: 'Meeting', status: 'joining', status_changed_at: '', startedAt: '', platform: 'zoom', kind: 'client-check-in' };

beforeEach(() => {
	configMock.mockReturnValue({ ...baseConfig });
	transportMock.mockReturnValue({ dispatchBot: jest.fn(async () => meeting) });
	isClientChannelMock.mockReset().mockResolvedValue(false);
});

describe('dispatchBot — consent is non-negotiable', () => {
	it('always sends the bot display name and the disclosure', async () => {
		const transport = { dispatchBot: jest.fn(async () => meeting) };
		transportMock.mockReturnValue(transport);

		await dispatchBot({ meetingUrl: 'https://zoom.us/j/123', kind: 'client-check-in', requestedBy: 'u1' });

		expect(transport.dispatchBot).toHaveBeenCalledWith(
			expect.objectContaining({ botDisplayName: 'CaseNotes Notetaker', disclosure: 'This meeting is being recorded.' }),
		);
	});

	it('REFUSES to dispatch when no disclosure is configured', async () => {
		// There is no code path that produces a silent recorder.
		configMock.mockReturnValue({ ...baseConfig, recordingDisclosure: '   ' });
		const transport = { dispatchBot: jest.fn() };
		transportMock.mockReturnValue(transport);

		await expect(dispatchBot({ meetingUrl: 'https://zoom.us/j/123', kind: 'client-check-in', requestedBy: 'u1' })).rejects.toThrow(
			/disclosure/i,
		);
		expect(transport.dispatchBot).not.toHaveBeenCalled();
	});

	it('REFUSES to dispatch an unnamed bot', async () => {
		configMock.mockReturnValue({ ...baseConfig, botDisplayName: '' });
		const transport = { dispatchBot: jest.fn() };
		transportMock.mockReturnValue(transport);

		await expect(dispatchBot({ meetingUrl: 'https://zoom.us/j/123', kind: 'client-check-in', requestedBy: 'u1' })).rejects.toThrow();
		expect(transport.dispatchBot).not.toHaveBeenCalled();
	});

	it('rejects a link that is not Zoom, Meet, or Teams', async () => {
		await expect(dispatchBot({ meetingUrl: 'https://evil.example.com/x', kind: 'client-check-in', requestedBy: 'u1' })).rejects.toThrow();
	});

	it('rejects a non-https link', async () => {
		await expect(dispatchBot({ meetingUrl: 'http://zoom.us/j/123', kind: 'client-check-in', requestedBy: 'u1' })).rejects.toThrow();
	});

	it('accepts Zoom, Google Meet and Teams links', async () => {
		for (const url of ['https://zoom.us/j/1', 'https://meet.google.com/abc-defg-hij', 'https://teams.microsoft.com/l/meetup-join/x']) {
			await expect(dispatchBot({ meetingUrl: url, kind: 'client-check-in', requestedBy: 'u1' })).resolves.toBeTruthy();
		}
	});

	it('does not dispatch at all when CaseNotes is disabled', async () => {
		configMock.mockReturnValue({ ...baseConfig, enabled: false });
		await expect(dispatchBot({ meetingUrl: 'https://zoom.us/j/1', kind: 'client-check-in', requestedBy: 'u1' })).rejects.toThrow();
	});
});

describe('canPostToChannel — work product is hard-gated', () => {
	it('blocks internal strategy notes in a CLIENT-facing channel', async () => {
		isClientChannelMock.mockResolvedValue(true);
		expect(await canPostToChannel('internal-strategy', 'r1')).toBe(false);
	});

	it('blocks defense counsel calls in a client-facing channel', async () => {
		isClientChannelMock.mockResolvedValue(true);
		expect(await canPostToChannel('defense-counsel-call', 'r1')).toBe(false);
	});

	it('allows internal strategy notes in an internal channel', async () => {
		isClientChannelMock.mockResolvedValue(false);
		expect(await canPostToChannel('internal-strategy', 'r1')).toBe(true);
	});

	it('allows a client check-in in a client-facing channel', async () => {
		isClientChannelMock.mockResolvedValue(true);
		expect(await canPostToChannel('client-check-in', 'r1')).toBe(true);
	});
});
