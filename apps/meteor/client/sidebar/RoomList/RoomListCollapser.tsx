import type { ISubscription } from '@rocket.chat/core-typings';
import { Badge, SidebarV2CollapseGroup } from '@rocket.chat/fuselage';
import type { HTMLAttributes, KeyboardEvent, MouseEventHandler } from 'react';
import { useTranslation } from 'react-i18next';

import { useUnreadDisplay } from '../hooks/useUnreadDisplay';

type RoomListCollapserProps = {
	groupTitle: string;
	collapsedGroups: string[];
	onClick: MouseEventHandler<HTMLElement>;
	onKeyDown: (e: KeyboardEvent) => void;
	unreadCount: Pick<ISubscription, 'userMentions' | 'groupMentions' | 'unread' | 'tunread' | 'tunreadUser' | 'tunreadGroup'> & {
		// Total members of this group (Omnis addition — see useRoomList); drives the header "(N)" count.
		groupSize?: number;
	};
} & Omit<HTMLAttributes<HTMLElement>, 'onClick' | 'onKeyDown'>;
const RoomListCollapser = ({ groupTitle, unreadCount: unreadGroupCount, collapsedGroups, ...props }: RoomListCollapserProps) => {
	const { t } = useTranslation();

	const { unreadTitle, unreadVariant, showUnread, unreadCount } = useUnreadDisplay(unreadGroupCount);

	// Omnis channel folders use a dynamic `folder:<name>` group key — show the bare folder name.
	const isFolder = groupTitle.startsWith('folder:');
	const groupLabel = isFolder ? groupTitle.slice('folder:'.length) : t(groupTitle);

	// For the Omnis matter-grouping sections (the "Matters" group and channel folders) append a
	// total-member count to the header — e.g. "Matters (12)" — so firms with many matter channels can
	// gauge a group at a glance. `groupSize` rides in on the unread-info object (see useRoomList) and,
	// unlike the virtuoso group count, stays truthful while the group is collapsed. Standard groups
	// (Channels, Direct Messages, …) keep their plain labels, preserving current behavior.
	const groupSize = unreadGroupCount?.groupSize;
	const showCount = (isFolder || groupTitle === 'Matters') && typeof groupSize === 'number' && groupSize > 0;
	const displayLabel = showCount ? `${groupLabel} (${groupSize})` : groupLabel;

	return (
		<SidebarV2CollapseGroup
			title={displayLabel}
			expanded={!collapsedGroups.includes(groupTitle)}
			badge={
				showUnread ? (
					<Badge variant={unreadVariant} title={unreadTitle} aria-label={unreadTitle} role='status'>
						{unreadCount.total}
					</Badge>
				) : undefined
			}
			aria-label={
				!collapsedGroups.includes(groupTitle) ? t('Collapse_group', { group: groupLabel }) : t('Expand_group', { group: groupLabel })
			}
			{...props}
		/>
	);
};

export default RoomListCollapser;
