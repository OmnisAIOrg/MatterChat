import type { ReactElement, ReactNode } from 'react';
import { useCallback, useMemo, useState } from 'react';

import type { SelectedTeamsChannel } from './OrgSwitcherContext';
import OrgSwitcherContext from './OrgSwitcherContext';

/**
 * Holds the selected-workspace state shared between the OrgSwitcherRail (writer), the Sidebar (which
 * swaps the room list for the Teams channel list) and the main content (which renders the open Teams
 * channel). Mounted once in LayoutWithSidebar, wrapping the rail + sidebar(s) + content.
 *
 * Leaving Teams (selecting any non-'teams' workspace) clears the open channel so returning to the
 * native workspace is a clean reset — no stale Teams channel lingering behind the MatterChat view.
 */
const OrgSwitcherProvider = ({ children }: { children: ReactNode }): ReactElement => {
	const [selectedOrgId, setSelectedOrgIdState] = useState('current');
	const [selectedTeamsChannel, setSelectedTeamsChannel] = useState<SelectedTeamsChannel | undefined>(undefined);

	const setSelectedOrgId = useCallback((id: string) => {
		setSelectedOrgIdState(id);
		// Switching away from Teams (e.g. clicking the M tile) drops the open channel so the Teams view
		// never bleeds into the MatterChat view.
		if (id !== 'teams') {
			setSelectedTeamsChannel(undefined);
		}
	}, []);

	const value = useMemo(
		() => ({ selectedOrgId, setSelectedOrgId, selectedTeamsChannel, setSelectedTeamsChannel }),
		[selectedOrgId, setSelectedOrgId, selectedTeamsChannel],
	);

	return <OrgSwitcherContext.Provider value={value}>{children}</OrgSwitcherContext.Provider>;
};

export default OrgSwitcherProvider;
