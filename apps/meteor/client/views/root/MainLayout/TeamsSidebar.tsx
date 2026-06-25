import { css } from '@rocket.chat/css-in-js';
import { Box, Icon, Throbber, States, StatesIcon, StatesTitle, StatesSubtitle, StatesActions, StatesAction } from '@rocket.chat/fuselage';
import type { ReactElement } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useOrgSwitcherSelection } from './OrgSwitcherContext';
import { useExternalWorkspaces } from './useExternalWorkspaces';
import { useTeamsChannels } from './useTeamsChannels';

/**
 * TeamsSidebar — the LEFT SIDEBAR contents while the connected Teams workspace is selected.
 *
 * This REPLACES the MatterChat room list (Channels / DMs) when `selectedOrgId === 'teams'` — see
 * Sidebar.tsx. It lists the user's REAL Teams channels (external-workspaces.channels -> Graph
 * listChannels) grouped by team, and clicking a channel opens it in the MAIN content area by setting
 * `selectedTeamsChannel`. The header carries the primary way back to MatterChat. Being "in Teams" is
 * its own mode: the MatterChat nav is not shown alongside this (no half-overlay).
 *
 * Standalone-safe: only ever mounted when a Teams connection exists and its tile is selected.
 */

const TEAMS_PURPLE = '#4B53BC';

const rootClass = css`
	display: flex;
	flex-direction: column;
	height: 100%;
	width: 100%;
	background: var(--rcx-color-surface-light, #ffffff);
	overflow: hidden;
`;

const headerClass = css`
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 12px 14px;
	background: ${TEAMS_PURPLE};
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

const channelRowClass = css`
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

	&:focus-visible {
		outline: 2px solid ${TEAMS_PURPLE};
		outline-offset: -2px;
	}
`;

const channelRowSelectedClass = css`
	background: rgba(75, 83, 188, 0.12);
	color: ${TEAMS_PURPLE};
	font-weight: 600;

	&:hover {
		background: rgba(75, 83, 188, 0.16);
	}
`;

// The Microsoft Teams mark (rendered, never recoloured). Declared as an element to keep one
// component per file.
const teamsMark = (
	<svg width={18} height={18} viewBox='0 0 24 24' aria-hidden focusable='false'>
		<rect x='2' y='5' width='12' height='14' rx='2' fill='#ffffff' opacity='0.92' />
		<text x='8' y='15' fontSize='9' fontWeight='700' textAnchor='middle' fill={TEAMS_PURPLE} fontFamily='Arial, sans-serif'>
			T
		</text>
		<circle cx='18' cy='8' r='3.4' fill='#ffffff' opacity='0.92' />
		<rect x='14.4' y='10.5' width='7.2' height='8' rx='2' fill='#ffffff' opacity='0.72' />
	</svg>
);

const TeamsSidebar = (): ReactElement => {
	const { t } = useTranslation();
	const { selectedTeamsChannel, setSelectedTeamsChannel, setSelectedOrgId } = useOrgSwitcherSelection();
	const { teamsConnection } = useExternalWorkspaces();
	const { groups, error, isLoading, refetch } = useTeamsChannels(teamsConnection?._id, true);

	const channelCount = groups?.reduce((sum, g) => sum + g.channels.length, 0) ?? 0;

	return (
		<Box className={rootClass} role='navigation' aria-label={t('Teams_channels', { defaultValue: 'Teams channels' })}>
			<Box className={headerClass}>
				{teamsMark}
				<Box is='span' fontWeight={700} fontSize={15} withTruncatedText flexGrow={1}>
					{teamsConnection?.externalOrgName || t('Microsoft_Teams', { defaultValue: 'Microsoft Teams' })}
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
							{t('Loading_your_Teams_channels', { defaultValue: 'Loading your Teams channels…' })}
						</Box>
					</Box>
				)}

				{!isLoading && error && (
					<States>
						<StatesIcon name='warning' variation='danger' />
						<StatesTitle>{t('Couldnt_load_Teams_channels', { defaultValue: 'Couldn’t load your Teams channels' })}</StatesTitle>
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
						<StatesTitle>{t('No_Teams_channels_found', { defaultValue: 'No channels found' })}</StatesTitle>
						<StatesSubtitle>
							{t('No_Teams_channels_found_subtitle', {
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
					groups?.map((group) => (
						<Box key={group.teamName}>
							<Box className={teamHeadingClass}>
								<Icon name='team' size='x14' />
								<Box is='span' withTruncatedText>
									{group.teamName}
								</Box>
							</Box>
							{group.channels.map((channel) => {
								const isSelected = selectedTeamsChannel?.externalId === channel.externalId;
								return (
									<Box
										is='button'
										type='button'
										key={channel.externalId}
										className={[channelRowClass, isSelected && channelRowSelectedClass].filter(Boolean)}
										aria-current={isSelected ? 'true' : undefined}
										title={channel.topic || channel.name}
										onClick={(): void =>
											setSelectedTeamsChannel({
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

export default memo(TeamsSidebar);
