import { allowListFor, authHeaders, buildMultipartBody } from './http';
import type { OmnisProductConfig } from './config';

jest.mock('@rocket.chat/server-fetch', () => ({ serverFetch: jest.fn() }));

const cfg = (overrides: Partial<OmnisProductConfig> = {}): OmnisProductConfig => ({
	enabled: true,
	transport: 'native',
	baseUrl: 'https://autodoc.example.com',
	authMode: 'internal-key',
	apiKey: 'secret-key',
	orgId: 'org-1',
	webUrl: '',
	...overrides,
});

describe('buildMultipartBody', () => {
	it('produces a Buffer, not an object — serverFetch JSON-stringifies non-Buffer bodies', () => {
		const { body } = buildMultipartBody([{ name: 'matter_id', value: 'm-1' }]);
		// This is THE regression guard for the trap in packages/server-fetch/src/parsers.ts:
		// a FormData here would go out as the literal string '{}'.
		expect(Buffer.isBuffer(body)).toBe(true);
	});

	it('declares the boundary it actually used', () => {
		const { body, contentType } = buildMultipartBody([{ name: 'a', value: '1' }]);
		const boundary = /boundary=(.+)$/.exec(contentType)?.[1];

		expect(boundary).toBeTruthy();
		expect(body.toString('utf8')).toContain(`--${boundary}`);
		expect(body.toString('utf8').trimEnd().endsWith(`--${boundary}--`)).toBe(true);
	});

	it('writes fields and file parts with their headers', () => {
		const { body } = buildMultipartBody(
			[{ name: 'matter_id', value: 'm-42' }],
			[{ name: 'file', filename: 'bill.pdf', contentType: 'application/pdf', content: Buffer.from('%PDF-1.7') }],
		);
		const text = body.toString('utf8');

		expect(text).toContain('Content-Disposition: form-data; name="matter_id"');
		expect(text).toContain('m-42');
		expect(text).toContain('Content-Disposition: form-data; name="file"; filename="bill.pdf"');
		expect(text).toContain('Content-Type: application/pdf');
		expect(text).toContain('%PDF-1.7');
	});

	it('preserves binary content byte-for-byte', () => {
		const binary = Buffer.from([0x00, 0xff, 0x10, 0x0d, 0x0a, 0x2d, 0x2d]);
		const { body } = buildMultipartBody([], [{ name: 'file', filename: 'x.bin', contentType: 'application/octet-stream', content: binary }]);

		expect(body.includes(binary)).toBe(true);
	});

	it('escapes quotes in field and file names rather than breaking the header', () => {
		const { body } = buildMultipartBody(
			[{ name: 'we"ird', value: 'v' }],
			[{ name: 'file', filename: 'in"voice.pdf', contentType: 'application/pdf', content: Buffer.from('x') }],
		);
		const text = body.toString('utf8');

		expect(text).toContain('name="we\\"ird"');
		expect(text).toContain('filename="in\\"voice.pdf"');
	});

	it('never picks a boundary that occurs inside the file content', () => {
		// Build once to discover a boundary, then feed it back as file content and
		// confirm the next build refuses to reuse it — otherwise the part would be
		// truncated at the attacker-supplied marker.
		const first = buildMultipartBody([], [{ name: 'f', filename: 'a', contentType: 'text/plain', content: Buffer.from('x') }]);
		const firstBoundary = /boundary=(.+)$/.exec(first.contentType)?.[1] as string;

		const second = buildMultipartBody(
			[],
			[{ name: 'f', filename: 'a', contentType: 'text/plain', content: Buffer.from(`--${firstBoundary}\r\nhostile`) }],
		);
		const secondBoundary = /boundary=(.+)$/.exec(second.contentType)?.[1] as string;

		expect(secondBoundary).not.toBe(firstBoundary);
	});
});

describe('authHeaders', () => {
	it('sends a service key header in internal-key mode', () => {
		expect(authHeaders(cfg({ authMode: 'internal-key' }))).toEqual({ 'X-Internal-Key': 'secret-key' });
	});

	it('sends a bearer token in bearer mode', () => {
		expect(authHeaders(cfg({ authMode: 'bearer' }))).toEqual({ Authorization: 'Bearer secret-key' });
	});

	it('sends no auth header at all when no key is configured', () => {
		// Not an empty Bearer — an empty credential must look absent, not malformed.
		expect(authHeaders(cfg({ apiKey: '' }))).toEqual({});
	});
});

describe('allowListFor', () => {
	it('pins outbound calls to the configured host', () => {
		expect(allowListFor(cfg())).toEqual(['autodoc.example.com']);
	});

	it('returns an empty allow-list for an unparseable base URL, so nothing is reachable', () => {
		// Fail closed: a mistyped base URL must not become an internal-network probe.
		expect(allowListFor(cfg({ baseUrl: 'not a url' }))).toEqual([]);
	});
});
