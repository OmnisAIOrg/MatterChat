import { Invites, Rooms, Settings } from '@rocket.chat/models';
import { Meteor } from 'meteor/meteor';

import { resolveFirmInviteLimits } from '../../lib/firms/firmsHelpers';
import { SystemLogger } from '../../lib/logger/system';

/**
 * MATTERCHAT: retro-tighten pre-existing firm invite links (2026-07-30 audit).
 *
 * Firm invites used to be minted with `maxUses: 0` (unlimited redemptions).
 * Creation is now settings-driven and always finite (see inviteToFirm /
 * resolveFirmInviteLimits), but links minted before this change may still be
 * circulating — prod has Firms_SelfServe_Enabled on. This sweep caps every
 * unlimited-use invite that points at a firm team room at the configured
 * Firms_Invite_MaxUses value.
 *
 * Semantics:
 * - Naturally idempotent: only documents with `maxUses: 0` match, and the
 *   sweep writes a non-zero cap, so reruns are no-ops.
 * - `days`/`expires` are left untouched — every legacy firm invite already
 *   carries a real expiry (they were minted with days: 15), so only the
 *   unlimited-uses hole needs closing retroactively.
 * - An old link whose `uses` already exceeds the new cap goes dead immediately
 *   (stock validateInviteToken reports it as expired); the next firms.invite
 *   call auto-mints a fresh link because findOrCreateInvite's dedupe query
 *   skips exhausted/expired invites.
 * - Runs even when Firms_SelfServe_Enabled is off — the invite documents are
 *   the hazard, not the feature flag.
 * - Reads the Settings COLLECTION directly (not the settings cache), like
 *   matterchatConfigFixes.ts, because the cache may not be primed when this
 *   startup hook runs; a missing/garbage value falls back to the default cap.
 */
export function tightenFirmInvites(): void {
	Meteor.startup(async () => {
		try {
			const maxUsesSetting = await Settings.findOneById('Firms_Invite_MaxUses', { projection: { value: 1 } });
			const { maxUses } = resolveFirmInviteLimits(undefined, maxUsesSetting?.value);

			const firmRoomIds = await Rooms.find({ 'customFields.firmTeam': true }, { projection: { _id: 1 } })
				.map((room) => room._id)
				.toArray();
			if (firmRoomIds.length === 0) {
				return;
			}

			const result = await Invites.updateMany({ rid: { $in: firmRoomIds }, maxUses: 0 }, { $set: { maxUses } });
			if (result.modifiedCount > 0) {
				SystemLogger.warn(
					`MatterChat config fix: capped ${result.modifiedCount} unlimited-use firm invite link(s) at ${maxUses} redemptions.`,
				);
			}
		} catch (err) {
			SystemLogger.error({ msg: 'MatterChat firm-invite tightening failed (non-fatal)', err });
		}
	});
}
