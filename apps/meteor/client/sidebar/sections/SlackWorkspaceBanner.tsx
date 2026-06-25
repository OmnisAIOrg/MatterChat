import { css } from '@rocket.chat/css-in-js';
import { Box, Icon } from '@rocket.chat/fuselage';
import type { ReactElement } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useOrgSwitcherSelection } from '../../views/root/MainLayout/OrgSwitcherContext';

/**
 * SlackWorkspaceBanner — the header that frames the "Slack workspace view".
 *
 * When the connected-Slack tile is selected in the OrgSwitcherRail, the room list is filtered to
 * the firm's BRIDGED Slack channels (rooms carrying Slack `importIds` — see useRoomList). On its own
 * the filtered list looks like a normal — but mysteriously short — room list, with no signal that
 * you've hopped into Slack and no obvious way out. This banner sits at the top of the sidebar to:
 *   • label the view ("Slack workspace", with the Slack mark) so the context is unmistakable, and
 *   • give a single, always-visible "Back to MatterChat" control that returns the rail to 'current'.
 *
 * It renders NOTHING unless the Slack tile is selected, so it is a pure no-op for the normal view
 * and when no Slack is connected (the tile never appears, so it can never be selected).
 */

const SLACK_AUBERGINE = '#4A154B';

const bannerClass = css`
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 8px 12px;
	background: ${SLACK_AUBERGINE};
	color: #ffffff;
`;

const backClass = css`
	margin-inline-start: auto;
	display: flex;
	align-items: center;
	gap: 4px;
	border: 0;
	border-radius: 6px;
	padding: 4px 8px;
	background: rgba(255, 255, 255, 0.14);
	color: #ffffff;
	font-family: inherit;
	font-size: 12px;
	font-weight: 600;
	line-height: 1;
	cursor: pointer;
	white-space: nowrap;

	&:hover {
		background: rgba(255, 255, 255, 0.24);
	}

	&:focus-visible {
		outline: 2px solid #ffffff;
		outline-offset: 1px;
	}
`;

// The Slack 4-colour mark, as a plain element (not a component) so this file declares exactly one
// React component. Mirrors the mark used on the Slack tile in OrgSwitcherRail.
const slackMark = (
	<svg width={16} height={16} viewBox='0 0 24 24' aria-hidden focusable='false'>
		<rect x='9' y='2.5' width='2.8' height='19' rx='1.4' fill='#36C5F0' />
		<rect x='12.2' y='2.5' width='2.8' height='19' rx='1.4' fill='#2EB67D' />
		<rect x='2.5' y='9' width='19' height='2.8' rx='1.4' fill='#ECB22E' />
		<rect x='2.5' y='12.2' width='19' height='2.8' rx='1.4' fill='#E01E5A' />
	</svg>
);

const SlackWorkspaceBanner = (): ReactElement | null => {
	const { t } = useTranslation();
	const { selectedOrgId, setSelectedOrgId } = useOrgSwitcherSelection();

	if (selectedOrgId !== 'slack') {
		return null;
	}

	return (
		<Box className={bannerClass} role='status'>
			{slackMark}
			<Box is='span' fontWeight={600} fontSize={13}>
				{t('Slack_workspace', { defaultValue: 'Slack workspace' })}
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
	);
};

export default memo(SlackWorkspaceBanner);
