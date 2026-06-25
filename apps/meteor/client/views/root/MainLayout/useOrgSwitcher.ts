import { useMethod, usePermission, useRouter, useSetting, useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import { useCallback, useMemo } from 'react';

/**
 * A workspace shown in the switcher — this MatterChat workspace OR a connected external Slack.
 */
export type SwitchableOrg = {
	id: string;
	name: string;
	initial: string;
	color?: string; // tile colour for a MatterChat workspace (Slack renders the Slack mark instead)
	type: 'matterchat' | 'slack';
	active?: boolean;
	unread?: boolean;
	mentions?: number;
};

/**
 * useOrgSwitcher — data + actions for the multi-org switcher rail.
 *
 * Reflects REALITY for the single instance: the current MatterChat workspace (active), plus the
 * firm's connected Slack workspace whenever the SlackBridge is enabled (the bridge proven live).
 *  - Multi-FIRM switching needs the per-firm-instance model (Phase 2 — gated; nothing to switch to
 *    with one instance).
 *  - The Slack tile's dedicated "workspace view" (its bridged channels — the rooms carrying Slack
 *    `importIds`) is now wired (see OrgSwitcherRail.handleSelect -> setSelectedOrgId + useRoomList).
 */
export const useOrgSwitcher = (): {
	orgs: SwitchableOrg[];
	switchOrg: (org: SwitchableOrg) => void;
	addWorkspace: () => void;
	connectSlack: () => void;
	connectTeams: () => void;
	teamsEnabled: boolean;
} => {
	const dispatchToast = useToastMessageDispatch();
	const router = useRouter();
	const siteName = String(useSetting('Site_Name') || 'MatterChat');
	const slackConnected = Boolean(useSetting('SlackBridge_Enabled'));
	// Teams is standalone-safe: the "Connect Teams" action only shows/works when the connector is
	// enabled in admin (Teams_Enabled, a PUBLIC setting). Whether the client SECRET is set is not a
	// public setting, so a missing secret surfaces at click-time as the `teams-not-configured` toast.
	const teamsEnabled = Boolean(useSetting('Teams_Enabled'));
	const getAuthorizeUrl = useMethod('connectors:getAuthorizeUrl');
	// "Connect a Slack" lives in the SlackBridge admin settings, so the add action is admin-gated —
	// mirrors the permission set that guards the admin/settings area (see admin sidebarItems).
	const canEditSettings = usePermission('edit-privileged-setting');
	const canViewSettings = usePermission('view-privileged-setting');
	const canManageSettings = canEditSettings || canViewSettings;

	const orgs = useMemo<SwitchableOrg[]>(() => {
		const initial = (siteName.trim().match(/\b\w/g) || ['M']).slice(0, 2).join('').toUpperCase();
		const list: SwitchableOrg[] = [{ id: 'current', name: siteName, initial, color: '#e1140a', type: 'matterchat', active: true }];
		if (slackConnected) {
			list.push({ id: 'slack', name: 'Slack', initial: 'SL', type: 'slack' });
		}
		return list;
	}, [siteName, slackConnected]);

	// switchOrg handles ONLY the cross-firm case: the connected Slack ('slack') and the native
	// workspace ('current') switch the sidebar view in place via OrgSwitcherContext (see
	// OrgSwitcherRail.handleSelect) and never reach here. Multi-firm switching needs the per-firm
	// instance model (Phase 2 — nothing to switch to with one instance), hence the explanatory toast.
	const switchOrg = useCallback(
		(org: SwitchableOrg) => {
			if (org.active) {
				return;
			}
			dispatchToast({ type: 'info', message: 'Switching to another firm needs the per-firm setup — that comes in the next phase.' });
		},
		[dispatchToast],
	);

	// "Connect Slack" → the SlackBridge admin settings. Slack is configured in admin settings, so this
	// deep-links there for admins. Non-admins get a plain message (they can't reach the settings)
	// rather than a dead-end navigation. (Unchanged behavior; just named explicitly.)
	const connectSlack = useCallback(() => {
		if (canManageSettings) {
			router.navigate('/admin/settings/SlackBridge');
			return;
		}
		dispatchToast({
			type: 'info',
			message: 'Connecting a Slack workspace is an admin setting — ask a workspace admin to connect one under Admin → SlackBridge.',
		});
	}, [canManageSettings, router, dispatchToast]);

	// "Connect Teams" → start the per-user Microsoft Teams OAuth. Cookie-FREE: we call the
	// authenticated `connectors:getAuthorizeUrl` method (it mints PKCE + state bound to this.userId
	// server-side), then full-page-redirect the browser to Microsoft. On 'teams-not-configured' we
	// tell the admin to paste the secret + enable Teams. Any user can connect their OWN Teams.
	const connectTeams = useCallback(async () => {
		try {
			const url = await getAuthorizeUrl('teams');
			window.location.href = url;
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			if (reason === 'teams-not-configured' || (error as { error?: string })?.error === 'teams-not-configured') {
				dispatchToast({
					type: 'error',
					message: 'Microsoft Teams isn’t set up yet. An admin needs to paste the client secret and enable Teams under Admin → Settings → Teams.',
				});
				return;
			}
			dispatchToast({ type: 'error', message: error });
		}
	}, [getAuthorizeUrl, dispatchToast]);

	// "Add a workspace" → the default add action. Kept for existing callers; defaults to Connect Slack
	// (the long-standing behavior). The rail surfaces Connect Slack / Connect Teams discretely.
	const addWorkspace = connectSlack;

	return { orgs, switchOrg, addWorkspace, connectSlack, connectTeams, teamsEnabled };
};
