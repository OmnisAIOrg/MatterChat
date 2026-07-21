import type { ILivechatInquiryRecord } from '@rocket.chat/core-typings';
import { useDebouncedValue } from '@rocket.chat/fuselage-hooks';
import { useFeaturePreview } from '@rocket.chat/ui-client';
import type { SubscriptionWithRoom, TranslationKey } from '@rocket.chat/ui-contexts';
import { useUserPreference, useUserSubscriptions, useSetting } from '@rocket.chat/ui-contexts';
import { useVideoConfIncomingCalls } from '@rocket.chat/ui-video-conf';
import { useMemo } from 'react';

import { useSortQueryOptions } from '../../hooks/useSortQueryOptions';
import { useOmnichannelEnabled } from '../../views/omnichannel/hooks/useOmnichannelEnabled';
import { useQueuedInquiries } from '../../views/omnichannel/hooks/useQueuedInquiries';
import { useOrgSwitcherSelection } from '../../views/root/MainLayout/OrgSwitcherContext';

const query = { open: { $ne: false } };

const emptyQueue: ILivechatInquiryRecord[] = [];

const order = [
	'Incoming_Calls',
	'Incoming_Livechats',
	'Open_Livechats',
	'On_Hold_Chats',
	'Unread',
	'Drafts',
	'Favorites',
	'Teams',
	'Discussions',
	'Matters',
	'Channels',
	'Direct_Messages',
	'Conversations',
] as const;

/**
 * Per-provider sidebar sections for connector-bridged rooms (rooms mirroring an external
 * conversation, tagged `connectorBridge` at creation) — one clearly-labeled group per provider
 * so Slack, Teams and Google Chat bridges never mix into one anonymous pile (founder ask
 * 2026-07-21). Fixed order: Slack, Teams, Google Chat.
 */
const BRIDGE_GROUP_BY_PROVIDER: Record<string, string> = {
	slack: 'Slack_Bridges',
	teams: 'Teams_Bridges',
	google: 'Google_Chat_Bridges',
};
const BRIDGE_GROUP_ORDER = ['Slack_Bridges', 'Teams_Bridges', 'Google_Chat_Bridges'];

type useRoomListReturnType = {
	roomList: Array<SubscriptionWithRoom>;
	groupsCount: number[];
	groupsList: TranslationKey[];
	groupedUnreadInfo: (Pick<
		SubscriptionWithRoom,
		'userMentions' | 'groupMentions' | 'unread' | 'tunread' | 'tunreadUser' | 'tunreadGroup' | 'alert' | 'hideUnreadStatus'
	> & { groupSize: number })[];
};
export const useRoomList = ({ collapsedGroups }: { collapsedGroups?: string[] }): useRoomListReturnType => {
	const showOmnichannel = useOmnichannelEnabled();
	const sidebarGroupByType = useUserPreference('sidebarGroupByType');
	const favoritesEnabled = useUserPreference('sidebarShowFavorites');
	const sidebarDrafts = useFeaturePreview('sidebarDrafts');
	const sidebarOrder = useUserPreference<typeof order>('sidebarSectionsOrder') ?? order;
	const isDiscussionEnabled = useSetting('Discussion_enabled');
	const sidebarShowUnread = useUserPreference('sidebarShowUnread');

	const options = useSortQueryOptions();

	const rooms = useUserSubscriptions(query, options);

	const { selectedOrgId } = useOrgSwitcherSelection();

	const inquiries = useQueuedInquiries();

	const incomingCalls = useVideoConfIncomingCalls();

	const queue = inquiries.enabled ? inquiries.queue : emptyQueue;

	const { groupsCount, groupsList, roomList, groupedUnreadInfo } = useDebouncedValue(
		useMemo(() => {
			const isCollapsed = (groupTitle: string) => collapsedGroups?.includes(groupTitle);

			const drafts = new Set();
			const incomingCall = new Set();
			const favorite = new Set();
			const team = new Set();
			const omnichannel = new Set();
			const unread = new Set();
			const channels = new Set();
			const direct = new Set();
			const discussion = new Set();
			const conversation = new Set();
			const onHold = new Set();
			const matters = new Set();
			// Omnis channel folders: one dynamic group per user-assigned folder label (key `folder:<name>`).
			const folders = new Map<string, Set<any>>();
			// Connector bridges: one group per provider (Slack_Bridges / Teams_Bridges / Google_Chat_Bridges).
			const bridges = new Map<string, Set<any>>();

			rooms.forEach((room) => {
				if (room.archived) {
					return;
				}

				// Slack workspace view: when the connected-Slack tile is selected in the org rail,
				// show ONLY its bridged channels (rooms carrying Slack importIds).
				if (selectedOrgId === 'slack' && !(Array.isArray(room.importIds) && room.importIds.length > 0)) {
					return;
				}

				if (incomingCalls.find((call) => call.rid === room.rid)) {
					return incomingCall.add(room);
				}

				if (sidebarShowUnread && (room.alert || room.unread || room.tunread?.length) && !room.hideUnreadStatus) {
					return unread.add(room);
				}

				if (sidebarDrafts && room.draft) {
					return drafts.add(room);
				}

				if (favoritesEnabled && room.f) {
					return favorite.add(room);
				}

				if (sidebarGroupByType && room.teamMain) {
					return team.add(room);
				}

				if (sidebarGroupByType && isDiscussionEnabled && room.prid) {
					return discussion.add(room);
				}

				if (sidebarGroupByType && room.matterCardId) {
					return matters.add(room);
				}

				if (sidebarGroupByType && room.folder) {
					const key = `folder:${room.folder}`;
					const bucket = folders.get(key) ?? new Set();
					bucket.add(room);
					folders.set(key, bucket);
					return;
				}

				// Bridged external conversations get their own per-provider section — never mixed
				// into Channels/DMs, so a user always knows which room is a Slack/Teams/GChat mirror.
				if (sidebarGroupByType && room.connectorBridge?.provider) {
					const key = BRIDGE_GROUP_BY_PROVIDER[room.connectorBridge.provider] ?? `bridge:${room.connectorBridge.provider}`;
					const bucket = bridges.get(key) ?? new Set();
					bucket.add(room);
					bridges.set(key, bucket);
					return;
				}

				if (room.t === 'c' || room.t === 'p') {
					channels.add(room);
				}

				if (room.t === 'l' && room.onHold) {
					return showOmnichannel && onHold.add(room);
				}

				if (room.t === 'l') {
					return showOmnichannel && omnichannel.add(room);
				}

				if (room.t === 'd') {
					direct.add(room);
				}

				conversation.add(room);
			});

			const groups = new Map<string, Set<any>>();
			incomingCall.size && groups.set('Incoming_Calls', incomingCall);

			showOmnichannel && inquiries.enabled && queue.length && groups.set('Incoming_Livechats', new Set(queue));
			showOmnichannel && omnichannel.size && groups.set('Open_Livechats', omnichannel);
			showOmnichannel && onHold.size && groups.set('On_Hold_Chats', onHold);

			sidebarShowUnread && unread.size && groups.set('Unread', unread);

			sidebarDrafts && drafts.size && groups.set('Drafts', drafts);

			favoritesEnabled && favorite.size && groups.set('Favorites', favorite);

			sidebarGroupByType && team.size && groups.set('Teams', team);

			sidebarGroupByType && isDiscussionEnabled && discussion.size && groups.set('Discussions', discussion);

			// Matters group: sort alphabetically (case-insensitive) by the human matter/client name —
			// the `topic` set at link time, falling back to fname/raw name. For firms with 50+ matter
			// channels a stable name-sorted list is the most scannable (you look a matter up by client
			// name); activity ordering would make a long list shuffle on every message. A sorted Set
			// keeps `.size` and iterability intact for the group-assembly reduce below.
			const matterSortName = (room: SubscriptionWithRoom): string => String(room.topic || room.fname || room.name || '').toLowerCase();
			const sortedMatters = new Set(
				([...matters] as SubscriptionWithRoom[]).sort((a, b) => matterSortName(a).localeCompare(matterSortName(b))),
			);

			sidebarGroupByType && matters.size && groups.set('Matters', sortedMatters);

			sidebarGroupByType && channels.size && groups.set('Channels', channels);

			sidebarGroupByType && direct.size && groups.set('Direct_Messages', direct);

			!sidebarGroupByType && groups.set('Conversations', conversation);

			// Add a group per bridge provider (fixed Slack → Teams → Google Chat order, unknown
			// providers alpha-sorted after), then a group per folder; weave both into the ordered
			// key list just above "Channels" so they sit with the channel groups.
			const bridgeKeys = sidebarGroupByType
				? [...bridges.keys()].sort((a, b) => {
						const ai = BRIDGE_GROUP_ORDER.indexOf(a);
						const bi = BRIDGE_GROUP_ORDER.indexOf(b);
						return (ai === -1 ? BRIDGE_GROUP_ORDER.length : ai) - (bi === -1 ? BRIDGE_GROUP_ORDER.length : bi) || a.localeCompare(b);
					})
				: [];
			bridgeKeys.forEach((key) => {
				const bucket = bridges.get(key);
				bucket && bucket.size && groups.set(key, bucket);
			});

			const folderKeys = sidebarGroupByType ? [...folders.keys()].sort() : [];
			folderKeys.forEach((key) => {
				const bucket = folders.get(key);
				bucket && bucket.size && groups.set(key, bucket);
			});

			const wovenKeys = [...bridgeKeys, ...folderKeys];
			const channelsIndex = sidebarOrder.indexOf('Channels');
			const orderedKeys: string[] =
				wovenKeys.length && channelsIndex >= 0
					? [...sidebarOrder.slice(0, channelsIndex), ...wovenKeys, ...sidebarOrder.slice(channelsIndex)]
					: [...sidebarOrder, ...wovenKeys];

			const { groupsCount, groupsList, roomList, groupedUnreadInfo } = orderedKeys.reduce(
				(acc, key) => {
					const value = groups.get(key);

					if (!value) {
						return acc;
					}

					acc.groupsList.push(key as TranslationKey);

					const groupedUnreadInfoAcc = {
						userMentions: 0,
						groupMentions: 0,
						tunread: [],
						tunreadUser: [],
						unread: 0,
						// Total members of this group, carried alongside the unread aggregates so the
						// collapser can render a stable "(N)" count (e.g. "Matters (12)"). Unlike
						// `groupsCount` this is NOT zeroed when the group is collapsed, so the header
						// count stays truthful in both states. RoomList already forwards this object to
						// the collapser, so no extra prop plumbing is needed.
						groupSize: value.size,
					};

					if (isCollapsed(key)) {
						const groupedUnreadInfo = [...value].reduce(
							(counter, { userMentions, groupMentions, tunread, tunreadUser, unread, alert, hideUnreadStatus }) => {
								if (hideUnreadStatus) {
									return counter;
								}

								counter.userMentions += userMentions || 0;
								counter.groupMentions += groupMentions || 0;
								counter.tunread = [...counter.tunread, ...(tunread || [])];
								counter.tunreadUser = [...counter.tunreadUser, ...(tunreadUser || [])];
								counter.unread += unread || 0;
								!unread && !tunread?.length && alert && (counter.unread += 1);
								return counter;
							},
							groupedUnreadInfoAcc,
						);

						acc.groupedUnreadInfo.push(groupedUnreadInfo);
						acc.groupsCount.push(0);
						return acc;
					}

					acc.groupedUnreadInfo.push(groupedUnreadInfoAcc);
					acc.groupsCount.push(value.size);
					acc.roomList.push(...value);
					return acc;
				},
				{
					groupsCount: [],
					groupsList: [],
					roomList: [],
					groupedUnreadInfo: [],
				} as useRoomListReturnType,
			);

			return { groupsCount, groupsList, roomList, groupedUnreadInfo };
		}, [
			rooms,
			selectedOrgId,
			showOmnichannel,
			inquiries.enabled,
			sidebarDrafts,
			queue,
			sidebarShowUnread,
			favoritesEnabled,
			sidebarGroupByType,
			isDiscussionEnabled,
			sidebarOrder,
			collapsedGroups,
			incomingCalls,
		]),
		50,
	);

	return {
		roomList,
		groupsCount,
		groupsList,
		groupedUnreadInfo,
	};
};
