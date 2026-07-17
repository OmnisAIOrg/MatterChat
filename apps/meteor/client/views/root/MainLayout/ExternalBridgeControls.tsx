import { css } from '@rocket.chat/css-in-js';
import { Box, Icon } from '@rocket.chat/fuselage';
import type { ExternalWorkspaceBridge } from '@rocket.chat/rest-typings';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * ExternalBridgeControls — the channel header's live-bridge cluster (own file per one-component-
 * per-file). Bridged → status badge (bright dot = inbound live via a webhook/shared subscription,
 * hollow dot = outbound-only) + Unbridge. Not bridged → the green "Bridge into MatterChat"
 * call-to-action. MatterChat brand green throughout — this is OUR action on an external surface,
 * so it never wears the provider's colour.
 */

// MatterChat brand green (same tokens as AppLeftRail).
const BRAND_GREEN = '#1B7A2E';
const BRAND_GREEN_BRIGHT = '#22B43F';

// Dense green-outline pill: the "Bridge into MatterChat" call-to-action (and its Unbridge
// counterpart). Native button so styling never depends on how css-in-js resolves on a fuselage
// Button variant we don't control.
const bridgeButtonClass = css`
	display: inline-flex;
	align-items: center;
	gap: 5px;
	height: 26px;
	padding: 0 10px;
	border: 1px solid ${BRAND_GREEN};
	border-radius: 999px;
	background: transparent;
	color: ${BRAND_GREEN};
	font-family: inherit;
	font-size: 12px;
	font-weight: 600;
	letter-spacing: 0.01em;
	cursor: pointer;
	white-space: nowrap;

	&:hover:not(:disabled) {
		background: ${BRAND_GREEN};
		color: #ffffff;
	}

	&:disabled {
		opacity: 0.55;
		cursor: default;
	}
`;

// Small live-status badge for a bridged channel: green-tinted pill + status dot. The dot is
// BRIGHT green when inbound is live (webhook/shared subscription), hollow when outbound-only.
const bridgedBadgeClass = css`
	display: inline-flex;
	align-items: center;
	gap: 6px;
	height: 26px;
	padding: 0 10px;
	border: 1px solid ${BRAND_GREEN};
	border-radius: 999px;
	background: rgba(27, 122, 46, 0.08); /* BRAND_GREEN @ 8% — quiet tint on any surface */
	color: ${BRAND_GREEN};
	font-size: 11px;
	font-weight: 700;
	letter-spacing: 0.02em;
	white-space: nowrap;
	user-select: none;
`;

const liveDotClass = css`
	width: 7px;
	height: 7px;
	border-radius: 50%;
	background: ${BRAND_GREEN_BRIGHT};
	flex-shrink: 0;
`;

const outboundDotClass = css`
	width: 7px;
	height: 7px;
	border-radius: 50%;
	border: 1.5px solid ${BRAND_GREEN};
	background: transparent;
	flex-shrink: 0;
`;

type ExternalBridgeControlsProps = {
	/** The bridge record for the open channel, when it is bridged (undefined = not bridged). */
	bridge: ExternalWorkspaceBridge | undefined;
	isBridging: boolean;
	isUnbridging: boolean;
	onBridge: () => void;
	onUnbridge: () => void;
};

const ExternalBridgeControls = ({ bridge, isBridging, isUnbridging, onBridge, onUnbridge }: ExternalBridgeControlsProps): ReactElement => {
	const { t } = useTranslation();

	if (!bridge) {
		return (
			// Box is='button' (the ExternalSidebar pattern) so the css-in-js class resolves natively.
			<Box
				is='button'
				type='button'
				className={bridgeButtonClass}
				disabled={isBridging}
				onClick={onBridge}
				title={t('External_bridge_title', {
					defaultValue: 'Mirror this channel into a MatterChat room — live inbound + outbound, recent history included',
				})}
			>
				<Icon name='link' size='x16' />
				{isBridging
					? t('External_bridging', { defaultValue: 'Bridging…' })
					: t('External_bridge_action', { defaultValue: 'Bridge into MatterChat' })}
			</Box>
		);
	}

	const inboundLive = bridge.realtime !== 'none';
	const badgeLabel = inboundLive
		? t('External_bridge_live', { defaultValue: 'Bridged · Live' })
		: t('External_bridge_outbound_only', { defaultValue: 'Bridged · Outbound' });
	const badgeTitle = inboundLive
		? t('External_bridge_live_title', { defaultValue: 'Bridged — messages mirror live between this channel and its MatterChat room.' })
		: t('External_bridge_outbound_only_title', {
				defaultValue: 'Bridged — messages you send here reach the workspace; live inbound is off on this deployment.',
			});

	return (
		<>
			<Box is='span' className={bridgedBadgeClass} title={badgeTitle}>
				<Box is='span' className={inboundLive ? liveDotClass : outboundDotClass} aria-hidden />
				{badgeLabel}
			</Box>
			<Box
				is='button'
				type='button'
				className={bridgeButtonClass}
				disabled={isUnbridging}
				onClick={onUnbridge}
				title={t('External_unbridge_title', { defaultValue: 'Stop mirroring this channel (the MatterChat room and its history stay)' })}
			>
				{isUnbridging ? t('Removing', { defaultValue: 'Removing…' }) : t('External_unbridge', { defaultValue: 'Unbridge' })}
			</Box>
		</>
	);
};

export default ExternalBridgeControls;
