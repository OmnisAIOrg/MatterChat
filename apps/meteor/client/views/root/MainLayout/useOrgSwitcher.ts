import { useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import { useCallback, useMemo } from 'react';

/**
 * A workspace the user can switch into — a native MatterChat firm OR a connected external Slack.
 */
export type SwitchableOrg = {
	id: string;
	name: string;
	initial: string;
	color?: string; // tile colour for a native MatterChat org (Slack orgs render the Slack mark instead)
	type: 'matterchat' | 'slack';
	active?: boolean;
	unread?: boolean;
	mentions?: number;
};

/**
 * useOrgSwitcher — data + actions for the multi-org switcher rail (slice 1).
 *
 * Slice 1 returns PLACEHOLDER workspaces so the rail can render the approved design. The actions
 * are stubbed (a toast) for now.
 *   - Slice 2 replaces `orgs` with the user's real org list from CentralizedAuth (which already
 *     knows every firm they belong to) and makes `switchOrg` route to that firm's MatterChat URL.
 *   - Slice 3 adds the per-user "Connect a Slack workspace" flow (on the proven SlackBridge) so a
 *     Slack org appears as a tile whose bridged channels open as native rooms.
 */
export const useOrgSwitcher = (): {
	orgs: SwitchableOrg[];
	switchOrg: (org: SwitchableOrg) => void;
	addWorkspace: () => void;
} => {
	const dispatchToast = useToastMessageDispatch();

	const orgs = useMemo<SwitchableOrg[]>(
		() => [
			{ id: 'apex', name: 'Apex Law', initial: 'A', color: '#e1140a', type: 'matterchat', active: true },
			{ id: 'brennan', name: 'Brennan & Cole', initial: 'BC', color: '#1D9E75', type: 'matterchat', mentions: 3 },
			{ id: 'dorsey', name: 'Dorsey Group', initial: 'D', color: '#BA7517', type: 'matterchat', unread: true },
			{ id: 'omnisai-slack', name: 'OmnisAI Slack', initial: 'OS', type: 'slack' },
		],
		[],
	);

	const switchOrg = useCallback(
		(org: SwitchableOrg) => {
			// Slice 2: route to org's MatterChat instance (per-firm URL resolved from CentralizedAuth).
			dispatchToast({ type: 'info', message: `Switch to ${org.name} — wired up in the next slice.` });
		},
		[dispatchToast],
	);

	const addWorkspace = useCallback(() => {
		// Slice 2/3: the "Add a MatterChat workspace" / "Connect a Slack workspace" popover + flows.
		dispatchToast({ type: 'info', message: 'Add a workspace — the connect flow lands in the next slice.' });
	}, [dispatchToast]);

	return { orgs, switchOrg, addWorkspace };
};
