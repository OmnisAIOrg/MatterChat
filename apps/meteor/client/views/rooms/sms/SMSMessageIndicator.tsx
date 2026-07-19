/**
 * SMS Message Indicator — visual component to show that a message came from SMS.
 *
 * Displayed on room messages that were synced from CasePro SMS threads.
 * Shows the SMS status, sender, and provider reference (if available).
 *
 * Design: uses premium tokens
 * - Mono uppercase label (10px, letter-spacing .12em)
 * - Status colors: green for delivered, amber for pending, red for failed
 */

import React from 'react';
import { Chip, Icon, Box } from '@rocket.chat/fuselage';
import type { ISMSMessage } from '@rocket.chat/core-typings';

interface SMSMessageIndicatorProps {
	sms: ISMSMessage;
	sender?: string;
}

const statusColors: Record<string, string> = {
	pending: '#A97A18', // warning
	delivered: '#17804D', // primary green
	failed: '#CF4438', // danger
	read: '#3C6EB4', // info
	default: '#57615B', // secondary ink
};

const styles = {
	container: {
		display: 'flex',
		alignItems: 'center',
		gap: '8px',
		padding: '4px 8px',
		backgroundColor: 'rgba(23, 128, 77, 0.08)', // primary tint
		borderRadius: '7px',
		marginTop: '4px',
	},
	label: {
		fontSize: '10px',
		fontWeight: '600',
		fontFamily: 'Geist Mono, monospace',
		textTransform: 'uppercase' as const,
		letterSpacing: '0.12em',
		color: 'var(--ink)',
	} as React.CSSProperties,
	badge: {
		display: 'inline-flex',
		alignItems: 'center',
		gap: '4px',
		padding: '2px 6px',
		borderRadius: '999px',
		fontSize: '10px',
		fontWeight: '500',
		fontFamily: 'Geist Mono, monospace',
	} as React.CSSProperties,
};

export const SMSMessageIndicator: React.FC<SMSMessageIndicatorProps> = ({ sms, sender }) => {
	const status = sms.caseProStatus || 'default';
	const statusColor = statusColors[status] || statusColors.default;

	return (
		<Box style={styles.container}>
			<span style={styles.label}>SMS</span>
			{sender && <span style={styles.label}>{sender}</span>}
			<Chip
				style={{
					...styles.badge,
					backgroundColor: statusColor,
					color: '#FFFFFF',
				}}
				size="small"
			>
				{status.charAt(0).toUpperCase() + status.slice(1)}
			</Chip>
			{sms.externalMessageId && (
				<span
					style={{
						...styles.label,
						fontSize: '9px',
						color: 'var(--ink3)',
					}}
					title={sms.externalMessageId}
				>
					ID: {sms.externalMessageId.slice(0, 8)}
				</span>
			)}
		</Box>
	);
};
