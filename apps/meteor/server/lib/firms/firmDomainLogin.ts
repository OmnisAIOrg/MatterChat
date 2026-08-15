import type { IUser } from '@rocket.chat/core-typings';

import { adoptUserByEmailDomain, isFirmDomainAutoJoinEnabled } from './firmDomains';
import { callbacks } from '../callbacks';
import { SystemLogger } from '../logger/system';

/**
 * MATTERCHAT: adopt a user into the firm that owns their email domain, on login.
 *
 * ## Why `afterValidateLogin`, and not `afterCreateUser`
 *
 * `firmsOnboarding.ts` hangs off `afterCreateUser`, and that is the wrong hook
 * for this one for three reasons:
 *
 *  - **A claim can be made after the account exists.** The firm's first three
 *    people sign up, THEN someone claims the domain. On account-creation only,
 *    those three are never adopted and have to be chased with invite links —
 *    which is the friction this feature exists to remove. Login runs again for
 *    everyone, so the claim reaches accounts that predate it.
 *  - **At `afterCreateUser` the email may not be verified yet**, and when
 *    `Accounts_EmailVerification` is on an unverified address proves nothing —
 *    the adoption would either never fire or fire on an unproven address.
 *  - **It covers every login path.** Password, OIDC and LDAP all funnel through
 *    `Accounts.validateLoginAttempt`, so one registration handles them all.
 *
 * Editing core was not needed: `afterValidateLogin` is an existing hook and the
 * registration lives here, in a fork-owned file, exactly like the CasePro
 * `loginSync.ts` precedent.
 *
 * Core already runs this hook inside a `setImmediate` (server/lib/auth/startup.js),
 * so it is off the login response path by construction. We still return the
 * promise so the callback chain awaits it in order, and swallow everything:
 * `adoptUserIntoFirm` is guarded on "user has no firmId", making a repeat login
 * a no-op, and nothing here is worth failing a sign-in over.
 */

const CALLBACK_ID = 'MatterChat_Firms_DomainAutoJoin';

export function registerFirmDomainAutoJoin(): void {
	callbacks.add(
		'afterValidateLogin',
		(login: { user: IUser }) =>
			(async () => {
				// Cheap boolean first: with the feature off this costs one settings
				// read per login and touches no collection.
				if (!isFirmDomainAutoJoinEnabled()) {
					return;
				}
				const firmId = await adoptUserByEmailDomain(login.user);
				if (firmId) {
					SystemLogger.info({ msg: 'firms.domainAutoJoin.adopted', uid: login.user._id, firmId });
				}
			})().catch((err) => {
				SystemLogger.warn({ msg: 'firms.domainAutoJoin.failed', err });
			}),
		callbacks.priority.LOW,
		CALLBACK_ID,
	);
}
