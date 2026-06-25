import type { ExternalProvider } from '@rocket.chat/core-typings';
import { css } from '@rocket.chat/css-in-js';
import { Box, Icon, Throbber, States, StatesIcon, StatesTitle, StatesSubtitle, StatesActions, StatesAction } from '@rocket.chat/fuselage';
import type { ReactElement, ReactNode } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useOrgSwitcherSelection } from './OrgSwitcherContext';
import { useExternalChannels } from './useExternalChannels';
import { useExternalWorkspaces } from './useExternalWorkspaces';

/**
 * ExternalChannelsPanel — the provider-AGNOSTIC "see your connected channels" view.
 *
 * Renders when an external tile is selected in the OrgSwitcherRail (selectedOrgId === 'teams' or
 * 'slack'). It calls `external-workspaces.channels`, which runs the provider's REAL `listChannels`
 * (Teams: Microsoft Graph /me/joinedTeams -> /teams/{id}/channels; Slack: conversations.list) for the
 * caller's OWN connection, and LISTS the channels grouped by team/workspace. It shows a loading state
 * and surfaces any provider/auth error message plainly (the endpoint returns the error in a 200
 * envelope rather than swallowing it).
 *
 * It is a pure no-op for the normal view and when nothing external is connected (the tile never
 * appears, so it can never be selected). Standalone-safe: zero behavior with the connectors off.
 *
 * Both Slack and Teams feed the SAME panel — this is the generalization of the old
 * Teams-only panel so a connected Slack lists its channels in the same view.
 */

const TEAMS_PURPLE = '#4B53BC';
const SLACK_AUBERGINE = '#4A154B';

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

// Provider-specific header marks (rendered, never recoloured). Declared as elements (not components)
// to keep one component per file, matching the original Teams panel.
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

const slackMark = (
	<svg width={18} height={18} viewBox='0 0 24 24' aria-hidden focusable='false'>
		<rect x='9' y='2.5' width='2.8' height='19' rx='1.4' fill='#36C5F0' />
		<rect x='12.2' y='2.5' width='2.8' height='19' rx='1.4' fill='#2EB67D' />
		<rect x='2.5' y='9' width='19' height='2.8' rx='1.4' fill='#ECB22E' />
		<rect x='2.5' y='12.2' width='19' height='2.8' rx='1.4' fill='#E01E5A' />
	</svg>
);

type PanelTheme = {
	/** The external provider whose channels this panel lists. */
	provider: ExternalProvider;
	headerBg: string;
	mark: ReactNode;
	defaultName: string;
};

/**
 * Map an OrgSwitcherRail selection id → the provider + theme. NOTE: the per-user Slack CONNECTOR uses
 * the selection id `slack-connector` (NOT `slack`) so it never collides with the legacy SlackBridge
 * workspace view, which still owns `selectedOrgId === 'slack'` (room-list filter + SlackWorkspaceBanner).
 */
const THEME_BY_SELECTION: Record<'teams' | 'slack-connector', PanelTheme> = {
	'teams': { provider: 'teams', headerBg: TEAMS_PURPLE, mark: teamsMark, defaultName: 'Microsoft Teams' },
	'slack-connector': { provider: 'slack', headerBg: SLACK_AUBERGINE, mark: slackMark, defaultName: 'Slack' },
};

const ExternalChannelsPanel = (): ReactElement | null => {
	const { t } = useTranslation();
	const { selectedOrgId, setSelectedOrgId } = useOrgSwitcherSelection();

	// Only the external-connector tiles open this panel; everything else (incl. 'current' and the
	// legacy SlackBridge 'slack' view) is a no-op.
	const theme = selectedOrgId === 'teams' || selectedOrgId === 'slack-connector' ? THEME_BY_SELECTION[selectedOrgId] : undefined;
	const isOpen = Boolean(theme);

	const provider = (theme?.provider ?? 'teams') as ExternalProvider;
	const { connectionFor } = useExternalWorkspaces();
	const connection = connectionFor(provider);
	const { groups, error, isLoading, refetch } = useExternalChannels(provider, connection?._id, isOpen);

	// No-op for the normal view / when nothing external is connected.
	if (!isOpen || !theme) {
		return null;
	}

	const channelCount = groups?.reduce((sum, g) => sum + g.channels.length, 0) ?? 0;
	const workspaceName = connection?.externalOrgName || theme.defaultName;

	return (
		<Box className={panelClass} role='region' aria-label={t('External_channels', { defaultValue: '{{name}} channels', name: workspaceName })}>
			<Box className={headerClass} style={{ background: theme.headerBg }}>
				{theme.mark}
				<Box is='span' fontWeight={700} fontSize={15}>
					{workspaceName}
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
							{t('Loading_your_channels', { defaultValue: 'Loading your channels…' })}
						</Box>
					</Box>
				)}

				{!isLoading && error && (
					<States>
						<StatesIcon name='warning' variation='danger' />
						<StatesTitle>{t('Couldnt_load_channels', { defaultValue: 'Couldn’t load your channels' })}</StatesTitle>
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
						<StatesIcon name='hash' />
						<StatesTitle>{t('No_channels_found', { defaultValue: 'No channels found' })}</StatesTitle>
						<StatesSubtitle>
							{t('No_channels_found_subtitle', {
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
							{t('External_channels_count', {
								defaultValue: '{{count}} channels across {{groups}} groups',
								count: channelCount,
								groups: groups?.length ?? 0,
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

export default memo(ExternalChannelsPanel);
