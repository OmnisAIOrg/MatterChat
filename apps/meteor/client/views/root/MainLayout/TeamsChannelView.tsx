import { css } from '@rocket.chat/css-in-js';
import {
	Box,
	Icon,
	Throbber,
	States,
	StatesIcon,
	StatesTitle,
	StatesSubtitle,
	StatesActions,
	StatesAction,
	Button,
} from '@rocket.chat/fuselage';
import type { CSSProperties, ChangeEvent, KeyboardEvent, ReactElement } from 'react';
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useOrgSwitcherSelection } from './OrgSwitcherContext';
import { useExternalWorkspaces } from './useExternalWorkspaces';
import { useTeamsMessages } from './useTeamsMessages';
import { useFormatDateAndTime } from '../../../../hooks/useFormatDateAndTime';
import { useFormatTime } from '../../../../hooks/useFormatTime';

/**
 * TeamsChannelView — the MAIN content for an open Teams channel.
 *
 * Renders ONLY while the connected Teams workspace is selected (selectedOrgId === 'teams'). When a
 * channel is open (selectedTeamsChannel set in the TeamsSidebar) it loads that channel's REAL
 * messages via `external-workspaces.messages` and shows them chat-style — author, text, time,
 * newest-AT-BOTTOM. A Throbber covers the load; a real Graph/auth error (e.g. the admin-consent 403)
 * shows the plain `{ message + status }` with Retry. A composer at the bottom posts AS the user via
 * `external-workspaces.sendMessage`, then refetches so the new message appears.
 *
 * With no channel open it shows a quiet "pick a channel" placeholder. Being "in Teams" is its own
 * mode: this is the whole main content, not an overlay over the MatterChat room.
 */

const TEAMS_PURPLE = '#4B53BC';

const rootClass = css`
	display: flex;
	flex-direction: column;
	height: 100%;
	width: 100%;
	background: var(--rcx-color-surface-room, #ffffff);
`;

const headerClass = css`
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 0 16px;
	height: 56px;
	flex-shrink: 0;
	border-block-end: 1px solid var(--rcx-color-stroke-extra-light, #e4e7ea);
`;

const messagesScrollClass = css`
	flex: 1;
	overflow-y: auto;
	display: flex;
	flex-direction: column;
	padding: 16px 24px 8px;
`;

// Pushes the message list to the BOTTOM of the scroll area when it's short (chat-like) while still
// scrolling correctly when it's tall — unlike justify-content:flex-end, which clips the top overflow.
const messagesInnerClass = css`
	margin-block-start: auto;
	display: flex;
	flex-direction: column;
`;

const messageRowClass = css`
	display: flex;
	gap: 10px;
	padding: 6px 0;
	align-items: flex-start;
`;

const avatarClass = css`
	flex-shrink: 0;
	width: 36px;
	height: 36px;
	border-radius: 4px;
	display: flex;
	align-items: center;
	justify-content: center;
	background: ${TEAMS_PURPLE};
	color: #ffffff;
	font-weight: 600;
	font-size: 15px;
	line-height: 1;
	user-select: none;
`;

const composerWrapClass = css`
	flex-shrink: 0;
	padding: 8px 16px 16px;
`;

const composerClass = css`
	display: flex;
	align-items: flex-end;
	gap: 8px;
	border: 1px solid var(--rcx-color-stroke-light, #cbced1);
	border-radius: 8px;
	padding: 8px 10px;
	background: var(--rcx-color-surface-light, #ffffff);

	&:focus-within {
		border-color: ${TEAMS_PURPLE};
	}
`;

// Inline style (not a css class) so it applies on a native <textarea> with zero dependence on how
// css-in-js resolves a class on a non-fuselage element. Placeholder colour is left to the browser.
const textareaStyle: CSSProperties = {
	flex: 1,
	border: 0,
	outline: 0,
	resize: 'none',
	background: 'transparent',
	fontFamily: 'inherit',
	fontSize: '14px',
	lineHeight: 1.4,
	maxHeight: '140px',
	color: 'var(--rcx-color-font-default, #2f343d)',
	width: '100%',
};

const sendErrorClass = css`
	margin-block-start: 6px;
	font-size: 12px;
	color: var(--rcx-color-status-font-on-danger, #c14444);
`;

const initialsOf = (name: string): string =>
	(name.trim().match(/\b\w/g) || ['?'])
		.slice(0, 2)
		.join('')
		.toUpperCase();

const TeamsChannelView = (): ReactElement => {
	const { t } = useTranslation();
	const formatTime = useFormatTime();
	const formatDateAndTime = useFormatDateAndTime();
	const { selectedTeamsChannel } = useOrgSwitcherSelection();
	const { teamsConnection } = useExternalWorkspaces();

	const connectionId = teamsConnection?._id;
	const channelExternalId = selectedTeamsChannel?.externalId;

	const { messages, error, isLoading, refetch, send, isSending, sendError } = useTeamsMessages(connectionId, channelExternalId);

	const [draft, setDraft] = useState('');
	const scrollRef = useRef<HTMLDivElement>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	// Reset the draft when switching channels so a half-typed message doesn't leak across channels.
	useEffect(() => {
		setDraft('');
	}, [channelExternalId]);

	// Provider returns newest-first; present newest-AT-BOTTOM. Keep the scroll pinned to the bottom as
	// messages arrive (load + after a send refetch), like a normal chat.
	const ordered = messages ? [...messages].reverse() : [];
	useLayoutEffect(() => {
		const el = scrollRef.current;
		if (el) {
			el.scrollTop = el.scrollHeight;
		}
	}, [messages]);

	const channelName = selectedTeamsChannel?.name ?? '';

	const handleSend = async (): Promise<void> => {
		const text = draft.trim();
		if (!text || isSending) {
			return;
		}
		try {
			await send(text);
			setDraft('');
			textareaRef.current?.focus();
		} catch {
			// The error is surfaced from the hook's sendError; keep the typed text so nothing is lost.
		}
	};

	const onComposerKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
		// Enter sends; Shift+Enter inserts a newline (the familiar chat composer behavior).
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			void handleSend();
		}
	};

	// No channel chosen yet — quiet placeholder inviting a pick from the Teams sidebar.
	if (!selectedTeamsChannel) {
		return (
			<Box className={rootClass} display='flex' alignItems='center' justifyContent='center'>
				<States>
					<StatesIcon name='team' />
					<StatesTitle>{t('Pick_a_Teams_channel', { defaultValue: 'Pick a channel' })}</StatesTitle>
					<StatesSubtitle>
						{t('Pick_a_Teams_channel_subtitle', { defaultValue: 'Choose a Teams channel on the left to read and post messages.' })}
					</StatesSubtitle>
				</States>
			</Box>
		);
	}

	return (
		<Box className={rootClass} role='main' aria-label={t('Teams_channel_X', { defaultValue: 'Teams channel {{name}}', name: channelName })}>
			<Box className={headerClass}>
				<Icon name={selectedTeamsChannel.isPrivate ? 'lock' : 'hash'} size='x20' color='hint' />
				<Box is='span' fontWeight={700} fontSize={16} withTruncatedText>
					{channelName}
				</Box>
				<Box is='span' color='hint' fontSize={13} withTruncatedText flexShrink={1}>
					{selectedTeamsChannel.teamName}
				</Box>
				<Box marginInlineStart='auto' display='flex' alignItems='center'>
					{/* The purple Teams chip keeps the context unmistakably "in Teams". */}
					<Box
						is='span'
						fontSize={11}
						fontWeight={600}
						color='#ffffff'
						className={css`
							background: ${TEAMS_PURPLE};
							padding: 3px 8px;
							border-radius: 999px;
							letter-spacing: 0.02em;
						`}
					>
						{t('Microsoft_Teams', { defaultValue: 'Microsoft Teams' })}
					</Box>
				</Box>
			</Box>

			<Box ref={scrollRef} className={messagesScrollClass}>
				{isLoading && (
					<Box display='flex' flexDirection='column' alignItems='center' justifyContent='center' flexGrow={1}>
						<Throbber />
						<Box mbs={12} color='hint' fontSize={13}>
							{t('Loading_messages', { defaultValue: 'Loading messages…' })}
						</Box>
					</Box>
				)}

				{!isLoading && error && (
					<Box display='flex' flexDirection='column' alignItems='center' justifyContent='center' flexGrow={1}>
						<States>
							<StatesIcon name='warning' variation='danger' />
							<StatesTitle>{t('Couldnt_load_messages', { defaultValue: 'Couldn’t load these messages' })}</StatesTitle>
							{/* The REAL provider/auth message, plainly — admin-consent 403 included. */}
							<StatesSubtitle>
								{error.message}
								{error.status ? ` (${error.status})` : ''}
							</StatesSubtitle>
							<StatesActions>
								<StatesAction onClick={refetch}>{t('Retry', { defaultValue: 'Retry' })}</StatesAction>
							</StatesActions>
						</States>
					</Box>
				)}

				{!isLoading && !error && ordered.length === 0 && (
					<Box display='flex' flexDirection='column' alignItems='center' justifyContent='center' flexGrow={1} color='hint'>
						<Icon name='balloon' size='x32' mbe={8} />
						<Box fontSize={14}>{t('No_messages_yet', { defaultValue: 'No messages yet — say hello.' })}</Box>
					</Box>
				)}

				{!isLoading && !error && ordered.length > 0 && (
					<Box className={messagesInnerClass}>
						{ordered.map((message) => (
							<Box key={message.externalId} className={messageRowClass}>
								<Box className={avatarClass} aria-hidden>
									{initialsOf(message.author || '?')}
								</Box>
								<Box flexGrow={1} minWidth={0}>
									<Box display='flex' alignItems='baseline' style={{ gap: '8px' }}>
										<Box is='span' fontWeight={700} fontSize={14} color='default' withTruncatedText>
											{message.author || t('Unknown', { defaultValue: 'Unknown' })}
										</Box>
										<Box is='span' fontSize={11} color='hint' title={formatDateAndTime(message.createdAt)} flexShrink={0}>
											{formatTime(message.createdAt)}
										</Box>
									</Box>
									<Box fontSize={14} color='default' style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
										{message.text}
									</Box>
								</Box>
							</Box>
						))}
					</Box>
				)}
			</Box>

			<Box className={composerWrapClass}>
				<Box className={composerClass}>
					{/* Native textarea so the ref + change/keydown events type to HTMLTextAreaElement and the
					    styling never depends on css-in-js class resolution on a non-fuselage element. */}
					<textarea
						ref={textareaRef}
						style={textareaStyle}
						rows={1}
						value={draft}
						placeholder={t('Message_channel', { defaultValue: 'Message #{{name}}', name: channelName })}
						aria-label={t('Message_channel', { defaultValue: 'Message #{{name}}', name: channelName })}
						disabled={isSending}
						onChange={(e: ChangeEvent<HTMLTextAreaElement>): void => setDraft(e.target.value)}
						onKeyDown={onComposerKeyDown}
					/>
					<Button
						small
						primary
						loading={isSending}
						disabled={!draft.trim() || isSending}
						onClick={(): void => {
							void handleSend();
						}}
						title={t('Send', { defaultValue: 'Send' })}
					>
						<Icon name='send' size='x18' />
					</Button>
				</Box>
				{sendError && (
					<Box className={sendErrorClass}>
						{t('Couldnt_send', { defaultValue: 'Couldn’t send' })}: {sendError.message}
						{sendError.status ? ` (${sendError.status})` : ''}
					</Box>
				)}
			</Box>
		</Box>
	);
};

export default memo(TeamsChannelView);
