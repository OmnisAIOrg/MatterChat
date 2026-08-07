import type { ICommTemplate, ISequence, Serialized } from '@rocket.chat/core-typings';
import type { SelectOption } from '@rocket.chat/fuselage';
import {
	Box,
	Button,
	Callout,
	Field,
	FieldLabel,
	FieldRow,
	FieldError,
	FieldHint,
	Icon,
	Select,
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableRow,
	Tag,
	TextInput,
	TextAreaInput,
	Throbber,
} from '@rocket.chat/fuselage';
import { GenericModal, Page, PageHeader, PageScrollableContentWithShadow } from '@rocket.chat/ui-client';
import { useEndpoint, useSetModal, useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { useId, useMemo } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import LedgerPageStyleTag from '../../lib/LedgerPageStyleTag';
import { serifCaption, useLedgerTones } from '../../lib/ledgerTheme';

/**
 * TemplatesView — the `/boards/leads/templates` screen (M6 client).
 *
 * Two stacked panels over the intake board:
 *  - Comm templates (`GET /v1/boards.leads.template.list`): the reusable email /
 *    SMS templates that power the lead timeline "send template" action and drip
 *    sequence steps. A "New template" action opens an editor modal that upserts
 *    via `POST /v1/boards.leads.template.upsert`; seeded `isSystem` rows are shown
 *    as read-only (the server keeps them firm-portable / undeletable).
 *  - Sequences (`GET /v1/boards.leads.sequences.list`): a read-only list of the
 *    drip sequences (intake-lead-management.md §7). Enrollment happens on the lead
 *    card (LeadPanel); the M7 automation engine owns scheduling, so this view does
 *    not run anything — it just shows the definitions + their rollups.
 *
 * Wiring: register at route name `boards-leads-templates`
 * (path `/boards/leads/templates`) gated by `boards-leads-templates-manage`.
 * See return summary.
 */

const CHANNELS = ['email', 'sms'] as const;
type Channel = (typeof CHANNELS)[number];

type TemplateFormValues = {
	name: string;
	channel: Channel;
	subject: string;
	body: string;
	practiceArea: string;
};

const channelTag = (channel: ICommTemplate['channel'], t: ReturnType<typeof useTranslation>['t']): ReactElement =>
	channel === 'email' ? (
		<Tag variant='secondary'>{t('Boards_Leads_Template_Channel_Email', { defaultValue: 'Email' })}</Tag>
	) : (
		<Tag variant='secondary'>{t('Boards_Leads_Template_Channel_SMS', { defaultValue: 'SMS' })}</Tag>
	);

// ---------------------------------------------------------------------------
// Template editor modal (upsert)
// ---------------------------------------------------------------------------

type TemplateEditorModalProps = {
	template?: Serialized<ICommTemplate>;
	onClose: () => void;
	onSaved: () => void;
};

const TemplateEditorModal = ({ template, onClose, onSaved }: TemplateEditorModalProps): ReactElement => {
	const { t } = useTranslation();
	const dispatchToastMessage = useToastMessageDispatch();
	const upsertTemplate = useEndpoint('POST', '/v1/boards.leads.template.upsert');

	const channelId = useId();

	const {
		register,
		control,
		handleSubmit,
		watch,
		formState: { errors, isSubmitting },
	} = useForm<TemplateFormValues>({
		defaultValues: {
			name: template?.name ?? '',
			channel: (template?.channel as Channel) ?? 'email',
			subject: template?.subject ?? '',
			body: template?.body ?? '',
			practiceArea: template?.practiceArea ?? '',
		},
	});

	const channel = watch('channel');

	const channelOptions = useMemo<SelectOption[]>(
		() => [
			['email', t('Boards_Leads_Template_Channel_Email', { defaultValue: 'Email' })],
			['sms', t('Boards_Leads_Template_Channel_SMS', { defaultValue: 'SMS' })],
		],
		[t],
	);

	const upsertMutation = useMutation({
		mutationFn: (values: TemplateFormValues) =>
			upsertTemplate({
				...(template?._id ? { templateId: template._id } : {}),
				fields: {
					name: values.name.trim(),
					channel: values.channel,
					subject: values.channel === 'email' && values.subject.trim() ? values.subject.trim() : undefined,
					body: values.body.trim(),
					practiceArea: values.practiceArea.trim() || undefined,
				},
			}),
		onSuccess: () => {
			dispatchToastMessage({ type: 'success', message: t('Saved') });
			onSaved();
			onClose();
		},
		onError: (error) => dispatchToastMessage({ type: 'error', message: error }),
	});

	const submit = handleSubmit((values) => upsertMutation.mutateAsync(values));

	return (
		<GenericModal
			wrapperFunction={(props) => <Box is='form' onSubmit={submit} {...props} />}
			title={template ? t('Edit') : t('Boards_Leads_Template_New', { defaultValue: 'New template' })}
			confirmText={t('Save')}
			onCancel={onClose}
			onClose={onClose}
			confirmDisabled={isSubmitting || upsertMutation.isPending}
		>
			{(isSubmitting || upsertMutation.isPending) && (
				<Box display='flex' justifyContent='center' marginBlockEnd={8}>
					<Throbber />
				</Box>
			)}

			<Field>
				<FieldLabel>{t('Name')}</FieldLabel>
				<FieldRow>
					<TextInput {...register('name', { required: t('Required_field', { field: t('Name') }) })} />
				</FieldRow>
				{errors.name && <FieldError>{errors.name.message}</FieldError>}
			</Field>

			<Field marginBlockStart={12}>
				<FieldLabel htmlFor={channelId}>{t('Boards_Leads_Template_Channel_Email', { defaultValue: 'Email' })}</FieldLabel>
				<FieldRow>
					<Controller
						control={control}
						name='channel'
						render={({ field: { onChange, value } }) => (
							<Select id={channelId} value={value} onChange={(next) => onChange(next as Channel)} options={channelOptions} />
						)}
					/>
				</FieldRow>
			</Field>

			{channel === 'email' && (
				<Field marginBlockStart={12}>
					<FieldLabel>{t('Subject')}</FieldLabel>
					<FieldRow>
						<TextInput {...register('subject')} placeholder='{lead.firstName}, your case' />
					</FieldRow>
				</Field>
			)}

			<Field marginBlockStart={12}>
				<FieldLabel>{t('Message')}</FieldLabel>
				<FieldRow>
					<TextAreaInput
						rows={5}
						{...register('body', { required: t('Required_field', { field: t('Message') }) })}
						placeholder='Hi {lead.firstName}, this is {firm.name}…'
					/>
				</FieldRow>
				<FieldHint>
					{t('Boards_Leads_Template_VarsHint', { defaultValue: 'Tokens: {lead.firstName}, {lead.refNo}, {firm.name}' })}
				</FieldHint>
				{errors.body && <FieldError>{errors.body.message}</FieldError>}
			</Field>

			<Field marginBlockStart={12}>
				<FieldLabel>{t('Boards_PracticeArea', { defaultValue: 'Practice area' })}</FieldLabel>
				<FieldRow>
					<TextInput {...register('practiceArea')} placeholder={t('Optional', { defaultValue: 'Optional' })} />
				</FieldRow>
			</Field>
		</GenericModal>
	);
};

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

const TemplatesPanel = (): ReactElement => {
	const { t } = useTranslation();
	const setModal = useSetModal();
	const queryClient = useQueryClient();
	const listTemplates = useEndpoint('GET', '/v1/boards.leads.template.list');

	const queryKey = ['boards', 'leads', 'templates'];

	const { data, isLoading, isError, refetch } = useQuery({
		queryKey,
		queryFn: () => listTemplates({}),
	});

	const invalidate = (): void => {
		void queryClient.invalidateQueries({ queryKey });
	};

	const openEditor = (template?: Serialized<ICommTemplate>): void => {
		const close = (): void => setModal(null);
		setModal(<TemplateEditorModal template={template} onClose={close} onSaved={invalidate} />);
	};

	if (isLoading) {
		return (
			<Box display='flex' justifyContent='center' padding={16}>
				<Throbber />
			</Box>
		);
	}

	if (isError || !data) {
		return (
			<Callout type='danger' icon='warning' title={t('Something_went_wrong')}>
				<Button small marginBlockStart={8} onClick={() => refetch()}>
					{t('Reload_page')}
				</Button>
			</Callout>
		);
	}

	const templates = data.templates ?? [];

	return (
		<Box>
			<Box display='flex' justifyContent='flex-end' marginBlockEnd={8}>
				<Button small primary onClick={() => openEditor()}>
					{t('Boards_Leads_Template_New', { defaultValue: 'New template' })}
				</Button>
			</Box>
			<Table fixed>
				<TableHead>
					<TableRow>
						<TableCell>{t('Name')}</TableCell>
						<TableCell>{t('Boards_Leads_Template_Channel_Email', { defaultValue: 'Email' })}</TableCell>
						<TableCell>{t('Subject')}</TableCell>
						<TableCell>{t('Boards_PracticeArea', { defaultValue: 'Practice area' })}</TableCell>
						<TableCell align='end'>{t('Actions')}</TableCell>
					</TableRow>
				</TableHead>
				<TableBody>
					{templates.map((template) => (
						<TableRow key={template._id}>
							<TableCell>
								<Box display='flex' alignItems='center'>
									<Box withTruncatedText marginInlineEnd={6}>
										{template.name}
									</Box>
									{template.isSystem && <Tag>{t('Default', { defaultValue: 'Default' })}</Tag>}
								</Box>
							</TableCell>
							<TableCell>{channelTag(template.channel, t)}</TableCell>
							<TableCell>
								<Box withTruncatedText color={template.subject ? 'default' : 'hint'}>
									{template.subject || '—'}
								</Box>
							</TableCell>
							<TableCell>
								<Box color={template.practiceArea ? 'default' : 'hint'}>{template.practiceArea || '—'}</Box>
							</TableCell>
							<TableCell align='end'>
								<Button small onClick={() => openEditor(template)}>
									{template.isSystem ? t('View', { defaultValue: 'View' }) : t('Edit')}
								</Button>
							</TableCell>
						</TableRow>
					))}
					{templates.length === 0 && (
						<TableRow>
							<TableCell colSpan={5}>
								<Box fontScale='c1' color='hint'>
									{t('No_results_found')}
								</Box>
							</TableCell>
						</TableRow>
					)}
				</TableBody>
			</Table>
		</Box>
	);
};

const SequencesPanel = (): ReactElement => {
	const { t } = useTranslation();
	const listSequences = useEndpoint('GET', '/v1/boards.leads.sequences.list');

	const { data, isLoading, isError, refetch } = useQuery({
		queryKey: ['boards', 'leads', 'sequences'],
		queryFn: () => listSequences({}),
	});

	if (isLoading) {
		return (
			<Box display='flex' justifyContent='center' padding={16}>
				<Throbber />
			</Box>
		);
	}

	if (isError || !data) {
		return (
			<Callout type='danger' icon='warning' title={t('Something_went_wrong')}>
				<Button small marginBlockStart={8} onClick={() => refetch()}>
					{t('Reload_page')}
				</Button>
			</Callout>
		);
	}

	const sequences: Serialized<ISequence>[] = data.sequences ?? [];

	return (
		<Table fixed>
			<TableHead>
				<TableRow>
					<TableCell>{t('Name')}</TableCell>
					<TableCell align='end'>{t('Steps', { defaultValue: 'Steps' })}</TableCell>
					<TableCell align='end'>{t('Boards_Leads_Sequence_Enroll', { defaultValue: 'Enroll in sequence' })}</TableCell>
					<TableCell align='end'>{t('Status')}</TableCell>
				</TableRow>
			</TableHead>
			<TableBody>
				{sequences.map((seq) => (
					<TableRow key={seq._id}>
						<TableCell>
							<Box display='flex' flexDirection='column'>
								<Box withTruncatedText>{seq.name}</Box>
								{seq.description && (
									<Box fontScale='micro' color='hint' withTruncatedText>
										{seq.description}
									</Box>
								)}
							</Box>
						</TableCell>
						<TableCell align='end'>{seq.steps?.length ?? 0}</TableCell>
						<TableCell align='end'>{seq.enrolledCount ?? 0}</TableCell>
						<TableCell align='end'>
							{seq.enabled ? (
								<Tag variant='primary'>{t('Enabled', { defaultValue: 'Enabled' })}</Tag>
							) : (
								<Tag>{t('Disabled', { defaultValue: 'Disabled' })}</Tag>
							)}
						</TableCell>
					</TableRow>
				))}
				{sequences.length === 0 && (
					<TableRow>
						<TableCell colSpan={4}>
							<Box fontScale='c1' color='hint'>
								{t('No_results_found')}
							</Box>
						</TableCell>
					</TableRow>
				)}
			</TableBody>
		</Table>
	);
};

// Serif "case caption" section heads — ledger parity with the redesigned siblings.
const SectionTitle = ({ children }: { children: React.ReactNode }): ReactElement => (
	<Box fontScale='h4' color='default' marginBlockStart={20} marginBlockEnd={10} style={serifCaption}>
		{children}
	</Box>
);

const TemplatesView = (): ReactElement => {
	const { t } = useTranslation();
	const tones = useLedgerTones();

	return (
		// Ledger-dense skin (style-only): paper page ground + serif caption title.
		<Page className='mcLedgerPage' style={{ background: tones.paper }}>
			<PageHeader
				title={
					<Box display='flex' alignItems='center'>
						<Icon name='mail' size='x24' marginInlineEnd={8} style={{ color: tones.green }} />
						<Box withTruncatedText style={serifCaption}>
							{t('Boards_Leads_Templates', { defaultValue: 'Templates' })}
						</Box>
					</Box>
				}
			/>
			<PageScrollableContentWithShadow>
				{/* Static, theme-derived constant string — the shared ledger table/card skin. */}
				<LedgerPageStyleTag />
				<SectionTitle>{t('Boards_Leads_Templates', { defaultValue: 'Templates' })}</SectionTitle>
				<TemplatesPanel />

				<SectionTitle>{t('Boards_Leads_Sequences', { defaultValue: 'Sequences' })}</SectionTitle>
				<SequencesPanel />
			</PageScrollableContentWithShadow>
		</Page>
	);
};

export default TemplatesView;
