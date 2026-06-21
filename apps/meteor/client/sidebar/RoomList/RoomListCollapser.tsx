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
	unreadCount: Pick<ISubscription, 'userMentions' | 'groupMentions' | 'unread' | 'tunread' | 'tunreadUser' | 'tunreadGroup'>;
} & Omit<HTMLAttributes<HTMLElement>, 'onClick' | 'onKeyDown'>;
const RoomListCollapser = ({ groupTitle, unreadCount: unreadGroupCount, collapsedGroups, ...props }: RoomListCollapserProps) => {
	const { t } = useTranslation();

	const { unreadTitle, unreadVariant, showUnread, unreadCount } = useUnreadDisplay(unreadGroupCount);

	// Omnis channel folders use a dynamic `folder:<name>` group key — show the bare folder name.
	const groupLabel = groupTitle.startsWith('folder:') ? groupTitle.slice('folder:'.length) : t(groupTitle);

	return (
		<SidebarV2CollapseGroup
			title={groupLabel}
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
