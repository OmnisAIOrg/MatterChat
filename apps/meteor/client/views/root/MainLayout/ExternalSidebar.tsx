import { css } from '@rocket.chat/css-in-js';
import { Box, Icon, Throbber, States, StatesIcon, StatesTitle, StatesSubtitle, StatesActions, StatesAction } from '@rocket.chat/fuselage';
import type { ReactElement } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { externalConnectionIdFromSelection, useOrgSwitcherSelection } from './OrgSwitcherContext';
import { externalProviderBranding } from './externalProviders';
import { useExternalChannels } from './useExternalChannels';
import { useExternalWorkspaces } from './useExternalWorkspaces';

/**
 * ExternalSidebar — the LEFT SIDEBAR contents while a connected external workspace is selected.
 *
 * Provider-agnostic (Teams OR Google Chat): it REPLACES the MatterChat room list when an external
 * tile is selected (selectedOrgId === `ext:<connectionId>`) — see LayoutWithSidebar. It resolves the
 * SELECTED connection from the selection (not a hardcoded provider), lists that connection's REAL
 * channels/spaces (external-workspaces.channels -> the provider's listChannels) grouped by team, and
 * clicking a channel opens it in the MAIN content area by setting `selectedExternalChannel`. The
 * header colour + mark + name come from the connection's provider branding, and the header carries
 * the primary way back to MatterChat. Being "in a workspace" is its own mode: the MatterChat nav is
 * not shown alongside this (no half-overlay).
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

const teamHeadingClass = css`
	display: flex;
	align-items: center;
	gap: 6px;
	margin-block: 14px 4px;
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

const channelRowBaseClass = css`
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

const ExternalSidebar = (): ReactElement => {
	const { t } = useTranslation();
	const { selectedOrgId, selectedExternalChannel, setSelectedExternalChannel, setSelectedOrgId } = useOrgSwitcherSelection();
	const { getConnectionById } = useExternalWorkspaces();

	// Resolve the SELECTED connection from the selection sentinel — provider-agnostic.
	const connection = getConnectionById(externalConnectionIdFromSelection(selectedOrgId));
	const branding = externalProviderBranding(connection?.provider);
	const workspaceName = connection?.externalOrgName || branding.defaultName;

	const { groups, error, isLoading, refetch } = useExternalChannels(connection?._id, true);

	// Defensive: `groups` may be undefined (loading / error / unexpected shape); never deref blindly.
	const safeGroups = Array.isArray(groups) ? groups : [];
	const channelCount = safeGroups.reduce((sum, g) => sum + (Array.isArray(g?.channels) ? g.channels.length : 0), 0);

	// Provider-coloured selected-row style (kept inline so it tracks the connection's brand colour).
	const channelRowSelectedClass = css`
		background: ${branding.color}1f;
		color: ${branding.color};
		font-weight: 600;

		&:hover {
			background: ${branding.color}29;
		}
	`;

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
				{isLoading && (
					<Box display='flex' flexDirection='column' alignItems='center' justifyContent='center' pbs={48}>
						<Throbber />
						<Box mbs={12} color='hint' fontSize={13}>
							{t('Loading_workspace_channels', { defaultValue: 'Loading your channels…' })}
						</Box>
					</Box>
				)}

				{!isLoading && error && (
					<States>
						<StatesIcon name='warning' variation='danger' />
						<StatesTitle>{t('Couldnt_load_workspace_channels', { defaultValue: 'Couldn’t load your channels' })}</StatesTitle>
						{/* Surface the REAL provider/auth message plainly (e.g. admin-consent 403). */}
						<StatesSubtitle>
							{error.message}
							{error.status ? ` (${error.status})` : ''}
						</StatesSubtitle>
						<StatesActions>
							<StatesAction onClick={refetch}>{t('Retry', { defaultValue: 'Retry' })}</StatesAction>
						</StatesActions>
					</States>
				)}

				{!isLoading && !error && channelCount === 0 && (
					<States>
						<StatesIcon name='team' />
						<StatesTitle>{t('No_workspace_channels_found', { defaultValue: 'No channels found' })}</StatesTitle>
						<StatesSubtitle>
							{t('No_workspace_channels_found_subtitle', {
								defaultValue: 'You’re connected, but we didn’t find any channels you’re a member of.',
							})}
						</StatesSubtitle>
						<StatesActions>
							<StatesAction onClick={refetch}>{t('Refresh', { defaultValue: 'Refresh' })}</StatesAction>
						</StatesActions>
					</States>
				)}

				{!isLoading &&
					!error &&
					channelCount > 0 &&
					safeGroups.map((group) => (
						<Box key={group.teamName}>
							<Box className={teamHeadingClass}>
								<Icon name='team' size='x14' />
								<Box is='span' withTruncatedText>
									{group.teamName}
								</Box>
							</Box>
							{(Array.isArray(group?.channels) ? group.channels : []).map((channel) => {
								const isSelected = selectedExternalChannel?.externalId === channel.externalId;
								return (
									<Box
										is='button'
										type='button'
										key={channel.externalId}
										className={[channelRowBaseClass, isSelected && channelRowSelectedClass].filter(Boolean)}
										aria-current={isSelected ? 'true' : undefined}
										title={channel.topic || channel.name}
										onClick={(): void =>
											setSelectedExternalChannel({
												externalId: channel.externalId,
												name: channel.name,
												teamName: group.teamName,
												isPrivate: channel.isPrivate,
											})
										}
									>
										<Icon name={channel.isPrivate ? 'lock' : 'hash'} size='x18' color={isSelected ? undefined : 'hint'} />
										<Box is='span' withTruncatedText>
											{channel.name}
										</Box>
									</Box>
								);
							})}
						</Box>
					))}
			</Box>
		</Box>
	);
};

export default memo(ExternalSidebar);
