import { css } from '@rocket.chat/css-in-js';
import { Box, Button, States, StatesActions, StatesIcon, StatesSubtitle, StatesTitle, Throbber } from '@rocket.chat/fuselage';
import {
	ContextualbarDialog,
	ContextualbarHeader,
	ContextualbarIcon,
	ContextualbarTitle,
	ContextualbarClose,
	ContextualbarContent,
} from '@rocket.chat/ui-client';
import { useTranslation } from 'react-i18next';

import type { CatchUpMessage } from './useCatchUp';

/**
 * MATTERCHAT: "Catch me up" (F4) in the channel header.
 *
 * The spec's phrasing is the design brief: a summary that is "a navigation surface rather than a
 * wall of text". So every row here is a jump — you read the line, you click it, you are at the
 * message in context. It is not trying to be the orb's prose answer; it is what you use when you
 * open a channel with 40 unread and want to know whether any of it needs you.
 *
 * Presentation only. Loading, authority and the permalinks all come from ./useCatchUp.
 */
export type CatchMeUpPanelProps = {
	label: string;
	messages: CatchUpMessage[];
	unread: number;
	omitted: number;
	loading: boolean;
	error: boolean;
	onRetry: () => void;
	onJump: (message: CatchUpMessage) => void;
	onClose: () => void;
};

/** Rows are buttons, so they have to carry the affordance a button normally brings with it. */
const clickableRow = css`
	border: none;
	cursor: pointer;
	&:hover,
	&:focus-visible {
		background-color: var(--rcx-color-surface-hover);
	}
`;

/** Three lines is enough to recognise a message; more and the list stops being scannable. */
const clampedText = css`
	display: -webkit-box;
	-webkit-line-clamp: 3;
	-webkit-box-orient: vertical;
	overflow: hidden;
	word-break: break-word;
`;

const time = (ts: string | Date): string => {
	const date = ts instanceof Date ? ts : new Date(ts);
	return Number.isNaN(date.getTime())
		? ''
		: date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const CatchMeUpPanel = ({ label, messages, unread, omitted, loading, error, onRetry, onJump, onClose }: CatchMeUpPanelProps) => {
	const { t } = useTranslation();

	return (
		<ContextualbarDialog>
			<ContextualbarHeader>
				<ContextualbarIcon name='clock' />
				<ContextualbarTitle>{t('Chi_Catch_Me_Up')}</ContextualbarTitle>
				<ContextualbarClose onClick={onClose} />
			</ContextualbarHeader>
			<ContextualbarContent paddingInline={0}>
				{loading && (
					<Box display='flex' justifyContent='center' padding={24}>
						<Throbber size='x12' />
					</Box>
				)}

				{!loading && error && (
					<States>
						<StatesIcon name='warning' variation='danger' />
						<StatesTitle>{t('Chi_Catch_Me_Up_Failed')}</StatesTitle>
						<StatesSubtitle>{t('Chi_Catch_Me_Up_Failed_Description')}</StatesSubtitle>
						<StatesActions>
							<Button onClick={onRetry}>{t('Retry')}</Button>
						</StatesActions>
					</States>
				)}

				{!loading && !error && messages.length === 0 && (
					<States>
						<StatesIcon name='checkmark-circled' variation='success' />
						<StatesTitle>{t('Chi_Catch_Me_Up_Nothing')}</StatesTitle>
						<StatesSubtitle>{t('Chi_Catch_Me_Up_Nothing_Description', { channel: label })}</StatesSubtitle>
					</States>
				)}

				{!loading && !error && messages.length > 0 && (
					<>
						<Box paddingInline={24} paddingBlock={12} color='hint' fontScale='c1'>
							{t('Chi_Catch_Me_Up_Summary', { count: unread || messages.length, channel: label })}
						</Box>
						{messages.map((message) => (
							<Box
								key={message.id}
								is='button'
								type='button'
								textAlign='start'
								width='100%'
								paddingInline={24}
								paddingBlock={8}
								backgroundColor='surface-light'
								className={clickableRow}
								onClick={() => onJump(message)}
							>
								<Box display='flex' alignItems='center' marginBlockEnd={2}>
									<Box fontScale='p2b' flexGrow={1} withTruncatedText>
										{message.username}
									</Box>
									<Box fontScale='c1' color='hint' flexShrink={0}>
										{time(message.ts)}
									</Box>
								</Box>
								{/* Plain text on purpose: this is a scan-and-jump list, and rendering markdown
								    here would give every row a different height and defeat that. */}
								<Box fontScale='p2' color='default' className={clampedText}>
									{message.text}
								</Box>
							</Box>
						))}
						{omitted > 0 && (
							<Box paddingInline={24} paddingBlock={12} color='hint' fontScale='c1'>
								{t('Chi_Catch_Me_Up_Omitted', { count: omitted })}
							</Box>
						)}
					</>
				)}
			</ContextualbarContent>
		</ContextualbarDialog>
	);
};

export default CatchMeUpPanel;
