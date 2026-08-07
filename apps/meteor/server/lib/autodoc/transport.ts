import type { AutoDocConfig } from './config';
import { buildMultipartBody, omnisFetchJson } from '../omnis/http';

/**
 * The ONLY thing in the AutoDoc integration that touches the wire.
 *
 * Two implementations behind one interface:
 *   - {@link AutoDocStubTransport} — representative fixtures, zero configuration.
 *     The default, so the widget, drop zones, approve flow and receipts are all
 *     demoable and QA-deterministic before any credential exists.
 *   - {@link AutoDocNativeTransport} — real REST against AutoDoc's backend.
 *
 * Note the interface name: ESLint's `@typescript-eslint/naming-convention` in
 * this repo requires interfaces to match `/^I[A-Z]/`. `AutoDocTransport` fails;
 * `IAutoDocTransport` passes.
 */

/** AutoDoc's own confidence bands, passed through unchanged. */
export type AutoDocStatus = 'ready' | 'quick_confirm' | 'needs_review' | 'processing' | 'failed';

export type AutoDocFieldConfidence = {
	name: string;
	label: string;
	value: string;
	/** 0–1. Anything below the review threshold is visually flagged and editable. */
	confidence: number;
	/** Page + bounding box of the region the value was read from, when known. */
	region?: { page: number; x: number; y: number; width: number; height: number };
};

export type AutoDocDocument = {
	id: string;
	filename: string;
	documentType?: string;
	status: AutoDocStatus;
	/** 0–1 overall extraction confidence. */
	confidence: number;
	/** Monotonic change marker — this is what the feed poller diffs on. */
	status_changed_at: string;
	sizeBytes?: number;
	pageCount?: number;
	/** Set when the document was submitted from a matter channel. */
	matterId?: string;
	/** AutoDoc's OWN guess at the matter, when it had to match one itself. */
	matterGuess?: { matterId: string; matterName: string; confidence: number };
	fields?: AutoDocFieldConfidence[];
	previewUrl?: string;
	submittedBy?: string;
	submittedAt?: string;
	/** The MatterChat room it came from, echoed back so receipts know where to post. */
	roomId?: string;
};

export type AutoDocFeed = {
	items: AutoDocDocument[];
	summary: { recent: number; ready: number; needsReview: number };
};

export type AutoDocSubmitInput = {
	filename: string;
	contentType: string;
	content: Buffer;
	/** Binds the matter at intake — the whole point of dropping in a channel. */
	matterId?: string;
	roomId?: string;
	submittedBy?: string;
};

export type AutoDocCorrection = { name: string; value: string };

export interface IAutoDocTransport {
	readonly kind: 'stub' | 'native';
	listFeed(): Promise<AutoDocFeed>;
	getDocument(id: string): Promise<AutoDocDocument | null>;
	submit(input: AutoDocSubmitInput): Promise<AutoDocDocument>;
	/**
	 * Confirm the extraction (optionally with human corrections and a matter the
	 * user picked). Corrections are posted back to AutoDoc's correction API,
	 * which feeds its spatial-extraction feedback loop — so fixes make future
	 * extractions better instead of being thrown away.
	 */
	confirm(id: string, input: { matterId?: string; corrections?: AutoDocCorrection[] }): Promise<void>;
	/** Push the confirmed extraction into the CasePro matter. */
	pushToCrm(id: string, input: { matterId: string }): Promise<{ crmRecordId?: string }>;
	reject(id: string, reason?: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Stub
// ---------------------------------------------------------------------------

/**
 * Deterministic fixtures. Mutations are held in memory so the whole flow —
 * submit, approve, reject — behaves for a reviewer, and a server restart
 * returns to a known baseline.
 */
export class AutoDocStubTransport implements IAutoDocTransport {
	readonly kind = 'stub' as const;

	private docs: AutoDocDocument[] = seedDocuments();

	private counter = 0;

	async listFeed(): Promise<AutoDocFeed> {
		const items = [...this.docs].sort((a, b) => b.status_changed_at.localeCompare(a.status_changed_at));
		return { items, summary: summarize(items) };
	}

	async getDocument(id: string): Promise<AutoDocDocument | null> {
		return this.docs.find((d) => d.id === id) ?? null;
	}

	async submit(input: AutoDocSubmitInput): Promise<AutoDocDocument> {
		this.counter += 1;
		const now = new Date().toISOString();
		// A channel drop arrives matter-bound and lands high-confidence; a widget
		// drop has no context and lands needing a matter picked. The two entry
		// points have honestly different outcomes, and the fixture says so.
		const bound = Boolean(input.matterId);
		const doc: AutoDocDocument = {
			id: `stub-sub-${this.counter}`,
			filename: input.filename,
			documentType: guessTypeFromName(input.filename),
			status: bound ? 'ready' : 'needs_review',
			confidence: bound ? 0.94 : 0.41,
			status_changed_at: now,
			sizeBytes: input.content.length,
			...(input.matterId ? { matterId: input.matterId } : {}),
			...(bound
				? {}
				: { matterGuess: { matterId: 'stub-matter-2', matterName: 'Duong v. Metro Transit', confidence: 0.41 } }),
			...(input.roomId ? { roomId: input.roomId } : {}),
			...(input.submittedBy ? { submittedBy: input.submittedBy } : {}),
			submittedAt: now,
			fields: seedFields(bound),
		};
		this.docs = [doc, ...this.docs];
		return doc;
	}

	async confirm(id: string, input: { matterId?: string; corrections?: AutoDocCorrection[] }): Promise<void> {
		const doc = this.docs.find((d) => d.id === id);
		if (!doc) {
			throw new Error(`AutoDoc stub: unknown document ${id}`);
		}
		if (input.matterId) {
			doc.matterId = input.matterId;
		}
		for (const correction of input.corrections ?? []) {
			const field = doc.fields?.find((f) => f.name === correction.name);
			if (field) {
				field.value = correction.value;
				field.confidence = 1;
			}
		}
		doc.status = 'ready';
		doc.status_changed_at = new Date().toISOString();
	}

	async pushToCrm(id: string, input: { matterId: string }): Promise<{ crmRecordId?: string }> {
		const doc = this.docs.find((d) => d.id === id);
		if (!doc) {
			throw new Error(`AutoDoc stub: unknown document ${id}`);
		}
		this.docs = this.docs.filter((d) => d.id !== id);
		return { crmRecordId: `stub-crm-${input.matterId}-${id}` };
	}

	async reject(id: string): Promise<void> {
		this.docs = this.docs.filter((d) => d.id !== id);
	}

	/** Test seam: restore the baseline fixtures. */
	reset(): void {
		this.docs = seedDocuments();
		this.counter = 0;
	}
}

function summarize(items: AutoDocDocument[]): AutoDocFeed['summary'] {
	return {
		recent: items.length,
		ready: items.filter((i) => i.status === 'ready').length,
		// Coarse but correct: anything that is not `ready` wants a human.
		// `quick_confirm` could earn a lighter-weight affordance later.
		needsReview: items.filter((i) => i.status === 'needs_review' || i.status === 'quick_confirm').length,
	};
}

function guessTypeFromName(filename: string): string | undefined {
	const lower = filename.toLowerCase();
	if (lower.includes('lop') || lower.includes('protection')) {
		return 'Letter of Protection';
	}
	if (lower.includes('bill') || lower.includes('invoice')) {
		return 'Medical Bill';
	}
	if (lower.includes('record')) {
		return 'Medical Record';
	}
	return undefined;
}

function iso(minutesAgo: number): string {
	return new Date(Date.now() - minutesAgo * 60_000).toISOString();
}

function seedFields(highConfidence: boolean): AutoDocFieldConfidence[] {
	return [
		{ name: 'provider', label: 'Provider', value: 'Patel Clinic', confidence: highConfidence ? 0.97 : 0.88 },
		{ name: 'date_of_service', label: 'Date of service', value: '2026-06-14', confidence: highConfidence ? 0.95 : 0.52 },
		{
			name: 'amount',
			label: 'Amount',
			value: '$2,480.00',
			confidence: highConfidence ? 0.93 : 0.38,
			region: { page: 1, x: 0.62, y: 0.41, width: 0.18, height: 0.04 },
		},
		{ name: 'patient', label: 'Patient', value: 'Maria Alvarez', confidence: highConfidence ? 0.99 : 0.91 },
	];
}

function seedDocuments(): AutoDocDocument[] {
	return [
		{
			id: 'stub-doc-1',
			filename: 'patel-clinic-bill-june.pdf',
			documentType: 'Medical Bill',
			status: 'ready',
			confidence: 0.96,
			status_changed_at: iso(4),
			sizeBytes: 284_120,
			pageCount: 2,
			matterId: 'stub-matter-1',
			fields: seedFields(true),
			submittedAt: iso(9),
		},
		{
			id: 'stub-doc-2',
			filename: 'imaging-report-scan.pdf',
			documentType: 'Medical Record',
			status: 'needs_review',
			confidence: 0.41,
			status_changed_at: iso(18),
			sizeBytes: 1_942_300,
			pageCount: 11,
			matterGuess: { matterId: 'stub-matter-2', matterName: 'Duong v. Metro Transit', confidence: 0.41 },
			fields: seedFields(false),
			submittedAt: iso(26),
		},
		{
			id: 'stub-doc-3',
			filename: 'lop-signed-alvarez.pdf',
			documentType: 'Letter of Protection',
			status: 'quick_confirm',
			confidence: 0.78,
			status_changed_at: iso(41),
			sizeBytes: 96_400,
			pageCount: 1,
			matterId: 'stub-matter-1',
			fields: seedFields(true),
			submittedAt: iso(52),
		},
		{
			id: 'stub-doc-4',
			filename: 'crash-report-0421.pdf',
			documentType: 'Police Report',
			status: 'processing',
			confidence: 0,
			status_changed_at: iso(1),
			sizeBytes: 512_000,
			submittedAt: iso(2),
		},
		{
			id: 'stub-doc-5',
			filename: 'wage-loss-statement.pdf',
			status: 'ready',
			confidence: 0.91,
			status_changed_at: iso(120),
			sizeBytes: 61_200,
			pageCount: 1,
			matterId: 'stub-matter-3',
			fields: seedFields(true),
			submittedAt: iso(133),
		},
	];
}

// ---------------------------------------------------------------------------
// Native REST
// ---------------------------------------------------------------------------

export class AutoDocNativeTransport implements IAutoDocTransport {
	readonly kind = 'native' as const;

	constructor(private readonly cfg: AutoDocConfig) {}

	async listFeed(): Promise<AutoDocFeed> {
		const raw = await omnisFetchJson<{ items?: unknown[]; documents?: unknown[] }>(this.cfg, '/api/feed/');
		const items = (raw.items ?? raw.documents ?? []).map(normalizeDocument).filter((d): d is AutoDocDocument => Boolean(d));
		return { items, summary: summarize(items) };
	}

	async getDocument(id: string): Promise<AutoDocDocument | null> {
		const raw = await omnisFetchJson<unknown>(this.cfg, `/api/documents/${encodeURIComponent(id)}/`);
		return normalizeDocument(raw);
	}

	async submit(input: AutoDocSubmitInput): Promise<AutoDocDocument> {
		// Multipart MUST be a Buffer: serverFetch JSON-stringifies any non-Buffer
		// object body, so a real FormData would go out as `{}`. See omnis/http.ts.
		const { body, contentType } = buildMultipartBody(
			[
				...(input.matterId ? [{ name: 'matter_id', value: input.matterId }] : []),
				...(input.roomId ? [{ name: 'room_id', value: input.roomId }] : []),
				...(input.submittedBy ? [{ name: 'submitted_by', value: input.submittedBy }] : []),
				...(this.cfg.orgId ? [{ name: 'organization_id', value: this.cfg.orgId }] : []),
				{ name: 'source', value: 'matterchat' },
			],
			[{ name: 'file', filename: input.filename, contentType: input.contentType, content: input.content }],
		);

		const raw = await omnisFetchJson<unknown>(this.cfg, '/api/documents/upload/', {
			method: 'POST',
			raw: { body, contentType },
		});
		const doc = normalizeDocument(raw);
		if (!doc) {
			throw new Error('AutoDoc returned an unreadable document on submit');
		}
		return doc;
	}

	async confirm(id: string, input: { matterId?: string; corrections?: AutoDocCorrection[] }): Promise<void> {
		await omnisFetchJson<unknown>(this.cfg, `/api/documents/${encodeURIComponent(id)}/confirm-file/`, {
			method: 'POST',
			json: {
				...(input.matterId ? { matter_id: input.matterId } : {}),
				...(input.corrections?.length
					? { corrections: input.corrections.map((c) => ({ field: c.name, value: c.value })) }
					: {}),
			},
		});
	}

	async pushToCrm(id: string, input: { matterId: string }): Promise<{ crmRecordId?: string }> {
		const raw = await omnisFetchJson<{ crm_record_id?: string; id?: string }>(this.cfg, '/api/crm/v2/process/', {
			method: 'POST',
			json: { document_id: id, matter_id: input.matterId, ...(this.cfg.orgId ? { organization_id: this.cfg.orgId } : {}) },
		});
		return { ...(raw.crm_record_id || raw.id ? { crmRecordId: raw.crm_record_id ?? raw.id } : {}) };
	}

	async reject(id: string, reason?: string): Promise<void> {
		await omnisFetchJson<unknown>(this.cfg, `/api/documents/${encodeURIComponent(id)}/reject/`, {
			method: 'POST',
			json: { ...(reason ? { reason } : {}) },
		});
	}
}

/** Map AutoDoc's snake_case wire shape onto our camelCase domain type. */
export function normalizeDocument(raw: unknown): AutoDocDocument | null {
	if (!raw || typeof raw !== 'object') {
		return null;
	}
	const r = raw as Record<string, unknown>;
	const id = str(r.id) ?? str(r.document_id);
	if (!id) {
		return null;
	}

	const guessId = str(r.matter_guess_id);
	const guessConfidence = num(r.matter_guess_confidence);

	return {
		id,
		filename: str(r.filename) ?? str(r.file_name) ?? 'document',
		...(str(r.document_type) ? { documentType: str(r.document_type) } : {}),
		status: normalizeStatus(str(r.status)),
		confidence: num(r.confidence) ?? 0,
		// The diff key. Fall back to updated_at so a feed that omits it still
		// produces a usable (if coarser) delta rather than emitting every poll.
		status_changed_at: str(r.status_changed_at) ?? str(r.updated_at) ?? new Date(0).toISOString(),
		...(num(r.size_bytes) !== undefined ? { sizeBytes: num(r.size_bytes) } : {}),
		...(num(r.page_count) !== undefined ? { pageCount: num(r.page_count) } : {}),
		...(str(r.matter_id) ? { matterId: str(r.matter_id) } : {}),
		...(guessId && guessConfidence !== undefined
			? { matterGuess: { matterId: guessId, matterName: str(r.matter_guess_name) ?? guessId, confidence: guessConfidence } }
			: {}),
		...(Array.isArray(r.fields) ? { fields: r.fields.map(normalizeField).filter((f): f is AutoDocFieldConfidence => Boolean(f)) } : {}),
		...(str(r.preview_url) ? { previewUrl: str(r.preview_url) } : {}),
		...(str(r.submitted_by) ? { submittedBy: str(r.submitted_by) } : {}),
		...(str(r.submitted_at) ? { submittedAt: str(r.submitted_at) } : {}),
		...(str(r.room_id) ? { roomId: str(r.room_id) } : {}),
	};
}

function normalizeField(raw: unknown): AutoDocFieldConfidence | null {
	if (!raw || typeof raw !== 'object') {
		return null;
	}
	const r = raw as Record<string, unknown>;
	const name = str(r.name) ?? str(r.field);
	if (!name) {
		return null;
	}
	return {
		name,
		label: str(r.label) ?? name,
		value: str(r.value) ?? '',
		confidence: num(r.confidence) ?? 0,
		...(r.region && typeof r.region === 'object'
			? {
					region: {
						page: num((r.region as Record<string, unknown>).page) ?? 1,
						x: num((r.region as Record<string, unknown>).x) ?? 0,
						y: num((r.region as Record<string, unknown>).y) ?? 0,
						width: num((r.region as Record<string, unknown>).width) ?? 0,
						height: num((r.region as Record<string, unknown>).height) ?? 0,
					},
				}
			: {}),
	};
}

function normalizeStatus(value: string | undefined): AutoDocStatus {
	switch (value) {
		case 'ready':
		case 'quick_confirm':
		case 'needs_review':
		case 'processing':
		case 'failed':
			return value;
		default:
			// Unknown states are treated as needing a human, never as ready —
			// erring toward review is the safe direction for a filing decision.
			return 'needs_review';
	}
}

function str(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function num(value: unknown): number | undefined {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === 'string' && value.trim() !== '') {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : undefined;
	}
	return undefined;
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

const stubSingleton = new AutoDocStubTransport();

/** The stub is a singleton so in-memory mutations survive across requests. */
export function autoDocTransport(cfg: AutoDocConfig): IAutoDocTransport {
	return cfg.transport === 'native' ? new AutoDocNativeTransport(cfg) : stubSingleton;
}

/** Test seam. */
export function stubTransportForTests(): AutoDocStubTransport {
	return stubSingleton;
}
