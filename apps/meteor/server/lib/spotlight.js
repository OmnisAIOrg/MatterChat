import { Team } from '@rocket.chat/core-services';
import { Users, Subscriptions as SubscriptionsRaw, Rooms } from '@rocket.chat/models';
import { escapeRegExp } from '@rocket.chat/string-helpers';

import { canAccessRoomAsync, roomAccessAttributes } from '../../app/authorization/server';
import { hasPermissionAsync, hasAllPermissionAsync } from '../../app/authorization/server/functions/hasPermission';
import { settings } from '../../app/settings/server';
import { trim } from '../../lib/utils/stringUtils';
import { readSecondaryPreferred } from '../database/readSecondaryPreferred';
import { firmRoomScopeQuery } from './firms/firmsRoomScope';
import {
	getCallerFirmCohort,
	getFirmRoomScopeExtraQuery,
	getFirmScopeExtraQuery,
	isSelfServeFirmsEnabled,
	roomMatchesFirmScope,
	userMatchesFirmScope,
} from './firms/firmsService';
import { roomCoordinator } from './rooms/roomCoordinator';

/**
 * MATTERCHAT: how many pages of teams to pull from Mongo before the firm
 * post-filter in _searchTeams, so a page full of foreign-firm matches does not
 * starve the caller's own firm out of @mention autocomplete.
 */
const TEAM_FIRM_OVERFETCH_FACTOR = 4;

export class Spotlight {
	async fetchRooms(userId, rooms) {
		if (!settings.get('Store_Last_Message') || (await hasPermissionAsync(userId, 'preview-c-room'))) {
			return rooms;
		}

		return rooms.map((room) => {
			delete room.lastMessage;
			return room;
		});
	}

	async searchRooms({ userId, text, includeFederatedRooms = false }) {
		const regex = new RegExp(trim(escapeRegExp(text)), 'i');

		const roomOptions = {
			limit: 5,
			projection: {
				t: 1,
				name: 1,
				fname: 1,
				teamMain: 1,
				joinCodeRequired: 1,
				lastMessage: 1,
				federated: true,
				prid: 1,
			},
			sort: {
				name: 1,
			},
		};

		if (userId == null) {
			if (!settings.get('Accounts_AllowAnonymousRead')) {
				return [];
			}

			// MATTERCHAT: self-serve firms — an ANONYMOUS visitor is the unstamped cohort:
			// legacy/workspace-wide rooms only, never another firm's stamped rooms. Without
			// this arm, enabling Accounts_AllowAnonymousRead reopens the exact cross-firm
			// enumeration leak the authenticated path below closes.
			const anonScope = isSelfServeFirmsEnabled() ? firmRoomScopeQuery(null) : null;
			return this.fetchRooms(
				userId,
				await Rooms.findByNameAndTypeNotDefault(regex, 'c', roomOptions, includeFederatedRooms, anonScope ? [anonScope] : []).toArray(),
			);
		}

		if (!(await hasAllPermissionAsync(userId, ['view-outside-room', 'view-c-room']))) {
			return [];
		}

		const searchableRoomTypeIds = roomCoordinator.searchableRoomTypes();

		const roomIds = (
			await SubscriptionsRaw.findByUserIdAndTypes(userId, searchableRoomTypeIds, {
				projection: { rid: 1 },
			}).toArray()
		).map((s) => s.rid);

		// MATTERCHAT: self-serve firms — room search stays inside the caller's firm cohort.
		// Legacy rooms without a firmId stay visible to everyone; admins and the
		// feature-off case get no scope (null). The caller's OWN subscribed rooms are passed
		// in so membership always beats the firm stamp: the $nin below already excludes them
		// from the regex query, but the exact-name lookup (findOneByNameAndType) is NOT
		// id-excluded, so without them a room the caller is legitimately in but that carries
		// another firm's stamp would be unfindable by its exact name.
		const roomScope = await getFirmRoomScopeExtraQuery(userId, roomIds);
		const extraQueries = roomScope ? [roomScope] : [];

		const exactRoom = await Rooms.findOneByNameAndType(text, searchableRoomTypeIds, roomOptions, includeFederatedRooms, extraQueries);
		if (exactRoom) {
			roomIds.push(exactRoom.rid);
		}

		return this.fetchRooms(
			userId,
			await Rooms.findByNameOrFNameAndTypesNotInIds(
				regex,
				searchableRoomTypeIds,
				roomIds,
				roomOptions,
				includeFederatedRooms,
				extraQueries,
			).toArray(),
		);
	}

	mapOutsiders(u) {
		u.outside = true;
		return u;
	}

	processLimitAndUsernames(options, usernames, users) {
		// Reduce the results from the limit for the next query
		options.limit -= users.length;

		// If the limit was reached, return
		if (options.limit <= 0) {
			return users;
		}

		// Prevent the next query to get the same users
		usernames.push(...users.map((u) => u.username).filter((u) => !usernames.includes(u)));
	}

	async _searchInsiderUsers({ rid, text, usernames, options, users, insiderExtraQuery, match = { startsWith: false, endsWith: false } }) {
		// Get insiders first
		if (rid) {
			const searchFields = settings.get('Accounts_SearchFields').trim().split(',');

			users.push(...(await Users.findByActiveUsersExcept(text, usernames, options, searchFields, insiderExtraQuery, match).toArray()));

			// If the limit was reached, return
			if (this.processLimitAndUsernames(options, usernames, users)) {
				return users;
			}
		}
	}

	async _searchConnectedUsers(userId, { text, usernames, options, users, match = { startsWith: false, endsWith: false } }, roomType) {
		const searchFields = settings.get('Accounts_SearchFields').trim().split(',');

		users.push(
			...(
				await SubscriptionsRaw.findConnectedUsersExcept(userId, text, usernames, searchFields, {}, options.limit || 5, roomType, match, {
					readPreference: options.readPreference,
				})
			).map(this.mapOutsiders),
		);

		// If the limit was reached, return
		if (this.processLimitAndUsernames(options, usernames, users)) {
			return users;
		}
	}

	async _searchOutsiderUsers({
		text,
		usernames,
		options,
		users,
		canListOutsiders,
		firmScope,
		match = { startsWith: false, endsWith: false },
	}) {
		// Then get the outsiders if allowed
		if (canListOutsiders) {
			const searchFields = settings.get('Accounts_SearchFields').trim().split(',');
			// MATTERCHAT: self-serve firms — outsider search stays inside the caller's firm cohort
			const extraQuery = firmScope ? [firmScope] : undefined;
			users.push(
				...(await Users.findByActiveUsersExcept(text, usernames, options, searchFields, extraQuery, match).toArray()).map(
					this.mapOutsiders,
				),
			);

			// If the limit was reached, return
			if (this.processLimitAndUsernames(options, usernames, users)) {
				return users;
			}
		}
	}

	mapTeams(teams) {
		return teams.map((t) => {
			t.isTeam = true;
			t.username = t.name;
			t.status = 'online';
			return t;
		});
	}

	async _searchTeams(userId, { text, options, users, mentions }) {
		if (!mentions || settings.get('Troubleshoot_Disable_Teams_Mention')) {
			return users;
		}

		options.limit -= users.length;

		if (options.limit <= 0) {
			return users;
		}

		// MATTERCHAT: self-serve firms — Team.search returns every PUBLIC team, which
		// would let one firm enumerate another's teams via @mention autocomplete. Teams
		// carry no firm stamp of their own (the stamp lives on the team's MAIN ROOM), so
		// this one surface post-filters instead of pushing the scope into Mongo.
		//
		// Post-filtering interacts badly with the DB limit — if the first N matches are
		// foreign-firm teams the caller gets a short page while same-firm teams matched
		// beyond it — so OVER-FETCH by TEAM_FIRM_OVERFETCH_FACTOR and slice back to the
		// caller's limit after filtering. Not a hard guarantee (a caller with >4x the
		// limit in foreign matches can still come up short) but it removes the common case;
		// the alternative is resolving cohort room ids into Team.search's id restriction.
		const cohort = await getCallerFirmCohort(userId);
		const wantedLimit = options.limit;
		const teamOptions = {
			...options,
			...(cohort !== undefined ? { limit: wantedLimit * TEAM_FIRM_OVERFETCH_FACTOR } : {}),
			projection: { name: 1, type: 1, roomId: 1 },
		};
		let teams = await Team.search(userId, text, teamOptions);

		// Teams the caller is a member of always stay (membership beats the stamp), and
		// unstamped/legacy teams stay visible to everyone.
		if (cohort !== undefined && teams.length) {
			const mainRoomIds = teams.map((team) => team.roomId).filter(Boolean);
			const memberRoomIds = new Set(
				(await SubscriptionsRaw.findByUserIdAndRoomIds(userId, mainRoomIds, { projection: { rid: 1 } }).toArray()).map((s) => s.rid),
			);
			const mainRooms = await Rooms.findByIds(mainRoomIds, { projection: { customFields: 1 } }).toArray();
			const roomById = new Map(mainRooms.map((room) => [room._id, room]));
			teams = teams
				.filter((team) => memberRoomIds.has(team.roomId) || roomMatchesFirmScope(roomById.get(team.roomId), cohort))
				// back to the page size the caller asked for (we over-fetched above)
				.slice(0, wantedLimit);
		}
		// roomId was only needed for the firm filter — keep the wire shape unchanged
		for (const team of teams) {
			delete team.roomId;
		}
		users.push(...this.mapTeams(teams));

		return users;
	}

	async searchUsers({ userId, rid, text, usernames, mentions }) {
		const users = [];

		const options = {
			limit: settings.get('Number_of_users_autocomplete_suggestions'),
			projection: {
				username: 1,
				nickname: 1,
				name: 1,
				status: 1,
				statusText: 1,
				avatarETag: 1,
			},
			sort: {
				[settings.get('UI_Use_Real_Name') ? 'name' : 'username']: 1,
			},
			readPreference: readSecondaryPreferred(Users.col.s.db),
		};

		const room = await Rooms.findOneById(rid, { projection: { ...roomAccessAttributes, _id: 1, t: 1, uids: 1 } });

		if (rid && !room) {
			return users;
		}

		const canListOutsiders = await hasAllPermissionAsync(userId, ['view-outside-room', 'view-d-room']);
		const canListInsiders = canListOutsiders || (rid && (await canAccessRoomAsync(room, { _id: userId })));

		// MATTERCHAT: self-serve firms — non-admin searches are scoped to the caller's firm cohort
		const firmScope = await getFirmScopeExtraQuery(userId);

		const insiderExtraQuery = [];

		if (rid) {
			switch (room.t) {
				case 'd':
					insiderExtraQuery.push({
						_id: { $in: room.uids.filter((id) => id !== userId) },
					});
					break;
				case 'l':
					insiderExtraQuery.push({
						_id: {
							$in: (await SubscriptionsRaw.findByRoomId(room._id).toArray()).map((s) => s.u?._id).filter((id) => id && id !== userId),
						},
					});
					break;
				default:
					insiderExtraQuery.push({
						__rooms: rid,
					});
					break;
			}
		}

		const searchParams = {
			rid,
			text,
			usernames,
			options,
			users,
			canListOutsiders,
			firmScope,
			insiderExtraQuery,
			mentions,
		};

		// Exact match for username only
		// TODO: these exact-match branches push the user without filtering against `usernames`
		// (the exclusion list), so an exact username query bypasses the exclusion that the
		// findByActiveUsersExcept paths below honor. Evaluate filtering exactMatch against
		// `usernames` here so the exclusion applies uniformly.
		if (rid && canListInsiders) {
			const exactMatch = await Users.findOneByUsernameAndRoomIgnoringCase(text, rid, {
				projection: options.projection,
				readPreference: options.readPreference,
			});
			if (exactMatch) {
				users.push(exactMatch);
				this.processLimitAndUsernames(options, usernames, users);
			}
		}

		if (users.length === 0 && canListOutsiders && text) {
			const exactMatch = await Users.findOneByUsernameIgnoringCase(text, {
				projection: { ...options.projection, ...(firmScope && { customFields: 1 }) },
				readPreference: options.readPreference,
			});
			// MATTERCHAT: exact-username lookups must not leak users outside the firm cohort
			if (exactMatch && userMatchesFirmScope(exactMatch, firmScope)) {
				delete exactMatch.customFields;
				users.push(this.mapOutsiders(exactMatch));
				this.processLimitAndUsernames(options, usernames, users);
			}
		}

		if (canListInsiders && rid) {
			// Search for insiders
			if (await this._searchInsiderUsers(searchParams)) {
				return users;
			}

			// Search for users that the requester has DMs with
			if (await this._searchConnectedUsers(userId, searchParams, 'd')) {
				return users;
			}
		}

		// If the user can search outsiders, search for any user in the server
		// Otherwise, search for users that are subscribed to the same rooms as the requester
		if (canListOutsiders) {
			if (await this._searchOutsiderUsers(searchParams)) {
				return users;
			}
		} else if (await this._searchConnectedUsers(userId, searchParams, 'd')) {
			return users;
		}

		if (await this._searchTeams(userId, searchParams)) {
			return users;
		}

		return users;
	}
}
