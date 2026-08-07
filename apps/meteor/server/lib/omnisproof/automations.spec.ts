import { applyEsignActions, previewEsignActions } from './automations';
import { getDocumentType } from './documentTypes';
import type { EnvelopeRecord } from './store';
import { caseProClient } from '../boards/casepro/client';

jest.mock('./documentTypes', () => ({
	getDocumentType: jest.fn(),
	renderActionLabel: (action: { label: string }, matterName: string) => action.label.replace(/\{matter\}/g, matterName),
}));

jest.mock('../boards/casepro/client', () => ({ caseProClient: { updateMatter: jest.fn(async () => ({})) } }));
jest.mock('../logger/system', () => ({ SystemLogger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() } }));

const getTypeMock = getDocumentType as jest.Mock;
const updateMatterMock = caseProClient.updateMatter as jest.Mock;

const lopType = {
	_id: 't1',
	key: 'lop',
	label: 'Letter of Protection (LOP)',
	active: true,
	builtIn: true,
	actions: [
		{ kind: 'file-document', label: 'File signed PDF to {matter} → Documents', params: { folder: 'Documents' } },
		{ kind: 'set-field', label: 'LOP on file = Yes, dated today', params: { field: 'lop_on_file', value: true, stampDate: 'lop_date' } },
		{ kind: 'add-to-lien-schedule', label: 'Add the provider to the lien schedule' },
	],
};

const envelope = (overrides: Partial<EnvelopeRecord> = {}): EnvelopeRecord =>
	({
		_id: 'e1',
		envelopeId: 'env-1',
		provider: 'omnisproof',
		documentName: 'LOP',
		documentRef: 'litbox:doc-1',
		signers: [
			{ name: 'Maria Alvarez', email: 'm@example.com', role: 'client', order: 1 },
			{ name: 'Patel Clinic', email: 'p@example.com', role: 'provider', order: 2 },
		],
		matterId: 'm-1',
		matterName: 'Alvarez v. Diaz',
		documentTypeKey: 'lop',
		sentBy: { _id: 'u1' },
		status: 'signed',
		sentAt: new Date(),
		viewCount: 1,
		...overrides,
	}) as EnvelopeRecord;

beforeEach(() => {
	updateMatterMock.mockReset().mockResolvedValue({});
	getTypeMock.mockReset().mockResolvedValue(lopType);
});

describe('previewEsignActions', () => {
	it('renders each action against the RESOLVED matter', async () => {
		const steps = await previewEsignActions('lop', 'Duong v. Metro Transit');

		// The mockup bug this guards: picking "Duong v. Metro Transit" outside a
		// matter channel still promised to file into "Alvarez v. Diaz".
		expect(steps[0].label).toBe('File signed PDF to Duong v. Metro Transit → Documents');
		expect(steps.some((s) => s.label.includes('Alvarez'))).toBe(false);
	});

	it('returns nothing until a matter is resolved', async () => {
		expect(await previewEsignActions('lop', undefined)).toEqual([]);
	});

	it('returns nothing until a document type is chosen', async () => {
		expect(await previewEsignActions(undefined, 'Alvarez v. Diaz')).toEqual([]);
	});
});

describe('applyEsignActions', () => {
	it('runs every action of the type, in order', async () => {
		const steps = await applyEsignActions(envelope(), 'litbox:signed-1');

		expect(steps.slice(0, 3).map((s) => s.label)).toEqual([
			'File signed PDF to Alvarez v. Diaz → Documents',
			'LOP on file = Yes, dated today',
			'Add the provider to the lien schedule',
		]);
		expect(steps.every((s) => s.ok)).toBe(true);
	});

	it('names the provider signer when adding to the lien schedule', async () => {
		const steps = await applyEsignActions(envelope(), 'litbox:signed-1');
		expect(steps.find((s) => s.label.includes('lien schedule'))?.detail).toBe('Patel Clinic');
	});

	it('does NOTHING for a General (non-matter) send', async () => {
		const steps = await applyEsignActions(envelope({ matterId: undefined, documentTypeKey: undefined }));

		expect(steps).toEqual([]);
		expect(updateMatterMock).not.toHaveBeenCalled();
	});

	it('REPORTS a failed step rather than omitting it, and keeps going', async () => {
		// A partially-applied automation that looks complete is worse than one
		// that reports the failure.
		updateMatterMock.mockImplementation(async (_matterId: string, patch: Record<string, unknown>) => {
			if ('lien_schedule_add' in patch) {
				throw new Error('lien service unavailable');
			}
			return {};
		});

		const steps = await applyEsignActions(envelope(), 'litbox:signed-1');
		const lienStep = steps.find((s) => s.label.includes('lien schedule'));

		expect(lienStep?.ok).toBe(false);
		expect(lienStep?.detail).toBe('lien service unavailable');
		// Earlier steps still succeeded — filing the PDF is worth doing regardless.
		expect(steps.find((s) => s.label.includes('File signed PDF'))?.ok).toBe(true);
		// And the summary line honestly reflects the partial failure.
		expect(steps[steps.length - 1]).toMatchObject({ label: 'Matter updated in CasePro', ok: false });
	});

	it('never throws, even when every write fails', async () => {
		updateMatterMock.mockRejectedValue(new Error('crm down'));

		const steps = await applyEsignActions(envelope(), 'litbox:signed-1');

		expect(steps.length).toBeGreaterThan(0);
		expect(steps.filter((s) => !s.ok).length).toBeGreaterThan(0);
	});

	it('reports a removed document type instead of silently applying nothing', async () => {
		getTypeMock.mockResolvedValue(null);

		const steps = await applyEsignActions(envelope());

		expect(steps).toHaveLength(1);
		expect(steps[0].ok).toBe(false);
		expect(steps[0].label).toContain('Unknown document type');
	});

	it('fails the file step when the provider returned no signed document', async () => {
		const steps = await applyEsignActions(envelope({ documentRef: undefined }), undefined);
		const fileStep = steps.find((s) => s.label.includes('File signed PDF'));

		expect(fileStep?.ok).toBe(false);
		expect(fileStep?.detail).toContain('No signed document reference');
	});
});
