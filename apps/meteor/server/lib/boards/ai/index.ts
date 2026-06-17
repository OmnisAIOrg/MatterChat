import type { IBoardCard, ILead, IMatterSnapshot } from '@rocket.chat/core-typings';

import {
	resolveAiProvider,
	setAiProviderOverride,
	type AiTask,
	type AiContext,
	type AiGenerateInput,
	type AiGenerateOutput,
	type IAiProvider,
} from './provider';

/**
 * Boards AI — public seam (M8 — §B "AI"). One {@link generate} entry point used by
 * BOTH the automation `ai.generate` action (server/services/automation/actions/ai.ts) and
 * the REST surface (app/api/server/v1/boards-ai.ts).
 *
 * Responsibilities split:
 *  - This module RENDERS context (matter snapshot / lead / card → a human-readable block)
 *    and dispatches to the configured provider via {@link resolveAiProvider}.
 *  - ./provider owns transport + provider selection + graceful degrade.
 *
 * The context builders read ONLY already-loaded docs (a card's cached matter snapshot, an
 * ILead, a card description). They never call CasePro themselves — callers that want a
 * fresh snapshot refresh it first (matters service) and hand us the card. Money/date fields
 * on the snapshot are already coerced by the M2 mapping, so formatting here is display-only.
 */

export {
	resolveAiProvider,
	setAiProviderOverride,
	type AiTask,
	type AiContext,
	type AiGenerateInput,
	type AiGenerateOutput,
	type IAiProvider,
};

// ---------------------------------------------------------------------------
// Formatting helpers (display-only; never throw on odd input)
// ---------------------------------------------------------------------------

function money(value: number | undefined): string | undefined {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return undefined;
	}
	try {
		return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
	} catch {
		return `$${Math.round(value)}`;
	}
}

function date(value: Date | string | undefined): string | undefined {
	if (!value) {
		return undefined;
	}
	const d = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(d.getTime())) {
		return undefined;
	}
	return d.toISOString().slice(0, 10);
}

/** Join `label: value` lines, dropping any whose value is empty/undefined. */
function lines(rows: [string, string | number | undefined][]): string {
	return rows
		.filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '')
		.map(([label, v]) => `- ${label}: ${v}`)
		.join('\n');
}

// ---------------------------------------------------------------------------
// Context builders
// ---------------------------------------------------------------------------

/** Render a CasePro matter snapshot into the AI context block. */
export function buildMatterContext(snapshot: IMatterSnapshot): AiContext {
	const text = lines([
		['Matter', snapshot.matterName],
		['Matter number', snapshot.matterNumber],
		['Cause number', snapshot.causeNumber],
		['Client', snapshot.clientName],
		['Practice area', snapshot.practiceArea],
		['Stage', snapshot.stageName],
		['Sub-stage', snapshot.subStageName],
		['Date of incident', date(snapshot.incidentDate)],
		['Statute of limitations', date(snapshot.solDate)],
		['Liability', snapshot.liabilityStatus],
		['Medical providers', snapshot.providerCount],
		['Total billed', money(snapshot.totalBilled)],
		['Total balance', money(snapshot.totalBalance)],
		['Last demand', money(snapshot.lastDemandAmount)],
		['Last offer', money(snapshot.lastOfferAmount)],
		['Demand expiration', date(snapshot.demandExpiration)],
		['Settlement amount', money(snapshot.settlementAmount)],
	]);
	return {
		kind: 'matter',
		subjectId: snapshot.matterId,
		text,
		fields: {
			matterId: snapshot.matterId,
			...(snapshot.solDate ? { solDate: date(snapshot.solDate) } : {}),
			...(typeof snapshot.totalBilled === 'number' ? { totalBilled: snapshot.totalBilled } : {}),
			...(typeof snapshot.lastDemandAmount === 'number' ? { lastDemandAmount: snapshot.lastDemandAmount } : {}),
			...(snapshot.liabilityStatus ? { liabilityStatus: snapshot.liabilityStatus } : {}),
		},
	};
}

/** Render an intake lead into the AI context block. */
export function buildLeadContext(lead: ILead): AiContext {
	const c = lead.contact ?? {};
	const name = c.fullName || [c.firstName, c.lastName].filter(Boolean).join(' ').trim() || undefined;
	const incident = lead.incident;
	const text = lines([
		['Prospect', name],
		['Phone', c.phone || c.mobile],
		['Email', c.email],
		['Practice area', lead.practiceArea],
		['Incident type', incident?.incidentType],
		['Date of incident', date(incident?.incidentDate)],
		['Jurisdiction', incident?.jurisdictionState],
		['Injuries', incident?.injuries?.length ? incident.injuries.join(', ') : undefined],
		['Incident description', incident?.incidentDescription],
		['Lead score', lead.qualification?.score],
		['Qualified', lead.qualification?.qualified === undefined ? undefined : lead.qualification.qualified ? 'yes' : 'no'],
		['Marketing source', lead.attribution?.source],
		['Statute of limitations', date(lead.solDate)],
	]);
	return {
		kind: 'lead',
		subjectId: lead._id,
		text,
	};
}

/** Render a generic card (no matter/lead link) from its title + description. */
export function buildCardContext(card: IBoardCard): AiContext {
	const text = lines([
		['Card', card.title],
		['Description', card.description],
	]);
	return {
		kind: 'card',
		subjectId: card._id,
		text,
	};
}

// ---------------------------------------------------------------------------
// Public generate entry point
// ---------------------------------------------------------------------------

/**
 * Generate AI output for a task against a pre-built context. Resolves the provider for the
 * task (LitDraft for demands, Claude for summaries/custom) and delegates. Returns the
 * provider's {@link AiGenerateOutput} verbatim — including the degraded shape
 * (`generated:false` + `note`) when no provider/key/url is configured. NEVER throws: a
 * provider exception is already caught inside the provider, and this wrapper adds a final
 * guard so callers (action handler, REST) can rely on a result object in all cases.
 */
export async function generate(input: AiGenerateInput): Promise<AiGenerateOutput> {
	try {
		const provider = resolveAiProvider(input.task);
		return await provider.generate(input);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { generated: false, text: '', provider: 'none', note: `AI generation failed: ${message}` };
	}
}
