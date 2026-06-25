import { usePermission, useRouter, useSetting, useToastMessageDispatch } from '@rocket.chat/ui-contexts';
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
} => {
	const dispatchToast = useToastMessageDispatch();
	const router = useRouter();
	const siteName = String(useSetting('Site_Name') || 'MatterChat');
	const slackConnected = Boolean(useSetting('SlackBridge_Enabled'));
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

	// "Add a workspace" → Connect a Slack. The only workspace you can add today is a Slack via the
	// SlackBridge, which is configured in admin settings, so this deep-links there for admins. Non-
	// admins get a plain message (they can't reach the settings) rather than a dead-end navigation.
	const addWorkspace = useCallback(() => {
		if (canManageSettings) {
			router.navigate('/admin/settings/SlackBridge');
			return;
		}
		dispatchToast({
			type: 'info',
			message: 'Connecting a Slack workspace is an admin setting — ask a workspace admin to connect one under Admin → SlackBridge.',
		});
	}, [canManageSettings, router, dispatchToast]);

	return { orgs, switchOrg, addWorkspace };
};
