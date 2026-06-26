import type { ReactElement, ReactNode } from 'react';
import { useCallback, useMemo, useState } from 'react';

import type { SelectedExternalChannel } from './OrgSwitcherContext';
import OrgSwitcherContext from './OrgSwitcherContext';

/**
 * Holds the selected-workspace state shared between the OrgSwitcherRail (writer), the sidebar (which
 * swaps the room list for the external channel list) and the main content (which renders the open
 * external channel). Mounted once in LayoutWithSidebar, wrapping the rail + sidebar(s) + content.
 *
 * Leaving an external workspace (selecting the native 'current' tile, or any non-external selection)
 * clears the open channel so returning to the native workspace is a clean reset — no stale external
 * channel lingering behind the MatterChat view. SWITCHING between two external tiles (Teams <-> Google
 * Chat) also clears the open channel, because a channel id from one connection is meaningless in the
 * other.
 */
const OrgSwitcherProvider = ({ children }: { children: ReactNode }): ReactElement => {
	const [selectedOrgId, setSelectedOrgIdState] = useState('current');
	const [selectedExternalChannel, setSelectedExternalChannel] = useState<SelectedExternalChannel | undefined>(undefined);

	const setSelectedOrgId = useCallback((id: string) => {
		setSelectedOrgIdState((prev) => {
			// Switching away from the CURRENT external tile (back to MatterChat, or to a DIFFERENT
			// external tile) drops the open channel so it never bleeds across connections/views.
			if (id !== prev) {
				setSelectedExternalChannel(undefined);
			}
			return id;
		});
	}, []);

	const value = useMemo(
		() => ({ selectedOrgId, setSelectedOrgId, selectedExternalChannel, setSelectedExternalChannel }),
		[selectedOrgId, setSelectedOrgId, selectedExternalChannel],
	);

	return <OrgSwitcherContext.Provider value={value}>{children}</OrgSwitcherContext.Provider>;
};

export default OrgSwitcherProvider;
