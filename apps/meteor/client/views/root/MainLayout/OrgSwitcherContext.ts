import { createContext, useContext } from 'react';

/**
 * What KIND of external conversation is open. The read/post endpoints are identical for all three (the
 * provider detects a channel id vs a direct-chat id from the token itself), so this is purely for
 * rendering the right header icon/label — never branched on for data.
 *  - `channel` — a channel/space from the "Channels/Spaces" section.
 *  - `chat`    — a 1:1 or group DM from the "Chats" section.
 *  - `dm`      — a DM started from the "People" section (a person, not a pre-existing chat).
 */
export type SelectedExternalChannelKind = 'channel' | 'chat' | 'dm';

/**
 * Identity of an open external conversation as the lists provide it — passed straight through to the
 * read/post endpoints. `externalId` is the provider-native channel/space/chat id (Teams: the
 * `teamId|channelId` composite for a channel, a bare chat id for a DM; Google Chat: the `spaces/{id}`
 * resource name) and is the ONLY value the backend needs; the rest is for rendering the open
 * conversation's header. Provider-agnostic: the same shape carries a Teams channel, a Google Chat
 * space OR a direct chat.
 */
export type SelectedExternalChannel = {
	externalId: string;
	name: string;
	teamName: string;
	isPrivate: boolean;
	/** Optional render hint (channel vs chat vs DM); defaults to a channel when absent. */
	kind?: SelectedExternalChannelKind;
};

export type OrgSwitcherContextValue = {
	selectedOrgId: string;
	setSelectedOrgId: (id: string) => void;
	/** The external channel currently open in the main content (only meaningful while in workspace mode). */
	selectedExternalChannel: SelectedExternalChannel | undefined;
	setSelectedExternalChannel: (channel: SelectedExternalChannel | undefined) => void;
};

/**
 * The sentinel `selectedOrgId` for a connected external workspace tile. It embeds the connection's
 * `_id` so the switcher can carry MORE THAN ONE external connection (e.g. a Teams AND a Google Chat
 * tile) and the workspace view knows EXACTLY which connection to read. Selecting any such tile enters
 * the provider-agnostic workspace MODE; the native workspace is the plain 'current' sentinel.
 *
 *   externalSelectionId('abc123')  ->  'ext:abc123'
 *   externalConnectionIdFromSelection('ext:abc123')  ->  'abc123'
 *   externalConnectionIdFromSelection('current')     ->  undefined
 */
const EXTERNAL_SELECTION_PREFIX = 'ext:';

export const externalSelectionId = (connectionId: string): string => `${EXTERNAL_SELECTION_PREFIX}${connectionId}`;

export const externalConnectionIdFromSelection = (selectedOrgId: string): string | undefined =>
	selectedOrgId.startsWith(EXTERNAL_SELECTION_PREFIX) ? selectedOrgId.slice(EXTERNAL_SELECTION_PREFIX.length) : undefined;

/** True when the current selection is any connected external workspace tile (Teams, Google, …). */
export const isExternalSelection = (selectedOrgId: string): boolean => selectedOrgId.startsWith(EXTERNAL_SELECTION_PREFIX);

/**
 * Which workspace tile is selected in the OrgSwitcherRail, and — when that tile is a connected
 * external workspace — which channel/space is open. This is the single source of truth that turns an
 * external workspace into its own coherent MODE:
 *   - the OrgSwitcherRail (writer) sets `selectedOrgId` to `ext:<connectionId>`,
 *   - LayoutWithSidebar reads it to swap the MatterChat sidebar for the external channel list,
 *   - the main content reads `selectedExternalChannel` to render that channel's messages + composer.
 *
 * Selecting the native workspace ('current') is the clean way back: it returns the normal sidebar +
 * content. The default is a NO-OP context so consumers (useRoomList, the sidebars, tests) work
 * without a provider present — it never throws, keeping the sidebar decoupled from mount order.
 */
const OrgSwitcherContext = createContext<OrgSwitcherContextValue>({
	selectedOrgId: 'current',
	setSelectedOrgId: () => undefined,
	selectedExternalChannel: undefined,
	setSelectedExternalChannel: () => undefined,
});

export const useOrgSwitcherSelection = (): OrgSwitcherContextValue => useContext(OrgSwitcherContext);

export default OrgSwitcherContext;
