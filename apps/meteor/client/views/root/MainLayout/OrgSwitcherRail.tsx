import { css } from '@rocket.chat/css-in-js';
import { Box } from '@rocket.chat/fuselage';
import { GenericMenu } from '@rocket.chat/ui-client';
import type { GenericMenuItemProps } from '@rocket.chat/ui-client';
import { useCurrentRoutePath, useLayout, useRouter } from '@rocket.chat/ui-contexts';
import type { ReactElement } from 'react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { externalConnectionIdFromSelection, externalSelectionId, useOrgSwitcherSelection } from './OrgSwitcherContext';
import { externalProviderBranding } from './externalProviders';
import type { ExternalUnreadCounts } from './useExternalUnreadSummary';
import { useExternalUnreadSummary } from './useExternalUnreadSummary';
import type { ConnectedExternalWorkspace } from './useExternalWorkspaces';
import { useExternalWorkspaces } from './useExternalWorkspaces';
import type { SwitchableOrg } from './useOrgSwitcher';
import { useOrgSwitcher } from './useOrgSwitcher';

/**
 * OrgSwitcherRail — the GREEN "Variant B" WORKSPACE switcher (the leftmost of the two rails).
 *
 * A 62px, always-dark column pinned to the FAR LEFT of the app shell, LEFT of AppLeftRail. It lists
 * the workspaces a user belongs to — native MatterChat firms AND connected external Slack/Teams/Google
 * workspaces — as switchable tiles, plus a "+" to add one. The active org gets a GREEN accent ring; a
 * Slack-connected org renders the Slack mark + a Slack badge so it reads as external at a glance.
 *
 * Always-dark (`#0C0F14`), the deepest layer of the chrome. Slice 1 is the UI on placeholder data for
 * native firms; switching/adding are stubbed for those (see useOrgSwitcher) while external tiles are live.
 */

const RAIL_BG = '#0C0F14';
const BRAND_GREEN = '#1B7A2E';
const BRAND_GREEN_BRIGHT = '#22B43F';
const ACCENT_RING = 'rgba(27,122,46,0.5)';
// Native-app-style unread badge colour (Slack red). Used on external tiles that have unread activity.
const UNREAD_BADGE = '#e01e5a';

/** Cap a count for the badge so a 4-figure unread doesn't blow out the tile corner. */
const formatBadgeCount = (count: number): string => (count > 99 ? '99+' : String(count));

const columnClass = css`
	width: 62px;
	min-width: 62px;
	height: 100%;
	flex-shrink: 0;
	z-index: 4;

	@media print {
		display: none;
	}
`;

const tabClass = css`
	width: 62px;
	height: 100%;
	background-color: ${RAIL_BG};
	padding-block: 12px;
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 9px;
`;

const tileClass = css`
	width: 40px;
	height: 40px;
	border: 0;
	border-radius: 12px;
	display: flex;
	align-items: center;
	justify-content: center;
	color: #ffffff;
	font-weight: 600;
	line-height: 1;
	position: relative;
	cursor: pointer;
	font-family: inherit;
	user-select: none;
	transition:
		opacity 0.12s ease,
		box-shadow 0.12s ease;

	&:hover {
		opacity: 1;
	}

	&:focus-visible {
		outline: 2px solid ${BRAND_GREEN_BRIGHT};
		outline-offset: 2px;
	}
`;

const addClass = css`
	width: 40px;
	height: 40px;
	border: 1.5px dashed rgba(255, 255, 255, 0.3);
	border-radius: 12px;
	background: rgba(255, 255, 255, 0.06);
	color: #ffffff;
	font-size: 22px;
	line-height: 1;
	display: flex;
	align-items: center;
	justify-content: center;
	cursor: pointer;
	font-family: inherit;

	&:hover {
		background: rgba(255, 255, 255, 0.1);
	}

	&:focus-visible {
		outline: 2px solid ${BRAND_GREEN_BRIGHT};
		outline-offset: 2px;
	}
`;

const dividerClass = css`
	width: 32px;
	height: 1px;
	background: rgba(255, 255, 255, 0.12);
	margin-block: 1px;
`;

// The Slack 4-colour mark (rendered, never recoloured). Used on a Slack-connected tile + its badge.
const SlackMark = ({ size }: { size: number }): ReactElement => (
	<svg width={size} height={size} viewBox='0 0 24 24' aria-hidden focusable='false'>
		<rect x='9' y='2.5' width='2.8' height='19' rx='1.4' fill='#36C5F0' />
		<rect x='12.2' y='2.5' width='2.8' height='19' rx='1.4' fill='#2EB67D' />
		<rect x='2.5' y='9' width='19' height='2.8' rx='1.4' fill='#ECB22E' />
		<rect x='2.5' y='12.2' width='19' height='2.8' rx='1.4' fill='#E01E5A' />
	</svg>
);

/**
 * A connected-EXTERNAL-workspace tile. Appears once per connected external connection
 * (external-workspaces.list) — Teams AND/OR Google Chat. Its colour + mark + name come from the
 * connection's provider branding (provider-agnostic; an unknown provider falls back to a neutral
 * tile). Selecting it enters WORKSPACE mode (see LayoutWithSidebar): the left sidebar becomes that
 * connection's real channels/spaces and the open channel fills the main content. The M tile returns
 * to MatterChat.
 */
const ExternalTile = ({
	connection,
	isSelected,
	unread,
	onClick,
}: {
	connection: ConnectedExternalWorkspace;
	isSelected: boolean;
	unread: ExternalUnreadCounts;
	onClick: () => void;
}): ReactElement => {
	const branding = externalProviderBranding(connection.provider);
	const name = connection.externalOrgName || branding.defaultName;

	// Native-app-style unread badge: only when this connection has unread activity. Mention-aware —
	// when there are mentions, show the mention count (the "you specifically" signal) rather than the
	// raw unread total. The tile (tileClass) is already position:relative, so the absolute badge anchors
	// to the tile corner and overlaps it like an iOS app icon badge.
	const hasUnread = unread.unreadCount > 0;
	const showMentions = unread.mentionCount > 0;
	const badgeValue = showMentions ? unread.mentionCount : unread.unreadCount;

	return (
		<Box
			is='button'
			type='button'
			className={tileClass}
			onClick={onClick}
			title={name}
			aria-label={name}
			aria-current={isSelected ? 'true' : undefined}
			style={{
				backgroundColor: branding.color,
				opacity: isSelected ? 1 : 0.82,
				boxShadow: isSelected ? `0 0 0 2px ${RAIL_BG}, 0 0 0 4px ${ACCENT_RING}` : undefined,
			}}
		>
			<branding.Mark size={22} />

			{hasUnread && (
				<Box
					aria-label={
						showMentions
							? `${unread.mentionCount} mentions, ${unread.unreadCount} unread`
							: `${unread.unreadCount} unread`
					}
					style={{
						position: 'absolute',
						top: '-4px',
						right: '-4px',
						minWidth: '17px',
						height: '17px',
						borderRadius: '9px',
						background: UNREAD_BADGE,
						color: '#ffffff',
						fontSize: '10px',
						fontWeight: 600,
						lineHeight: 1,
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						border: `2px solid ${RAIL_BG}`,
						padding: '0 4px',
						boxSizing: 'border-box',
						pointerEvents: 'none',
					}}
				>
					{formatBadgeCount(badgeValue)}
				</Box>
			)}
		</Box>
	);
};

const OrgTile = ({ org, isSelected, onClick }: { org: SwitchableOrg; isSelected: boolean; onClick: () => void }): ReactElement => {
	const isSlack = org.type === 'slack';

	return (
		<Box
			is='button'
			type='button'
			className={tileClass}
			onClick={onClick}
			title={org.name}
			aria-label={org.name}
			aria-current={isSelected ? 'true' : undefined}
			style={{
				backgroundColor: isSlack ? '#ffffff' : org.color || '#3a3d44',
				opacity: isSelected ? 1 : org.unread ? 0.9 : 0.78,
				boxShadow: isSelected ? `0 0 0 2px ${RAIL_BG}, 0 0 0 4px ${ACCENT_RING}` : undefined,
				fontSize: org.initial.length > 1 ? '14px' : '16px',
			}}
		>
			{isSlack ? <SlackMark size={20} /> : org.initial}

			{isSlack && (
				<Box
					style={{
						position: 'absolute',
						bottom: '-3px',
						right: '-3px',
						width: '16px',
						height: '16px',
						borderRadius: '50%',
						background: '#4A154B',
						border: `2px solid ${RAIL_BG}`,
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
					}}
				>
					<SlackMark size={8} />
				</Box>
			)}

			{!!org.mentions && (
				<Box
					style={{
						position: 'absolute',
						top: '-4px',
						right: '-4px',
						minWidth: '17px',
						height: '17px',
						borderRadius: '9px',
						background: BRAND_GREEN,
						color: '#ffffff',
						fontSize: '10px',
						fontWeight: 600,
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						border: `2px solid ${RAIL_BG}`,
						padding: '0 4px',
					}}
				>
					{org.mentions}
				</Box>
			)}

			{!org.mentions && org.unread && (
				<Box
					style={{
						position: 'absolute',
						top: '-1px',
						right: '-1px',
						width: '9px',
						height: '9px',
						borderRadius: '50%',
						background: '#ffffff',
						border: `1.5px solid ${RAIL_BG}`,
					}}
				/>
			)}
		</Box>
	);
};

const OrgSwitcherRail = (): ReactElement | null => {
	const { t } = useTranslation();
	const { isMobile } = useLayout();
	const { orgs, switchOrg, connectSlack, connectTeams, connectGoogle, teamsEnabled, googleEnabled } = useOrgSwitcher();
	const { selectedOrgId, setSelectedOrgId } = useOrgSwitcherSelection();
	const router = useRouter();
	const currentRoutePath = useCurrentRoutePath();
	// Each connected external workspace surfaces its OWN tile (per-user, from external-workspaces.list)
	// — Slack and/or Teams and/or Google Chat. Provider-agnostic: the rail maps over the list, it
	// doesn't branch on which provider.
	const { externalConnections } = useExternalWorkspaces();
	// Rolled-up unread/mention counts per external connection (polled 30s) — drives the rail badges.
	const { getCountsForConnection } = useExternalUnreadSummary();

	// The currently-selected external connection id (if any), parsed from the `ext:<id>` sentinel.
	const selectedExternalId = externalConnectionIdFromSelection(selectedOrgId);

	// Selecting an external tile enters workspace MODE. If we're currently parked on a native content
	// route (Boards/LitBox/Admin), that route would otherwise render its real page (ShellBody keeps
	// those functional in external mode) and the workspace chat view wouldn't show. Bounce to /home so
	// the just-selected workspace's channels/chats/people are what the user lands on.
	const selectExternal = (connectionId: string): void => {
		setSelectedOrgId(externalSelectionId(connectionId));
		const onNativeContentRoute =
			currentRoutePath?.startsWith('/boards') || currentRoutePath?.startsWith('/litbox') || currentRoutePath?.startsWith('/admin');
		if (onNativeContentRoute) {
			router.navigate('/home');
		}
	};

	// The "+" tile opens a menu of the workspaces you can connect: Slack (admin deep-link, always) +
	// Teams + Google Chat (per-user OAuth, each shown only when its connector is enabled in admin —
	// standalone-safe). Per-provider gating keeps a disabled connector entirely out of the UI.
	const addItems = useMemo<GenericMenuItemProps[]>(() => {
		const items: GenericMenuItemProps[] = [
			{
				id: 'connect-slack',
				icon: 'hash',
				content: t('Connect_Slack', { defaultValue: 'Connect Slack' }),
				onClick: (): void => {
					void connectSlack();
				},
			},
		];
		if (teamsEnabled) {
			items.push({
				id: 'connect-teams',
				icon: 'team',
				content: t('Connect_Teams', { defaultValue: 'Connect Teams' }),
				onClick: (): void => {
					void connectTeams();
				},
			});
		}
		if (googleEnabled) {
			items.push({
				id: 'connect-google',
				icon: 'discussion',
				content: t('Connect_Google_Chat', { defaultValue: 'Connect Google Chat' }),
				onClick: (): void => {
					void connectGoogle();
				},
			});
		}
		return items;
	}, [t, connectSlack, connectTeams, connectGoogle, teamsEnabled, googleEnabled]);

	if (!orgs.length) {
		return null;
	}

	// MATTERCHAT: on phones the MobileTabBar is the primary nav and every horizontal pixel counts —
	// the workspace-switcher column is desktop chrome.
	if (isMobile) {
		return null;
	}

	// In-instance workspaces (this MatterChat + its connected Slack) switch the sidebar view in
	// place; other firms (future, gated on per-firm instances) fall back to the switchOrg stub.
	const handleSelect = (org: SwitchableOrg): void => {
		if (org.type === 'slack' || org.id === 'current') {
			setSelectedOrgId(org.id);
			return;
		}
		switchOrg(org);
	};

	return (
		<Box is='nav' aria-label={t('Workspaces', { defaultValue: 'Workspaces' })} className={columnClass}>
			<Box className={tabClass}>
				{orgs.map((org) => (
					<OrgTile key={org.id} org={org} isSelected={selectedOrgId === org.id} onClick={(): void => handleSelect(org)} />
				))}
				{externalConnections.map((connection) => (
					<ExternalTile
						key={connection._id}
						connection={connection}
						isSelected={selectedExternalId === connection._id}
						unread={getCountsForConnection(connection._id)}
						onClick={(): void => selectExternal(connection._id)}
					/>
				))}
				<Box className={dividerClass} />
				<GenericMenu
					title={t('Add_workspace', { defaultValue: 'Add a workspace' })}
					items={addItems}
					placement='right-start'
					button={
						<Box
							is='button'
							type='button'
							className={addClass}
							title={t('Add_workspace', { defaultValue: 'Add a workspace' })}
							aria-label={t('Add_workspace', { defaultValue: 'Add a workspace' })}
						>
							+
						</Box>
					}
				/>
			</Box>
		</Box>
	);
};

export default memo(OrgSwitcherRail);
