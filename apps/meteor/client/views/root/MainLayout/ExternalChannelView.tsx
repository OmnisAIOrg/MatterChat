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

import ExternalBridgeControls from './ExternalBridgeControls';
import { externalConnectionIdFromSelection, useOrgSwitcherSelection } from './OrgSwitcherContext';
import { externalProviderBranding } from './externalProviders';
import { useExternalBridges } from './useExternalBridges';
import { useExternalMessages } from './useExternalMessages';
import { useExternalWorkspaces } from './useExternalWorkspaces';
import { useFormatDateAndTime } from '../../../hooks/useFormatDateAndTime';
import { useFormatTime } from '../../../hooks/useFormatTime';

/**
 * ExternalChannelView — the MAIN content for an open external channel/space.
 *
 * Provider-agnostic (Teams channel OR Google Chat space). Renders ONLY while a connected external
 * workspace is selected (selectedOrgId === `ext:<connectionId>`). When a channel is open
 * (selectedExternalChannel set in the ExternalSidebar) it loads that channel's REAL messages via
 * `external-workspaces.messages` and shows them chat-style — author, text, time, newest-AT-BOTTOM. A
 * Throbber covers the load; a real provider/auth error (e.g. an admin-consent 403) shows the plain
 * `{ message + status }` with Retry. A composer at the bottom posts AS the user via
 * `external-workspaces.sendMessage`, then refetches so the new message appears. The avatar colour +
 * the context chip come from the SELECTED connection's provider branding (purple Teams, green Google
 * Chat), so this never hardcodes a single provider.
 *
 * With no channel open it shows a quiet "pick a channel" placeholder. Being "in a workspace" is its
 * own mode: this is the whole main content, not an overlay over the MatterChat room.
 *
 * Crash-safety:
 *  - The two hooks that read `client/hooks/*` are imported from `../../../hooks/...` (THREE levels:
 *    MainLayout -> root -> views -> client). The earlier crash was a four-level path resolving to a
 *    non-existent `apps/meteor/hooks/*` module, whose `undefined` export threw when called.
 *  - EVERY hook (translation, formatters, selection, workspaces, messages, the local state hooks)
 *    runs UNCONDITIONALLY and in a stable order BEFORE the only early return, so hook order can never
 *    change between renders.
 *  - Every `selectedExternalChannel` / `connection` / `messages` access is optional-chained or
 *    null-guarded — nothing is dereferenced blindly; `externalProviderBranding` falls back for an
 *    unknown provider.
 */

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

const composerWrapClass = css`
	flex-shrink: 0;
	padding: 8px 16px 16px;
`;

const sendErrorClass = css`
	margin-block-start: 6px;
	font-size: 12px;
	color: var(--rcx-color-status-font-on-danger, #c14444);
`;

// Thin ride-along error line under the header for a failed bridge/unbridge (real message, dense).
const bridgeErrorClass = css`
	flex-shrink: 0;
	padding: 4px 16px;
	font-size: 12px;
	color: var(--rcx-color-status-font-on-danger, #c14444);
	border-block-end: 1px solid var(--rcx-color-stroke-extra-light, #e4e7ea);
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

const initialsOf = (name: string): string => (name.trim().match(/\b\w/g) || ['?']).slice(0, 2).join('').toUpperCase();

// Plain string builder for an envelope error (helper, not component code — keeps the render lean).
const formatEnvelopeError = (e: { message: string; status?: number }): string => `${e.message}${e.status ? ` (${e.status})` : ''}`;

const ExternalChannelView = (): ReactElement => {
	const { t } = useTranslation();
	const rawFormatTime = useFormatTime();
	const rawFormatDateAndTime = useFormatDateAndTime();
	// Crash-safe formatters: date-fns THROWS on an invalid date, and one malformed provider
	// timestamp must degrade to blank text — never crash the whole workspace view (that is
	// exactly what happened when Slack's seconds.micros ts reached the formatter).
	const formatTime = (value: unknown): string => {
		try {
			return rawFormatTime(value as never);
		} catch {
			return '';
		}
	};
	const formatDateAndTime = (value: unknown): string => {
		try {
			return rawFormatDateAndTime(value as never);
		} catch {
			return '';
		}
	};
	const { selectedOrgId, selectedExternalChannel } = useOrgSwitcherSelection();
	const { getConnectionById } = useExternalWorkspaces();

	const connection = getConnectionById(externalConnectionIdFromSelection(selectedOrgId));
	const branding = externalProviderBranding(connection?.provider);
	const providerName = connection?.externalOrgName || branding.defaultName;

	const connectionId = connection?._id;
	const channelExternalId = selectedExternalChannel?.externalId;

	const { messages, error, isLoading, refetch, send, isSending, sendError } = useExternalMessages(connectionId, channelExternalId);
	// Live-bridge state + actions for THIS channel (the UI over external-workspaces.bridgeChannel /
	// unbridgeChannel / bridges). Runs unconditionally — same hook-order discipline as messages.
	const {
		bridge,
		bridgeNow,
		unbridgeNow,
		isBridging,
		isUnbridging,
		actionError: bridgeError,
	} = useExternalBridges(connectionId, channelExternalId);

	const [draft, setDraft] = useState('');
	const scrollRef = useRef<HTMLDivElement>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	// Reset the draft when switching channels so a half-typed message doesn't leak across channels.
	useEffect(() => {
		setDraft('');
	}, [channelExternalId]);

	// Provider returns newest-first; present newest-AT-BOTTOM. Defensive: only reverse a real array.
	const ordered = Array.isArray(messages) ? [...messages].reverse() : [];

	// Keep the scroll pinned to the bottom as messages arrive (load + after a send refetch), like a
	// normal chat. Runs unconditionally; the ref is simply null when no channel is open.
	useLayoutEffect(() => {
		const el = scrollRef.current;
		if (el) {
			el.scrollTop = el.scrollHeight;
		}
	}, [messages]);

	const channelName = selectedExternalChannel?.name ?? '';
	// A channel reads with a leading #; a chat/DM is a person/group, so no hash. Drives both the header
	// icon and the composer placeholder (provider-agnostic — just a render hint, never a data branch).
	const isDirect = selectedExternalChannel?.kind === 'chat' || selectedExternalChannel?.kind === 'dm';
	const headerIcon = isDirect ? 'balloons' : selectedExternalChannel?.isPrivate ? 'lock' : 'hash';
	const composerPlaceholder = isDirect
		? t('Message_person', { defaultValue: 'Message {{name}}', name: channelName })
		: t('Message_channel', { defaultValue: 'Message #{{name}}', name: channelName });

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

	// Provider-coloured avatar + composer focus (kept inline so they track the brand colour).
	const avatarClass = css`
		flex-shrink: 0;
		width: 36px;
		height: 36px;
		border-radius: 4px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: ${branding.color};
		color: #ffffff;
		font-weight: 600;
		font-size: 15px;
		line-height: 1;
		user-select: none;
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
			border-color: ${branding.color};
		}
	`;

	// No channel chosen yet — quiet placeholder inviting a pick from the sidebar. This is the ONLY
	// early return, and it comes AFTER every hook above, so hook order is always stable.
	if (!selectedExternalChannel) {
		return (
			<Box className={rootClass} display='flex' alignItems='center' justifyContent='center'>
				<States>
					<StatesIcon name='team' />
					<StatesTitle>{t('Pick_a_channel', { defaultValue: 'Pick a channel' })}</StatesTitle>
					<StatesSubtitle>
						{t('Pick_a_channel_subtitle', { defaultValue: 'Choose a channel on the left to read and post messages.' })}
					</StatesSubtitle>
				</States>
			</Box>
		);
	}

	return (
		<Box className={rootClass} role='main' aria-label={t('External_channel_X', { defaultValue: '{{name}} channel', name: channelName })}>
			<Box className={headerClass}>
				<Icon name={headerIcon} size='x20' color='hint' />
				<Box is='span' fontWeight={700} fontSize={16} withTruncatedText>
					{channelName}
				</Box>
				<Box is='span' color='hint' fontSize={13} withTruncatedText flexShrink={1}>
					{selectedExternalChannel.teamName}
				</Box>
				<Box marginInlineStart='auto' display='flex' alignItems='center' style={{ gap: '8px' }}>
					{/* Live-bridge controls: mirror this external channel into a MatterChat room (and back). */}
					<ExternalBridgeControls
						bridge={bridge}
						isBridging={isBridging}
						isUnbridging={isUnbridging}
						onBridge={(): void => {
							void bridgeNow(channelName || undefined);
						}}
						onUnbridge={(): void => {
							void unbridgeNow();
						}}
					/>
					{/* The provider-coloured chip keeps the context unmistakably "in this workspace". */}
					<Box
						is='span'
						fontSize={11}
						fontWeight={600}
						color='#ffffff'
						className={css`
							background: ${branding.color};
							padding: 3px 8px;
							border-radius: 999px;
							letter-spacing: 0.02em;
						`}
					>
						{providerName}
					</Box>
				</Box>
			</Box>

			{/* A failed bridge/unbridge rides its REAL provider/auth message here, plainly (dense line,
			    not a modal) — same "never swallow the message" discipline as the messages error state. */}
			{bridgeError && (
				<Box className={bridgeErrorClass}>
					{t('External_bridge_failed', { defaultValue: 'Couldn’t update the bridge' })}: {formatEnvelopeError(bridgeError)}
				</Box>
			)}

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
						placeholder={composerPlaceholder}
						aria-label={composerPlaceholder}
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

export default memo(ExternalChannelView);
