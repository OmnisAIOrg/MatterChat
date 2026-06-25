import { createContext, useContext } from 'react';

export type OrgSwitcherContextValue = {
	selectedOrgId: string;
	setSelectedOrgId: (id: string) => void;
};

/**
 * Which workspace tile is selected in the OrgSwitcherRail. Drives the sidebar's workspace view —
 * e.g. selecting the connected-Slack tile filters the room list to Slack-bridged channels (rooms
 * carrying `importIds`); selecting the native workspace ('current') shows the normal list.
 *
 * The default is a NO-OP context so consumers (useRoomList, both sidebars, tests) work without a
 * provider present — it never throws, keeping the sidebar decoupled from mount order.
 */
const OrgSwitcherContext = createContext<OrgSwitcherContextValue>({
	selectedOrgId: 'current',
	setSelectedOrgId: () => undefined,
});

export const useOrgSwitcherSelection = (): OrgSwitcherContextValue => useContext(OrgSwitcherContext);

export default OrgSwitcherContext;
