import { approveAutoDocDocument, listAutoDocFeed } from './client';
import { resolveAutoDocConfig } from './config';
import { autoDocTransport } from './transport';
import { postOmnisReceipt } from '../omnis/receipt';

jest.mock('./config', () => ({ resolveAutoDocConfig: jest.fn() }));
jest.mock('./transport', () => ({ autoDocTransport: jest.fn() }));
jest.mock('../omnis/matter', () => ({ matterDisplayName: jest.fn(async () => 'Alvarez v. Diaz') }));
jest.mock('../omnis/receipt', () => ({ postOmnisReceipt: jest.fn(async () => true) }));
jest.mock('../logger/system', () => ({ SystemLogger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() } }));

const configMock = resolveAutoDocConfig as jest.Mock;
const transportMock = autoDocTransport as jest.Mock;
const receiptMock = postOmnisReceipt as jest.Mock;

const enabledConfig = {
	enabled: true,
	transport: 'stub',
	baseUrl: '',
	authMode: 'internal-key',
	apiKey: '',
	orgId: '',
	webUrl: '',
	pollIntervalSeconds: 15,
	autoProcessMaxMb: 25,
	autoProcessDailyCap: 50,
};

function makeTransport(overrides: Record<string, unknown> = {}) {
	return {
		kind: 'stub',
		listFeed: jest.fn(async () => ({ items: [], summary: { recent: 0, ready: 0, needsReview: 0 } })),
		getDocument: jest.fn(),
		submit: jest.fn(),
		confirm: jest.fn(async () => undefined),
		pushToCrm: jest.fn(async () => ({ crmRecordId: 'crm-1' })),
		reject: jest.fn(),
		...overrides,
	};
}

beforeEach(() => {
	configMock.mockReturnValue({ ...enabledConfig });
	receiptMock.mockClear();
});

describe('approveAutoDocDocument', () => {
	it('calls confirm BEFORE pushing to the CRM', async () => {
		const order: string[] = [];
		const transport = makeTransport({
			confirm: jest.fn(async () => {
				order.push('confirm');
			}),
			pushToCrm: jest.fn(async () => {
				order.push('push');
				return { crmRecordId: 'crm-1' };
			}),
		});
		transportMock.mockReturnValue(transport);

		await approveAutoDocDocument({ documentId: 'd1', matterId: 'm-1', uid: 'u1' });

		expect(order).toEqual(['confirm', 'push']);
	});

	it('ABORTS the CRM push when confirm fails', async () => {
		// The order is not interchangeable: pushing an unconfirmed extraction
		// writes fields into a live matter that nobody signed off on.
		const transport = makeTransport({
			confirm: jest.fn(async () => {
				throw new Error('confirm rejected');
			}),
		});
		transportMock.mockReturnValue(transport);

		await expect(approveAutoDocDocument({ documentId: 'd1', matterId: 'm-1', uid: 'u1' })).rejects.toThrow('confirm rejected');
		expect(transport.pushToCrm).not.toHaveBeenCalled();
	});

	it('propagates a failed CRM push — a swallowed write is silent data loss', async () => {
		const transport = makeTransport({
			pushToCrm: jest.fn(async () => {
				throw new Error('crm down');
			}),
		});
		transportMock.mockReturnValue(transport);

		await expect(approveAutoDocDocument({ documentId: 'd1', matterId: 'm-1', uid: 'u1' })).rejects.toThrow('crm down');
	});

	it('forwards corrections to confirm', async () => {
		const transport = makeTransport();
		transportMock.mockReturnValue(transport);

		await approveAutoDocDocument({
			documentId: 'd1',
			matterId: 'm-1',
			uid: 'u1',
			corrections: [{ name: 'amount', value: '$99.00' }],
		});

		expect(transport.confirm).toHaveBeenCalledWith('d1', { matterId: 'm-1', corrections: [{ name: 'amount', value: '$99.00' }] });
	});

	it('posts a receipt naming the matter when the document came from a channel', async () => {
		transportMock.mockReturnValue(makeTransport());

		const result = await approveAutoDocDocument({ documentId: 'd1', matterId: 'm-1', uid: 'u1', roomId: 'r-1' });

		expect(receiptMock).toHaveBeenCalledTimes(1);
		expect(receiptMock.mock.calls[0][0]).toMatchObject({ rid: 'r-1', uid: 'u1', matterName: 'Alvarez v. Diaz' });
		expect(result.receiptPosted).toBe(true);
	});

	it('does NOT fail the approve when the receipt cannot be posted', async () => {
		// The filing already happened; an error here would invite a duplicate approve.
		transportMock.mockReturnValue(makeTransport());
		receiptMock.mockResolvedValueOnce(false);

		const result = await approveAutoDocDocument({ documentId: 'd1', matterId: 'm-1', uid: 'u1', roomId: 'r-1' });

		expect(result.crmRecordId).toBe('crm-1');
		expect(result.receiptPosted).toBe(false);
	});

	it('refuses to run at all when AutoDoc is disabled', async () => {
		configMock.mockReturnValue({ ...enabledConfig, enabled: false });
		const transport = makeTransport();
		transportMock.mockReturnValue(transport);

		await expect(approveAutoDocDocument({ documentId: 'd1', matterId: 'm-1', uid: 'u1' })).rejects.toThrow('not enabled');
		expect(transport.confirm).not.toHaveBeenCalled();
	});
});

describe('listAutoDocFeed', () => {
	it('DEGRADES to an unreachable feed rather than throwing', async () => {
		transportMock.mockReturnValue(
			makeTransport({
				listFeed: jest.fn(async () => {
					throw new Error('upstream down');
				}),
			}),
		);

		const feed = await listAutoDocFeed();

		// `reachable: false` is what lets the widget say "Can't reach AutoDoc right
		// now" instead of rendering an empty list, which reads as "no items".
		expect(feed.reachable).toBe(false);
		expect(feed.items).toEqual([]);
	});

	it('reports reachable with no items when the product is switched off', async () => {
		configMock.mockReturnValue({ ...enabledConfig, enabled: false });

		const feed = await listAutoDocFeed();

		expect(feed.enabled).toBe(false);
		expect(feed.reachable).toBe(true);
	});
});
