import { resolveAutoDocConfig } from './config';
import type { AutoDocConfig } from './config';
import { autoDocTransport } from './transport';
import type { AutoDocCorrection, AutoDocDocument, AutoDocFeed, AutoDocSubmitInput, IAutoDocTransport } from './transport';
import { matterDisplayName } from '../omnis/matter';
import { postOmnisReceipt } from '../omnis/receipt';
import { SystemLogger } from '../logger/system';

/**
 * AutoDoc domain verbs — pure, transport-agnostic, and the home of the business
 * rules. Nothing here knows whether it is talking to fixtures or a live backend.
 *
 * ## Reads degrade, writes throw
 *
 * A feed that cannot be fetched returns empty plus one warning and never takes
 * the room down. A write that fails MUST throw, because a swallowed write is
 * silent data loss — the user believes something was filed when it was not.
 */

function tx(cfg: AutoDocConfig): IAutoDocTransport {
	return autoDocTransport(cfg);
}

export type AutoDocFeedResult = AutoDocFeed & {
	enabled: boolean;
	transport: 'stub' | 'native';
	/** False when the upstream read failed — the client shows a degraded line, not an empty list. */
	reachable: boolean;
	webUrl: string;
};

/**
 * The queue feed. A READ, so it degrades: an unreachable AutoDoc yields an empty
 * list with `reachable: false` so the widget can say "Can't reach AutoDoc right
 * now" instead of rendering an empty list, which reads as "no items".
 */
export async function listAutoDocFeed(): Promise<AutoDocFeedResult> {
	const cfg = resolveAutoDocConfig();
	const base = {
		enabled: cfg.enabled,
		transport: cfg.transport,
		webUrl: cfg.webUrl,
	};

	if (!cfg.enabled) {
		return { ...base, reachable: true, items: [], summary: { recent: 0, ready: 0, needsReview: 0 } };
	}

	try {
		const feed = await tx(cfg).listFeed();
		return { ...base, reachable: true, ...feed };
	} catch (err) {
		SystemLogger.warn({ msg: 'AutoDoc feed unavailable — serving a degraded feed', err });
		return { ...base, reachable: false, items: [], summary: { recent: 0, ready: 0, needsReview: 0 } };
	}
}

/** One document, for the review panel. Read — returns null rather than throwing. */
export async function getAutoDocDocument(id: string): Promise<AutoDocDocument | null> {
	const cfg = resolveAutoDocConfig();
	if (!cfg.enabled) {
		return null;
	}
	try {
		return await tx(cfg).getDocument(id);
	} catch (err) {
		SystemLogger.warn({ msg: 'AutoDoc document fetch failed', id, err });
		return null;
	}
}

/**
 * Submit a document for processing. A WRITE — throws on failure so the caller
 * can tell the user the file was not accepted (it remains in the channel as a
 * normal attachment).
 */
export async function submitAutoDocDocument(input: AutoDocSubmitInput): Promise<AutoDocDocument> {
	const cfg = resolveAutoDocConfig();
	if (!cfg.enabled) {
		throw new Error('AutoDoc is not enabled on this workspace');
	}
	return tx(cfg).submit(input);
}

export type ApproveInput = {
	documentId: string;
	/** Resolved matter. Required — approving is the moment the filing decision is made. */
	matterId: string;
	corrections?: AutoDocCorrection[];
	/** Channel to post the receipt into, when the document came from one. */
	roomId?: string;
	/** Acting user — the receipt posts as them. */
	uid: string;
};

export type ApproveResult = {
	documentId: string;
	matterId: string;
	matterName: string;
	crmRecordId?: string;
	receiptPosted: boolean;
};

/**
 * Approve a document: confirm the extraction, then push it into the matter.
 *
 * **The order is not interchangeable and both steps throw.** If confirm fails
 * the push must NOT happen — pushing an unconfirmed extraction writes fields
 * into a live matter that nobody signed off on. `await` before the push is what
 * enforces that; do not parallelise these two calls.
 */
export async function approveAutoDocDocument(input: ApproveInput): Promise<ApproveResult> {
	const cfg = resolveAutoDocConfig();
	if (!cfg.enabled) {
		throw new Error('AutoDoc is not enabled on this workspace');
	}
	const transport = tx(cfg);

	// 1. Confirm FIRST. A throw here aborts the whole operation.
	await transport.confirm(input.documentId, {
		matterId: input.matterId,
		...(input.corrections?.length ? { corrections: input.corrections } : {}),
	});

	// 2. Only now push to the CRM.
	const { crmRecordId } = await transport.pushToCrm(input.documentId, { matterId: input.matterId });

	const matterName = await matterDisplayName(input.matterId);

	// 3. Receipt. Best-effort by design — the filing already happened, and an
	//    error here would invite the user to approve a second time.
	let receiptPosted = false;
	if (input.roomId) {
		receiptPosted = await postOmnisReceipt({
			rid: input.roomId,
			uid: input.uid,
			title: `📄 ${input.documentId} · filed`,
			matterName,
			steps: [
				{ ok: true, label: `Filed to ${matterName} → Documents` },
				{ ok: true, label: 'Extracted fields pushed to CasePro' },
				...(input.corrections?.length ? [{ ok: true, label: `${input.corrections.length} field(s) corrected before filing` }] : []),
			],
			...(cfg.webUrl ? { link: { text: 'Open in AutoDoc', url: `${cfg.webUrl.replace(/\/+$/, '')}/documents/${input.documentId}` } } : {}),
		});
	}

	return {
		documentId: input.documentId,
		matterId: input.matterId,
		matterName,
		...(crmRecordId ? { crmRecordId } : {}),
		receiptPosted,
	};
}

/** Reject a document. A WRITE — throws. */
export async function rejectAutoDocDocument(documentId: string, reason?: string): Promise<void> {
	const cfg = resolveAutoDocConfig();
	if (!cfg.enabled) {
		throw new Error('AutoDoc is not enabled on this workspace');
	}
	await tx(cfg).reject(documentId, reason);
}
