import { resolveOmnisProofConfig } from './config';
import { omnisProofTransport } from './transport';
import type { IEsignProvider } from '../boards/leads/signupPackets';

/**
 * The live OmnisProof adapter for the e-sign provider seam.
 *
 * `server/lib/boards/leads/signupPackets.ts` defines `IEsignProvider` and its
 * `PROVIDERS` registry, with two explicit TODO markers asking for exactly this:
 *
 *   > TODO(esign): swap for a live DocuSign/Dropbox-Sign/OmnisProof adapter that
 *   > uploads input.docRef, adds the signer, and returns the real envelope id +
 *   > signing URL
 *   > TODO(esign): register live DocuSign/Dropbox-Sign/OmnisProof adapters in PROVIDERS
 *
 * **The contract is the integration point.** This drops into `PROVIDERS` with
 * no other surgery, so the sign-up packet state machine keeps working exactly
 * as it did — same `send()` signature, same synthetic-id fallback semantics
 * when unconfigured. There is deliberately no parallel path.
 */
export const omnisProofEsignProvider: IEsignProvider = {
	name: 'omnisproof',

	async send(input) {
		const cfg = resolveOmnisProofConfig();
		if (!cfg.enabled) {
			// Registered but switched off. Throwing here would break packet sends
			// for a workspace that never asked for OmnisProof, so the caller's
			// fallback-to-manual behaviour is preserved by declining loudly.
			throw new Error('OmnisProof is not enabled on this workspace');
		}

		const { envelopeId, signUrl } = await omnisProofTransport(cfg).send({
			documentName: input.subject ?? input.docRef,
			documentRef: input.docRef,
			signers: input.signerEmail
				? [{ name: input.signerName ?? input.signerEmail, email: input.signerEmail, role: 'client', order: 1 }]
				: [],
			...(input.subject ? { subject: input.subject } : {}),
		});

		return { envelopeId, ...(signUrl ? { signUrl } : {}) };
	},
};
