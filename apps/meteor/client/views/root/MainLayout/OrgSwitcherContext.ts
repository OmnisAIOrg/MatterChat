import { createContext, useContext } from 'react';

/**
 * Identity of a Teams channel as the channels list provides it — passed straight through to the
 * read/post endpoints. `externalId` is the provider-native composite (`teamId|channelId`) and is
 * the ONLY value the backend needs; the rest is for rendering the open channel's header.
 */
export type SelectedTeamsChannel = {
	externalId: string;
	name: string;
	teamName: string;
	isPrivate: boolean;
};

export type OrgSwitcherContextValue = {
	selectedOrgId: string;
	setSelectedOrgId: (id: string) => void;
	/** The Teams channel currently open in the main content (only meaningful while in Teams mode). */
	selectedTeamsChannel: SelectedTeamsChannel | undefined;
	setSelectedTeamsChannel: (channel: SelectedTeamsChannel | undefined) => void;
};

/**
 * Which workspace tile is selected in the OrgSwitcherRail, and — when that tile is the connected
 * Teams workspace — which Teams channel is open. This is the single source of truth that turns Teams
 * into its own coherent MODE:
 *   - the OrgSwitcherRail (writer) sets `selectedOrgId`,
 *   - the Sidebar reads it to swap the MatterChat room list for the Teams channel list,
 *   - the main content reads `selectedTeamsChannel` to render that channel's messages + composer.
 *
 * Selecting the native workspace ('current') is the clean way back: it returns the normal sidebar +
 * content. The default is a NO-OP context so consumers (useRoomList, both sidebars, tests) work
 * without a provider present — it never throws, keeping the sidebar decoupled from mount order.
 */
const OrgSwitcherContext = createContext<OrgSwitcherContextValue>({
	selectedOrgId: 'current',
	setSelectedOrgId: () => undefined,
	selectedTeamsChannel: undefined,
	setSelectedTeamsChannel: () => undefined,
});

export const useOrgSwitcherSelection = (): OrgSwitcherContextValue => useContext(OrgSwitcherContext);

export default OrgSwitcherContext;
