import { css } from '@rocket.chat/css-in-js';
import { Box, Icon, Throbber } from '@rocket.chat/fuselage';
import type { ComponentProps, ReactElement, ReactNode } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { externalConnectionIdFromSelection, useOrgSwitcherSelection } from './OrgSwitcherContext';
import { externalProviderBranding } from './externalProviders';
import { useExternalChannels } from './useExternalChannels';
import { useExternalDirectChats } from './useExternalDirectChats';
import { useExternalMembers } from './useExternalMembers';
import { useExternalWorkspaces } from './useExternalWorkspaces';

/**
 * ExternalSidebar — the LEFT SIDEBAR contents while a connected external workspace is selected.
 *
 * Provider-agnostic (Teams / Google Chat / Slack): it REPLACES the MatterChat room list when an
 * external tile is selected (selectedOrgId === `ext:<connectionId>`) — see LayoutWithSidebar. It
 * resolves the SELECTED connection from the selection (not a hardcoded provider) and renders THREE
 * sections for that connection:
 *
 *   • Channels/Spaces — external-workspaces.channels (grouped by team)
 *   • Chats           — external-workspaces.directChats (1:1 + group DMs)
 *   • People          — external-workspaces.members (the org directory)
 *
 * Clicking a channel OR a chat opens it in the MAIN content area (ExternalChannelView) by setting
 * `selectedExternalChannel` — both ride the SAME `externalId` token through messages/sendMessage (the
 * provider detects channel vs chat). Clicking a person attempts to open a DM the same way (passing the
 * member's `externalId` through); where the provider doesn't accept a member id as a messaging token
 * the messages endpoint rides back a plain `{ ok:false }` envelope and the channel view shows a clean
 * error with Retry (no crash) — so People degrades to "just a directory" gracefully. Each section has
 * its own loading / plain-error / empty state so one section failing never blanks the others.
 *
 * Standalone-safe: only ever mounted when an external connection exists and its tile is selected.
 *
 * Crash-safety: every external value is read defensively (`connection?._id`, `groups ?? []`,
 * `externalProviderBranding(...)` falls back for an unknown provider) and all hooks run
 * unconditionally with no early return before them.
 */

const rootClass = css`
	display: flex;
	flex-direction: column;
	height: 100%;
	width: 100%;
	background: var(--rcx-color-surface-light, #ffffff);
	overflow: hidden;
`;

const headerBaseClass = css`
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 12px 14px;
	color: #ffffff;
	flex-shrink: 0;
`;

const bodyClass = css`
	flex: 1;
	overflow-y: auto;
	padding: 8px 8px 24px;
`;

const sectionHeadingClass = css`
	display: flex;
	align-items: center;
	gap: 6px;
	margin-block: 16px 4px;
	padding-inline: 8px;
	font-size: 12px;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.04em;
	color: var(--rcx-color-font-hint, #6c727a);

	&:first-of-type {
		margin-block-start: 6px;
	}
`;

const teamHeadingClass = css`
	display: flex;
	align-items: center;
	gap: 6px;
	margin-block: 10px 2px;
	padding-inline: 14px;
	font-size: 11px;
	font-weight: 600;
	letter-spacing: 0.02em;
	color: var(--rcx-color-font-hint, #6c727a);
`;

const rowBaseClass = css`
	display: flex;
	align-items: center;
	gap: 8px;
	width: 100%;
	padding: 7px 10px;
	border: 0;
	border-radius: 8px;
	background: transparent;
	color: var(--rcx-color-font-default, #2f343d);
	font-family: inherit;
	font-size: 14px;
	text-align: start;
	cursor: pointer;

	&:hover {
		background: var(--rcx-color-surface-neutral, #f2f3f5);
	}
`;

const avatarDotClass = css`
	flex-shrink: 0;
	width: 22px;
	height: 22px;
	border-radius: 50%;
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 10px;
	font-weight: 700;
	color: #ffffff;
	line-height: 1;
	user-select: none;
`;

const subtleClass = css`
	padding: 6px 12px 2px;
	font-size: 13px;
	color: var(--rcx-color-font-hint, #6c727a);
`;

const initialsOf = (name: string): string => (name.trim().match(/\b\w/g) || ['?']).slice(0, 2).join('').toUpperCase();

/** A compact section shell with one of: loading / error / empty / children. Keeps each section's
 * states self-contained so one failing list never blanks the others. */
const Section = ({
	icon,
	title,
	isLoading,
	error,
	isEmpty,
	emptyLabel,
	onRetry,
	children,
}: {
	icon: ComponentProps<typeof Icon>['name'];
	title: string;
	isLoading: boolean;
	error: { message: string; status?: number } | undefined;
	isEmpty: boolean;
	emptyLabel: string;
	onRetry: () => void;
	children: ReactNode;
}): ReactElement => {
	const { t } = useTranslation();
	return (
		<Box>
			<Box className={sectionHeadingClass}>
				<Icon name={icon} size='x14' />
				<Box is='span' withTruncatedText>
					{title}
				</Box>
			</Box>

			{isLoading && (
				<Box display='flex' alignItems='center' justifyContent='center' pb={12}>
					<Throbber size='x12' />
				</Box>
			)}

			{!isLoading && error && (
				<Box pi={12} pb={8}>
					<Box fontSize={12} color='danger' mbe={4}>
						{error.message}
						{error.status ? ` (${error.status})` : ''}
					</Box>
					<Box
						is='button'
						type='button'
						onClick={onRetry}
						className={css`
							border: 0;
							background: transparent;
							padding: 0;
							color: var(--rcx-color-font-info, #095ad2);
							font-family: inherit;
							font-size: 12px;
							cursor: pointer;
							text-decoration: underline;
						`}
					>
						{t('Retry', { defaultValue: 'Retry' })}
					</Box>
				</Box>
			)}

			{!isLoading && !error && isEmpty && <Box className={subtleClass}>{emptyLabel}</Box>}

			{!isLoading && !error && !isEmpty && children}
		</Box>
	);
};

const ExternalSidebar = (): ReactElement => {
	const { t } = useTranslation();
	const { selectedOrgId, selectedExternalChannel, setSelectedExternalChannel, setSelectedOrgId } = useOrgSwitcherSelection();
	const { getConnectionById } = useExternalWorkspaces();

	// Resolve the SELECTED connection from the selection sentinel — provider-agnostic.
	const connection = getConnectionById(externalConnectionIdFromSelection(selectedOrgId));
	const branding = externalProviderBranding(connection?.provider);
	const workspaceName = connection?.externalOrgName || branding.defaultName;
	const connectionId = connection?._id;

	// All three section hooks run UNCONDITIONALLY (stable order, gated by `enabled`) so hook order can
	// never change between renders.
	const channels = useExternalChannels(connectionId, true);
	const directChats = useExternalDirectChats(connectionId, true);
	const members = useExternalMembers(connectionId, true);

	// Defensive: each list may be undefined (loading / error / unexpected shape); never deref blindly.
	const safeGroups = Array.isArray(channels.groups) ? channels.groups : [];
	const channelCount = safeGroups.reduce((sum, g) => sum + (Array.isArray(g?.channels) ? g.channels.length : 0), 0);
	const safeChats = Array.isArray(directChats.chats) ? directChats.chats : [];
	const safeMembers = Array.isArray(members.members) ? members.members : [];

	// Provider-coloured selected-row style (kept inline so it tracks the connection's brand colour).
	const rowSelectedClass = css`
		background: ${branding.color}1f;
		color: ${branding.color};
		font-weight: 600;

		&:hover {
			background: ${branding.color}29;
		}
	`;

	const isOpen = (externalId: string): boolean => selectedExternalChannel?.externalId === externalId;

	return (
		<Box className={rootClass} role='navigation' aria-label={t('External_workspace_channels', { defaultValue: 'Workspace channels' })}>
			<Box className={headerBaseClass} style={{ background: branding.color }}>
				<branding.Mark size={18} />
				<Box is='span' fontWeight={700} fontSize={15} withTruncatedText flexGrow={1}>
					{workspaceName}
				</Box>
				<Box
					is='button'
					type='button'
					onClick={(): void => setSelectedOrgId('current')}
					title={t('Back_to_MatterChat', { defaultValue: 'Back to MatterChat' })}
					aria-label={t('Back_to_MatterChat', { defaultValue: 'Back to MatterChat' })}
					className={css`
						display: flex;
						align-items: center;
						border: 0;
						border-radius: 6px;
						padding: 5px;
						background: rgba(255, 255, 255, 0.16);
						color: #ffffff;
						cursor: pointer;

						&:hover {
							background: rgba(255, 255, 255, 0.26);
						}

						&:focus-visible {
							outline: 2px solid #ffffff;
							outline-offset: 1px;
						}
					`}
				>
					<Icon name='arrow-back' size='x18' />
				</Box>
			</Box>

			<Box className={bodyClass}>
				{/* CHANNELS / SPACES */}
				<Section
					icon='hash'
					title={t('Channels_and_spaces', { defaultValue: 'Channels' })}
					isLoading={channels.isLoading}
					error={channels.error}
					isEmpty={channelCount === 0}
					emptyLabel={t('No_workspace_channels_found', { defaultValue: 'No channels found' })}
					onRetry={channels.refetch}
				>
					{safeGroups.map((group) => (
						<Box key={group.teamName}>
							{group.teamName ? (
								<Box className={teamHeadingClass}>
									<Box is='span' withTruncatedText>
										{group.teamName}
									</Box>
								</Box>
							) : null}
							{(Array.isArray(group?.channels) ? group.channels : []).map((channel) => {
								const selected = isOpen(channel.externalId);
								return (
									<Box
										is='button'
										type='button'
										key={channel.externalId}
										className={[rowBaseClass, selected && rowSelectedClass].filter(Boolean)}
										aria-current={selected ? 'true' : undefined}
										title={channel.topic || channel.name}
										onClick={(): void =>
											setSelectedExternalChannel({
												externalId: channel.externalId,
												name: channel.name,
												teamName: group.teamName,
												isPrivate: channel.isPrivate,
												kind: 'channel',
											})
										}
									>
										<Icon name={channel.isPrivate ? 'lock' : 'hash'} size='x18' color={selected ? undefined : 'hint'} />
										<Box is='span' withTruncatedText>
											{channel.name}
										</Box>
									</Box>
								);
							})}
						</Box>
					))}
				</Section>

				{/* CHATS (direct + group DMs) */}
				<Section
					icon='balloons'
					title={t('Chats', { defaultValue: 'Chats' })}
					isLoading={directChats.isLoading}
					error={directChats.error}
					isEmpty={safeChats.length === 0}
					emptyLabel={t('No_workspace_chats_found', { defaultValue: 'No direct chats' })}
					onRetry={directChats.refetch}
				>
					{safeChats.map((chat) => {
						const selected = isOpen(chat.externalId);
						return (
							<Box
								is='button'
								type='button'
								key={chat.externalId}
								className={[rowBaseClass, selected && rowSelectedClass].filter(Boolean)}
								aria-current={selected ? 'true' : undefined}
								title={chat.name}
								onClick={(): void =>
									setSelectedExternalChannel({
										externalId: chat.externalId,
										name: chat.name,
										teamName: t('Direct_messages', { defaultValue: 'Direct messages' }),
										isPrivate: true,
										kind: 'chat',
									})
								}
							>
								<Icon name={chat.isGroup ? 'team' : 'balloons'} size='x18' color={selected ? undefined : 'hint'} />
								<Box is='span' withTruncatedText>
									{chat.name}
								</Box>
							</Box>
						);
					})}
				</Section>

				{/* PEOPLE (the org directory; clicking starts/opens a DM with that person) */}
				<Section
					icon='team'
					title={t('People', { defaultValue: 'People' })}
					isLoading={members.isLoading}
					error={members.error}
					isEmpty={safeMembers.length === 0}
					emptyLabel={t('No_workspace_people_found', { defaultValue: 'No people found' })}
					onRetry={members.refetch}
				>
					{safeMembers.map((member) => {
						const selected = isOpen(member.externalId);
						return (
							<Box
								is='button'
								type='button'
								key={member.externalId}
								className={[rowBaseClass, selected && rowSelectedClass].filter(Boolean)}
								aria-current={selected ? 'true' : undefined}
								title={member.email || member.displayName}
								onClick={(): void =>
									setSelectedExternalChannel({
										externalId: member.externalId,
										name: member.displayName,
										teamName: t('Direct_message', { defaultValue: 'Direct message' }),
										isPrivate: true,
										kind: 'dm',
									})
								}
							>
								<Box className={avatarDotClass} style={{ background: branding.color }} aria-hidden>
									{initialsOf(member.displayName || '?')}
								</Box>
								<Box flexGrow={1} minWidth={0}>
									<Box is='span' withTruncatedText display='block'>
										{member.displayName}
									</Box>
									{member.email ? (
										<Box is='span' fontSize={11} color='hint' withTruncatedText display='block'>
											{member.email}
										</Box>
									) : null}
								</Box>
							</Box>
						);
					})}
				</Section>
			</Box>
		</Box>
	);
};

export default memo(ExternalSidebar);
