import type { IBoardNotification, Serialized } from '@rocket.chat/core-typings';
import type { Keys as IconName } from '@rocket.chat/icons';

/**
 * Presentation helpers for the M8 Boards notification bell + inbox.
 *
 * The server stores `IBoardNotification.kind` as an OPEN string (an event name
 * like `card.assigned`/`comment.added`, or a synthesized reason like
 * `sla_breach`/`sol_warning`/`digest`). The bell renders best-effort: it maps a
 * known prefix to an icon, and otherwise falls back to a neutral bell glyph — so
 * a brand-new notification reason coined server-side still renders sensibly
 * without a client change (mirrors how LeadPanel/CardDetail tolerate open vocab).
 *
 * Time is relative ("3m", "2h", "5d") for the compact inbox, matching the
 * micro-timestamp idiom used elsewhere in the boards card detail.
 */

// kind (or its dotted prefix) -> fuselage icon. Verified-present glyphs only
// (same constraint noted in views/boards/lib/icons.ts — no `briefcase`/`kanban`).
const KIND_ICON: Record<string, IconName> = {
	// lifecycle / card events
	'card.assigned': 'user',
	'card.moved': 'arrow-forward',
	'card.due': 'clock',
	'card.created': 'plus',
	'comment.added': 'baloons',
	mention: 'at',
	// matter / lead safety + SLA reasons (synthesized)
	sla_breach: 'warning',
	sol_warning: 'clock',
	deadline: 'clock',
	digest: 'mail',
	// automation
	automation: 'cog',
};

/**
 * Resolve a fuselage icon for a notification. Tries the exact `kind`, then its
 * dotted prefix (`card.assigned` -> `card`), then a neutral bell.
 */
export const notificationIcon = (kind: string): IconName => {
	if (KIND_ICON[kind]) {
		return KIND_ICON[kind];
	}
	const prefix = kind.split('.')[0] ?? '';
	if (prefix === 'card') {
		// `briefcase`/`kanban` don't exist in this fork's icon set (see lib/icons.ts).
		return 'circle';
	}
	if (KIND_ICON[prefix]) {
		return KIND_ICON[prefix];
	}
	return 'bell';
};

/** A compact relative time ("now", "3m", "2h", "5d", or a date when older). */
export const relativeTime = (value: string | Date | undefined): string => {
	if (!value) {
		return '';
	}
	const then = typeof value === 'string' ? new Date(value) : value;
	const ms = then.getTime();
	if (Number.isNaN(ms)) {
		return '';
	}
	const deltaSec = Math.round((Date.now() - ms) / 1000);
	if (deltaSec < 45) {
		return 'now';
	}
	const deltaMin = Math.round(deltaSec / 60);
	if (deltaMin < 60) {
		return `${deltaMin}m`;
	}
	const deltaHr = Math.round(deltaMin / 60);
	if (deltaHr < 24) {
		return `${deltaHr}h`;
	}
	const deltaDay = Math.round(deltaHr / 24);
	if (deltaDay < 7) {
		return `${deltaDay}d`;
	}
	return then.toLocaleDateString();
};

export type ClientNotification = Serialized<IBoardNotification>;
