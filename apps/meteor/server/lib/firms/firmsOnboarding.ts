import type { IUser } from '@rocket.chat/core-typings';
import { Users } from '@rocket.chat/models';

import { isSelfServeFirmsEnabled } from './firmsService';
import { callbacks } from '../callbacks';

/**
 * MATTERCHAT: marking a brand-new account as needing firm setup.
 *
 * ## Why a stored flag, and not the old gate
 *
 * The previous gate showed the firm wizard when
 * `!user.customFields.firmId && subscriptions.length === 0`, and remembered
 * dismissal in React `useState`. Both halves were wrong:
 *
 *  - **`subscriptions.length === 0` is not "new".** Any workspace that
 *    auto-joins new users to a default channel gives them a subscription
 *    immediately, so the wizard silently NEVER appeared. That is why the flow
 *    behaved differently between deployments for no visible reason.
 *  - **`useState` dismissal does not survive a reload.** "Continue on my own"
 *    looked like a choice but came back on every refresh until the user
 *    happened to acquire a subscription.
 *
 * And simply gating on `!firmId` instead would trap every EXISTING user on an
 * established workspace — none of them carry a firm stamp — behind a wizard
 * they have no business seeing.
 *
 * A flag stamped at creation time separates the two cohorts cleanly: only
 * accounts created after self-serve firms were switched on are asked, and the
 * answer is durable because it lives on the user document. Existing users are
 * never touched.
 *
 * The flag is cleared in exactly three places, all of which genuinely resolve
 * the question:
 *   - `createFirm` — they made one;
 *   - `adoptUserIntoFirm` — they joined one by invite;
 *   - `ensureFirmForOrg` — CentralAuth says which org they belong to.
 */

const CALLBACK_ID = 'MatterChat_Firms_MarkNeedsSetup';

export async function markNeedsFirmSetup(user: IUser): Promise<void> {
	// Users who already have a firm (invite redemption can run first) or who are
	// admins are never asked.
	if ((user.customFields as Record<string, unknown> | undefined)?.firmId) {
		return;
	}
	if (user.roles?.includes('admin')) {
		return;
	}

	await Users.updateOne({ _id: user._id }, { $set: { 'customFields.needsFirmSetup': true } });
}

/** True when this user should be shown the firm wizard. */
export function needsFirmSetup(user: Pick<IUser, 'customFields' | 'roles'>): boolean {
	const fields = user.customFields as Record<string, unknown> | undefined;
	return isSelfServeFirmsEnabled() && fields?.needsFirmSetup === true && !fields?.firmId && !user.roles?.includes('admin');
}

export function registerFirmOnboarding(): void {
	callbacks.add(
		'afterCreateUser',
		(user: IUser) => {
			if (!isSelfServeFirmsEnabled()) {
				return user;
			}
			void markNeedsFirmSetup(user).catch((err) => {
				// Non-fatal: worst case the user is not asked to set up a firm.
				// Failing account creation over this would be far worse.
				console.warn('[firms] could not mark the new user as needing firm setup', err);
			});
			return user;
		},
		callbacks.priority.LOW,
		CALLBACK_ID,
	);
}
