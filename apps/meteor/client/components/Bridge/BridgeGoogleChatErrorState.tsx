import { Box, Button } from '@rocket.chat/fuselage';
import { useTranslation } from 'react-i18next';
import { AlertTriangleIcon } from '@rocket.chat/icons';
import type { ReactNode } from 'react';
import React from 'react';

import './BridgeGoogleChatErrorState.css';

type BridgeGoogleChatErrorStateProps = {
	onRetry?: () => void;
	onViewLogs?: () => void;
	errorMessage?: string;
	attemptCount?: number;
	maxAttempts?: number;
	autoRetrySeconds?: number;
};

/**
 * Premium error state for Google Chat bridge connection errors.
 * Displays when the bridge fails to load messages with retry/recovery options.
 *
 * Design: docs/design/premium-refresh/Bridge Google Chat.dc.html
 */
const BridgeGoogleChatErrorState = ({
	onRetry,
	onViewLogs,
	errorMessage = "Unexpected token '<', \"<h1>Not Fo\"… is not valid JSON",
	attemptCount = 2,
	maxAttempts = 5,
	autoRetrySeconds = 30,
}: BridgeGoogleChatErrorStateProps) => {
	const { t } = useTranslation();

	return (
		<Box
			display="flex"
			height="100%"
			flexDirection="column"
			justifyContent="center"
			alignItems="center"
			padding={30}
			className="bridge-gchat-error-state"
		>
			<Box
				maxWidth={420}
				textAlign="center"
				className="bridge-gchat-error-container"
				animation="mcFadeUp"
			>
				{/* Icon Tile */}
				<Box
					width={52}
					height={52}
					margin="0 auto"
					borderRadius="15px"
					backgroundColor="var(--redSoft)"
					border="1px solid var(--redLine)"
					display="flex"
					justifyContent="center"
					alignItems="center"
					color="var(--red)"
					className="bridge-gchat-error-icon"
				>
					<AlertTriangleIcon size={23} />
				</Box>

				{/* Title */}
				<Box
					marginTop={16}
					fontSize={17}
					fontWeight={650}
					letterSpacing="-0.01em"
					color="var(--ink)"
					className="bridge-gchat-error-title"
				>
					{t('Bridge_CouldntLoadMessages', { defaultValue: "Couldn't load these messages" })}
				</Box>

				{/* Description */}
				<Box
					marginTop={6}
					fontSize={13}
					color="var(--ink2)"
					lineHeight="1.55"
					className="bridge-gchat-error-description"
				>
					{t('Bridge_GoogleChatErrorDescription', {
						defaultValue: 'The Google Chat bridge returned an unexpected response. This usually resolves on retry.',
					})}
				</Box>

				{/* Error Code Chip */}
				<Box
					marginTop={12}
					display="inline-flex"
					alignItems="center"
					justifyContent="center"
					fontSize={11}
					color="var(--ink2)"
					padding="8px 13px"
					borderRadius="9px"
					backgroundColor="var(--surface2)"
					border="1px solid var(--border)"
					maxWidth="100%"
					overflow="hidden"
					textOverflow="ellipsis"
					whiteSpace="nowrap"
					className="bridge-gchat-error-code"
					fontFamily="'Geist Mono', monospace"
				>
					{errorMessage}
				</Box>

				{/* Action Buttons */}
				<Box
					marginTop={16}
					display="flex"
					justifyContent="center"
					gap={9}
					className="bridge-gchat-error-actions"
				>
					<Button
						primary
						height={33}
						padding="0 17px"
						borderRadius="9px"
						onClick={onRetry}
						className="bridge-gchat-retry-btn"
					>
						{t('Retry', { defaultValue: 'Retry' })}
					</Button>
					<Button
						secondary
						height={33}
						padding="0 15px"
						borderRadius="9px"
						onClick={onViewLogs}
						className="bridge-gchat-logs-btn"
					>
						{t('Bridge_ViewLogs', { defaultValue: 'View bridge logs' })}
					</Button>
				</Box>

				{/* Auto-retry Note */}
				<Box
					marginTop={12}
					fontSize="11.5px"
					color="var(--ink3)"
					className="bridge-gchat-error-note"
				>
					{t('Bridge_AutoRetryingNote', {
						defaultValue: `Auto-retrying in ${autoRetrySeconds}s · attempt ${attemptCount} of ${maxAttempts}`,
						args: { seconds: autoRetrySeconds, attempt: attemptCount, max: maxAttempts },
					})}
				</Box>
			</Box>
		</Box>
	);
};

export default BridgeGoogleChatErrorState;
