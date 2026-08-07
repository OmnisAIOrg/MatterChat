import { getDocumentType, renderActionLabel } from './documentTypes';
import type { EsignAction } from './documentTypes';
import type { AppliedStep, EnvelopeRecord } from './store';
import { caseProClient } from '../boards/casepro/client';
import { SystemLogger } from '../logger/system';

/**
 * Running a document type's actions against the matter.
 *
 * ## Every step reports, including the failures
 *
 * `applyEsignActions` never throws. It returns one {@link AppliedStep} per
 * action, `ok: false` for anything that did not happen. That is deliberate and
 * it is the opposite of the usual "fail fast" instinct:
 *
 *   - the signature ALREADY happened — the client signed, and the envelope is
 *     complete whatever we do next;
 *   - the receipt enumerates these steps into the channel, and **a
 *     partially-applied automation that looks complete is worse than one that
 *     reports the failure**. Omitting a failed line is how a matter ends up
 *     with a signed LOP and no lien-schedule entry that nobody notices.
 *
 * A later step is therefore attempted even when an earlier one failed: filing
 * the PDF is worth doing even if the lien schedule is unreachable.
 *
 * ## Preview and execution share this code
 *
 * {@link previewEsignActions} renders the same labels the receipt will use, so
 * "what will happen" and "what happened" cannot drift. That matters because the
 * consequence preview is the only thing standing between a user and a fee
 * agreement filed against the wrong case.
 */

export type PreviewStep = { label: string };

/** The consequence preview, rendered against the RESOLVED matter. */
export async function previewEsignActions(documentTypeKey: string | undefined, matterName: string | undefined): Promise<PreviewStep[]> {
	if (!matterName) {
		// "Pick a matter first; the document type and its data entry depend on it."
		return [];
	}
	if (!documentTypeKey) {
		return [];
	}
	const type = await getDocumentType(documentTypeKey);
	if (!type) {
		return [];
	}
	return type.actions.map((action) => ({ label: renderActionLabel(action, matterName) }));
}

export async function applyEsignActions(envelope: EnvelopeRecord, signedDocRef?: string): Promise<AppliedStep[]> {
	// A General (non-matter) send updates nothing. This is not an edge case to
	// tolerate — it is the documented behaviour of the fork in the send panel.
	if (!envelope.matterId || !envelope.documentTypeKey) {
		return [];
	}

	const type = await getDocumentType(envelope.documentTypeKey);
	if (!type) {
		return [
			{
				label: `Unknown document type "${envelope.documentTypeKey}"`,
				ok: false,
				detail: 'It may have been removed since this was sent — nothing was applied.',
			},
		];
	}

	const matterName = envelope.matterName ?? envelope.matterId;
	const steps: AppliedStep[] = [];

	for (const action of type.actions) {
		const label = renderActionLabel(action, matterName);
		try {
			const detail = await runAction(action, envelope, signedDocRef);
			steps.push({ label, ok: true, ...(detail ? { detail } : {}) });
		} catch (err) {
			// Recorded, not thrown. See the note above.
			SystemLogger.warn({ msg: 'OmnisProof automation step failed', envelopeId: envelope.envelopeId, action: action.kind, err });
			steps.push({ label, ok: false, detail: err instanceof Error ? err.message : 'Unknown error' });
		}
	}

	steps.push({ label: `Matter updated in CasePro`, ok: steps.every((s) => s.ok) });
	return steps;
}

/**
 * Perform one action.
 *
 * Every verb goes through the EXISTING CasePro client rather than a second path
 * to the CRM, for the same reason the matter picker does: CasePro remains the
 * system of record, and a parallel writer is how two systems start disagreeing
 * about a matter's status.
 *
 * @returns an optional human-readable detail for the receipt line.
 */
async function runAction(action: EsignAction, envelope: EnvelopeRecord, signedDocRef?: string): Promise<string | undefined> {
	const matterId = envelope.matterId as string;
	const params = action.params ?? {};

	switch (action.kind) {
		case 'file-document': {
			// Reference-share: the signed PDF already exists in LitBox, so this
			// carries its ref and moves no bytes.
			const ref = signedDocRef ?? envelope.documentRef;
			if (!ref) {
				throw new Error('No signed document reference was returned by the provider');
			}
			await writeMatterField(matterId, `document:${String(params.folder ?? 'Documents')}`, ref);
			return undefined;
		}

		case 'set-field': {
			const field = typeof params.field === 'string' ? params.field : undefined;
			if (field) {
				await writeMatterField(matterId, field, params.value ?? true);
			}
			if (typeof params.stampDate === 'string') {
				await writeMatterField(matterId, params.stampDate, new Date().toISOString());
			}
			if (typeof params.expiryMonths === 'number' && field) {
				const expiry = new Date();
				expiry.setMonth(expiry.getMonth() + params.expiryMonths);
				await writeMatterField(matterId, `${field}_expires_at`, expiry.toISOString());
				return `expires ${expiry.toLocaleDateString()}`;
			}
			return undefined;
		}

		case 'set-status': {
			const to = typeof params.to === 'string' ? params.to : undefined;
			if (!to) {
				throw new Error('No target status configured');
			}
			await writeMatterField(matterId, 'status', to);
			return undefined;
		}

		case 'start-sol-clock': {
			await writeMatterField(matterId, 'sol_clock_started_at', new Date().toISOString());
			return undefined;
		}

		case 'add-to-lien-schedule': {
			const provider = envelope.signers.find((s) => s.role === 'provider');
			if (!provider) {
				throw new Error('No provider signer on this envelope to add to the lien schedule');
			}
			await writeMatterField(matterId, 'lien_schedule_add', provider.name);
			return provider.name;
		}

		case 'authorize-provider': {
			const provider = envelope.signers.find((s) => s.role === 'provider');
			if (!provider) {
				throw new Error('No provider signer on this envelope to authorize');
			}
			await writeMatterField(matterId, 'provider_authorized', provider.name);
			return provider.name;
		}

		case 'unlock-records-requests': {
			await writeMatterField(matterId, 'records_requests_unlocked', true);
			return undefined;
		}

		case 'queue-task': {
			const task = typeof params.task === 'string' ? params.task : 'Follow up';
			await writeMatterField(matterId, 'queued_task', task);
			return task;
		}

		case 'open-checklist': {
			await writeMatterField(matterId, 'checklist_open', String(params.checklist ?? ''));
			return undefined;
		}

		default: {
			// Exhaustiveness: a new verb added to the union without a branch here
			// fails the build rather than silently doing nothing.
			const exhaustive: never = action.kind;
			throw new Error(`Unhandled e-sign action ${String(exhaustive)}`);
		}
	}
}

/**
 * Write one field onto a matter, through the EXISTING CasePro client
 * (`updateMatter` → `tx.update('matters', …)`).
 *
 * Isolated behind a single function so the whole automation surface has ONE
 * write path to audit, and so the day CasePro exposes a richer verb (a real
 * lien-schedule endpoint rather than a field write, say) there is exactly one
 * place to change.
 *
 * Throws on failure, which is what turns the step into an `ok: false` line in
 * the receipt. A swallowed write here would claim the matter was updated when
 * it was not.
 */
async function writeMatterField(matterId: string, field: string, value: unknown): Promise<void> {
	await caseProClient.updateMatter(matterId, { [field]: value });
}
