/**
 * MATTERCHAT: practice-area channel templates for firm onboarding.
 *
 * Pure data plus resolution logic — no Meteor/model imports, so this unit-tests
 * without a database (see tests/unit/server/lib/firms/firmTemplates.spec.ts).
 *
 * ## Why templates are data
 *
 * The original onboarding seeded three fixed channels for every firm, which
 * suits a personal-injury practice and nobody else: an immigration firm got a
 * "Referrals" channel it did not ask for and no "Filings" channel it needed.
 * Adding a practice area should be a one-line data change, not a code change,
 * so the shape below is a list, not a switch.
 *
 * A firm picks zero or more practice areas. Zero is a legitimate answer — the
 * base set alone is a usable workspace — so an empty selection is never an
 * error, it just yields the base channels.
 */

export type ChannelSpec = {
	/** Appended to the firm slug to form the room name; must be slug-safe. */
	slug: string;
	/** The display name (room `fname`) — what people actually read. */
	display: string;
	topic: string;
};

export type PracticeArea = {
	id: string;
	label: string;
	channels: ChannelSpec[];
};

/**
 * Seeded into every firm whatever it practises.
 *
 * These three are unchanged from the original hardcoded set, deliberately: firms
 * created before templates existed have exactly these, and keeping them as the
 * base means an old firm and a new firm with no practice areas are identical.
 */
export const BASE_CHANNELS: ChannelSpec[] = [
	{ slug: 'general', display: 'General', topic: 'Firm-wide announcements and everything that has no better home.' },
	{ slug: 'intake', display: 'Intake', topic: 'New enquiries and prospective clients, before a matter exists.' },
	{ slug: 'referrals', display: 'Referrals', topic: 'Referrals in and out, and the relationships behind them.' },
];

export const PRACTICE_AREAS: PracticeArea[] = [
	{
		id: 'personal-injury',
		label: 'Personal injury',
		channels: [
			{ slug: 'medical-records', display: 'Medical records', topic: 'Records requests, chronologies and provider chasing.' },
			{ slug: 'settlements', display: 'Settlements', topic: 'Demands, negotiations and settlement authority.' },
			{ slug: 'liens', display: 'Liens', topic: 'Health insurers, providers and statutory liens.' },
		],
	},
	{
		id: 'litigation',
		label: 'Litigation',
		channels: [
			{ slug: 'litigation', display: 'Litigation', topic: 'Active cases in suit — motions, hearings and strategy.' },
			{ slug: 'discovery', display: 'Discovery', topic: 'Requests, productions and discovery disputes.' },
			{ slug: 'depositions', display: 'Depositions', topic: 'Scheduling, prep and deposition summaries.' },
		],
	},
	{
		id: 'family-law',
		label: 'Family law',
		channels: [
			{ slug: 'custody', display: 'Custody', topic: 'Custody, parenting plans and child support.' },
			{ slug: 'hearings', display: 'Hearings', topic: 'Upcoming appearances and what each one needs.' },
		],
	},
	{
		id: 'criminal-defense',
		label: 'Criminal defense',
		channels: [
			{ slug: 'arraignments', display: 'Arraignments', topic: 'New arrests, bail and first appearances.' },
			{ slug: 'discovery', display: 'Discovery', topic: 'Requests, productions and discovery disputes.' },
			{ slug: 'trial-prep', display: 'Trial prep', topic: 'Witnesses, exhibits and trial logistics.' },
		],
	},
	{
		id: 'estate-planning',
		label: 'Estate planning & probate',
		channels: [
			{ slug: 'drafting', display: 'Drafting', topic: 'Wills, trusts and document drafting in progress.' },
			{ slug: 'probate', display: 'Probate', topic: 'Estate administration and probate filings.' },
		],
	},
	{
		id: 'immigration',
		label: 'Immigration',
		channels: [
			{ slug: 'filings', display: 'Filings', topic: 'Petitions, applications and filing deadlines.' },
			{ slug: 'hearings', display: 'Hearings', topic: 'Upcoming appearances and what each one needs.' },
		],
	},
	{
		id: 'employment',
		label: 'Employment',
		channels: [
			{ slug: 'claims', display: 'Claims', topic: 'Charges, complaints and agency filings.' },
			{ slug: 'litigation', display: 'Litigation', topic: 'Active cases in suit — motions, hearings and strategy.' },
		],
	},
	{
		id: 'real-estate',
		label: 'Real estate',
		channels: [
			{ slug: 'closings', display: 'Closings', topic: 'Transactions in flight and closing dates.' },
			{ slug: 'title', display: 'Title', topic: 'Title searches, clouds and curative work.' },
		],
	},
	{
		id: 'corporate',
		label: 'Corporate & transactional',
		channels: [
			{ slug: 'deals', display: 'Deals', topic: 'Live transactions and deal teams.' },
			{ slug: 'contracts', display: 'Contracts', topic: 'Drafting, review and negotiation.' },
		],
	},
];

/**
 * Ceiling on seeded channels.
 *
 * A firm that selects every practice area would otherwise land in a workspace
 * with two dozen empty channels, which is worse than the empty room this
 * feature exists to fix — a wall of unread-less channels reads as clutter, and
 * the firm has to delete them one at a time. Base channels are never dropped;
 * the cap only trims practice-area channels beyond the limit.
 */
export const MAX_SEEDED_CHANNELS = 12;

/** The `{ id, label }` list offered to the client. Channels stay server-side. */
export const listPracticeAreas = (): { id: string; label: string }[] =>
	PRACTICE_AREAS.map(({ id, label }) => ({ id, label }));

export const findPracticeArea = (id: unknown): PracticeArea | undefined =>
	typeof id === 'string' ? PRACTICE_AREAS.find((area) => area.id === id) : undefined;

/**
 * Resolve a practice-area selection into the channels to seed.
 *
 * Total function: any input shape yields a usable plan, because this runs on a
 * REST body during signup and a malformed selection must not fail the firm
 * creation the user is standing in front of. Unknown ids are ignored rather
 * than rejected for the same reason — a client sending a stale area id gets a
 * workspace, not an error.
 *
 * Order is base-first then selection order, deduplicated by slug: two practice
 * areas that both want "#discovery" produce one channel, and its topic comes
 * from whichever area was listed first.
 */
export const resolveChannelPlan = (practiceAreas: unknown): ChannelSpec[] => {
	const plan: ChannelSpec[] = [];
	const seen = new Set<string>();

	// Copy each spec. Callers seed rooms from this list and some adjust a topic
	// as they go; handing out the module-level objects would let one firm's
	// signup rewrite the template for every firm after it.
	const push = (channel: ChannelSpec): void => {
		if (seen.has(channel.slug)) {
			return;
		}
		seen.add(channel.slug);
		plan.push({ ...channel });
	};

	BASE_CHANNELS.forEach(push);

	if (!Array.isArray(practiceAreas)) {
		return plan;
	}

	for (const id of practiceAreas) {
		const area = findPracticeArea(id);
		if (!area) {
			continue;
		}
		for (const channel of area.channels) {
			if (plan.length >= MAX_SEEDED_CHANNELS) {
				return plan;
			}
			push(channel);
		}
	}

	return plan;
};

/**
 * Normalize a selection for storage on the firm room.
 *
 * Keeps only ids that exist, deduplicated, in the order given — so what we
 * record is what we actually seeded from, not what the client claimed.
 */
export const normalizePracticeAreas = (practiceAreas: unknown): string[] => {
	if (!Array.isArray(practiceAreas)) {
		return [];
	}
	const out: string[] = [];
	for (const id of practiceAreas) {
		const area = findPracticeArea(id);
		if (area && !out.includes(area.id)) {
			out.push(area.id);
		}
	}
	return out;
};
