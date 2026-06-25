import { css } from '@rocket.chat/css-in-js';
import { Box, Icon, Throbber, States, StatesIcon, StatesTitle, StatesSubtitle, StatesActions, StatesAction } from '@rocket.chat/fuselage';
import type { ReactElement } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useOrgSwitcherSelection } from './OrgSwitcherContext';
import { useExternalWorkspaces } from './useExternalWorkspaces';
import { useTeamsChannels } from './useTeamsChannels';

/**
 * TeamsChannelsPanel — the "see your connected Teams channels" view.
 *
 * Renders ONLY when the Teams tile is selected in the OrgSwitcherRail (selectedOrgId === 'teams').
 * It calls `external-workspaces.channels`, which runs the provider's REAL Microsoft Graph
 * `listChannels` (GET /me/joinedTeams -> /teams/{id}/channels) for the caller's OWN connection, and
 * LISTS the channels grouped by team. It shows a loading state and surfaces any Graph/auth error
 * message plainly (the endpoint returns the error in a 200 envelope rather than swallowing it).
 *
 * It is a pure no-op for the normal view and when no Teams is connected (the tile never appears, so
 * it can never be selected). Standalone-safe: zero Teams behavior with the connector off.
 */

const TEAMS_PURPLE = '#4B53BC';

const panelClass = css`
	position: absolute;
	inset: 0;
	z-index: 2;
	display: flex;
	flex-direction: column;
	background: var(--rcx-color-surface-light, #ffffff);
	overflow: hidden;
`;

const headerClass = css`
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 12px 16px;
	background: ${TEAMS_PURPLE};
	color: #ffffff;
	flex-shrink: 0;
`;

const backClass = css`
	margin-inline-start: auto;
	display: flex;
	align-items: center;
	gap: 4px;
	border: 0;
	border-radius: 6px;
	padding: 4px 8px;
	background: rgba(255, 255, 255, 0.16);
	color: #ffffff;
	font-family: inherit;
	font-size: 12px;
	font-weight: 600;
	line-height: 1;
	cursor: pointer;
	white-space: nowrap;

	&:hover {
		background: rgba(255, 255, 255, 0.26);
	}

	&:focus-visible {
		outline: 2px solid #ffffff;
		outline-offset: 1px;
	}
`;

const bodyClass = css`
	flex: 1;
	overflow-y: auto;
	padding: 16px 24px 32px;
`;

const teamHeadingClass = css`
	display: flex;
	align-items: center;
	gap: 8px;
	margin-block: 20px 8px;
	font-size: 13px;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.04em;
	color: var(--rcx-color-font-hint, #6c727a);

	&:first-of-type {
		margin-block-start: 4px;
	}
`;

const channelRowClass = css`
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 8px 10px;
	border-radius: 8px;
	color: var(--rcx-color-font-default, #2f343d);
	font-size: 14px;

	&:hover {
		background: var(--rcx-color-surface-neutral, #f2f3f5);
	}
`;

// The Microsoft Teams mark (rendered, never recoloured) — used in the header so the context reads
// as Teams at a glance. Declared as an element (not a component) to keep one component per file.
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

const TeamsChannelsPanel = (): ReactElement | null => {
	const { t } = useTranslation();
	const { selectedOrgId, setSelectedOrgId } = useOrgSwitcherSelection();
	const isOpen = selectedOrgId === 'teams';

	const { teamsConnection } = useExternalWorkspaces();
	const { groups, error, isLoading, refetch } = useTeamsChannels(teamsConnection?._id, isOpen);

	// No-op for the normal view / when no Teams is connected.
	if (!isOpen) {
		return null;
	}

	const channelCount = groups?.reduce((sum, g) => sum + g.channels.length, 0) ?? 0;

	return (
		<Box className={panelClass} role='region' aria-label={t('Teams_channels', { defaultValue: 'Teams channels' })}>
			<Box className={headerClass}>
				{teamsMark}
				<Box is='span' fontWeight={700} fontSize={15}>
					{teamsConnection?.externalOrgName || t('Microsoft_Teams', { defaultValue: 'Microsoft Teams' })}
				</Box>
				<Box
					is='button'
					type='button'
					className={backClass}
					onClick={(): void => setSelectedOrgId('current')}
					title={t('Back_to_MatterChat', { defaultValue: 'Back to MatterChat' })}
					aria-label={t('Back_to_MatterChat', { defaultValue: 'Back to MatterChat' })}
				>
					<Icon name='arrow-back' size='x14' />
					{t('Back_to_MatterChat', { defaultValue: 'Back to MatterChat' })}
				</Box>
			</Box>

			<Box className={bodyClass}>
				{isLoading && (
					<Box display='flex' flexDirection='column' alignItems='center' justifyContent='center' height='60%'>
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
						{/* Surface the REAL provider/auth message plainly — we need to see if listChannels worked. */}
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

				{!isLoading && !error && channelCount > 0 && (
					<>
						<Box color='hint' fontSize={12} mbe={4}>
							{t('Teams_channels_count', {
								defaultValue: '{{count}} channels across {{teams}} teams',
								count: channelCount,
								teams: groups?.length ?? 0,
							})}
						</Box>
						{groups?.map((group) => (
							<Box key={group.teamName}>
								<Box className={teamHeadingClass}>
									<Icon name='team' size='x16' />
									{group.teamName}
								</Box>
								{group.channels.map((channel) => (
									<Box key={channel.externalId} className={channelRowClass} title={channel.topic || channel.name}>
										<Icon name={channel.isPrivate ? 'lock' : 'hash'} size='x18' color='hint' />
										<Box is='span'>{channel.name}</Box>
										{channel.topic && (
											<Box is='span' color='hint' fontSize={12} withTruncatedText flexShrink={1}>
												{channel.topic}
											</Box>
										)}
									</Box>
								))}
							</Box>
						))}
					</>
				)}
			</Box>
		</Box>
	);
};

export default memo(TeamsChannelsPanel);
