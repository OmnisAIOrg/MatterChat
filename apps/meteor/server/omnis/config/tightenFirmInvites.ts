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
 * - NEVER-EXPIRING links are capped too (2026-07-30 fixer). Legacy firm invites
 *   were minted with days: 15, but the stock `/v1/findOrCreateInvite` endpoint
 *   accepts `days: 0` = "never expires", so a link with `expires: null` can
 *   exist. Those get `days` + an `expires` computed from NOW (the original
 *   createdAt may be long past, and back-dating would kill the link outright
 *   rather than bound it).
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
			const [maxUsesSetting, expirySetting] = await Promise.all([
				Settings.findOneById('Firms_Invite_MaxUses', { projection: { value: 1 } }),
				Settings.findOneById('Firms_Invite_Expiry_Days', { projection: { value: 1 } }),
			]);
			const { days, maxUses } = resolveFirmInviteLimits(expirySetting?.value, maxUsesSetting?.value);

			// Rooms carrying EITHER firm marker: firmTeam is the home-room flag the adoption
			// path keys on, firmId covers firm-stamped rooms whose firmTeam flag was stripped.
			const firmRoomIds = await Rooms.find(
				{ $or: [{ 'customFields.firmTeam': true }, { 'customFields.firmId': { $type: 'string' } }] },
				{ projection: { _id: 1 } },
			)
				.map((room) => room._id)
				.toArray();
			if (firmRoomIds.length === 0) {
				return;
			}

			const capped = await Invites.updateMany({ rid: { $in: firmRoomIds }, maxUses: 0 }, { $set: { maxUses } });
			if (capped.modifiedCount > 0) {
				SystemLogger.warn(
					`MatterChat config fix: capped ${capped.modifiedCount} unlimited-use firm invite link(s) at ${maxUses} redemptions.`,
				);
			}

			// `days: 0` / `expires: null` = never expires. Give those a real expiry measured
			// from now, so a permanent link minted via the stock endpoint cannot survive a boot.
			const expires = new Date();
			expires.setDate(expires.getDate() + days);
			const dated = await Invites.updateMany(
				{ rid: { $in: firmRoomIds }, $or: [{ expires: null }, { expires: { $exists: false } }] },
				{ $set: { days, expires } },
			);
			if (dated.modifiedCount > 0) {
				SystemLogger.warn(`MatterChat config fix: set a ${days}-day expiry on ${dated.modifiedCount} never-expiring firm invite link(s).`);
			}
		} catch (err) {
			SystemLogger.error({ msg: 'MatterChat firm-invite tightening failed (non-fatal)', err });
		}
	});
}
