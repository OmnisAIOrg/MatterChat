import { serverFetch } from '@rocket.chat/server-fetch';

import type { AutoDocConfig } from './config';
import { AutoDocNativeTransport, AutoDocStubTransport, normalizeDocument } from './transport';

jest.mock('@rocket.chat/server-fetch', () => ({ serverFetch: jest.fn() }));

const fetchMock = serverFetch as unknown as jest.Mock;

const cfg = (overrides: Partial<AutoDocConfig> = {}): AutoDocConfig => ({
	enabled: true,
	transport: 'native',
	baseUrl: 'https://autodoc.example.com',
	authMode: 'internal-key',
	apiKey: 'k',
	orgId: 'org-1',
	webUrl: '',
	pollIntervalSeconds: 15,
	autoProcessMaxMb: 25,
	autoProcessDailyCap: 50,
	...overrides,
});

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });

beforeEach(() => {
	fetchMock.mockReset();
});

describe('AutoDocStubTransport', () => {
	it('serves representative rows with zero configuration', async () => {
		const { items, summary } = await new AutoDocStubTransport().listFeed();

		expect(items.length).toBeGreaterThan(0);
		expect(summary.recent).toBe(items.length);
		// Every row carries the diff key the poller needs.
		items.forEach((item) => expect(item.status_changed_at).toEqual(expect.any(String)));
	});

	it('counts anything that is not `ready` as needing review', async () => {
		const { items, summary } = await new AutoDocStubTransport().listFeed();
		const expected = items.filter((i) => i.status === 'needs_review' || i.status === 'quick_confirm').length;

		expect(summary.needsReview).toBe(expected);
	});

	it('binds the matter and lands high-confidence when submitted WITH a matter', async () => {
		const stub = new AutoDocStubTransport();
		const doc = await stub.submit({ filename: 'bill.pdf', contentType: 'application/pdf', content: Buffer.from('x'), matterId: 'm-1' });

		expect(doc.matterId).toBe('m-1');
		expect(doc.status).toBe('ready');
		expect(doc.matterGuess).toBeUndefined();
	});

	it('lands needing review WITHOUT a matter, and offers a guess instead', async () => {
		// The two entry points have honestly different outcomes: a widget drop has
		// no channel context, so AutoDoc has to match the matter itself.
		const stub = new AutoDocStubTransport();
		const doc = await stub.submit({ filename: 'bill.pdf', contentType: 'application/pdf', content: Buffer.from('x') });

		expect(doc.matterId).toBeUndefined();
		expect(doc.status).toBe('needs_review');
		expect(doc.matterGuess?.confidence).toBeLessThan(0.75);
	});

	it('applies corrections and raises the corrected field to full confidence', async () => {
		const stub = new AutoDocStubTransport();
		const doc = await stub.submit({ filename: 'bill.pdf', contentType: 'application/pdf', content: Buffer.from('x'), matterId: 'm-1' });

		await stub.confirm(doc.id, { matterId: 'm-1', corrections: [{ name: 'amount', value: '$99.00' }] });
		const updated = await stub.getDocument(doc.id);

		expect(updated?.fields?.find((f) => f.name === 'amount')?.value).toBe('$99.00');
		expect(updated?.fields?.find((f) => f.name === 'amount')?.confidence).toBe(1);
	});
});

describe('AutoDocNativeTransport request construction', () => {
	it('sends the internal-key header in internal-key mode', async () => {
		fetchMock.mockResolvedValue(ok({ items: [] }));
		await new AutoDocNativeTransport(cfg({ authMode: 'internal-key' })).listFeed();

		const [, options] = fetchMock.mock.calls[0];
		expect(options.headers['X-Internal-Key']).toBe('k');
		expect(options.headers.Authorization).toBeUndefined();
	});

	it('sends a bearer token in bearer mode', async () => {
		fetchMock.mockResolvedValue(ok({ items: [] }));
		await new AutoDocNativeTransport(cfg({ authMode: 'bearer' })).listFeed();

		const [, options] = fetchMock.mock.calls[0];
		expect(options.headers.Authorization).toBe('Bearer k');
		expect(options.headers['X-Internal-Key']).toBeUndefined();
	});

	it('pins every request to the configured host', async () => {
		fetchMock.mockResolvedValue(ok({ items: [] }));
		await new AutoDocNativeTransport(cfg()).listFeed();

		const [url, options] = fetchMock.mock.calls[0];
		expect(url).toBe('https://autodoc.example.com/api/feed/');
		expect(options.ignoreSsrfValidation).toBe(false);
		expect(options.allowList).toEqual(['autodoc.example.com']);
	});

	it('uploads multipart as a Buffer with a matching boundary', async () => {
		fetchMock.mockResolvedValue(ok({ id: 'd1', status: 'ready', status_changed_at: '2026-01-01T00:00:00Z' }));

		await new AutoDocNativeTransport(cfg()).submit({
			filename: 'bill.pdf',
			contentType: 'application/pdf',
			content: Buffer.from('%PDF-1.7'),
			matterId: 'm-1',
			roomId: 'r-1',
		});

		const [url, options] = fetchMock.mock.calls[0];
		expect(url).toBe('https://autodoc.example.com/api/documents/upload/');
		expect(Buffer.isBuffer(options.body)).toBe(true);
		expect(options.headers['Content-Type']).toMatch(/^multipart\/form-data; boundary=/);
		expect(options.body.toString('utf8')).toContain('m-1');
	});

	it('throws on a non-2xx so a failed WRITE cannot be silently swallowed', async () => {
		fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => 'boom', json: async () => ({}) });

		await expect(
			new AutoDocNativeTransport(cfg()).submit({ filename: 'a.pdf', contentType: 'application/pdf', content: Buffer.from('x') }),
		).rejects.toThrow();
	});
});

describe('normalizeDocument', () => {
	it('maps the snake_case wire shape onto the domain type', () => {
		const doc = normalizeDocument({
			id: 'd1',
			file_name: 'scan.pdf',
			document_type: 'Medical Bill',
			status: 'ready',
			confidence: 0.9,
			status_changed_at: '2026-01-02T03:04:05Z',
			matter_id: 'm-9',
		});

		expect(doc).toMatchObject({ id: 'd1', filename: 'scan.pdf', documentType: 'Medical Bill', status: 'ready', matterId: 'm-9' });
	});

	it('treats an UNKNOWN status as needing review, never as ready', () => {
		// Erring toward review is the safe direction for a filing decision.
		expect(normalizeDocument({ id: 'd1', status: 'something_new' })?.status).toBe('needs_review');
	});

	it('falls back to updated_at when the feed omits the diff key', () => {
		const doc = normalizeDocument({ id: 'd1', status: 'ready', updated_at: '2026-05-05T00:00:00Z' });
		expect(doc?.status_changed_at).toBe('2026-05-05T00:00:00Z');
	});

	it('rejects a row with no id rather than inventing one', () => {
		expect(normalizeDocument({ filename: 'x.pdf' })).toBeNull();
	});
});
