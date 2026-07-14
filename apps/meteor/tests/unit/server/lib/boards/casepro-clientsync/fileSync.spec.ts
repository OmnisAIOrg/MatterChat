import { expect } from 'chai';
import { beforeEach, describe, it } from 'mocha';
import proxyquire from 'proxyquire';
import sinon from 'sinon';

/**
 * File (attachment) sync — the REFERENCE-SHARE path.
 *
 * Covers the task's required cases:
 *  - reference-share (the path built): resolvable ref → deep-linkable attachment.
 *  - size-cap reject: oversize ref → reference note (never blocked).
 *  - idempotency: mapping is pure/deterministic (re-mapping the same ref is identical),
 *    which is what lets the deterministic-_id upsert re-ingest without divergence.
 *  - failure → note-fallback: an unresolvable/malformed ref degrades to a stub.
 *  - gated-off = references-only: file-sync OFF reproduces today's stub behaviour exactly.
 */

const settingsGet = sinon.stub();

const fileSync = proxyquire.noCallThru().load(
	'../../../../../../server/lib/boards/casepro-clientsync/fileSync',
	{
		'../../../../app/settings/server': { settings: { get: settingsGet } },
	},
) as typeof import('../../../../../../server/lib/boards/casepro-clientsync/fileSync');

const {
	isFileSyncEnabled,
	fileMaxBytes,
	isResolvableRef,
	withinSizeCap,
	mapInboundAttachment,
	mapInboundAttachments,
	extractOutboundAttachments,
} = fileSync;

/** Configure the two settings the module reads. */
function setFlags({ filesEnabled, maxBytes }: { filesEnabled?: boolean; maxBytes?: number } = {}): void {
	settingsGet.reset();
	settingsGet.withArgs('CasePro_Client_Sync_Files_Enabled').returns(filesEnabled ?? false);
	settingsGet.withArgs('CasePro_Client_Sync_File_Max_Bytes').returns(maxBytes ?? 50 * 1024 * 1024);
	// Any other id → undefined (mirrors settings.get for unknown ids in these tests).
}

const RESOLVABLE = {
	documentId: 'litbox-doc-1',
	organizationId: 'org-1',
	name: 'medical-record.pdf',
	sizeBytes: 1024 * 1024,
	contentType: 'application/pdf',
};

describe('CasePro client-sync file (attachment) reference-share', () => {
	beforeEach(() => setFlags());

	describe('gating', () => {
		it('isFileSyncEnabled reflects the sub-flag', () => {
			setFlags({ filesEnabled: false });
			expect(isFileSyncEnabled()).to.equal(false);
			setFlags({ filesEnabled: true });
			expect(isFileSyncEnabled()).to.equal(true);
		});

		it('falls back to a safe default max when the setting is missing/garbage', () => {
			settingsGet.reset();
			settingsGet.returns(undefined);
			expect(fileMaxBytes()).to.equal(50 * 1024 * 1024);
			settingsGet.reset();
			settingsGet.withArgs('CasePro_Client_Sync_File_Max_Bytes').returns(-5);
			expect(fileMaxBytes()).to.equal(50 * 1024 * 1024);
		});
	});

	describe('gated OFF → references-only (today\'s behaviour, unchanged)', () => {
		it('renders a reference STUB with no deep-link even for a fully-resolvable ref', () => {
			setFlags({ filesEnabled: false });
			const att = mapInboundAttachment(RESOLVABLE);
			expect(att.title).to.equal('medical-record.pdf');
			expect((att as any).title_link).to.equal(undefined);
			expect(att.text).to.contain('open in the CasePro matter documents');
			// documentId still carried in a field for future deep-linking.
			expect(att.fields?.[0]).to.deep.include({ title: 'documentId', value: 'litbox-doc-1' });
		});

		it('forwards NO outbound attachments while gated off', () => {
			setFlags({ filesEnabled: false });
			const msg = { _id: 'm1', customFields: { caseproClientSyncFile: RESOLVABLE } } as any;
			expect(extractOutboundAttachments(msg)).to.deep.equal([]);
		});
	});

	describe('gated ON → reference-share (resolvable deep-link)', () => {
		beforeEach(() => setFlags({ filesEnabled: true }));

		it('recognizes a resolvable ref (needs BOTH documentId and organizationId)', () => {
			expect(isResolvableRef(RESOLVABLE)).to.equal(true);
			expect(isResolvableRef({ ...RESOLVABLE, organizationId: undefined } as any)).to.equal(false);
			expect(isResolvableRef({ ...RESOLVABLE, documentId: '' } as any)).to.equal(false);
		});

		it('renders a resolvable attachment with a same-origin LitBox deep-link + content-type passthrough', () => {
			const att = mapInboundAttachment(RESOLVABLE) as any;
			expect(att.title).to.equal('medical-record.pdf');
			expect(att.title_link).to.equal('/_litbox/v1/files/litbox-doc-1');
			expect(att.title_link_download).to.equal(true);
			// content-type passed through verbatim, never inferred.
			expect(att.fields).to.deep.include({ title: 'type', value: 'application/pdf', short: true });
			// resolvable coordinates ride in `fields` (a supported, rendered attachment field).
			expect(att.fields).to.deep.include({ title: 'documentId', value: 'litbox-doc-1', short: true });
			expect(att.fields).to.deep.include({ title: 'organizationId', value: 'org-1', short: true });
		});

		it('url-encodes a documentId so a crafted id cannot break out of the link path', () => {
			const att = mapInboundAttachment({ ...RESOLVABLE, documentId: 'a/../b' }) as any;
			expect(att.title_link).to.equal('/_litbox/v1/files/a%2F..%2Fb');
		});

		it('is deterministic — re-mapping the SAME ref yields an identical attachment (idempotent ingest)', () => {
			const a = mapInboundAttachment(RESOLVABLE);
			const b = mapInboundAttachment(RESOLVABLE);
			expect(a).to.deep.equal(b);
		});
	});

	describe('size-cap reject → reference note (never blocked)', () => {
		it('withinSizeCap compares against the configured cap; unknown size passes', () => {
			setFlags({ filesEnabled: true, maxBytes: 1000 });
			expect(withinSizeCap({ ...RESOLVABLE, sizeBytes: 999 })).to.equal(true);
			expect(withinSizeCap({ ...RESOLVABLE, sizeBytes: 1001 })).to.equal(false);
			expect(withinSizeCap({ ...RESOLVABLE, sizeBytes: undefined } as any)).to.equal(true);
		});

		it('an oversize resolvable ref degrades to a STUB (no deep-link), never dropped', () => {
			setFlags({ filesEnabled: true, maxBytes: 1000 });
			const att = mapInboundAttachment({ ...RESOLVABLE, sizeBytes: 5000 }) as any;
			expect(att.title_link).to.equal(undefined);
			expect(att.text).to.contain('open in the CasePro matter documents');
		});

		it('drops an oversize ref from the OUTBOUND forward set', () => {
			setFlags({ filesEnabled: true, maxBytes: 1000 });
			const msg = { _id: 'm1', customFields: { caseproClientSyncFile: { ...RESOLVABLE, sizeBytes: 5000 } } } as any;
			expect(extractOutboundAttachments(msg)).to.deep.equal([]);
		});
	});

	describe('failure → note fallback (a file never breaks a message)', () => {
		beforeEach(() => setFlags({ filesEnabled: true }));

		it('an unresolvable ref (no org id) falls back to a stub', () => {
			const att = mapInboundAttachment({ documentId: 'd', name: 'x.pdf' } as any) as any;
			expect(att.title_link).to.equal(undefined);
			expect(att.text).to.contain('open in the CasePro matter documents');
		});

		it('never throws even if settings.get blows up mid-map', () => {
			settingsGet.reset();
			settingsGet.throws(new Error('settings not ready'));
			const att = mapInboundAttachment(RESOLVABLE) as any;
			// falls through to a stub rather than throwing into the ingest loop.
			expect(att.title_link).to.equal(undefined);
			expect(att.title).to.equal('medical-record.pdf');
		});

		it('mapInboundAttachments returns undefined for an empty/absent list', () => {
			expect(mapInboundAttachments(undefined)).to.equal(undefined);
			expect(mapInboundAttachments([])).to.equal(undefined);
		});
	});

	describe('outbound extraction (reference-share, firm → client)', () => {
		beforeEach(() => setFlags({ filesEnabled: true }));

		it('forwards a well-formed resolvable ref and skips a dangling one', () => {
			const msg = {
				_id: 'm1',
				customFields: {
					caseproClientSyncFile: [
						RESOLVABLE,
						{ documentId: 'd2' /* no org id */, name: 'y.pdf' },
					],
				},
			} as any;
			const out = extractOutboundAttachments(msg);
			expect(out).to.have.length(1);
			expect(out[0]).to.include({ documentId: 'litbox-doc-1', organizationId: 'org-1' });
		});

		it('accepts a single object as well as an array', () => {
			const msg = { _id: 'm1', customFields: { caseproClientSyncFile: RESOLVABLE } } as any;
			expect(extractOutboundAttachments(msg)).to.have.length(1);
		});

		it('returns [] when the message has no file refs', () => {
			expect(extractOutboundAttachments({ _id: 'm1' } as any)).to.deep.equal([]);
		});
	});
});
