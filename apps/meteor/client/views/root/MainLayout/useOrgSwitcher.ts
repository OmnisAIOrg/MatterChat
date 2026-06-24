import { useSetting, useToastMessageDispatch } from '@rocket.chat/ui-contexts';
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
 *    `importIds`) is the next chunk.
 */
export const useOrgSwitcher = (): {
	orgs: SwitchableOrg[];
	switchOrg: (org: SwitchableOrg) => void;
	addWorkspace: () => void;
} => {
	const dispatchToast = useToastMessageDispatch();
	const siteName = String(useSetting('Site_Name') || 'MatterChat');
	const slackConnected = Boolean(useSetting('SlackBridge_Enabled'));

	const orgs = useMemo<SwitchableOrg[]>(() => {
		const initial = (siteName.trim().match(/\b\w/g) || ['M']).slice(0, 2).join('').toUpperCase();
		const list: SwitchableOrg[] = [{ id: 'current', name: siteName, initial, color: '#e1140a', type: 'matterchat', active: true }];
		if (slackConnected) {
			list.push({ id: 'slack', name: 'Slack', initial: 'SL', type: 'slack' });
		}
		return list;
	}, [siteName, slackConnected]);

	const switchOrg = useCallback(
		(org: SwitchableOrg) => {
			if (org.active) {
				return;
			}
			if (org.type === 'slack') {
				dispatchToast({ type: 'info', message: 'Your connected Slack — its channels are bridged into your list. A dedicated Slack-workspace view is the next step.' });
				return;
			}
			dispatchToast({ type: 'info', message: 'Switching to another firm needs the per-firm setup — that comes in the next phase.' });
		},
		[dispatchToast],
	);

	const addWorkspace = useCallback(() => {
		dispatchToast({ type: 'info', message: 'Add a workspace — connect a Slack or add a firm (coming next).' });
	}, [dispatchToast]);

	return { orgs, switchOrg, addWorkspace };
};
