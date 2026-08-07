import { LitboxStubUploadTransport, sniffContentType } from './transport';

jest.mock('@rocket.chat/server-fetch', () => ({ serverFetch: jest.fn() }));
jest.mock('../logger/system', () => ({ SystemLogger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() } }));

const pdf = Buffer.concat([Buffer.from('%PDF-1.7'), Buffer.alloc(16)]);
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]);

describe('sniffContentType', () => {
	it('recognises a PDF from its magic number', () => {
		expect(sniffContentType(pdf)).toBe('application/pdf');
	});

	it('recognises PNG and JPEG', () => {
		expect(sniffContentType(png)).toBe('image/png');
		expect(sniffContentType(jpeg)).toBe('image/jpeg');
	});

	it('REJECTS a file whose extension lies about its content', () => {
		// The upload endpoint is unauthenticated, so `invoice.pdf` may be anything
		// at all. The extension is not evidence — only the bytes are.
		const disguised = Buffer.from('#!/bin/sh\nrm -rf /\n# padded to length');
		expect(sniffContentType(disguised)).toBeNull();
	});

	it('rejects an HTML payload (stored-XSS vector if served back)', () => {
		expect(sniffContentType(Buffer.from('<html><script>alert(1)</script></html>'))).toBeNull();
	});

	it('rejects a truncated file too short to identify', () => {
		expect(sniffContentType(Buffer.from('%PDF'))).toBeNull();
	});
});

describe('LitboxStubUploadTransport', () => {
	it('returns a document id and echoes the size, with no credential', async () => {
		const result = await new LitboxStubUploadTransport().upload({
			filename: 'bill.pdf',
			contentType: 'application/pdf',
			content: pdf,
		});

		expect(result.documentId).toEqual(expect.any(String));
		expect(result.name).toBe('bill.pdf');
		expect(result.sizeBytes).toBe(pdf.length);
	});

	it('issues a distinct id per upload', async () => {
		const transport = new LitboxStubUploadTransport();
		const a = await transport.upload({ filename: 'a.pdf', contentType: 'application/pdf', content: pdf });
		const b = await transport.upload({ filename: 'b.pdf', contentType: 'application/pdf', content: pdf });

		expect(a.documentId).not.toBe(b.documentId);
	});
});
