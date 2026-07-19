import React from 'react';
import { Box, Button } from '@rocket.chat/fuselage';
import { LinkIcon } from '@rocket.chat/icons';
import { useTranslation } from 'react-i18next';

import './BridgeGoogleChatHeader.css';

type BridgeGoogleChatHeaderProps = {
	/**
	 * Google Chat user/space identifier
	 */
	identifier?: string;
	/**
	 * Bridge name identifier
	 */
	bridgeName?: string;
	/**
	 * Callback when "Bridge into MatterChat" button is clicked
	 */
	onBridgeClick?: () => void;
};

/**
 * Header component for bridged Google Chat conversations.
 * Displays the bridge identity badge and "Bridge into MatterChat" CTA.
 *
 * Design: docs/design/premium-refresh/Bridge Google Chat.dc.html
 */
const BridgeGoogleChatHeader = ({
	identifier = 'users/100965592610032797708',
	bridgeName = 'Google Chat (omnisai.io)',
	onBridgeClick,
}: BridgeGoogleChatHeaderProps) => {
	const { t } = useTranslation();

	return (
		<div className="bridge-gchat-header">
			{/* Left: Icon + Title */}
			<div className="bridge-gchat-header-left">
				<div className="bridge-gchat-header-icon">
					<svg
						width="15"
						height="15"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.8"
						strokeLinejoin="round"
					>
						<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H9.5L4 20.5z" />
					</svg>
				</div>
				<div className="bridge-gchat-header-titles">
					<div className="bridge-gchat-header-identifier">{identifier}</div>
					<div className="bridge-gchat-header-subtitle">
						{t('DirectMessage_BridgedConversation', {
							defaultValue: 'Direct message · bridged conversation',
						})}
					</div>
				</div>
			</div>

			{/* Center Spacer */}
			<div className="bridge-gchat-header-spacer" />

			{/* Right: Bridge CTA + Badge */}
			<div className="bridge-gchat-header-right">
				<Button
					className="bridge-gchat-header-bridge-btn"
					onClick={onBridgeClick}
					aria-label="Bridge into MatterChat"
				>
					<LinkIcon size="13" />
					{t('BridgeIntoMatterChat', { defaultValue: 'Bridge into MatterChat' })}
				</Button>
				<span className="bridge-gchat-header-badge">{bridgeName}</span>
			</div>
		</div>
	);
};

export default BridgeGoogleChatHeader;
