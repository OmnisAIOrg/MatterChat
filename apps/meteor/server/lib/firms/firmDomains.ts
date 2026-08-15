import type { IUser } from '@rocket.chat/core-typings';
import { Users } from '@rocket.chat/models';
import { Random } from '@rocket.chat/random';
import { Meteor } from 'meteor/meteor';

import { checkClaimableDomain, extractEmailDomain, normalizeDomain, pickAdoptableEmail } from './firmDomainHelpers';
import { adoptUserIntoFirm, getFirmForUser, isSelfServeFirmsEnabled } from './firmsService';
import type { IFirmDomainClaim } from '../../models/FirmDomains';
import { FirmDomains, isDuplicateKeyError } from '../../models/FirmDomains';
import { settings } from '../../settings';
import * as Mailer from '../notifications/email/api';

/**
 * MATTERCHAT: firm email-domain auto-join.
 *
 * A firm owner claims their firm's email domain; once the claim is VERIFIED,
 * anyone who signs up with an address at that domain is adopted into the firm on
 * their next login. That removes the third of three signup dead-ends (the other
 * two being "create a firm" and "redeem an invite link"): nobody has to be told
 * which link to click.
 *
 * Three things make this safe enough to switch on:
 *
 *  1. **Public mailbox providers can never be claimed.** See
 *     PUBLIC_EMAIL_PROVIDERS in firmDomainHelpers — claiming `gmail.com` would
 *     sweep unrelated signups into a stranger's private team.
 *  2. **Domains are globally unique**, enforced by a unique Mongo index as well
 *     as a pre-check, so a domain resolves to exactly one firm.
 *  3. **Claims are inert until verified** by an email round-trip to an address
 *     AT the domain. No DNS TXT record: the person doing this is an office
 *     manager, and a control proof they cannot perform is a control proof that
 *     does not happen.
 *
 * Gated by `Firms_Domain_AutoJoin_Enabled` (default off) on top of
 * `Firms_SelfServe_Enabled`; with either off nothing here runs.
 */

export const isFirmDomainAutoJoinEnabled = (): boolean =>
	isSelfServeFirmsEnabled() && settings.get<boolean>('Firms_Domain_AutoJoin_Enabled') === true;

/** What we hand back to clients — never the outstanding verification token. */
export type FirmDomainDTO = {
	_id: string;
	domain: string;
	verified: boolean;
	verificationEmail?: string;
	verificationExpiresAt?: string;
	createdAt: string;
	verifiedAt?: string;
};

const toDTO = (claim: IFirmDomainClaim): FirmDomainDTO => ({
	_id: claim._id,
	domain: claim.domain,
	verified: claim.verified,
	...(claim.verificationEmail ? { verificationEmail: claim.verificationEmail } : {}),
	...(claim.verificationExpiresAt ? { verificationExpiresAt: claim.verificationExpiresAt.toISOString() } : {}),
	createdAt: claim.createdAt.toISOString(),
	...(claim.verifiedAt ? { verifiedAt: claim.verifiedAt.toISOString() } : {}),
});

const getUserOrThrow = async (userId: string): Promise<IUser> => {
	const user = await Users.findOneById(userId);
	if (!user) {
		throw new Meteor.Error('error-invalid-user', 'Invalid user', { method: 'firms.domains' });
	}
	return user;
};

/**
 * Resolve the caller's firm and assert they may administer its domains.
 * Mirrors the check in `inviteToFirm`: the firm owner, or a workspace admin.
 */
const requireFirmAdmin = async (userId: string, method: string) => {
	if (!isFirmDomainAutoJoinEnabled()) {
		throw new Meteor.Error('error-not-allowed', 'Firm domain auto-join is disabled', { method });
	}
	const user = await getUserOrThrow(userId);
	const firm = await getFirmForUser(user);
	if (!firm) {
		throw new Meteor.Error('error-no-firm', 'You are not in a firm yet', { method });
	}
	if (!firm.isOwner && !user.roles?.includes('admin')) {
		throw new Meteor.Error('error-not-allowed', 'Only the firm owner can manage firm domains', { method });
	}
	return { user, firm };
};

/**
 * Choose the address the verification token is mailed to.
 *
 * It MUST be at the domain being claimed — that round-trip is the entire proof.
 * The caller may name one (`info@`, `admin@`, a shared mailbox); otherwise we
 * use the claimer's own address when it happens to be at the domain, which is
 * the common case and saves a form field.
 */
const resolveVerificationTarget = (user: IUser, domain: string, requested: unknown, method: string): string => {
	if (requested !== undefined && requested !== null && requested !== '') {
		if (typeof requested !== 'string' || !Mailer.checkAddressFormat(requested.trim())) {
			throw new Meteor.Error('error-invalid-email', 'The verification address is not a valid email address', { method });
		}
		const address = requested.trim().toLowerCase();
		if (extractEmailDomain(address) !== domain) {
			throw new Meteor.Error('error-verification-email-domain-mismatch', `The verification address must be at ${domain}`, { method });
		}
		return address;
	}

	const own = pickAdoptableEmail(user.emails, { requireVerified: false });
	if (own && extractEmailDomain(own) === domain) {
		return own;
	}
	throw new Meteor.Error('error-verification-email-required', `Provide an email address at ${domain} to send the verification link to`, {
		method,
	});
};

const sendVerificationEmail = async (to: string, domain: string, firmName: string, token: string): Promise<void> => {
	const siteName = settings.get<string>('Site_Name') || 'MatterChat';
	const siteUrl = settings.get<string>('Site_Url')?.replace(/\/+$/, '') ?? '';
	const fromEmail = settings.get<string>('From_Email');
	// A landing route, not an API call: the recipient is clicking in a mail
	// client. The page is expected to POST firms.domains.verify with this token.
	//
	// TODO(matterchat): the `/firm-domain/verify/:token` client route does not
	// exist yet — this server slice ships the claim/verify/list/remove REST
	// surface, and the Firm Console page that consumes it is the follow-up. Until
	// that route lands the loop is closable by POSTing firms.domains.verify
	// directly with the token from this link.
	const verifyUrl = `${siteUrl}/firm-domain/verify/${token}`;

	const html =
		`<p><strong>${firmName}</strong> would like to automatically add everyone with an <strong>@${domain}</strong> email address to its ${siteName} workspace.</p>` +
		`<p><a href="${verifyUrl}">Confirm this domain</a> to switch that on.</p>` +
		`<p>If the button doesn't work, paste this link into your browser:<br/>${verifyUrl}</p>` +
		`<p>This link expires in 48 hours. If you were not expecting this, ignore this email — nothing changes until the link is used.</p>`;

	await Mailer.send({
		to,
		from: fromEmail,
		subject: `Confirm the ${domain} email domain for ${firmName}`,
		html,
	});
};

/**
 * Claim a domain for the caller's firm and send the verification email.
 *
 * Re-claiming a domain the firm already has PENDING re-sends the token (people
 * lose the email). Re-claiming one already VERIFIED, or one held by another
 * firm, is refused.
 */
export const claimFirmDomain = async (
	userId: string,
	rawDomain: unknown,
	rawVerificationEmail?: unknown,
): Promise<{ domain: FirmDomainDTO; sentTo: string }> => {
	const method = 'firms.domains.claim';
	const { user, firm } = await requireFirmAdmin(userId, method);

	const check = checkClaimableDomain(rawDomain);
	if (!check.ok) {
		if (check.reason === 'public-provider') {
			throw new Meteor.Error(
				'error-public-email-domain',
				'That is a public email provider and cannot be claimed by a firm. Invite those teammates with an invite link instead.',
				{ method },
			);
		}
		throw new Meteor.Error('error-invalid-domain', 'That is not a valid email domain', { method });
	}
	const { domain } = check;

	const sentTo = resolveVerificationTarget(user, domain, rawVerificationEmail, method);
	const token = Random.secret();

	const existing = await FirmDomains.findOneByDomain(domain);
	if (existing) {
		if (existing.firmId !== firm.firmId) {
			// Deliberately does not name the other firm — that would leak which
			// firms exist on the workspace to anyone who can guess a domain.
			throw new Meteor.Error('error-domain-already-claimed', `${domain} has already been claimed on this workspace`, { method });
		}
		if (existing.verified) {
			throw new Meteor.Error('error-domain-already-verified', `${domain} is already verified for your firm`, { method });
		}
		const refreshed = await FirmDomains.refreshVerification(existing._id, token, sentTo);
		if (!refreshed) {
			throw new Meteor.Error('error-domain-claim-failed', 'Could not refresh the domain claim', { method });
		}
		await sendVerificationEmail(sentTo, domain, firm.name, token);
		return { domain: toDTO(refreshed), sentTo };
	}

	let claim: IFirmDomainClaim;
	try {
		claim = await FirmDomains.create({
			domain,
			firmId: firm.firmId,
			firmName: firm.name,
			claimedBy: { _id: user._id, ...(user.username ? { username: user.username } : {}) },
			verificationToken: token,
			verificationEmail: sentTo,
		});
	} catch (err) {
		// The unique index caught a claim that landed between our read and write.
		if (isDuplicateKeyError(err)) {
			throw new Meteor.Error('error-domain-already-claimed', `${domain} has already been claimed on this workspace`, { method });
		}
		throw err;
	}

	// Sent AFTER the row exists: a token in somebody's inbox that matches no
	// claim is worse than a claim whose email failed, which can be re-sent.
	await sendVerificationEmail(sentTo, domain, firm.name, token);
	return { domain: toDTO(claim), sentTo };
};

/**
 * Consume a verification token.
 *
 * The token is the proof — it was mailed to an address at the domain, so
 * whoever holds it controls mail there. The route around this is
 * `authRequired`, which stops anonymous token grinding; it deliberately does
 * NOT require the caller to be the firm owner, because the confirming mailbox
 * (`info@`, a shared inbox) is very often not the owner's.
 */
export const verifyFirmDomain = async (rawToken: unknown): Promise<FirmDomainDTO> => {
	const method = 'firms.domains.verify';
	if (!isFirmDomainAutoJoinEnabled()) {
		throw new Meteor.Error('error-not-allowed', 'Firm domain auto-join is disabled', { method });
	}
	if (typeof rawToken !== 'string' || !rawToken.trim()) {
		throw new Meteor.Error('error-invalid-token', 'The verification token is invalid', { method });
	}
	const claim = await FirmDomains.verifyByToken(rawToken.trim());
	if (!claim) {
		// One message for "wrong", "already used" and "expired" on purpose: the
		// caller is unauthenticated with respect to this claim and the difference
		// is only useful to someone probing.
		throw new Meteor.Error('error-invalid-token', 'That verification link is invalid or has expired', { method });
	}
	return toDTO(claim);
};

/** The caller firm's domain claims, pending and verified. Owner/admin only. */
export const listFirmDomains = async (userId: string): Promise<FirmDomainDTO[]> => {
	const { firm } = await requireFirmAdmin(userId, 'firms.domains.list');
	const claims = await FirmDomains.findByFirmId(firm.firmId);
	return claims.map(toDTO);
};

/**
 * Release a domain. Owner/admin only, and scoped to the caller's own firm so a
 * claim id from another firm is a no-op rather than a cross-firm delete.
 *
 * Users already adopted keep their firm — this stops FUTURE auto-joins. Undoing
 * a membership is a different, deliberate act.
 */
export const removeFirmDomain = async (userId: string, rawId: unknown): Promise<{ removed: boolean }> => {
	const method = 'firms.domains.remove';
	const { firm } = await requireFirmAdmin(userId, method);
	if (typeof rawId !== 'string' || !rawId.trim()) {
		throw new Meteor.Error('error-invalid-params', 'A domain claim id is required', { method });
	}
	const removed = await FirmDomains.removeByIdAndFirm(rawId.trim(), firm.firmId);
	if (!removed) {
		throw new Meteor.Error('error-domain-not-found', 'No such domain claim for your firm', { method });
	}
	return { removed };
};

/**
 * Login-time adoption: if this user has no firm and their email domain has a
 * verified claim, stamp them into that firm.
 *
 * Never throws — it runs on the login path (see firmDomainLogin.ts) and a
 * domain lookup hiccup must not affect signing in. Returns the firmId when an
 * adoption happened, so the caller can log it.
 */
export const adoptUserByEmailDomain = async (user: Pick<IUser, '_id' | 'emails' | 'customFields'>): Promise<string | null> => {
	try {
		if (!isFirmDomainAutoJoinEnabled()) {
			return null;
		}
		if ((user.customFields as Record<string, unknown> | undefined)?.firmId) {
			return null;
		}

		// When the workspace verifies email, only a verified address counts —
		// otherwise anyone could type someone else's firm domain at signup and be
		// let into a private team.
		const requireVerified = settings.get<boolean>('Accounts_EmailVerification') === true;
		const address = pickAdoptableEmail(user.emails, { requireVerified });
		if (!address) {
			return null;
		}
		const domain = extractEmailDomain(address);
		if (!domain) {
			return null;
		}

		const claim = await FirmDomains.findVerifiedByDomain(domain);
		if (!claim) {
			return null;
		}

		// `adoptUserIntoFirm` is itself guarded on "no firmId", so a repeat login
		// is a no-op even if two logins race.
		await adoptUserIntoFirm(user._id, claim.firmId, claim.firmName);
		return claim.firmId;
	} catch (err) {
		console.warn('[firms] domain auto-join failed', err);
		return null;
	}
};

/** Re-exported so callers do not need to reach into the pure module. */
export { normalizeDomain, extractEmailDomain };
