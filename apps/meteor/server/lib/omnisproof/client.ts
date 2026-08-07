import { applyEsignActions } from './automations';
import { resolveOmnisProofConfig } from './config';
import { claimCompletion, findEnvelope, listEnvelopes, markTerminal, markViewed, recordAppliedSteps, recordEnvelope } from './store';
import type { AppliedStep, EnvelopeRecord, EnvelopeSigner } from './store';
import { omnisProofTransport } from './transport';
import { SystemLogger } from '../logger/system';
import { matterDisplayName } from '../omnis/matter';
import { postOmnisReceipt } from '../omnis/receipt';

/** OmnisProof domain verbs. Reads degrade; writes throw. */

export type SignatureFeedRow = {
	envelopeId: string;
	documentName: string;
	signerName: string;
	status: 'sent' | 'viewed' | 'signed' | 'declined' | 'voided';
	/** True once past the overdue threshold and still unsigned. */
	overdue: boolean;
	sentAt: string;
	viewCount: number;
	matterName?: string;
};

export type SignatureFeed = {
	enabled: boolean;
	transport: 'stub' | 'native';
	reachable: boolean;
	webUrl: string;
	items: SignatureFeedRow[];
	summary: { out: number; signed: number; overdue: number };
};

/** A signature sitting unsigned this long is what a paralegal chases. */
const OVERDUE_DAYS = 5;

function isOverdue(record: EnvelopeRecord): boolean {
	if (record.status === 'signed' || record.status === 'declined' || record.status === 'voided') {
		return false;
	}
	return Date.now() - record.sentAt.getTime() > OVERDUE_DAYS * 24 * 60 * 60 * 1000;
}

export async function listSignatureFeed(matterId?: string): Promise<SignatureFeed> {
	const cfg = resolveOmnisProofConfig();
	const base = { enabled: cfg.enabled, transport: cfg.transport, webUrl: cfg.webUrl };

	if (!cfg.enabled) {
		return { ...base, reachable: true, items: [], summary: { out: 0, signed: 0, overdue: 0 } };
	}

	try {
		const records = await listEnvelopes(matterId ? { matterId } : {});
		const items = records.map(
			(record): SignatureFeedRow => ({
				envelopeId: record.envelopeId,
				documentName: record.documentName,
				signerName: record.signers[0]?.name ?? 'Unknown signer',
				status: record.status,
				overdue: isOverdue(record),
				sentAt: record.sentAt.toISOString(),
				viewCount: record.viewCount,
				...(record.matterName ? { matterName: record.matterName } : {}),
			}),
		);

		return {
			...base,
			reachable: true,
			items,
			summary: {
				out: items.filter((i) => i.status === 'sent' || i.status === 'viewed').length,
				signed: items.filter((i) => i.status === 'signed').length,
				overdue: items.filter((i) => i.overdue).length,
			},
		};
	} catch (err) {
		SystemLogger.warn({ msg: 'OmnisProof feed unavailable — serving a degraded feed', err });
		return { ...base, reachable: false, items: [], summary: { out: 0, signed: 0, overdue: 0 } };
	}
}

export type SendForSignatureInput = {
	documentName: string;
	documentRef?: string;
	signers: EnvelopeSigner[];
	/** Absent ⇒ a General send: saved to the user's LitBox, no matter updated. */
	matterId?: string;
	/** Required whenever `matterId` is set — a type is meaningless without one. */
	documentTypeKey?: string;
	roomId?: string;
	subject?: string;
	sentBy: { _id: string; username?: string };
};

/**
 * Send a document for signature and record the mapping that makes completion
 * meaningful.
 *
 * The envelope↔matter↔document-type record is written HERE, at send time,
 * because completion can arrive days later and nothing in that callback would
 * otherwise tell us what should fire.
 */
export async function sendForSignature(input: SendForSignatureInput): Promise<EnvelopeRecord> {
	const cfg = resolveOmnisProofConfig();
	if (!cfg.enabled) {
		throw new Error('OmnisProof is not enabled on this workspace');
	}
	if (input.signers.length === 0) {
		throw new Error('At least one signer is required');
	}
	// The fork is explicit, so an accidental omission cannot silently become a
	// General send that quietly updates nothing.
	if (input.matterId && !input.documentTypeKey) {
		throw new Error('A document type is required for a matter document');
	}

	const { envelopeId, signUrl } = await omnisProofTransport(cfg).send({
		documentName: input.documentName,
		...(input.documentRef ? { documentRef: input.documentRef } : {}),
		signers: input.signers,
		...(input.subject ? { subject: input.subject } : {}),
	});

	const matterName = input.matterId ? await matterDisplayName(input.matterId) : undefined;

	return recordEnvelope({
		envelopeId,
		provider: 'omnisproof',
		documentName: input.documentName,
		...(input.documentRef ? { documentRef: input.documentRef } : {}),
		signers: input.signers,
		...(input.matterId ? { matterId: input.matterId } : {}),
		...(matterName ? { matterName } : {}),
		...(input.documentTypeKey ? { documentTypeKey: input.documentTypeKey } : {}),
		...(input.roomId ? { roomId: input.roomId } : {}),
		sentBy: input.sentBy,
		...(signUrl ? { signUrl } : {}),
	});
}

export async function remindSigner(envelopeId: string): Promise<void> {
	const cfg = resolveOmnisProofConfig();
	if (!cfg.enabled) {
		throw new Error('OmnisProof is not enabled on this workspace');
	}
	await omnisProofTransport(cfg).remind(envelopeId);
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export type LifecycleEvent = 'sent' | 'viewed' | 'signed' | 'declined' | 'voided';

/**
 * Handle one envelope-lifecycle event.
 *
 * **Idempotent.** Providers retry, and firing the LOP automation twice would
 * double the lien-schedule entry. `claimCompletion` is an atomic
 * `completedAt: { $exists: false }` → `$set`, so exactly one delivery runs the
 * automations and every retry is a no-op that still reports success.
 */
export async function handleLifecycleEvent(
	envelopeId: string,
	event: LifecycleEvent,
	payload: { signedDocRef?: string } = {},
): Promise<{ applied: AppliedStep[]; duplicate: boolean }> {
	if (event === 'viewed') {
		await markViewed(envelopeId);
		return { applied: [], duplicate: false };
	}

	if (event === 'declined' || event === 'voided') {
		await markTerminal(envelopeId, event);
		return { applied: [], duplicate: false };
	}

	if (event !== 'signed') {
		return { applied: [], duplicate: false };
	}

	const envelope = await claimCompletion(envelopeId);
	if (!envelope) {
		// Unknown envelope, or a retry of one already completed. Both are
		// "nothing to do" — never an error, or the provider retries harder.
		return { applied: [], duplicate: true };
	}

	const applied = await applyEsignActions(envelope, payload.signedDocRef);
	await recordAppliedSteps(envelopeId, applied);

	// Receipt: enumerate what ACTUALLY fired, failures included.
	if (envelope.roomId) {
		const signer = envelope.signers[0]?.name ?? 'Signer';
		await postOmnisReceipt({
			rid: envelope.roomId,
			uid: envelope.sentBy._id,
			title: `✍️ ${envelope.documentName} — ${signer} · signed`,
			...(envelope.matterName ? { matterName: envelope.matterName } : {}),
			steps: applied,
			...(resolveOmnisProofConfig().webUrl
				? {
						link: {
							text: 'Open in OmnisProof',
							url: `${resolveOmnisProofConfig().webUrl.replace(/\/+$/, '')}/envelopes/${envelopeId}`,
						},
					}
				: {}),
		});
	}

	return { applied, duplicate: false };
}

export { findEnvelope };
