import { Box } from '@rocket.chat/fuselage';
import { Fragment, memo, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import SidebarItemsAssembler from '../../../components/Sidebar/SidebarItemsAssembler';
import type { Item } from '../../../lib/createSidebarItems';
import { isSidebarItem } from '../../../lib/createSidebarItems';
import { subscribeToBoardsSidebarItems, getBoardsSidebarItems } from '../sidebarItems';

type BoardsSidebarPagesProps = {
	currentPath: string;
};

type NavGroup = {
	labelKey: string;
	labelFallback?: string;
	items: Item[];
};

const BoardsSidebarPages = ({ currentPath }: BoardsSidebarPagesProps) => {
	const { t } = useTranslation();
	const items = useSyncExternalStore(subscribeToBoardsSidebarItems, getBoardsSidebarItems);

	// LEDGER CHROME (presentation only): the flat item list is split at its
	// divider entries into labelled groups — the first group is captioned
	// "Pipelines", each divider's own i18nLabel captions the group it opens
	// (small-caps mono labels via .mc-boards-nav-label in
	// BoardsChromeStyleTags). Same items, same order, same hrefs; permission
	// gating still happens inside SidebarItemsAssembler/SidebarNavigationItem.
	// Computed inline every render (NOT memoized) because the store mutates its
	// array in place — same freshness semantics as the assembler's own .map.
	// forEach (like .map) skips the holes unregisterSidebarItem can leave.
	const groups: NavGroup[] = [{ labelKey: 'Boards_Pipelines', labelFallback: 'Pipelines', items: [] }];
	items.forEach((item) => {
		if (isSidebarItem(item)) {
			groups[groups.length - 1].items.push(item);
		} else {
			groups.push({ labelKey: item.i18nLabel, items: [] });
		}
	});

	// A group label only shows when at least one of its items would render
	// (same permissionGranted functions SidebarNavigationItem evaluates —
	// checked here ONLY for label visibility, never to gate the items).
	const isGroupVisible = (group: NavGroup): boolean =>
		group.items.some((item) => (typeof item.permissionGranted === 'function' ? item.permissionGranted() : true));

	return (
		<Box className='mc-boards-nav' display='flex' flexDirection='column' flexShrink={0} pb={8}>
			{groups.map((group) => (
				<Fragment key={group.labelKey}>
					{isGroupVisible(group) && (
						<Box is='h3' className='mc-boards-nav-label'>
							{group.labelFallback
								? t(group.labelKey as Parameters<typeof t>[0], { defaultValue: group.labelFallback })
								: t(group.labelKey as Parameters<typeof t>[0])}
						</Box>
					)}
					<SidebarItemsAssembler items={group.items} currentPath={currentPath} />
				</Fragment>
			))}
		</Box>
	);
};

export default memo(BoardsSidebarPages);
