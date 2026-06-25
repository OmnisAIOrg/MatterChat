import { useMethod, useSetting, useToastMessageDispatch } from '@rocket.chat/ui-contexts';
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
 * Reflects REALITY for the single instance: the current MatterChat workspace (active). Connected
 * external workspaces (per-user Slack / Teams) surface their OWN tiles from external-workspaces.list
 * (see useExternalWorkspaces + OrgSwitcherRail), NOT from this `orgs` list.
 *  - Multi-FIRM switching needs the per-firm-instance model (Phase 2 — gated; nothing to switch to
 *    with one instance).
 *  - connectSlack / connectTeams each start a PER-USER OAuth (Slack OAuth v2 user token / Teams
 *    delegated Graph) via the authenticated `connectors:getAuthorizeUrl` method.
 */
export const useOrgSwitcher = (): {
	orgs: SwitchableOrg[];
	switchOrg: (org: SwitchableOrg) => void;
	addWorkspace: () => void;
	connectSlack: () => void;
	connectTeams: () => void;
	teamsEnabled: boolean;
	slackEnabled: boolean;
} => {
	const dispatchToast = useToastMessageDispatch();
	const siteName = String(useSetting('Site_Name') || 'MatterChat');
	// Teams + Slack are standalone-safe: the "Connect" actions only show/work when the connector is
	// enabled in admin (Teams_Enabled / Slack_Enabled, PUBLIC settings). Whether the client SECRET is
	// set is not a public setting, so a missing secret surfaces at click-time as the
	// `teams-not-configured` / `slack-not-configured` toast.
	const teamsEnabled = Boolean(useSetting('Teams_Enabled'));
	const slackEnabled = Boolean(useSetting('Slack_Enabled'));
	const getAuthorizeUrl = useMethod('connectors:getAuthorizeUrl');

	const orgs = useMemo<SwitchableOrg[]>(() => {
		const initial = (siteName.trim().match(/\b\w/g) || ['M']).slice(0, 2).join('').toUpperCase();
		const list: SwitchableOrg[] = [{ id: 'current', name: siteName, initial, color: '#e1140a', type: 'matterchat', active: true }];
		return list;
	}, [siteName]);

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

	// "Connect Slack" → start the per-user Slack OAuth (Slack OAuth v2, USER token). Each user connects
	// their OWN Slack workspace and acts AS themselves. Cookie-FREE: we call the authenticated
	// `connectors:getAuthorizeUrl` method (it parks state bound to this.userId server-side), then
	// full-page-redirect the browser to Slack. On 'slack-not-configured' we tell the admin to paste the
	// client secret + enable Slack. This replaces the old SlackBridge admin deep-link.
	const connectSlack = useCallback(async () => {
		try {
			const url = await getAuthorizeUrl('slack');
			window.location.href = url;
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			if (reason === 'slack-not-configured' || (error as { error?: string })?.error === 'slack-not-configured') {
				dispatchToast({
					type: 'error',
					message: 'Slack isn’t set up yet. An admin needs to paste the client secret and enable Slack under Admin → Settings → Slack.',
				});
				return;
			}
			dispatchToast({ type: 'error', message: error });
		}
	}, [getAuthorizeUrl, dispatchToast]);

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

	return { orgs, switchOrg, addWorkspace, connectSlack, connectTeams, teamsEnabled, slackEnabled };
};
