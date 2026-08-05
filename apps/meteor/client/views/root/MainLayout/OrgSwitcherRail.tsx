import type { ExternalProvider } from '@rocket.chat/core-typings';
import { css } from '@rocket.chat/css-in-js';
import { Box } from '@rocket.chat/fuselage';
import { GenericMenu } from '@rocket.chat/ui-client';
import type { GenericMenuItemProps } from '@rocket.chat/ui-client';
import {
	useCurrentRoutePath,
	useEndpoint,
	useLayout,
	useMethod,
	useRouter,
	useSetModal,
	useToastMessageDispatch,
} from '@rocket.chat/ui-contexts';
import { useQueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ConnectWorkspaceModal from './ConnectWorkspaceModal';
import { externalConnectionIdFromSelection, externalSelectionId, useOrgSwitcherSelection } from './OrgSwitcherContext';
import { externalProviderBranding } from './externalProviders';
import { useExternalInboundPush } from './useExternalInboundPush';
import type { ExternalUnreadCounts } from './useExternalUnreadSummary';
import { useExternalUnreadSummary } from './useExternalUnreadSummary';
import type { ConnectedExternalWorkspace } from './useExternalWorkspaces';
import { useExternalWorkspaces } from './useExternalWorkspaces';
import type { SwitchableOrg } from './useOrgSwitcher';
import { useOrgSwitcher } from './useOrgSwitcher';
import { isDesktopApp } from '../../../lib/desktop/desktopBridge';

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
	/* Frame spec §3 (web): the strip is the frame's FIRST COLUMN — 62px including its own padding, so
	   the 9px on the left doubles as the frame's left gutter and the groove never touches the bezel.
	   The protruding desktop "tab" variant is deliberately not built: it needs a transparent frameless
	   Electron window, which would cost the native traffic lights, window shadow and resize edges. */
	padding: 0 6px 0 9px;
	box-sizing: border-box;
	height: 100%;
	flex-shrink: 0;
	z-index: 4;

	@media print {
		display: none;
	}
`;

/** The workspace CHANNEL — the same groove recipe as the menu rail's channel. */
const tabClass = css`
	width: 100%;
	height: 100%;
	padding: 4px;
	box-sizing: border-box;
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 6px;
`;

/**
 * Frame spec §3: 36×36, radius 10. The tile keeps its EXISTING artwork and color — the only thing
 * added is the raised recipe (a top highlight + a contact shadow) so tiles sit ON the groove.
 */
const tileClass = css`
	width: 36px;
	height: 36px;
	border: 0;
	border-radius: 10px;
	box-shadow:
		inset 0 1px 0 rgba(255, 255, 255, 0.28),
		0 1px 3px rgba(0, 0, 0, 0.35);
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
	width: 36px;
	height: 36px;
	border: 1.5px dashed rgba(255, 255, 255, 0.3);
	border-radius: 10px;
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
 *
 * When the connection is in 'error' or 'consent_required' status, shows a warning badge + context
 * menu with a "Reconnect" option. The tile also has a context menu with "Disconnect" option.
 */
const ExternalTile = ({
	connection,
	isSelected,
	unread,
	onClick,
	getAuthorizeUrl,
}: {
	connection: ConnectedExternalWorkspace;
	isSelected: boolean;
	unread: ExternalUnreadCounts;
	onClick: () => void;
	getAuthorizeUrl: (provider: string, desktop: boolean) => Promise<unknown>;
}): ReactElement => {
	const { t } = useTranslation();
	const branding = externalProviderBranding(connection.provider);
	const name = connection.externalOrgName || branding.defaultName;
	const dispatchToast = useToastMessageDispatch();
	const queryClient = useQueryClient();
	const disconnectEndpoint = useEndpoint('POST', '/v1/external-workspaces.disconnect');
	const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);

	// Native-app-style unread badge: only when this connection has unread activity. Mention-aware —
	// when there are mentions, show the mention count (the "you specifically" signal) rather than the
	// raw unread total. The tile (tileClass) is already position:relative, so the absolute badge anchors
	// to the tile corner and overlaps it like an iOS app icon badge.
	const hasUnread = unread.unreadCount > 0;
	const showMentions = unread.mentionCount > 0;
	const badgeValue = showMentions ? unread.mentionCount : unread.unreadCount;

	// Warning badge for error/consent_required status
	const hasError = connection.status === 'error' || connection.status === 'consent_required';

	const handleDisconnect = useCallback(async () => {
		try {
			await disconnectEndpoint({ connectionId: connection._id });
			dispatchToast({
				type: 'success',
				message: t('Workspace_Disconnected', {
					defaultValue: `${branding.defaultName || 'Workspace'} disconnected`,
				}),
			});
			// Invalidate the workspace list so it updates to remove this connection
			queryClient.invalidateQueries({ queryKey: ['external-workspaces.list'] });
			setShowDisconnectConfirm(false);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			dispatchToast({
				type: 'error',
				message: t('Failed_to_Disconnect', {
					defaultValue: `Failed to disconnect: ${message}`,
				}),
			});
		}
	}, [disconnectEndpoint, connection._id, dispatchToast, queryClient, t, branding]);

	const handleReconnect = useCallback(async () => {
		try {
			const url = String(await getAuthorizeUrl(connection.provider, isDesktopApp()));
			window.location.href = url;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			dispatchToast({
				type: 'error',
				message: t('Failed_to_Reconnect', {
					defaultValue: `Failed to reconnect: ${message}`,
				}),
			});
		}
	}, [getAuthorizeUrl, connection.provider, dispatchToast, t]);

	// Context menu items for the tile
	const menuItems = useMemo<GenericMenuItemProps[]>(() => {
		const items: GenericMenuItemProps[] = [];

		if (connection.status === 'error' || connection.status === 'consent_required') {
			items.push({
				id: 'reconnect',
				icon: 'refresh',
				content: t('Reconnect', { defaultValue: 'Reconnect' }),
				onClick: () => {
					void handleReconnect();
				},
			});
		}

		items.push({
			id: 'disconnect',
			icon: 'trash',
			content: t('Disconnect_Workspace', { defaultValue: 'Disconnect workspace' }),
			onClick: () => {
				setShowDisconnectConfirm(true);
			},
		});

		return items;
	}, [connection.status, t, handleReconnect]);

	return (
		<>
			{/* Wrapper is position:relative so the kebab menu-trigger can overlay the tile's
			    corner as a SIBLING of the tile button — clicking the TILE selects the workspace
			    (the original behavior a prior change broke by making the whole tile the menu
			    trigger), clicking the kebab opens Reconnect/Disconnect. */}
			<Box style={{ position: 'relative' }}>
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
						// Frame spec §3: the active tile is the shared RAISED recipe (accent ring + lift), and it must
				// restate the base tile shadow — an inline boxShadow replaces the class's, it doesn't merge.
				boxShadow: isSelected
					? `inset 0 1px 0 rgba(255, 255, 255, 0.28), 0 0 0 2px ${ACCENT_RING}, 0 2px 7px rgba(0, 0, 0, 0.35)`
					: undefined,
					}}
				>
					<branding.Mark size={22} />

					{/* Warning badge for error/consent_required status */}
					{hasError && (
						<Box
							aria-label={
								connection.status === 'error'
									? t('Connection_Error', { defaultValue: 'Connection error — needs attention' })
									: t('Consent_Required', { defaultValue: 'Consent required' })
							}
							style={{
								position: 'absolute',
								top: '-4px',
								right: '-4px',
								width: '17px',
								height: '17px',
								borderRadius: '50%',
								background: '#F04747',
								border: `2px solid ${RAIL_BG}`,
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
								color: '#ffffff',
								fontSize: '11px',
								fontWeight: 700,
								pointerEvents: 'none',
							}}
						>
							!
						</Box>
					)}

					{/* Unread badge (displayed when no error) */}
					{!hasError && hasUnread && (
						<Box
							aria-label={showMentions ? `${unread.mentionCount} mentions, ${unread.unreadCount} unread` : `${unread.unreadCount} unread`}
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
				<GenericMenu
					title={t('Workspace_options', { defaultValue: 'Workspace options' })}
					items={menuItems}
					placement='right-start'
					button={
						<Box
							is='button'
							type='button'
							aria-label={t('Workspace_options', { defaultValue: 'Workspace options' })}
							style={{
								position: 'absolute',
								bottom: '-4px',
								right: '-4px',
								width: '16px',
								height: '16px',
								borderRadius: '50%',
								background: 'rgba(0,0,0,0.75)',
								color: '#ffffff',
								border: `1.5px solid ${RAIL_BG}`,
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
								fontSize: '11px',
								lineHeight: 1,
								padding: 0,
								cursor: 'pointer',
							}}
						>
							⋯
						</Box>
					}
				/>
			</Box>

			{/* Disconnect confirmation modal */}
			{showDisconnectConfirm && (
				<Box
					style={{
						position: 'fixed',
						top: 0,
						left: 0,
						right: 0,
						bottom: 0,
						backgroundColor: 'rgba(0, 0, 0, 0.6)',
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						zIndex: 1000,
					}}
					onClick={() => setShowDisconnectConfirm(false)}
				>
					<Box
						style={{
							backgroundColor: '#fff',
							borderRadius: '8px',
							padding: '24px',
							maxWidth: '400px',
							boxShadow: '0 4px 16px rgba(0, 0, 0, 0.2)',
						}}
						onClick={(e) => e.stopPropagation()}
					>
						<Box style={{ fontSize: '18px', fontWeight: 600, marginBottom: '12px' }}>
							{t('Disconnect_Workspace_Confirm_Title', { defaultValue: 'Disconnect workspace?' })}
						</Box>
						<Box style={{ fontSize: '14px', marginBottom: '24px', color: '#666' }}>
							{t('Disconnect_Workspace_Confirm_Message', {
								defaultValue: `This removes the connection and its synced credentials. Your ${branding.defaultName || 'workspace'} account is not affected.`,
							})}
						</Box>
						<Box style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
							<Box
								is='button'
								onClick={() => setShowDisconnectConfirm(false)}
								style={{
									padding: '8px 16px',
									backgroundColor: '#e0e0e0',
									border: 'none',
									borderRadius: '4px',
									cursor: 'pointer',
									fontSize: '14px',
								}}
							>
								{t('Cancel', { defaultValue: 'Cancel' })}
							</Box>
							<Box
								is='button'
								onClick={() => {
									void handleDisconnect();
								}}
								style={{
									padding: '8px 16px',
									backgroundColor: '#F04747',
									color: '#fff',
									border: 'none',
									borderRadius: '4px',
									cursor: 'pointer',
									fontSize: '14px',
								}}
							>
								{t('Disconnect', { defaultValue: 'Disconnect' })}
							</Box>
						</Box>
					</Box>
				</Box>
			)}
		</>
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
				// Frame spec §3: the active tile is the shared RAISED recipe (accent ring + lift), and it must
				// restate the base tile shadow — an inline boxShadow replaces the class's, it doesn't merge.
				boxShadow: isSelected
					? `inset 0 1px 0 rgba(255, 255, 255, 0.28), 0 0 0 2px ${ACCENT_RING}, 0 2px 7px rgba(0, 0, 0, 0.35)`
					: undefined,
				fontSize: org.initial.length > 1 ? '14px' : '16px',
			}}
		>
			{isSlack ? (
				<SlackMark size={20} />
			) : org.id === 'current' ? (
				/* This workspace = the MatterChat app itself → the ensō app icon, not a letter tile. */
				<img
					src='/images/pwa/icon-192.png'
					alt={org.name}
					style={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover', borderRadius: 'inherit' }}
				/>
			) : (
				org.initial
			)}

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

/**
 * `inDrawer` — MATTERCHAT mobile: the rail is desktop chrome (hidden under md), but on phones it
 * re-mounts INSIDE the room-list drawer (Discord-style: workspace column beside the channel list —
 * see SidebarRegion). In that mode selecting any workspace also collapses the drawer so the
 * newly-selected workspace's content is immediately visible.
 */
const OrgSwitcherRail = ({ inDrawer = false }: { inDrawer?: boolean }): ReactElement | null => {
	const { t } = useTranslation();
	const { isMobile, sidebar } = useLayout();
	// Live inbound push for connected external workspaces (subscribe once — desktop mount only;
	// the drawer re-mount passes enabled=false so events never double-fire).
	useExternalInboundPush(!inDrawer);
	const { orgs, switchOrg, connectSlack, connectTeams, connectGoogle } = useOrgSwitcher();
	const { selectedOrgId, setSelectedOrgId } = useOrgSwitcherSelection();
	const router = useRouter();
	const currentRoutePath = useCurrentRoutePath();
	// Each connected external workspace surfaces its OWN tile (per-user, from external-workspaces.list)
	// — Slack and/or Teams and/or Google Chat. Provider-agnostic: the rail maps over the list, it
	// doesn't branch on which provider.
	const { externalConnections } = useExternalWorkspaces();
	// Rolled-up unread/mention counts per external connection (polled 30s) — drives the rail badges.
	const { getCountsForConnection } = useExternalUnreadSummary();
	// For reconnect functionality in ExternalTile
	const getAuthorizeUrl = useMethod('connectors:getAuthorizeUrl');

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
		if (inDrawer) {
			sidebar.collapse();
		}
	};

	// The "+" tile opens the ConnectWorkspaceModal: provider CARDS for Slack + Teams + Google Chat,
	// every provider always listed (disabled ones explain themselves / deep-link admins to setup),
	// availability computed SERVER-side (env fallbacks included) via useConnectorAvailability.
	// A modal (not a dropdown) because the old GenericMenu never opened on phones — the modal
	// portal renders on every layout, drawer or not.
	const setModal = useSetModal();
	const handleConnect = useCallback(
		(provider: ExternalProvider): void => {
			setModal(null);
			if (provider === 'slack') {
				void connectSlack();
			} else if (provider === 'teams') {
				void connectTeams();
			} else {
				void connectGoogle();
			}
		},
		[setModal, connectSlack, connectTeams, connectGoogle],
	);
	const openConnectModal = useCallback((): void => {
		setModal(<ConnectWorkspaceModal onClose={(): void => setModal(null)} onConnect={handleConnect} />);
	}, [setModal, handleConnect]);

	if (!orgs.length) {
		return null;
	}

	// MATTERCHAT: on phones the MobileTabBar is the primary nav and every horizontal pixel counts —
	// the standalone workspace-switcher column is desktop chrome. Inside the room-list drawer
	// (`inDrawer`) it DOES render on mobile — that's where phone users switch Slack/Teams/GChat.
	if (isMobile && !inDrawer) {
		return null;
	}

	// In-instance workspaces (this MatterChat + its connected Slack) switch the sidebar view in
	// place; other firms (future, gated on per-firm instances) fall back to the switchOrg stub.
	const handleSelect = (org: SwitchableOrg): void => {
		if (org.type === 'slack' || org.id === 'current') {
			setSelectedOrgId(org.id);
			if (inDrawer) {
				sidebar.collapse();
			}
			return;
		}
		switchOrg(org);
	};

	return (
		// MATTERCHAT: `mc-rail-workspace` is the depth pass's hook (depthSkin.ts) — the strip drops its
		// own fill so the chrome gradient is continuous, and its tiles sit in a groove.
		// className must be the ARRAY form — css() returns a css-in-js object, not a string, so
		// .join(' ') stringifies it into garbage and NO styles apply.
		<Box is='nav' aria-label={t('Workspaces', { defaultValue: 'Workspaces' })} className={[columnClass, 'mc-rail-workspace']}>
			<Box className={[tabClass, 'mc-groove']}>
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
						getAuthorizeUrl={(provider, desktop): Promise<unknown> => getAuthorizeUrl(provider as ExternalProvider, desktop)}
					/>
				))}
				<Box className={dividerClass} />
				<Box
					is='button'
					type='button'
					className={addClass}
					title={t('Add_workspace', { defaultValue: 'Add a workspace' })}
					aria-label={t('Add_workspace', { defaultValue: 'Add a workspace' })}
					onClick={openConnectModal}
				>
					+
				</Box>
			</Box>
		</Box>
	);
};

export default memo(OrgSwitcherRail);
