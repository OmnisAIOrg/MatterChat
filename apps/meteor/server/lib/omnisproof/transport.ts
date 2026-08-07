import { createHmac, timingSafeEqual } from 'crypto';

import type { OmnisProofConfig } from './config';
import type { EnvelopeSigner } from './store';
import { omnisFetchJson } from '../omnis/http';

/**
 * The only thing in the OmnisProof integration that touches the wire.
 *
 * The stub is a genuinely useful fixture here, not just a placeholder: the
 * whole point of this feature is what happens to the MATTER when an envelope
 * completes, and that chain — send → webhook → automations → receipt — is fully
 * exercisable against the stub with no e-sign account at all.
 */

export type EsignSendRequest = {
	documentName: string;
	/** LitBox reference for an existing document. Mutually exclusive with `content`. */
	documentRef?: string;
	content?: Buffer;
	contentType?: string;
	signers: EnvelopeSigner[];
	subject?: string;
};

export type EsignSendResponse = { envelopeId: string; signUrl?: string };

export type EsignEnvelopeState = {
	envelopeId: string;
	status: 'sent' | 'viewed' | 'signed' | 'declined' | 'voided';
	/** Reference to the executed PDF, present once signed. */
	signedDocRef?: string;
};

export interface IOmnisProofTransport {
	readonly kind: 'stub' | 'native';
	send(request: EsignSendRequest): Promise<EsignSendResponse>;
	remind(envelopeId: string): Promise<void>;
	getEnvelope(envelopeId: string): Promise<EsignEnvelopeState | null>;
}

export class OmnisProofStubTransport implements IOmnisProofTransport {
	readonly kind = 'stub' as const;

	private counter = 0;

	private states = new Map<string, EsignEnvelopeState>();

	async send(request: EsignSendRequest): Promise<EsignSendResponse> {
		this.counter += 1;
		const envelopeId = `stub-env-${this.counter}`;
		this.states.set(envelopeId, { envelopeId, status: 'sent' });
		return { envelopeId, signUrl: `https://example.invalid/sign/${envelopeId}?doc=${encodeURIComponent(request.documentName)}` };
	}

	async remind(): Promise<void> {
		// No-op: the stub has no recipient to remind.
	}

	async getEnvelope(envelopeId: string): Promise<EsignEnvelopeState | null> {
		return this.states.get(envelopeId) ?? null;
	}

	/** Test seam: drive an envelope through its lifecycle without a provider. */
	setState(envelopeId: string, status: EsignEnvelopeState['status'], signedDocRef?: string): void {
		this.states.set(envelopeId, { envelopeId, status, ...(signedDocRef ? { signedDocRef } : {}) });
	}
}

export class OmnisProofNativeTransport implements IOmnisProofTransport {
	readonly kind = 'native' as const;

	constructor(private readonly cfg: OmnisProofConfig) {}

	async send(request: EsignSendRequest): Promise<EsignSendResponse> {
		const raw = await omnisFetchJson<{ envelopeId?: string; id?: string; signUrl?: string; sign_url?: string }>(
			this.cfg,
			'/api/envelopes',
			{
				method: 'POST',
				json: {
					name: request.documentName,
					...(request.documentRef ? { document_ref: request.documentRef } : {}),
					...(request.subject ? { subject: request.subject } : {}),
					// Ordered signing: OmnisProof honours `order` as the routing sequence.
					signers: request.signers.map((s) => ({ name: s.name, email: s.email, role: s.role, order: s.order })),
					...(this.cfg.orgId ? { organization_id: this.cfg.orgId } : {}),
				},
			},
		);

		const envelopeId = raw.envelopeId ?? raw.id;
		if (!envelopeId) {
			throw new Error('OmnisProof returned no envelope id');
		}
		return { envelopeId, ...(raw.signUrl ?? raw.sign_url ? { signUrl: raw.signUrl ?? raw.sign_url } : {}) };
	}

	async remind(envelopeId: string): Promise<void> {
		await omnisFetchJson<unknown>(this.cfg, `/api/envelopes/${encodeURIComponent(envelopeId)}/remind`, { method: 'POST' });
	}

	async getEnvelope(envelopeId: string): Promise<EsignEnvelopeState | null> {
		const raw = await omnisFetchJson<Record<string, unknown>>(this.cfg, `/api/envelopes/${encodeURIComponent(envelopeId)}`);
		const status = String(raw.status ?? '');
		if (!['sent', 'viewed', 'signed', 'declined', 'voided'].includes(status)) {
			return null;
		}
		return {
			envelopeId,
			status: status as EsignEnvelopeState['status'],
			...(typeof raw.signed_doc_ref === 'string' ? { signedDocRef: raw.signed_doc_ref } : {}),
		};
	}
}

const stubSingleton = new OmnisProofStubTransport();

export function omnisProofTransport(cfg: OmnisProofConfig): IOmnisProofTransport {
	return cfg.transport === 'native' ? new OmnisProofNativeTransport(cfg) : stubSingleton;
}

export function stubProofTransportForTests(): OmnisProofStubTransport {
	return stubSingleton;
}

// ---------------------------------------------------------------------------
// Webhook signature verification
// ---------------------------------------------------------------------------

/**
 * Verify a webhook signature.
 *
 * **Unsigned callbacks are treated as hostile.** This endpoint can move a
 * matter's status, set its fee percentage and start its limitations clock, so
 * an unauthenticated POST to it is a write to the firm's case data. A missing
 * secret therefore rejects every delivery rather than falling open — a webhook
 * that silently accepts anything while the secret is unset is the worst
 * possible default.
 *
 * Comparison is constant-time; `timingSafeEqual` throws on unequal lengths, so
 * the length check comes first.
 */
export function verifyWebhookSignature(secret: string, rawBody: string, signatureHeader: string | undefined): boolean {
	if (!secret || !signatureHeader) {
		return false;
	}
	// Accept both `sha256=<hex>` and a bare hex digest.
	const provided = signatureHeader.startsWith('sha256=') ? signatureHeader.slice(7) : signatureHeader;
	const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');

	if (provided.length !== expected.length) {
		return false;
	}
	try {
		return timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expected, 'hex'));
	} catch {
		return false;
	}
}
