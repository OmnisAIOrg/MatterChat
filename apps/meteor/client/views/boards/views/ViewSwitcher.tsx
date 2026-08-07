import type { SavedViewType, Serialized, ISavedView } from '@rocket.chat/core-typings';
import { Box, Button, Icon, Tabs, TabsItem } from '@rocket.chat/fuselage';
import { GenericMenu } from '@rocket.chat/ui-client';
import type { GenericMenuItemProps } from '@rocket.chat/ui-client';
import { usePermission, useSetModal } from '@rocket.chat/ui-contexts';
import type { ReactElement } from 'react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import SaveViewModal from './SaveViewModal';
import { safeViewTypeIcon } from './lib/viewModel';
import { useSavedViews } from './lib/useSavedViews';

/**
 * ViewSwitcher — the board header control that switches between the built-in
 * view types (Board | Table | Timeline | Dashboard, + Calendar on matters
 * boards) AND the user's/board's saved views (M8).
 *
 * - Built-in tabs change the *view type* and clear the active saved view.
 * - The "Saved views" menu lists own + shared views; picking one applies its
 *   saved view type and id. Per-view manage actions (set default / delete) are
 *   gated by `boards-manage-saved-views`; "Save current view…" opens SaveViewModal.
 *
 * The parent (BoardRouter via BoardHeader) owns the `view` (type) + `activeViewId`
 * state and renders the matching view component. This switcher is presentational
 * + the saved-view CRUD glue; reads use `boards.views.list` (gated boards-view).
 */

type ViewSwitcherProps = {
	boardId: string;
	pipelineType: 'general' | 'matters' | 'leads';
	view: string;
	activeViewId?: string;
	onSelectViewType: (viewType: SavedViewType) => void;
	onSelectSavedView: (view: Serialized<ISavedView>) => void;
};

// the built-in (non-saved) view types shown as tabs.
const baseViewTabs: { type: SavedViewType; i18n: string; fallback: string }[] = [
	{ type: 'board', i18n: 'Boards_View_Board', fallback: 'Board' },
	{ type: 'table', i18n: 'Boards_View_Table', fallback: 'Table' },
	{ type: 'timeline', i18n: 'Boards_Views_Type_Timeline', fallback: 'Timeline' },
	{ type: 'dashboard', i18n: 'Boards_Views_Type_Dashboard', fallback: 'Dashboard' },
];

const ViewSwitcher = ({
	boardId,
	pipelineType,
	view,
	activeViewId,
	onSelectViewType,
	onSelectSavedView,
}: ViewSwitcherProps): ReactElement => {
	const { t } = useTranslation();
	const setModal = useSetModal();
	const canManageViews = usePermission('boards-manage-saved-views');

	const { views, setDefaultView, removeView } = useSavedViews(boardId);

	// matters boards keep the dedicated calendar tab (the matters SOL/deadline agenda).
	const tabs = useMemo(() => {
		const list = [...baseViewTabs];
		if (pipelineType === 'matters') {
			list.splice(1, 0, { type: 'calendar', i18n: 'Boards_View_Calendar', fallback: 'Calendar' });
		}
		return list;
	}, [pipelineType]);

	const openSaveModal = (existing?: Serialized<ISavedView>): void => {
		const close = (): void => setModal(null);
		setModal(
			<SaveViewModal
				boardId={boardId}
				currentViewType={(view as SavedViewType) ?? 'board'}
				existing={existing}
				onClose={close}
				onSaved={(saved) => onSelectSavedView(saved)}
			/>,
		);
	};

	// the saved-views dropdown: a section listing each view (switch on click), then
	// a section of manage actions for the active saved view (when one is selected),
	// then "Save current view…".
	const savedViewItems: GenericMenuItemProps[] = views.map((v) => ({
		id: v._id,
		icon: safeViewTypeIcon(v.viewType),
		content: (
			<Box display='flex' alignItems='center' style={{ gap: '6px' }}>
				{v.name}
				{v.shared && <Icon name='team' size='x12' color='hint' title={t('Boards_Views_Shared', { defaultValue: 'Shared' })} />}
				{v.isDefault && (
					<Icon name='star-filled' size='x12' color='warning' title={t('Boards_Views_Default', { defaultValue: 'Default' })} />
				)}
			</Box>
		),
		onClick: () => onSelectSavedView(v),
	}));

	const activeSavedView = views.find((v) => v._id === activeViewId);

	const manageItems: GenericMenuItemProps[] = [];
	if (activeSavedView && canManageViews) {
		manageItems.push({
			id: 'edit',
			icon: 'edit',
			content: t('Boards_Views_Edit', { defaultValue: 'Edit view' }),
			onClick: () => openSaveModal(activeSavedView),
		});
		manageItems.push({
			id: 'set-default',
			icon: 'star',
			content: t('Boards_Views_SetDefault', { defaultValue: 'Set as default' }),
			disabled: activeSavedView.isDefault,
			onClick: () => setDefaultView(activeSavedView._id),
		});
		manageItems.push({
			id: 'delete',
			icon: 'trash',
			content: t('Delete'),
			variant: 'danger',
			onClick: () => removeView(activeSavedView._id),
		});
	}

	const saveCurrentItems: GenericMenuItemProps[] = [
		{
			id: 'save-current',
			icon: 'plus',
			content: t('Boards_Views_SaveCurrent', { defaultValue: 'Save current view…' }),
			onClick: () => openSaveModal(),
		},
	];

	const sections: { title?: string; items: GenericMenuItemProps[] }[] = [
		...(savedViewItems.length > 0 ? [{ title: t('Boards_Views_Saved', { defaultValue: 'Saved views' }), items: savedViewItems }] : []),
		...(manageItems.length > 0 ? [{ title: t('Manage'), items: manageItems }] : []),
		...(canManageViews ? [{ items: saveCurrentItems }] : []),
	];

	return (
		<Box display='flex' alignItems='center' justifyContent='space-between' width='100%'>
			<Box display='flex' alignItems='center' minWidth={0}>
				<Tabs>
					{tabs.map((tab) => (
						<TabsItem key={tab.type} selected={!activeViewId && view === tab.type} onClick={() => onSelectViewType(tab.type)}>
							{t(tab.i18n as Parameters<typeof t>[0], { defaultValue: tab.fallback })}
						</TabsItem>
					))}
				</Tabs>
			</Box>
			<Box display='flex' alignItems='center' style={{ gap: '8px', flexShrink: 0 }}>
				{activeSavedView && (
					<Box fontScale='c1' color='hint' withTruncatedText style={{ maxWidth: 160 }}>
						<Icon name={safeViewTypeIcon(activeSavedView.viewType)} size='x14' marginInlineEnd={4} />
						{activeSavedView.name}
					</Box>
				)}
				{sections.length > 0 && (
					<GenericMenu
						title={t('Boards_Views_Saved', { defaultValue: 'Saved views' })}
						icon='chevron-down'
						sections={sections}
						placement='bottom-end'
					/>
				)}
				{canManageViews && !activeSavedView && (
					<Button small onClick={() => openSaveModal()}>
						<Icon name='plus' size='x16' marginInlineEnd={4} />
						{t('Boards_Views_Save', { defaultValue: 'Save view' })}
					</Button>
				)}
			</Box>
		</Box>
	);
};

export default ViewSwitcher;
