import { Box, Button, Field, FieldLabel, FieldRow, Icon, TextInput, Throbber } from '@rocket.chat/fuselage';
import { GenericModal } from '@rocket.chat/ui-client';
import { useAbsoluteUrl, useEndpoint, useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import useClipboardWithToast from '../../../hooks/useClipboardWithToast';

/**
 * "Subscribe in your calendar" modal.
 *
 * Mints (idempotently) the caller's per-user iCal feed token via POST boards.cards.ical.token,
 * then shows the full public feed URL — both an https:// link (copy/paste) and a webcal:// link
 * (one-click subscribe in many clients) — with copy buttons and a paste-it-here hint for
 * Google / Apple / Outlook Calendar. The feed itself is served unauthenticated from
 * GET /api/v1/boards.cards.ical.public?token=… so calendar apps can poll it directly.
 */
const SubscribeCalendarModal = ({ onClose }: { onClose: () => void }) => {
	const { t } = useTranslation();
	const absoluteUrl = useAbsoluteUrl();
	const dispatchToastMessage = useToastMessageDispatch();

	const getToken = useEndpoint('POST', '/v1/boards.cards.ical.token');

	const { mutate, data, isLoading, isError } = useMutation({
		mutationFn: () => getToken({}),
		onError: (error) => dispatchToastMessage({ type: 'error', message: error }),
	});

	// Mint the token as soon as the modal opens.
	useEffect(() => {
		mutate();
	}, [mutate]);

	const token = (data as { token?: string } | undefined)?.token;

	const { httpsUrl, webcalUrl } = useMemo(() => {
		if (!token) {
			return { httpsUrl: '', webcalUrl: '' };
		}
		// absoluteUrl('') -> "<siteUrl>/"; build the public feed URL from it.
		const base = absoluteUrl('').replace(/\/+$/, '');
		const path = `/api/v1/boards.cards.ical.public?token=${encodeURIComponent(token)}`;
		const https = `${base}${path}`;
		return { httpsUrl: https, webcalUrl: https.replace(/^https?:\/\//, 'webcal://') };
	}, [token, absoluteUrl]);

	const copyHttps = useClipboardWithToast(httpsUrl);
	const copyWebcal = useClipboardWithToast(webcalUrl);

	const httpsId = useId();
	const webcalId = useId();

	return (
		<GenericModal
			variant='info'
			icon='calendar'
			title={t('Boards_Subscribe_Calendar', { defaultValue: 'Subscribe in your calendar' })}
			confirmText={t('Close')}
			onConfirm={onClose}
			onClose={onClose}
		>
			<Box mbe={12} color='hint' fontScale='p2'>
				{t('Boards_Subscribe_Calendar_Hint', {
					defaultValue:
						'Add your Boards deadlines to your calendar app. Subscribe to this private feed and your due cards show up — and stay in sync — in Google, Apple, or Outlook Calendar.',
				})}
			</Box>

			{isLoading && <Throbber />}
			{isError && (
				<Box color='danger' fontScale='p2'>
					{t('Boards_Subscribe_Calendar_Error', { defaultValue: "Couldn't generate your calendar link. Please try again." })}
				</Box>
			)}

			{token && (
				<>
					<Field>
						<FieldLabel htmlFor={webcalId}>{t('Boards_Subscribe_Calendar_OneClick', { defaultValue: 'One-click subscribe' })}</FieldLabel>
						<FieldRow>
							<TextInput id={webcalId} readOnly value={webcalUrl} />
							<Button mis={8} icon='clipboard' onClick={() => copyWebcal.copy()} title={t('Copy')}>
								{t('Copy')}
							</Button>
						</FieldRow>
						<Box mbs={4} fontScale='c1' color='hint'>
							<Button
								small
								is='a'
								href={webcalUrl}
								// eslint-disable-next-line react/jsx-no-target-blank
								target='_blank'
								rel='noopener'
							>
								<Icon name='calendar' size='x16' mie={4} />
								{t('Boards_Subscribe_Calendar_Open', { defaultValue: 'Open in calendar app' })}
							</Button>
						</Box>
					</Field>

					<Field mbs={16}>
						<FieldLabel htmlFor={httpsId}>{t('Boards_Subscribe_Calendar_Url', { defaultValue: 'Feed URL (paste into your calendar app)' })}</FieldLabel>
						<FieldRow>
							<TextInput id={httpsId} readOnly value={httpsUrl} />
							<Button mis={8} icon='clipboard' onClick={() => copyHttps.copy()} title={t('Copy')}>
								{t('Copy')}
							</Button>
						</FieldRow>
						<Box mbs={4} fontScale='c1' color='hint'>
							{t('Boards_Subscribe_Calendar_Paste_Hint', {
								defaultValue:
									'Google Calendar: Other calendars → From URL. Apple Calendar: File → New Calendar Subscription. Outlook: Add calendar → Subscribe from web.',
							})}
						</Box>
					</Field>
				</>
			)}
		</GenericModal>
	);
};

export default SubscribeCalendarModal;
