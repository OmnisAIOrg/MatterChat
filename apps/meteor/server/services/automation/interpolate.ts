import { settings } from '../../settings';
import type { AutomationContext } from './context';

/**
 * Variable interpolation (M7 — 05-automation-engine.md §6). Recursively walks the
 * strings in an action's params, replacing `{{token}}` (and the bare `{token}` the
 * spec also writes) with values resolved from the run subject. Unknown tokens render
 * as '' so a typo never throws — the runner records it as a soft note, not a failure.
 *
 * Tokens (case-insensitive on the leaf): card.title / card.url / card.due / card.list,
 * board.name, me / user.name, now / now+14d / now-2h, field:<name>, lead.firstName /
 * lead.lastName / lead.fullName / lead.source / lead.owner / lead.email / lead.phone,
 * matter.clientName / matter.solDate / matter.demandAmount / matter.stage / matter.number,
 * firm.name.
 *
 * Date math (`now±<n><unit>`) returns an ISO string. Money/date snapshot fields are
 * formatted for human-readable comment/email bodies (the snapshot already coerced the
 * CasePro numeric-as-string per the M2 contract).
 */

const TOKEN_RE = /\{\{?\s*([\w.+\-: ]+?)\s*\}?\}/g;

const UNIT_MS: Record<string, number> = {
	m: 60 * 1000,
	h: 60 * 60 * 1000,
	d: 24 * 60 * 60 * 1000,
	w: 7 * 24 * 60 * 60 * 1000,
};

/** Resolve `now`, `now+14d`, `now-2h` → ISO; returns null if not a now-expression. */
export function resolveNowExpression(token: string, base: Date = new Date()): string | null {
	const t = token.trim().toLowerCase();
	if (t === 'now') {
		return base.toISOString();
	}
	const m = /^now\s*([+-])\s*(\d+)\s*([mhdw])$/.exec(t);
	if (!m) {
		return null;
	}
	const sign = m[1] === '-' ? -1 : 1;
	const n = Number(m[2]);
	const unit = UNIT_MS[m[3]];
	if (!Number.isFinite(n) || !unit) {
		return null;
	}
	return new Date(base.getTime() + sign * n * unit).toISOString();
}

function firmName(): string {
	try {
		return String(settings.get('Site_Name') || 'The Nguyen Law Firm');
	} catch {
		return 'The Nguyen Law Firm';
	}
}

function siteUrl(): string {
	try {
		return String(settings.get('Site_Url') || '').replace(/\/$/, '');
	} catch {
		return '';
	}
}

function fmtDate(value: Date | string | undefined): string {
	if (!value) {
		return '';
	}
	const d = value instanceof Date ? value : new Date(value);
	return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

function fmtMoney(value: number | undefined): string {
	if (value === undefined || value === null || !Number.isFinite(value)) {
		return '';
	}
	return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

/** Resolve a single token leaf against the run context. Returns '' for unknown tokens. */
export function resolveToken(token: string, ctx: AutomationContext): string {
	const now = resolveNowExpression(token);
	if (now !== null) {
		return now;
	}

	const { card, lead, snapshot } = ctx.subject;
	const key = token.trim();
	const lower = key.toLowerCase();

	// custom field by NAME: field:<name> -> card.fieldValues (id-keyed) via the board labelDefs/fieldDefs.
	if (lower.startsWith('field:')) {
		const fieldName = key.slice('field:'.length).trim();
		const v = card?.fieldValues?.[fieldName];
		return v === undefined || v === null ? '' : String(v);
	}

	switch (lower) {
		case 'firm.name':
			return firmName();
		case 'me':
		case 'user.name':
			return ctx.actor && ctx.actor !== 'system' && !ctx.actor.startsWith('automation:') ? ctx.actor : 'Automation';
		// card -----------------------------------------------------------------
		case 'card.title':
			return card?.title ?? '';
		case 'card.url': {
			const base = siteUrl();
			return card ? `${base}/boards/${card.boardId}/card/${card._id}` : '';
		}
		case 'card.due':
			return fmtDate(card?.dueDate);
		case 'card.list':
			return card?.listId ?? '';
		case 'board.name':
			return ctx.boardId;
		// lead -----------------------------------------------------------------
		case 'lead.firstname':
			return lead?.contact?.firstName ?? '';
		case 'lead.lastname':
			return lead?.contact?.lastName ?? '';
		case 'lead.fullname':
			return lead?.contact?.fullName || [lead?.contact?.firstName, lead?.contact?.lastName].filter(Boolean).join(' ').trim();
		case 'lead.source':
			return lead?.attribution?.source ?? '';
		case 'lead.owner':
			return lead?.ownership?.ownerId ?? '';
		case 'lead.email':
			return lead?.contact?.email ?? '';
		case 'lead.phone':
			return lead?.contact?.mobile || lead?.contact?.phone || '';
		// matter (CasePro snapshot — already coerced by M2) --------------------
		case 'matter.clientname':
			return snapshot?.clientName ?? '';
		case 'matter.soldate':
			return fmtDate(snapshot?.solDate);
		case 'matter.demandamount':
			return fmtMoney(snapshot?.lastDemandAmount);
		case 'matter.stage':
			return snapshot?.stageName ?? '';
		case 'matter.number':
			return snapshot?.matterNumber ?? '';
		default:
			return '';
	}
}

/**
 * Interpolate one string. Returns `{ value, missing }` so the runner can attach a
 * soft note (`partial`) when a token resolved to '' that wasn't an explicit empty.
 */
export function interpolateString(input: string, ctx: AutomationContext): { value: string; missing: string[] } {
	const missing: string[] = [];
	const value = input.replace(TOKEN_RE, (_match, token: string) => {
		const resolved = resolveToken(token, ctx);
		if (resolved === '') {
			missing.push(token.trim());
		}
		return resolved;
	});
	return { value, missing };
}

/**
 * Deep-interpolate every string in an action's params (recurses objects + arrays).
 * Non-string leaves pass through untouched. Returns the cloned, interpolated params
 * plus the union of missing tokens seen anywhere in the tree.
 */
export function interpolateParams<T>(params: T, ctx: AutomationContext): { value: T; missing: string[] } {
	const missing: string[] = [];

	const walk = (node: unknown): unknown => {
		if (typeof node === 'string') {
			const r = interpolateString(node, ctx);
			missing.push(...r.missing);
			return r.value;
		}
		if (Array.isArray(node)) {
			return node.map(walk);
		}
		if (node && typeof node === 'object') {
			const out: Record<string, unknown> = {};
			for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
				out[k] = walk(v);
			}
			return out;
		}
		return node;
	};

	return { value: walk(params) as T, missing: [...new Set(missing)] };
}

/**
 * Resolve a single value that may be an ISO date or a relative date token (`{{now+30d}}`
 * / `now+30d`) into a Date. Used by the date-bearing actions (setDue / createDeadline).
 * Returns null when unparseable so callers can skip rather than fabricate a date.
 */
export function resolveDateValue(input: string | undefined, ctx: AutomationContext): Date | null {
	if (!input) {
		return null;
	}
	// strip a single {{ }} / { } wrapper if present, then try now-math, then raw ISO.
	const unwrapped = input.replace(/^\{\{?\s*|\s*\}?\}$/g, '').trim();
	const now = resolveNowExpression(unwrapped);
	if (now !== null) {
		return new Date(now);
	}
	// fully interpolate (covers a token that itself yields an ISO string), then parse.
	const { value } = interpolateString(input, ctx);
	const d = new Date(value);
	return Number.isNaN(d.getTime()) ? null : d;
}
