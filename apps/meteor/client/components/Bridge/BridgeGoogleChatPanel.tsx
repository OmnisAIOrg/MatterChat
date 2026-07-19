import React from 'react';
import { Box } from '@rocket.chat/fuselage';
import type { ReactNode } from 'react';

import './BridgeGoogleChatPanel.css';

type BridgeGoogleChatPanelProps = {
	/**
	 * Bridge identifier (e.g., "Google Chat (omnisai.io)")
	 */
	bridgeName?: string;
	/**
	 * List of channels/chats in the bridge
	 */
	children?: ReactNode;
	/**
	 * Whether panel is currently open
	 */
	isOpen?: boolean;
};

/**
 * Bridge Google Chat context panel component.
 * Displays the green bridge header and organized channel/chat/people lists.
 * Replaces the standard context panel with bridge-specific UI.
 *
 * Design: docs/design/premium-refresh/Bridge Google Chat.dc.html
 */
const BridgeGoogleChatPanel = ({
	bridgeName = 'Google Chat (omnisai.io)',
	children,
	isOpen = true,
}: BridgeGoogleChatPanelProps) => {
	if (!isOpen) {
		return null;
	}

	return (
		<div className="bridge-gchat-panel">
			{/* Header with bridge identity */}
			<div className="bridge-gchat-panel-header">
				<button className="bridge-gchat-panel-back" aria-label="Go back">
					<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
						<path d="M14 6 8 12l6 6" />
					</svg>
				</button>
				<span className="bridge-gchat-panel-icon">
					<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
						<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H9.5L4 20.5z" />
					</svg>
				</span>
				<span className="bridge-gchat-panel-name">{bridgeName}</span>
			</div>

			{/* Content area with scrollable list */}
			<div className="bridge-gchat-panel-content">
				{children}
			</div>

			{/* Footer branding */}
			<div className="bridge-gchat-panel-footer">
				<div className="bridge-gchat-wordmark">
					<span>Matter</span>
					<span>Chat</span>
				</div>
				<a href="#" className="bridge-gchat-footer-link">
					Powered by Omnis AI
				</a>
			</div>
		</div>
	);
};

export default BridgeGoogleChatPanel;
