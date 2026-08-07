import { Box } from '@rocket.chat/fuselage';
import { useQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import CaptureMeetingPanel from './CaptureMeetingPanel';
import { useOpenedRoom } from '../../lib/RoomManager';
import OmnisWidget from '../shell/OmnisWidget';
import OmnisWidgetRow from '../shell/OmnisWidgetRow';
import { omnisGet } from '../shell/omnisRest';

/**
 * The CaseNotes meetings widget.
 *
 * `LOW AUDIO` is a first-class status, not a footnote: a transcript from a bad
 * phone speaker needs a human before anyone relies on it, and silently shipping
 * a poor transcript into a matter is worse than flagging it.
 */

type Meeting = {
	id: string;
	title: string;
	status: 'joining' | 'recording' | 'processing' | 'ready' | 'low_audio' | 'failed';
	startedAt: string;
	durationSeconds?: number;
	participantCount?: number;
	platform: 'zoom' | 'meet' | 'teams' | 'in-person';
	kind: string;
	matterId?: string;
};

type MeetingsFeed = {
	enabled: boolean;
	transport: 'stub' | 'native';
	reachable: boolean;
	webUrl: string;
	items: Meeting[];
	summary: { meetings: number; transcribing: number; needsReview: number };
};

function duration(seconds?: number): string {
	if (!seconds) {
		return '';
	}
	const mins = Math.round(seconds / 60);
	return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
}

const MeetingsWidget = (): ReactElement | null => {
	const { t } = useTranslation();
	const roomId = useOpenedRoom();
	const [panelOpen, setPanelOpen] = useState(false);

	const { data, isLoading, refetch } = useQuery<MeetingsFeed>({
		queryKey: ['omnis', 'casenotes', 'feed', roomId ?? 'all'],
		queryFn: () => omnisGet<MeetingsFeed>('/v1/casenotes.feed', roomId ? { roomId } : {}),
		staleTime: 30_000,
	});

	if (!data?.enabled) {
		return null;
	}

	return (
		<>
			<OmnisWidget
				title={t('CaseNotes_Meetings')}
				product='CaseNotes'
				icon='headset'
				isLoading={isLoading}
				reachable={data.reachable}
				isDemoData={data.transport === 'stub'}
				counters={[
					{ value: data.summary.meetings, label: t('CaseNotes_Counter_meetings') },
					{ value: data.summary.transcribing, label: t('CaseNotes_Counter_transcribing') },
					{ value: data.summary.needsReview, label: t('CaseNotes_Counter_needs_review'), emphasis: true },
				]}
				attentionCount={data.summary.needsReview}
				primaryAction={{ label: t('CaseNotes_Send_bot_or_record'), onClick: () => setPanelOpen(true) }}
			>
				{data.items.length === 0 && (
					<Box paddingInline={16} paddingBlock={16} fontScale='c1' color='annotation'>
						{t('CaseNotes_Queue_empty')}
					</Box>
				)}

				{data.items.map((meeting) => {
					const ready = meeting.status === 'ready';
					const needsReview = meeting.status === 'low_audio' || meeting.status === 'failed';

					return (
						<OmnisWidgetRow
							key={meeting.id}
							icon='headset'
							primary={meeting.title}
							secondary={[
								new Date(meeting.startedAt).toLocaleDateString(),
								duration(meeting.durationSeconds),
								meeting.participantCount ? t('CaseNotes_Participants', { count: meeting.participantCount }) : undefined,
							]
								.filter(Boolean)
								.join(' · ')}
							status={
								meeting.status === 'low_audio'
									? { label: t('CaseNotes_Status_low_audio'), variant: 'danger' }
									: meeting.status === 'failed'
										? { label: t('CaseNotes_Status_failed'), variant: 'danger' }
										: ready
											? { label: t('CaseNotes_Status_ready'), variant: 'primary' }
											: { label: t('CaseNotes_Status_transcribing'), variant: 'secondary' }
							}
							action={
								data.webUrl
									? {
											label: needsReview ? t('CaseNotes_Review') : t('CaseNotes_Open'),
											onClick: () => window.open(`${data.webUrl.replace(/\/+$/, '')}/meetings/${meeting.id}`, '_blank'),
											disabled: meeting.status === 'joining' || meeting.status === 'recording',
										}
									: undefined
							}
						/>
					);
				})}
			</OmnisWidget>

			{panelOpen && (
				<CaptureMeetingPanel
					onClose={() => setPanelOpen(false)}
					onStarted={() => {
						setPanelOpen(false);
						void refetch();
					}}
				/>
			)}
		</>
	);
};

export default MeetingsWidget;
