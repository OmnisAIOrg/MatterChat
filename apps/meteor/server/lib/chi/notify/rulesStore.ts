/**
 * Chi smart notifications — PERSISTENCE.
 *
 * Rules are per-user and live on the user document at `settings.chi.notificationRules`, next to
 * `settings.chi.model`, `settings.chi.connectors` and `settings.chi.morningBrief` (see
 * server/api/v1/chi.ts `chi.prefs` and ws-tools.ts `set_morning_brief`). Every write is a
 * TARGETED `$set` on that one sub-field, so saving rules can never clobber the user's model
 * override or connector toggles the way a whole-object write would.
 *
 * This layer is deliberately thin: all decisions, validation, the cap and the rendering live in
 * the pure engine (./notificationRules) where they are exhaustively tested. Everything here is
 * load → pure transform → store.
 *
 * Reads always pass the stored value through `validRules`, so a hand-edited or older-format
 * document degrades to "that row is ignored" rather than breaking notifications.
 */
import { Users } from '@rocket.chat/models';
import { Random } from '@rocket.chat/random';

import type { NotificationRule, RuleDraft } from './notificationRules';
import { MAX_RULES_PER_USER, appendRule, buildRule, removeRule, validRules } from './notificationRules';

/** The single sub-field this module owns. Nothing else on the user document is ever written. */
const FIELD = 'settings.chi.notificationRules';

type UserWithRules = { _id: string; settings?: { chi?: { notificationRules?: unknown } } };

/** Every structurally valid rule the user has, in order. Unreadable rows are dropped silently. */
export async function getNotificationRules(userId: string): Promise<NotificationRule[]> {
	const user = await Users.findOneById<UserWithRules>(userId, { projection: { [FIELD]: 1 } });
	return validRules(user?.settings?.chi?.notificationRules);
}

/** Targeted write — see the file header for why this is never a whole-object `settings.chi` set. */
async function persist(userId: string, rules: NotificationRule[]): Promise<void> {
	await Users.updateOne({ _id: userId }, { $set: { [FIELD]: rules.slice(0, MAX_RULES_PER_USER) } });
}

/**
 * Add one rule for `userId`. Throws with a user-facing message when the draft is nonsense, the
 * rule already exists, or the cap is reached — the Chi tool runner turns a thrown Error into the
 * failure reply, so these strings are written to be read by a human.
 */
export async function addNotificationRule(
	userId: string,
	draft: Omit<RuleDraft, 'id'>,
): Promise<{ rule: NotificationRule; total: number }> {
	const built = buildRule({ ...draft, id: Random.id(8), createdAt: Date.now() });
	if (!built.ok) {
		throw new Error(built.error);
	}
	const appended = appendRule(await getNotificationRules(userId), built.rule);
	if (!appended.ok) {
		throw new Error(appended.error);
	}
	await persist(userId, appended.rules);
	return { rule: built.rule, total: appended.rules.length };
}

/** Remove one rule by its id or by the 1-based number shown in the rendered list. */
export async function removeNotificationRule(userId: string, ref: string): Promise<{ removed: NotificationRule; total: number }> {
	const result = removeRule(await getNotificationRules(userId), ref);
	if (!result.ok) {
		throw new Error(result.error);
	}
	await persist(userId, result.rules);
	return { removed: result.removed, total: result.rules.length };
}

/** Drop every rule. Returns how many were removed so the tool can say so. */
export async function clearNotificationRules(userId: string): Promise<number> {
	const before = (await getNotificationRules(userId)).length;
	await persist(userId, []);
	return before;
}
