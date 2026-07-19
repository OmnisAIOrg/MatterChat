/**
 * updatesFeed.ts — Versioned updates feed for the Updates tab (changelog)
 *
 * Data source: seeded with shipped waves and new features
 * Each update includes: title, date (ISO 8601), tag (release version/wave), description
 */

export interface UpdateEntry {
	id: string;
	title: string;
	date: string; // ISO 8601 format
	tag: string; // e.g. "Wave 1", "Wave 2", "Wave 3", "v1.2.0"
	description: string;
	features?: string[]; // optional list of feature bullets
}

export const updatesFeed: UpdateEntry[] = [
	// Wave 3 Features (In Progress)
	{
		id: 'w3-updates-tab',
		title: 'Updates Tab',
		date: '2026-07-18',
		tag: 'Wave 3',
		description: 'Desktop-app-style changelog view listing all shipped updates and features with dates and descriptions. NEW badge on nav entry for unseen updates.',
		features: [
			'Updates feed with versioned entries',
			'Unseen update badge on nav',
			'localStorage tracking for last-seen',
		],
	},
	{
		id: 'w3-foundation',
		title: 'Wave 3 Foundation',
		date: '2026-07-18',
		tag: 'Wave 3',
		description: 'Core infrastructure and performance improvements for the wave 3 release.',
	},

	// Wave 2 Features (Recently Shipped)
	{
		id: 'w2-boards-fix',
		title: 'Boards Fix & Enhancement',
		date: '2026-07-17',
		tag: 'Wave 2',
		description: 'Fixed boards pagination and improved kanban UI for better task management.',
		features: [
			'Resolved pagination bugs in board views',
			'Enhanced kanban card drag-and-drop',
			'Improved board loading performance',
		],
	},
	{
		id: 'w2-bridge-reactions',
		title: 'Bridge Reactions, Edits & Deletes',
		date: '2026-07-17',
		tag: 'Wave 2',
		description: 'Full support for message reactions, edits, and deletions across bridged workspaces (Slack, Teams, Google Chat).',
		features: [
			'Emoji reactions sync across bridges',
			'Edit sync for all platforms',
			'Delete confirmation and sync',
			'Reaction counts display',
		],
	},
	{
		id: 'w2-connector-ux',
		title: 'Connector UX & Setup Guides',
		date: '2026-07-17',
		tag: 'Wave 2',
		description: 'Improved connector setup experience with guided workflows and clear configuration steps.',
		features: [
			'Step-by-step setup wizards',
			'Clear error messaging',
			'Integration status indicators',
			'Quick-start documentation',
		],
	},
	{
		id: 'w2-auto-sync',
		title: 'Auto-Sync & Status Monitoring',
		date: '2026-07-16',
		tag: 'Wave 2',
		description: 'Automatic synchronization of bridged workspace data with real-time status indicators.',
		features: [
			'Real-time sync status',
			'Auto-retry failed syncs',
			'Sync history log',
			'Connection health indicators',
		],
	},
	{
		id: 'w2-matters-search',
		title: 'Matters Full-Text Search',
		date: '2026-07-16',
		tag: 'Wave 2',
		description: 'Full-text search capabilities for matters, including name, ID, and case metadata.',
		features: [
			'Case-insensitive search',
			'Filter by matter type',
			'Filter by stage',
			'Recent searches saved',
		],
	},
	{
		id: 'w2-full-names',
		title: 'Full Names & Display Preferences',
		date: '2026-07-15',
		tag: 'Wave 2',
		description: 'Support for full names and customizable display preferences across the platform.',
		features: [
			'Display name customization',
			'Full name profile fields',
			'Consistent name display',
			'Name formatting options',
		],
	},

	// Future Wave 3 Items (Planned)
	{
		id: 'w3-placeholder-1',
		title: 'Placeholder Feature 1',
		date: '2026-07-25',
		tag: 'Wave 3',
		description: 'Additional wave 3 feature coming soon.',
	},
	{
		id: 'w3-placeholder-2',
		title: 'Placeholder Feature 2',
		date: '2026-07-26',
		tag: 'Wave 3',
		description: 'More enhancements in wave 3.',
	},
];

/**
 * Get updates since a specific date (for the "new" badge logic)
 */
export const getUnseenUpdates = (lastSeenDate: string | null): UpdateEntry[] => {
	if (!lastSeenDate) {
		return updatesFeed;
	}
	return updatesFeed.filter((update) => new Date(update.date) > new Date(lastSeenDate));
};

/**
 * Get the most recent update date for initialization of lastSeen
 */
export const getLatestUpdateDate = (): string => {
	if (updatesFeed.length === 0) return new Date().toISOString();
	return updatesFeed[0].date;
};
