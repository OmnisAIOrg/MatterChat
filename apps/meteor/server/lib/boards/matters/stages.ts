/**
 * Canonical CasePro `matter_stages` (13, by order_index) + their `matter_sub_stages`.
 *
 * Real schema for The Nguyen Law Firm (org cb446747-4936-4cff-894c-2c83d429df3e),
 * discovered 2026-06-16 — see omnis-boards-build/casepro/00-pipelines-and-matters.md.
 *
 * The actual CasePro `matter_stages.id` UUIDs are per-org and NOT known at build
 * time, so they are resolved at runtime via `caseProClient.listStages()` and matched
 * to these canonical entries BY NAME. This table is the fallback used when the CasePro
 * client is unavailable, and the source of the sub-stage labels seeded onto each list
 * (CasePro does not expose a stable per-stage sub-stage list through the connector).
 */

export type MatterStageSeed = {
	/** Exact CasePro matter_stages.matter_stage_name (the list title). */
	name: string;
	/** 1-based order_index — drives column ordering. */
	orderIndex: number;
	/** Sub-stage labels seeded onto the list's `subStatuses` (the sub-stage chip picker). */
	subStatuses: string[];
};

/**
 * The 13 real stages in order_index order, names spelled EXACTLY as CasePro stores them.
 * Sub-stages are only modelled for the stages that actually carry them in the real schema;
 * the rest seed an empty `subStatuses` array.
 */
export const MATTER_STAGE_SEEDS: MatterStageSeed[] = [
	{ name: 'Intake', orderIndex: 1, subStatuses: [] },
	{ name: 'Initial Review', orderIndex: 2, subStatuses: [] },
	{
		name: 'Investigation',
		orderIndex: 3,
		subStatuses: ['Active Treating', 'No Treatment', 'Dropped Approved', 'Dropped-No Lien', 'Dropped-Lien'],
	},
	{
		name: 'Pre-Litigation',
		orderIndex: 4,
		subStatuses: [
			'Active Treating',
			'No Treatment',
			'Pending Medicals',
			'Demand Writing',
			'Demanded',
			'Demanded-Confirm Coverage',
			'Pursuing UIM',
			'UM/UIM Demanded',
			'Negotiation',
			'Dropped Approved',
			'Dropped-No Lien',
			'Dropped-Lien',
			'Subbed Out',
			'Referred Out',
		],
	},
	{ name: 'Pre-Lit Settled', orderIndex: 5, subStatuses: ['Pending Reduction', 'Disbursed'] },
	{ name: 'Litigation Filed', orderIndex: 6, subStatuses: [] },
	{ name: 'Discovery', orderIndex: 7, subStatuses: [] },
	{ name: 'Settlement Negotiation', orderIndex: 8, subStatuses: [] },
	{ name: 'Lit Settlement Negotiation', orderIndex: 9, subStatuses: [] },
	{ name: 'Trial Preparation', orderIndex: 10, subStatuses: [] },
	{ name: 'Trial', orderIndex: 11, subStatuses: [] },
	{ name: 'Lit Settled', orderIndex: 12, subStatuses: ['Pending Reduction', 'Disbursed'] },
	{ name: 'Closed', orderIndex: 13, subStatuses: [] },
];

/** Litigation swimlane = stages 6..12 (Litigation Filed … Lit Settled). */
export const LITIGATION_ORDER_INDEX_RANGE = { from: 6, to: 12 } as const;

/** Case-insensitive normalize for name-matching CasePro stages to the seed table. */
export const normalizeStageName = (name: string): string => name.trim().toLowerCase();
