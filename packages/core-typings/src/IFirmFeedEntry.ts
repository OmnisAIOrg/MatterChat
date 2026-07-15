import type { IRocketChatRecord } from './IRocketChatRecord';

/**
 * MatterChat "Firm Feed" — the admin-managed bulletin on the My Day home dashboard.
 *
 * A fork-owned, additive feature (see docs/design/MATTERCHAT-UI-CUSTOMIZATION-GUIDE.md):
 * all entries live in their own `firm_feed` Mongo collection and are surfaced read-only
 * to every authenticated user; only holders of the `firm-feed-manage` permission
 * (admins/owners by default) can create/edit/delete them.
 *
 * `kind` drives which My Day section an entry renders in:
 *  - `announcement` / `update` → 📣 Announcements ("what's going on")
 *  - `birthday`                → 🎂 Birthdays (surfaced by upcoming `eventDate`)
 *  - `shoutout`                → 🎉 Shout-outs (recognition)
 */
export type FirmFeedKind = 'announcement' | 'birthday' | 'shoutout' | 'update';

export const FIRM_FEED_KINDS: FirmFeedKind[] = ['announcement', 'birthday', 'shoutout', 'update'];

export interface IFirmFeedEntry extends IRocketChatRecord {
	kind: FirmFeedKind;
	title: string;
	/** Optional longer body / message. */
	body?: string;
	/**
	 * Optional event date for dated items — the birthday date, or the day an
	 * announcement is "about". Birthdays are surfaced/sorted by the upcoming
	 * month-and-day of this value. Admin-entered in v1.
	 */
	eventDate?: Date;
	/** Pinned entries sort to the top of their section. */
	pinned?: boolean;
	/**
	 * Soft-delete / visibility flag. `false` hides the entry from `firm-feed.list`
	 * without removing it. Absent is treated as active.
	 */
	active?: boolean;
	/** Who authored the entry (denormalized for display without a user lookup). */
	createdBy: {
		_id: string;
		username?: string;
		name?: string;
	};
	createdAt: Date;
	updatedAt: Date;
}
