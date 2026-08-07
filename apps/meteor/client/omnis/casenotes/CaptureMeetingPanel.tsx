import { Box, Button, ButtonGroup, Callout, Field, FieldLabel, FieldRow, Select, Tabs, TabsItem, TextInput } from '@rocket.chat/fuselage';
import {
	ContextualbarClose,
	ContextualbarContent,
	ContextualbarDialog,
	ContextualbarFooter,
	ContextualbarHeader,
	ContextualbarIcon,
	ContextualbarTitle,
} from '@rocket.chat/ui-client';
import { useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import { useQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useOpenedRoom } from '../../lib/RoomManager';
import MatterContextField from '../shell/MatterContextField';
import { omnisGet, omnisPost } from '../shell/omnisRest';
import { useMatterContext } from '../shell/useMatterContext';

/**
 * Send the notetaker to a meeting, or record one in person.
 *
 * Two tabs, one destination logic. The bot tab is the ambitious half: **the
 * meeting does not have to be a MatterChat huddle**, which is what makes
 * MatterChat the control surface for meeting capture rather than one more app
 * that records only its own calls.
 *
 * ## The consent block is shown, not assumed
 *
 * The panel displays the exact disclosure the bot will announce and the name it
 * will appear under, before anything starts. A consent notice the dispatcher
 * never sees is not meaningfully a consent notice, and this is a law firm in a
 * jurisdiction-dependent area.
 *
 * It also warns, up front, when the chosen meeting type is work product and the
 * current channel is client-facing: the summary will be filed to the matter but
 * NOT posted here. Saying so beforehand is the difference between a deliberate
 * safeguard and a summary that mysteriously never arrives.
 */

type MeetingKind = 'client-check-in' | 'provider-call' | 'defense-counsel-call' | 'internal-strategy' | 'dictated-memo' | 'site-visit';

type ConsentInfo = { botDisplayName: string; disclosure: string; postingBlocked: boolean };

const CaptureMeetingPanel = ({ onClose, onStarted }: { onClose(): void; onStarted(): void }): ReactElement => {
	const { t } = useTranslation();
	const dispatchToast = useToastMessageDispatch();
	const roomId = useOpenedRoom();
	const matterContext = useMatterContext();

	const [tab, setTab] = useState<'bot' | 'record'>('bot');
	const [meetingUrl, setMeetingUrl] = useState('');
	const [kind, setKind] = useState<MeetingKind>('client-check-in');
	const [busy, setBusy] = useState(false);

	const { data: consent } = useQuery<ConsentInfo>({
		queryKey: ['omnis', 'casenotes', 'consent', kind, roomId ?? ''],
		queryFn: () => omnisGet<ConsentInfo>('/v1/casenotes.consent', { kind, ...(roomId ? { roomId } : {}) }),
		staleTime: 60_000,
	});

	const destination = matterContext.destination;

	const onStart = useCallback(() => {
		void (async () => {
			setBusy(true);
			try {
				const matterId = destination?.kind === 'matter' ? destination.matter.matterId : undefined;
				if (tab === 'bot') {
					await omnisPost('/v1/casenotes.dispatchBot', {
						meetingUrl,
						kind,
						...(matterId ? { matterId } : {}),
						...(roomId ? { roomId } : {}),
					});
					dispatchToast({ type: 'success', message: t('CaseNotes_Bot_dispatched') });
				} else {
					await omnisPost('/v1/casenotes.startRecording', {
						kind,
						...(matterId ? { matterId } : {}),
						...(roomId ? { roomId } : {}),
					});
					dispatchToast({ type: 'success', message: t('CaseNotes_Recording_started') });
				}
				onStarted();
			} catch (error) {
				dispatchToast({ type: 'error', message: error instanceof Error ? error.message : t('CaseNotes_Start_failed') });
			} finally {
				setBusy(false);
			}
		})();
	}, [destination, dispatchToast, kind, meetingUrl, onStarted, roomId, t, tab]);

	const botKinds: [MeetingKind, string][] = [
		['client-check-in', t('CaseNotes_Kind_client_check_in')],
		['provider-call', t('CaseNotes_Kind_provider_call')],
		['defense-counsel-call', t('CaseNotes_Kind_defense_counsel')],
		['internal-strategy', t('CaseNotes_Kind_internal_strategy')],
	];

	const recordKinds: [MeetingKind, string][] = [
		['client-check-in', t('CaseNotes_Kind_client_meeting')],
		['provider-call', t('CaseNotes_Kind_provider_call')],
		['dictated-memo', t('CaseNotes_Kind_dictated_memo')],
		['site-visit', t('CaseNotes_Kind_site_visit')],
	];

	const canStart = Boolean(destination) && (tab === 'record' || meetingUrl.trim().length > 0);

	return (
		<ContextualbarDialog onClose={onClose}>
			<ContextualbarHeader>
				<ContextualbarIcon name='headset' />
				<ContextualbarTitle>{t('CaseNotes_Capture_a_meeting')}</ContextualbarTitle>
				<ContextualbarClose onClick={onClose} />
			</ContextualbarHeader>

			<ContextualbarContent paddingInline={16} paddingBlock={16}>
				<Tabs marginBlockEnd={16}>
					<TabsItem selected={tab === 'bot'} onClick={() => setTab('bot')}>
						{t('CaseNotes_Send_bot')}
					</TabsItem>
					<TabsItem selected={tab === 'record'} onClick={() => setTab('record')}>
						{t('CaseNotes_Record')}
					</TabsItem>
				</Tabs>

				{tab === 'bot' && (
					<Field marginBlockEnd={16}>
						<FieldLabel>{t('CaseNotes_Meeting_link')}</FieldLabel>
						<FieldRow>
							<TextInput
								value={meetingUrl}
								placeholder={t('CaseNotes_Meeting_link_placeholder')}
								onChange={(e) => setMeetingUrl((e.target as HTMLInputElement).value)}
							/>
						</FieldRow>
						<Box fontScale='micro' color='annotation' marginBlockStart={4}>
							{t('CaseNotes_Any_meeting_hint')}
						</Box>
					</Field>
				)}

				<Field marginBlockEnd={16}>
					<FieldLabel>{tab === 'bot' ? t('CaseNotes_File_notes_to') : t('CaseNotes_File_recording_to')}</FieldLabel>
					<MatterContextField context={matterContext} personalLabel={t('CaseNotes_Just_me')} personalHint={t('CaseNotes_Just_me_hint')} />
				</Field>

				<Field marginBlockEnd={16}>
					<FieldLabel>{tab === 'bot' ? t('CaseNotes_Meeting_type') : t('CaseNotes_What_is_this')}</FieldLabel>
					<FieldRow>
						<Select
							value={kind}
							onChange={(value) => setKind(value as MeetingKind)}
							options={tab === 'bot' ? botKinds : recordKinds}
						/>
					</FieldRow>
				</Field>

				{/* Consent — shown before anything records. */}
				{consent && (
					<Callout type='info' title={t('CaseNotes_Consent_title')}>
						<Box>
							{tab === 'bot'
								? t('CaseNotes_Consent_bot', { name: consent.botDisplayName })
								: t('CaseNotes_Consent_in_person')}
						</Box>
						<Box marginBlockStart={6} fontScale='c1'>
							“{consent.disclosure}”
						</Box>
						<Box marginBlockStart={6} fontScale='micro' color='annotation'>
							{t('CaseNotes_Consent_stop_control')}
						</Box>
					</Callout>
				)}

				{/* Work product in a client-facing channel: say so BEFORE, not after. */}
				{consent?.postingBlocked && (
					<Callout type='warning' marginBlockStart={12} title={t('CaseNotes_Work_product_title')}>
						{t('CaseNotes_Work_product_body')}
					</Callout>
				)}
			</ContextualbarContent>

			<ContextualbarFooter>
				<ButtonGroup stretch>
					<Button secondary onClick={onClose}>
						{t('Omnis_Cancel')}
					</Button>
					<Button primary disabled={busy || !canStart} onClick={onStart}>
						{tab === 'bot' ? t('CaseNotes_Send_bot') : t('CaseNotes_Start_recording')}
					</Button>
				</ButtonGroup>
			</ContextualbarFooter>
		</ContextualbarDialog>
	);
};

export default CaptureMeetingPanel;
