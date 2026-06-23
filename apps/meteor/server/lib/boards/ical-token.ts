import { Users } from '@rocket.chat/models';
import { Random } from '@rocket.chat/random';

/**
 * Per-user secret token for the *public* (calendar-subscribable) Omnis Boards iCal feed.
 *
 * Calendar apps (Google / Apple / Outlook) subscribe to a plain URL and cannot send Rocket.Chat
 * auth headers (X-Auth-Token / X-User-Id). To make the feed subscribable we mint a long-lived,
 * high-entropy per-user token, store it on the user document (`boardsIcalToken`), and expose the
 * feed at an unauthenticated route that resolves the user from `?token=...`.
 *
 * The token is a 43-char `Random.secret()` (the same generator Rocket.Chat uses for security
 * secrets). It is generated lazily on first request and is idempotent thereafter. It grants
 * read-only access to ONLY this user's due-card feed, nothing else.
 */

/**
 * Return the user's existing iCal feed token, generating + persisting one on first call.
 * Idempotent: subsequent calls return the same token until it is explicitly rotated.
 */
export async function getOrCreateIcalToken(uid: string): Promise<string> {
	const user = await Users.findOne<{ _id: string; boardsIcalToken?: string }>(
		{ _id: uid },
		{ projection: { boardsIcalToken: 1 } },
	);
	if (!user) {
		throw new Error('user-not-found');
	}
	if (user.boardsIcalToken) {
		return user.boardsIcalToken;
	}

	const token = Random.secret();
	await Users.updateOne({ _id: uid }, { $set: { boardsIcalToken: token } });
	return token;
}

/**
 * Resolve the user id that owns a given iCal feed token. Returns null for a missing/unknown token
 * so the caller can reject with 401/404 and never leak whether a token exists.
 */
export async function resolveUserIdByIcalToken(token: string): Promise<string | null> {
	if (!token || typeof token !== 'string') {
		return null;
	}
	const user = await Users.findOne<{ _id: string }>({ boardsIcalToken: token }, { projection: { _id: 1 } });
	return user?._id ?? null;
}
