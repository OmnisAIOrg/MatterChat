import React from 'react';
import { Box } from '@rocket.chat/fuselage';

import './BridgeGoogleChatComposerVariant.css';

type BridgeGoogleChatComposerVariantProps = {
	/**
	 * The chat identifier/name to display in placeholder
	 */
	identifier?: string;
	/**
	 * Bridge type for the badge
	 */
	bridgeType?: 'google-chat' | 'teams';
	/**
	 * Callback when send button is clicked
	 */
	onSend?: (message: string) => void;
};

/**
 * Bridge-aware composer variant for Google Chat conversations.
 * Shows the bridge identity badge and supports sending messages to the bridge.
 *
 * Design: docs/design/premium-refresh/Bridge Google Chat.dc.html
 */
const BridgeGoogleChatComposerVariant = ({
	identifier = 'users/100965592610032797708',
	bridgeType = 'google-chat',
}: BridgeGoogleChatComposerVariantProps) => {
	const badgeLabel = bridgeType === 'google-chat' ? 'VIA GOOGLE CHAT' : 'VIA TEAMS';

	return (
		<div className="bridge-gchat-composer">
			<div className="bridge-gchat-composer-inner">
				<div className="bridge-gchat-composer-input-group">
					<span className="bridge-gchat-composer-placeholder">Message {identifier}</span>
					<span className="bridge-gchat-composer-badge">{badgeLabel}</span>
					<button className="bridge-gchat-composer-send" aria-label="Send message">
						<svg
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.9"
							strokeLinecap="round"
							strokeLinejoin="round"
						>
							<path d="M21 3 10 14M21 3l-7 18-4-7-7-4z" />
						</svg>
					</button>
				</div>
			</div>
		</div>
	);
};

export default BridgeGoogleChatComposerVariant;
