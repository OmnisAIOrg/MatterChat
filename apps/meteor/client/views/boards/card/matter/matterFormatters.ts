/**
 * Shared pure helpers for the Matter Workspace panel sections.
 *
 * All endpoint data is JSON-serialized over the wire, so `IMatterSnapshot` /
 * `IBoardDeadline` Date fields (incidentDate/solDate/demandExpiration/fetchedAt,
 * dueDate, …) arrive as ISO strings — every helper is string-tolerant.
 */

export const SOL_WARNING_DAYS = 90; // amber: within 90 days
export const SOL_DANGER_DAYS = 30; // red: within 30 days (or already passed)
export const DEMAND_WARNING_DAYS = 14; // amber: demand expiration within 14 days
export const SNAPSHOT_STALE_MS = 24 * 60 * 60 * 1000; // treat a snapshot older than 24h as stale

export type DateRiskVariant = 'danger' | 'warning' | 'secondary';

export type RiskTagVariant = 'secondary-danger' | 'secondary-warning' | 'secondary';

/** Map a computed date risk to the softer `secondary-*` Tag variant family used by the chips. */
export const riskTagVariant = (risk: DateRiskVariant): RiskTagVariant => {
	const map: Record<DateRiskVariant, RiskTagVariant> = {
		danger: 'secondary-danger',
		warning: 'secondary-warning',
		secondary: 'secondary',
	};
	return map[risk];
};

export const fmtCurrency = (value?: number): string | undefined => {
	if (value === undefined || value === null || Number.isNaN(value)) {
		return undefined;
	}
	return value.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
};

export const fmtDate = (value?: string | Date): string | undefined => {
	if (!value) {
		return undefined;
	}
	const d = typeof value === 'string' ? new Date(value) : value;
	if (Number.isNaN(d.getTime())) {
		return undefined;
	}
	return d.toLocaleDateString();
};

export const daysUntil = (value?: string | Date): number | undefined => {
	if (!value) {
		return undefined;
	}
	const d = typeof value === 'string' ? new Date(value) : value;
	if (Number.isNaN(d.getTime())) {
		return undefined;
	}
	return Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
};

/** SOL-style escalation: red when <30 days out (or passed), amber when <90 days. */
export const solRiskVariant = (days?: number): DateRiskVariant => {
	if (days === undefined) {
		return 'secondary';
	}
	if (days <= SOL_DANGER_DAYS) {
		return 'danger';
	}
	if (days <= SOL_WARNING_DAYS) {
		return 'warning';
	}
	return 'secondary';
};

/** Demand-expiration escalation: red when passed, amber when near. */
export const demandRiskVariant = (days?: number): DateRiskVariant => {
	if (days === undefined) {
		return 'secondary';
	}
	if (days < 0) {
		return 'danger';
	}
	if (days <= DEMAND_WARNING_DAYS) {
		return 'warning';
	}
	return 'secondary';
};

/** Is the cached CasePro snapshot too old to trust at a glance? */
export const isSnapshotOld = (fetchedAt?: string | Date): boolean => {
	if (!fetchedAt) {
		return false;
	}
	const d = typeof fetchedAt === 'string' ? new Date(fetchedAt) : fetchedAt;
	if (Number.isNaN(d.getTime())) {
		return false;
	}
	return Date.now() - d.getTime() > SNAPSHOT_STALE_MS;
};
