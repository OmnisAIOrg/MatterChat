/**
 * MATTERCHAT: shared constants and react-query keys for the Firm Console.
 *
 * The two whitelists below are NOT cosmetic. `findOrCreateInvite` on the server
 * rejects any other value outright — it does not round to the nearest allowed
 * one — so the UI must offer exactly these and nothing else. That is why the
 * create-invite form uses selects rather than number inputs: a free-text field
 * would let an owner type "14" and get an error they cannot act on.
 *
 * Keeping the keys here (rather than inline at each call site) means the create
 * and revoke mutations invalidate the same cache entries the lists read, so a
 * link disappears from the table the moment it is revoked.
 */

/** Days until an invite link expires. 0 = never expires. */
export const INVITE_DAYS_OPTIONS = [0, 1, 7, 15, 30] as const;

/** How many times an invite link may be redeemed. 0 = unlimited. */
export const INVITE_MAX_USES_OPTIONS = [0, 1, 5, 10, 25, 50, 100] as const;

/** The server's own defaults, mirrored so the form opens on a legal combination. */
export const INVITE_DEFAULT_DAYS = 15;
export const INVITE_DEFAULT_MAX_USES = 0;

export const firmMineQueryKey = ['firms', 'mine'] as const;
export const firmTemplatesQueryKey = ['firms', 'templates'] as const;
export const firmInvitesQueryKey = ['firms', 'invites'] as const;
export const firmDomainsQueryKey = ['firms', 'domains'] as const;
export const firmRoomQueryKey = (roomId: string) => ['firms', 'room', roomId] as const;
export const firmMembersQueryKey = (firmId: string) => ['firms', 'members', firmId] as const;
