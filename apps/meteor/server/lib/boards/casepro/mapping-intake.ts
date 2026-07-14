import type { CaseProRow } from './transport';
import { partyDisplayName, resolveCaseTypeName, toDate } from './mapping';

/**
 * Pure mapping functions for the Leads/Intake pillar (M3): raw CasePro
 * `intake_questionnaires` rows <-> a lead-shaped object the boards/leads layer
 * consumes. Like {@link ./mapping}, nothing here does I/O — the client fetches
 * rows via the transport then hands them in, so the stub and live paths produce
 * identical shapes and the mapping is unit-testable.
 *
 * The intake/lead entity is `intake_questionnaires` (NOT a separate leads table).
 * Stage = `intake_stage_id` -> `intake_stages` (the 8 board columns). Client =
 * `party_id` -> parties. Practice area = `case_type_id` -> case_types.
 */

function str(value: unknown): string | undefined {
	if (typeof value === 'string') {
		const t = value.trim();
		return t === '' ? undefined : t;
	}
	return undefined;
}

/** JSON-ish passthrough: keep objects as-is, leave everything else undefined. */
function obj(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

// ---------------------------------------------------------------------------
// Intake-stage lookup resolver (the 8 pipeline stages = the Leads board columns).
// ---------------------------------------------------------------------------

/** Resolve an `intake_stage_id` to { id, name } against the intake_stages rows. */
export function resolveIntakeStage(intakeStageId: unknown, intakeStages: CaseProRow[]): { id?: string; name?: string } {
	const id = str(intakeStageId);
	if (!id) {
		return {};
	}
	return { id, name: str(intakeStages.find((r) => r.id === id)?.intake_stage_name) };
}

/** A board-column descriptor from an intake_stages row (8 of them, by order_index). */
export type IntakeStageDescriptor = { stageId: string; name: string; orderIndex: number };

export function mapIntakeStage(row: CaseProRow): IntakeStageDescriptor {
	const order = row.order_index;
	return {
		stageId: str(row.id) ?? '',
		name: str(row.intake_stage_name) ?? '',
		orderIndex: typeof order === 'number' ? order : Number(order) || 0,
	};
}

// ---------------------------------------------------------------------------
// intake_questionnaires row -> lead-shaped object.
// ---------------------------------------------------------------------------

/**
 * The lead-shaped projection of an `intake_questionnaires` row. Field names are
 * board/lead-oriented (not CasePro column names) so the boards/leads service can
 * map straight onto its cache + card. `raw` carries the untouched row for any
 * field the projection doesn't surface.
 */
export type IntakeLead = {
	/** intake_questionnaires.id (the sync key — boards_leads.caseproIntakeId). */
	caseproIntakeId: string;
	/** intake_questionnaires.intake_id (human ref — boards_leads.caseproIntakeNumber). */
	caseproIntakeNumber?: string;
	/** intake_stage_id + resolved name (board column). */
	stageId?: string;
	stageName?: string;
	/** party_id + resolved display name (the prospective client). */
	partyId?: string;
	clientName?: string;
	/** case_type_id + resolved practice-area name. */
	caseTypeId?: string;
	practiceArea?: string;
	/** lead source + sub-status. */
	source?: string;
	status?: string; // intake_status (lead sub-status)
	overallStatus?: string; // status (open/closed-ish)
	incidentDate?: Date;
	/** questionnaire answers + form linkage. */
	formData?: Record<string, unknown>;
	templateId?: string;
	/** conversion link — set once an intake becomes a matter. */
	matterId?: string;
	converted: boolean;
	litboxWorkspaceId?: string;
	customFields?: Record<string, unknown>;
	/** the untouched CasePro row. */
	raw: CaseProRow;
};

/** Everything the intake mapper needs for one lead. Pure data — no I/O. */
export type IntakeRowBundle = {
	intake: CaseProRow;
	intakeStages: CaseProRow[];
	caseTypes: CaseProRow[];
	party?: CaseProRow | null;
};

/** Map one `intake_questionnaires` row (+ lookups + party) to a lead-shaped object. */
export function mapIntakeLead(bundle: IntakeRowBundle): IntakeLead {
	const { intake } = bundle;
	const stage = resolveIntakeStage(intake.intake_stage_id, bundle.intakeStages);
	const matterId = str(intake.matter_id);
	return {
		caseproIntakeId: str(intake.id) ?? '',
		caseproIntakeNumber: str(intake.intake_id),
		stageId: stage.id,
		stageName: stage.name,
		partyId: str(intake.party_id),
		clientName: partyDisplayName(bundle.party),
		caseTypeId: str(intake.case_type_id),
		practiceArea: resolveCaseTypeName(intake.case_type_id, bundle.caseTypes),
		source: str(intake.source),
		status: str(intake.intake_status),
		overallStatus: str(intake.status),
		incidentDate: toDate(intake.incident_date),
		formData: obj(intake.form_data),
		templateId: str(intake.template_id),
		matterId,
		converted: Boolean(matterId),
		litboxWorkspaceId: str(intake.litbox_workspace_id),
		customFields: obj(intake.custom_fields),
		raw: intake,
	};
}

// ---------------------------------------------------------------------------
// Reverse: lead capture input -> intake_questionnaires / parties row fields.
// ---------------------------------------------------------------------------

/** Capture input the boards/leads layer collects (party + classification + answers). */
export type IntakeCaptureInput = {
	/** prospective-client contact (used to match-or-create a party). */
	contact?: {
		firstName?: string;
		lastName?: string;
		fullName?: string;
		email?: string;
		phone?: string;
	};
	/** existing party id when the client already exists in the global pool. */
	partyId?: string;
	caseTypeId?: string;
	intakeStageId?: string;
	source?: string;
	intakeStatus?: string;
	incidentDate?: Date | string;
	formData?: Record<string, unknown>;
	templateId?: string;
	litboxWorkspaceId?: string;
	customFields?: Record<string, unknown>;
	intakeId?: string; // optional human ref; CasePro assigns if omitted
};

/** Drop undefined keys so a create/patch payload only carries supplied fields. */
function compact(row: CaseProRow): CaseProRow {
	const out: CaseProRow = {};
	for (const [k, v] of Object.entries(row)) {
		if (v !== undefined) {
			out[k] = v;
		}
	}
	return out;
}

function toIso(value: Date | string | undefined): string | undefined {
	if (!value) {
		return undefined;
	}
	if (value instanceof Date) {
		return Number.isNaN(value.getTime()) ? undefined : value.toISOString().slice(0, 10);
	}
	return str(value);
}

/** Build the `parties` row fields for a new prospective client from capture input. */
export function buildPartyRowFromCapture(input: IntakeCaptureInput): CaseProRow {
	const c = input.contact ?? {};
	const joined = [str(c.firstName), str(c.lastName)].filter(Boolean).join(' ').trim();
	const full = str(c.fullName) ?? (joined === '' ? undefined : joined);
	return compact({
		record_type: 'Individual',
		full_name: full,
		first_name: str(c.firstName),
		last_name: str(c.lastName),
		email: str(c.email),
		telephone_number: str(c.phone),
	});
}

/**
 * Build the `intake_questionnaires` row fields from capture input. `partyId` is the
 * (already match-or-created) party; the client supplies it after createParty.
 */
export function buildIntakeRowFromCapture(input: IntakeCaptureInput, partyId: string): CaseProRow {
	return compact({
		intake_id: str(input.intakeId),
		party_id: partyId,
		case_type_id: str(input.caseTypeId),
		intake_stage_id: str(input.intakeStageId),
		source: str(input.source),
		intake_status: str(input.intakeStatus),
		// `status` is Crm-Backend's ROW-LEVEL flag (@IsIn(['active','inactive']);
		// soft-delete = 'inactive', every list query filters status='active') — NOT a
		// lead lifecycle status (that's `intake_status`). 'open' fails DTO validation
		// (400 validation_failed) and the swallowed write-through left every captured
		// lead without a caseproIntakeId.
		status: 'active',
		incident_date: toIso(input.incidentDate),
		form_data: input.formData,
		template_id: str(input.templateId),
		litbox_workspace_id: str(input.litboxWorkspaceId),
		custom_fields: input.customFields,
		matter_id: null,
	});
}

/** Patch fields for a qualify/update (intake_status / form_data / case_type / etc.). */
export type IntakePatchInput = {
	intakeStatus?: string;
	status?: string;
	caseTypeId?: string;
	intakeStageId?: string;
	source?: string;
	incidentDate?: Date | string;
	formData?: Record<string, unknown>;
	customFields?: Record<string, unknown>;
	litboxWorkspaceId?: string;
};

/** Build a sparse `intake_questionnaires` patch from a qualify/update input. */
export function buildIntakePatch(patch: IntakePatchInput): CaseProRow {
	return compact({
		intake_status: str(patch.intakeStatus),
		status: str(patch.status),
		case_type_id: str(patch.caseTypeId),
		intake_stage_id: str(patch.intakeStageId),
		source: str(patch.source),
		incident_date: toIso(patch.incidentDate),
		form_data: patch.formData,
		custom_fields: patch.customFields,
		litbox_workspace_id: str(patch.litboxWorkspaceId),
	});
}

/**
 * Build the `matters` row fields for a conversion (POA Received) from the intake
 * row + caller extras. The new matter inherits client/practice-area/source/DOI;
 * extras (matter_name, stage_id, team, etc.) come from the convert call.
 */
export function buildMatterRowFromIntake(intake: CaseProRow, extra: CaseProRow = {}): CaseProRow {
	const base: CaseProRow = compact({
		client_id: str(intake.party_id),
		case_type: str(intake.case_type_id),
		source: str(intake.source),
		incident_date: str(intake.incident_date),
		intake_questionnaire: str(intake.id),
		litbox_workspace_id: str(intake.litbox_workspace_id),
		status: 'active',
		archived: false,
	});
	// extras win (matter_name, stage_id, matter_number, team roles, …)
	return compact({ ...base, ...extra });
}
