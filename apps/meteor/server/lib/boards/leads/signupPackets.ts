import type { ISignUpPacket, SignUpPacketStatus, EsignProvider, ILead } from '@rocket.chat/core-typings';
import { BoardsSignupPackets, BoardsLeads, BoardsActivities } from '@rocket.chat/models';
import { Meteor } from 'meteor/meteor';

import { hasPermissionAsync } from '../../authorization/hasPermission';
import { omnisProofEsignProvider } from '../../omnisproof/provider';

/**
 * Sign-up / retainer packet + e-sign state machine (M6 — intake-lead-management
 * .md §10). A packet is generated from a doc template merged with lead data,
 * stored by reference (LitBox), then driven through:
 *   draft -> generated -> sent -> viewed -> signed
 *   (sent|viewed) -> declined ; (any) -> voided
 *
 * A SIGNED packet arms conversion (the second conversion gate alongside the
 * POA-Received stage) — on `signed` we stamp the executed doc ref so the matter
 * carries it forward and mark the lead activity. The e-sign provider is a SEAM
 * (`IEsignProvider`): a manual default ships now; live DocuSign/Dropbox-Sign/
 * OmnisProof creds are NOT required (TODO markers below).
 */

// ---------------------------------------------------------------------------
// E-sign provider seam (stub — no live creds required)
// ---------------------------------------------------------------------------

export type EsignSendInput = {
	provider: EsignProvider;
	docRef: string; // unsigned PDF (LitBox ref)
	signerEmail?: string;
	signerName?: string;
	subject?: string;
};

export type EsignSendResult = {
	/** provider envelope id (manual provider returns a synthetic id). */
	envelopeId: string;
	/** signing URL when the provider returns one (unused for 'manual'). */
	signUrl?: string;
};

/** The provider contract a real DocuSign/Dropbox-Sign/OmnisProof adapter implements. */
export interface IEsignProvider {
	readonly name: EsignProvider;
	send(input: EsignSendInput): Promise<EsignSendResult>;
}

/**
 * Manual / no-op provider: the firm e-mails the doc out of band and records the
 * outcome by hand. Returns a synthetic envelope id so the state machine has a
 * handle. This is the DEFAULT until a live provider adapter is wired.
 */
const manualProvider: IEsignProvider = {
	name: 'manual',
	async send(input) {
		return { envelopeId: `manual:${input.docRef}:${Date.now()}` };
	},
};

/**
 * Live adapters register here keyed by provider name.
 *
 * `omnisproof` is wired (server/lib/omnisproof/provider.ts). DocuSign and
 * Dropbox-Sign remain unregistered and fall back to `manual` — the seam is the
 * integration point, so adding one is a single line here plus an adapter that
 * implements {@link IEsignProvider}.
 */
const PROVIDERS: Partial<Record<EsignProvider, IEsignProvider>> = {
	manual: manualProvider,
	omnisproof: omnisProofEsignProvider,
};

/**
 * Resolve a provider adapter by name, falling back to manual.
 *
 * The fallback is load-bearing: a packet whose stored provider is no longer
 * registered still sends by hand rather than throwing, so a configuration
 * change cannot strand existing packets mid-state-machine.
 */
function resolveProvider(provider?: EsignProvider): IEsignProvider {
	return (provider && PROVIDERS[provider]) || manualProvider;
}

// ---------------------------------------------------------------------------
// generateSignupPacket
// ---------------------------------------------------------------------------

export type GenerateSignupPacketResult = { packet: ISignUpPacket };

/**
 * Generate a sign-up packet for a lead from a doc template. Merges lead data into
 * the template (the actual doc render is a LitBox/OnlyOffice concern — here we
 * record the packet with status 'generated' and a `generatedDocRef` placeholder
 * the doc service fills). Idempotent-ish: a fresh packet per call (a lead can be
 * re-sent a packet); the latest non-voided packet is the active gate.
 */
export async function generateSignupPacket(
	uid: string,
	leadId: string,
	docTemplateId: string,
	opts: { esignProvider?: EsignProvider; generatedDocRef?: string; signerEmail?: string } = {},
): Promise<GenerateSignupPacketResult> {
	if (!(await hasPermissionAsync(uid, 'boards-leads-signups-manage'))) {
		throw new Meteor.Error('error-not-allowed', 'Not allowed', { method: 'boards.leads.signupPacket.generate' });
	}
	const lead = await BoardsLeads.findOneById(leadId);
	if (!lead) {
		throw new Meteor.Error('error-lead-not-found', 'Lead not found', { method: 'boards.leads.signupPacket.generate' });
	}

	const signerEmail = opts.signerEmail ?? lead.contact?.email;
	const doc: Omit<ISignUpPacket, '_id' | '_updatedAt'> = {
		leadId,
		docTemplateId,
		...(lead.caseTypeId ? { caseTypeId: lead.caseTypeId } : {}),
		status: 'generated',
		esignProvider: opts.esignProvider ?? 'manual',
		...(opts.generatedDocRef ? { generatedDocRef: opts.generatedDocRef } : {}),
		...(signerEmail ? { signerEmail } : {}),
	};

	const { insertedId } = await BoardsSignupPackets.insertOne(doc);
	const packet = await BoardsSignupPackets.findOneById(insertedId);
	if (!packet) {
		throw new Meteor.Error('error-signup-packet-not-found', 'Packet not found after create', {
			method: 'boards.leads.signupPacket.generate',
		});
	}

	await logPacketActivity(uid, lead, { packetId: insertedId, status: 'generated', docTemplateId });
	return { packet };
}

// ---------------------------------------------------------------------------
// sendSignupPacket (through the e-sign seam)
// ---------------------------------------------------------------------------

export type SendSignupPacketResult = { packet: ISignUpPacket; envelopeId: string; signUrl?: string };

/**
 * Send a generated packet for signature through the e-sign provider seam. Moves
 * the packet draft/generated -> sent and records the provider envelope id. An
 * optional `provider` override switches the packet's e-sign provider before send
 * (the wire surface exposes it; it still falls back to manual when unregistered).
 */
export async function sendSignupPacket(
	uid: string,
	packetId: string,
	opts: { subject?: string; provider?: EsignProvider } = {},
): Promise<SendSignupPacketResult> {
	if (!(await hasPermissionAsync(uid, 'boards-leads-signups-manage'))) {
		throw new Meteor.Error('error-not-allowed', 'Not allowed', { method: 'boards.leads.signupPacket.send' });
	}
	const packet = await BoardsSignupPackets.findOneById(packetId);
	if (!packet) {
		throw new Meteor.Error('error-signup-packet-not-found', 'Packet not found', { method: 'boards.leads.signupPacket.send' });
	}
	if (!packet.generatedDocRef) {
		throw new Meteor.Error('error-signup-packet-not-generated', 'Packet has no generated document to send', {
			method: 'boards.leads.signupPacket.send',
		});
	}

	const provider = resolveProvider(opts.provider ?? packet.esignProvider);
	const { envelopeId, signUrl } = await provider.send({
		provider: provider.name,
		docRef: packet.generatedDocRef,
		...(packet.signerEmail ? { signerEmail: packet.signerEmail } : {}),
		...(opts.subject ? { subject: opts.subject } : {}),
	});

	await BoardsSignupPackets.updatePacket(packetId, { esignEnvelopeId: envelopeId, esignProvider: provider.name });
	await BoardsSignupPackets.setStatus(packetId, 'sent', new Date());

	const lead = await BoardsLeads.findOneById(packet.leadId);
	if (lead) {
		await logPacketActivity(uid, lead, { packetId, status: 'sent', envelopeId });
	}

	const fresh = await BoardsSignupPackets.findOneById(packetId);
	if (!fresh) {
		throw new Meteor.Error('error-signup-packet-not-found', 'Packet not found', { method: 'boards.leads.signupPacket.send' });
	}
	return { packet: fresh, envelopeId, ...(signUrl ? { signUrl } : {}) };
}

// ---------------------------------------------------------------------------
// setSignupPacketStatus (state machine + signing arms conversion)
// ---------------------------------------------------------------------------

/** Allowed forward transitions of the e-sign state machine. */
const TRANSITIONS: Record<SignUpPacketStatus, SignUpPacketStatus[]> = {
	draft: ['generated', 'sent', 'voided'],
	generated: ['sent', 'voided'],
	sent: ['viewed', 'signed', 'declined', 'voided'],
	viewed: ['signed', 'declined', 'voided'],
	signed: ['voided'],
	declined: ['voided'],
	voided: [],
};

export type SetPacketStatusParams = {
	status: SignUpPacketStatus;
	/** required when status === 'signed': the executed PDF ref (LitBox). */
	signedDocRef?: string;
	at?: Date;
};

export type SetPacketStatusResult = {
	packet: ISignUpPacket;
	/** true when this transition put the packet into 'signed' (conversion is now armed). */
	conversionArmed: boolean;
};

/**
 * Advance a packet's status through the validated state machine. On `signed` we
 * require + stamp the `signedDocRef` (carried to the matter on convert) and
 * report `conversionArmed:true` so the caller can surface the Convert action.
 * This is also the e-sign webhook reconciliation entrypoint (provider → status).
 */
export async function setSignupPacketStatus(uid: string, packetId: string, params: SetPacketStatusParams): Promise<SetPacketStatusResult> {
	if (!(await hasPermissionAsync(uid, 'boards-leads-signups-manage'))) {
		throw new Meteor.Error('error-not-allowed', 'Not allowed', { method: 'boards.leads.signupPacket.setStatus' });
	}
	const packet = await BoardsSignupPackets.findOneById(packetId);
	if (!packet) {
		throw new Meteor.Error('error-signup-packet-not-found', 'Packet not found', {
			method: 'boards.leads.signupPacket.setStatus',
		});
	}

	const allowed = TRANSITIONS[packet.status] ?? [];
	if (params.status !== packet.status && !allowed.includes(params.status)) {
		throw new Meteor.Error('error-invalid-packet-transition', `Cannot move packet from ${packet.status} to ${params.status}`, {
			method: 'boards.leads.signupPacket.setStatus',
		});
	}

	const at = params.at ?? new Date();
	let conversionArmed = false;

	if (params.status === 'signed') {
		if (!params.signedDocRef) {
			throw new Meteor.Error('error-signed-doc-ref-required', 'A signed document reference is required to mark signed', {
				method: 'boards.leads.signupPacket.setStatus',
			});
		}
		await BoardsSignupPackets.recordSigned(packetId, params.signedDocRef, at);
		conversionArmed = true;
	} else {
		await BoardsSignupPackets.setStatus(packetId, params.status, at);
	}

	const lead = await BoardsLeads.findOneById(packet.leadId);
	if (lead) {
		await logPacketActivity(uid, lead, { packetId, status: params.status, ...(conversionArmed ? { conversionArmed: true } : {}) });
	}

	const fresh = await BoardsSignupPackets.findOneById(packetId);
	if (!fresh) {
		throw new Meteor.Error('error-signup-packet-not-found', 'Packet not found', {
			method: 'boards.leads.signupPacket.setStatus',
		});
	}
	return { packet: fresh, conversionArmed };
}

/** The lead's most recent non-voided packet (the active sign-up gate). */
export async function getLatestPacket(uid: string, leadId: string): Promise<ISignUpPacket | null> {
	if (!(await hasPermissionAsync(uid, 'boards-leads-view'))) {
		throw new Meteor.Error('error-not-allowed', 'Not allowed', { method: 'boards.leads.signupPacket.latest' });
	}
	return BoardsSignupPackets.findLatestByLead(leadId);
}

/** Audit a packet transition onto the lead's card. */
async function logPacketActivity(uid: string, lead: ILead, to: Record<string, unknown>): Promise<void> {
	if (!lead.boardId) {
		return;
	}
	await BoardsActivities.log({
		boardId: lead.boardId,
		...(lead.cardId ? { cardId: lead.cardId } : {}),
		actor: uid,
		verb: 'field.changed',
		to: { signupPacket: true, ...to },
		ts: new Date(),
	});
}
