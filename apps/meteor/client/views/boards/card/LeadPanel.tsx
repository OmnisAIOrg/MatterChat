import type { ICommunication, ICommTemplate, ILead, ISequence, Serialized } from '@rocket.chat/core-typings';
import type { SelectOption } from '@rocket.chat/fuselage';
import {
	Box,
	Button,
	ButtonGroup,
	Callout,
	Chip,
	Divider,
	Field,
	FieldLabel,
	FieldRow,
	FieldError,
	Icon,
	Select,
	Tag,
	TextInput,
	TextAreaInput,
	Throbber,
} from '@rocket.chat/fuselage';
import { GenericModal } from '@rocket.chat/ui-client';
import { useEndpoint, useMethod, useRouter, useSetModal, useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { useId, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

/**
 * LEAD PANEL — the Intake face of a `cardType:'lead'` card. The integrator wires
 * CardDetail so that when `card.cardType === 'lead'` and `card.link.kind === 'lead'`
 * this renders instead of (or above) the generic detail body, passing the leadId.
 *
 * Reads the lead + its communications via GET /v1/boards.leads.get and renders
 * contact, status/sub-status, a qualification chip, source/referral, SLA + SOL,
 * a communications timeline, and Qualify / Assign / Convert-to-Matter actions.
 *
 * M6 (Leads Depth) layers the depth tooling on top:
 *  - a recomputed lead-score chip (GET /v1/boards.leads.computeScore) with a
 *    factors tooltip, and a recomputed SOL chip (GET /v1/boards.leads.computeSol)
 *    that turns danger when at-risk/expired (differentiators.md §4);
 *  - a conflict-check banner (GET /v1/boards.leads.runConflictCheck) and a
 *    duplicate banner (GET /v1/boards.leads.checkDuplicates) — both degrade to a
 *    neutral/unknown state, never blocking;
 *  - the timeline reads GET /v1/boards.leads.timeline and gains "Log" (manual
 *    comm) and "Send template" actions, plus an "Enroll in sequence" action.
 *
 * All depth reads are GET-by-leadId, so the lead must already be persisted (it is,
 * since the panel opens on an existing card). `solDate` arrives as a string over
 * the wire (RC Date->string), so we parse with new Date().
 */

type LeadPanelProps = {
	leadId: string;
	boardId: string;
	cardId: string;
};

const fmtDate = (d?: string | Date): string => (d ? new Date(d).toLocaleDateString() : '—');
const fmtDateTime = (d?: string | Date): string => (d ? new Date(d).toLocaleString() : '—');

const Row = ({ label, children }: { label: string; children: React.ReactNode }): ReactElement => (
	<Box display='flex' justifyContent='space-between' alignItems='flex-start' mbe={6}>
		<Box fontScale='c1' color='hint' mie={8} flexShrink={0}>
			{label}
		</Box>
		<Box fontScale='p2' color='default' textAlign='end' withTruncatedText>
			{children}
		</Box>
	</Box>
);

const SectionTitle = ({ children }: { children: React.ReactNode }): ReactElement => (
	<Box fontScale='p2b' color='default' mbs={16} mbe={8}>
		{children}
	</Box>
);

const commIcon = (kind: ICommunication['kind']): 'phone' | 'message' | 'mail' | 'edit' | 'cog' => {
	switch (kind) {
		case 'call':
			return 'phone';
		case 'sms':
			return 'message';
		case 'email':
			return 'mail';
		case 'system':
			return 'cog';
		default:
			return 'edit';
	}
};

// ---------------------------------------------------------------------------
// Log communication modal (POST /v1/boards.leads.logComm)
// ---------------------------------------------------------------------------

const COMM_KINDS = ['call', 'sms', 'email', 'note'] as const;
const DIRECTIONS = ['out', 'in', 'internal'] as const;

type LogCommFormValues = {
	kind: (typeof COMM_KINDS)[number];
	direction: (typeof DIRECTIONS)[number];
	subject: string;
	body: string;
};

const LogCommModal = ({ leadId, onClose, onSaved }: { leadId: string; onClose: () => void; onSaved: () => void }): ReactElement => {
	const { t } = useTranslation();
	const dispatchToastMessage = useToastMessageDispatch();
	const logComm = useEndpoint('POST', '/v1/boards.leads.logComm');

	const kindId = useId();
	const dirId = useId();

	const {
		register,
		control,
		handleSubmit,
		watch,
		formState: { errors, isSubmitting },
	} = useForm<LogCommFormValues>({ defaultValues: { kind: 'call', direction: 'out', subject: '', body: '' } });

	const kind = watch('kind');

	const kindOptions = useMemo<SelectOption[]>(
		() => COMM_KINDS.map((k) => [k, t(`Boards_Comm_${k}` as Parameters<typeof t>[0], { defaultValue: k })]),
		[t],
	);
	const dirOptions = useMemo<SelectOption[]>(
		() => DIRECTIONS.map((d) => [d, t(`Boards_Comm_Direction_${d}` as Parameters<typeof t>[0], { defaultValue: d })]),
		[t],
	);

	const logMutation = useMutation({
		mutationFn: (values: LogCommFormValues) =>
			logComm({
				leadId,
				kind: values.kind,
				direction: values.direction,
				...(values.subject.trim() ? { subject: values.subject.trim() } : {}),
				...(values.body.trim() ? { body: values.body.trim() } : {}),
			}),
		onSuccess: () => {
			dispatchToastMessage({ type: 'success', message: t('Saved') });
			onSaved();
			onClose();
		},
		onError: (error) => dispatchToastMessage({ type: 'error', message: error }),
	});

	const submit = handleSubmit((values) => logMutation.mutateAsync(values));

	return (
		<GenericModal
			wrapperFunction={(props) => <Box is='form' onSubmit={submit} {...props} />}
			title={t('Boards_Leads_Task_New', { defaultValue: 'Log communication' })}
			confirmText={t('Save')}
			onCancel={onClose}
			onClose={onClose}
			confirmDisabled={isSubmitting || logMutation.isPending}
		>
			<Box display='flex' mi='neg-x4'>
				<Field mi={4}>
					<FieldLabel htmlFor={kindId}>{t('Type')}</FieldLabel>
					<FieldRow>
						<Controller
							control={control}
							name='kind'
							render={({ field: { onChange, value } }) => (
								<Select id={kindId} value={value} onChange={(next) => onChange(next)} options={kindOptions} />
							)}
						/>
					</FieldRow>
				</Field>
				<Field mi={4}>
					<FieldLabel htmlFor={dirId}>{t('Direction', { defaultValue: 'Direction' })}</FieldLabel>
					<FieldRow>
						<Controller
							control={control}
							name='direction'
							render={({ field: { onChange, value } }) => (
								<Select id={dirId} value={value} onChange={(next) => onChange(next)} options={dirOptions} />
							)}
						/>
					</FieldRow>
				</Field>
			</Box>

			{kind === 'email' && (
				<Field mbs={12}>
					<FieldLabel>{t('Subject')}</FieldLabel>
					<FieldRow>
						<TextInput {...register('subject')} />
					</FieldRow>
				</Field>
			)}

			<Field mbs={12}>
				<FieldLabel>{t('Message')}</FieldLabel>
				<FieldRow>
					<TextAreaInput rows={3} {...register('body', { required: t('Required_field', { field: t('Message') }) })} />
				</FieldRow>
				{errors.body && <FieldError>{errors.body.message}</FieldError>}
			</Field>
		</GenericModal>
	);
};

// ---------------------------------------------------------------------------
// Send template modal (POST /v1/boards.leads.template.send)
// ---------------------------------------------------------------------------

const SendTemplateModal = ({ leadId, onClose, onSaved }: { leadId: string; onClose: () => void; onSaved: () => void }): ReactElement => {
	const { t } = useTranslation();
	const dispatchToastMessage = useToastMessageDispatch();
	const listTemplates = useEndpoint('GET', '/v1/boards.leads.template.list');
	const sendTemplate = useEndpoint('POST', '/v1/boards.leads.template.send');

	const templateId = useId();
	const [selected, setSelected] = useState('');

	const { data, isLoading } = useQuery({
		queryKey: ['boards', 'leads', 'templates'],
		queryFn: () => listTemplates({}),
	});

	const templates: Serialized<ICommTemplate>[] = data?.templates ?? [];

	const options = useMemo<SelectOption[]>(
		() => templates.map((tpl) => [tpl._id, `${tpl.name} · ${tpl.channel}`] as [string, string]),
		[templates],
	);

	const selectedTemplate = templates.find((tpl) => tpl._id === selected);

	const sendMutation = useMutation({
		mutationFn: () => {
			if (!selected) {
				throw new Error('No template');
			}
			return sendTemplate({ leadId, templateId: selected });
		},
		onSuccess: () => {
			dispatchToastMessage({ type: 'success', message: t('Boards_Leads_Template_Send', { defaultValue: 'Template sent' }) });
			onSaved();
			onClose();
		},
		onError: (error) => dispatchToastMessage({ type: 'error', message: error }),
	});

	return (
		<GenericModal
			title={t('Boards_Leads_Template_Send', { defaultValue: 'Send template' })}
			confirmText={t('Boards_Leads_Template_Send', { defaultValue: 'Send' })}
			onCancel={onClose}
			onClose={onClose}
			onConfirm={() => sendMutation.mutate()}
			confirmDisabled={!selected || sendMutation.isPending}
		>
			{isLoading && (
				<Box display='flex' justifyContent='center' mbe={8}>
					<Throbber />
				</Box>
			)}
			<Field>
				<FieldLabel htmlFor={templateId}>{t('Boards_Leads_Templates', { defaultValue: 'Templates' })}</FieldLabel>
				<FieldRow>
					<Select id={templateId} value={selected} onChange={(next) => setSelected(next as string)} options={options} placeholder={t('Select_an_option')} />
				</FieldRow>
			</Field>
			{selectedTemplate && (
				<Box mbs={12} p={12} bg='tint' borderRadius='x4'>
					{selectedTemplate.subject && (
						<Box fontScale='p2b' color='default' mbe={4}>
							{selectedTemplate.subject}
						</Box>
					)}
					<Box fontScale='p2' color='default' withRichContent>
						{selectedTemplate.body}
					</Box>
					<Box fontScale='micro' color='hint' mbs={4}>
						{t('Boards_Leads_Template_PreviewNote', { defaultValue: 'Tokens are filled in when the message is sent.' })}
					</Box>
				</Box>
			)}
		</GenericModal>
	);
};

// ---------------------------------------------------------------------------
// Enroll-in-sequence modal (POST /v1/boards.leads.sequences.enroll)
// ---------------------------------------------------------------------------

const EnrollSequenceModal = ({ leadId, onClose, onSaved }: { leadId: string; onClose: () => void; onSaved: () => void }): ReactElement => {
	const { t } = useTranslation();
	const dispatchToastMessage = useToastMessageDispatch();
	const listSequences = useEndpoint('GET', '/v1/boards.leads.sequences.list');
	const enroll = useEndpoint('POST', '/v1/boards.leads.sequences.enroll');

	const seqId = useId();
	const [selected, setSelected] = useState('');

	const { data, isLoading } = useQuery({
		queryKey: ['boards', 'leads', 'sequences'],
		queryFn: () => listSequences({}),
	});

	const sequences: Serialized<ISequence>[] = (data?.sequences ?? []).filter((s) => s.enabled);

	const options = useMemo<SelectOption[]>(() => sequences.map((s) => [s._id, s.name] as [string, string]), [sequences]);

	const enrollMutation = useMutation({
		mutationFn: () => {
			if (!selected) {
				throw new Error('No sequence');
			}
			return enroll({ sequenceId: selected, leadId });
		},
		onSuccess: (result) => {
			dispatchToastMessage({
				type: 'success',
				message: result.alreadyEnrolled
					? t('Boards_Leads_Sequence_AlreadyEnrolled', { defaultValue: 'Already enrolled' })
					: t('Boards_Leads_Sequence_Enroll', { defaultValue: 'Enrolled in sequence' }),
			});
			onSaved();
			onClose();
		},
		onError: (error) => dispatchToastMessage({ type: 'error', message: error }),
	});

	return (
		<GenericModal
			title={t('Boards_Leads_Sequence_Enroll', { defaultValue: 'Enroll in sequence' })}
			confirmText={t('Boards_Leads_Sequence_Enroll', { defaultValue: 'Enroll' })}
			onCancel={onClose}
			onClose={onClose}
			onConfirm={() => enrollMutation.mutate()}
			confirmDisabled={!selected || enrollMutation.isPending}
		>
			{isLoading && (
				<Box display='flex' justifyContent='center' mbe={8}>
					<Throbber />
				</Box>
			)}
			<Field>
				<FieldLabel htmlFor={seqId}>{t('Boards_Leads_Sequences', { defaultValue: 'Sequences' })}</FieldLabel>
				<FieldRow>
					<Select id={seqId} value={selected} onChange={(next) => setSelected(next as string)} options={options} placeholder={t('Select_an_option')} />
				</FieldRow>
			</Field>
		</GenericModal>
	);
};

// ---------------------------------------------------------------------------
// Conflict + duplicate banners (GET reads, degrade gracefully)
// ---------------------------------------------------------------------------

const ConflictBanner = ({ leadId }: { leadId: string }): ReactElement | null => {
	const { t } = useTranslation();
	const runConflictCheck = useEndpoint('GET', '/v1/boards.leads.runConflictCheck');

	const { data, isLoading } = useQuery({
		queryKey: ['boards', 'leads', 'conflict', leadId],
		queryFn: () => runConflictCheck({ leadId }),
	});

	if (isLoading || !data) {
		return null;
	}

	const verdictLabel: Record<typeof data.verdict, string> = {
		clear: t('Boards_Leads_Conflict_Clear', { defaultValue: 'No conflicts found' }),
		review: t('Boards_Leads_Conflict_Review', { defaultValue: 'Possible match — review' }),
		conflict: t('Boards_Leads_Conflict_Conflict', { defaultValue: 'Potential conflict' }),
		unknown: t('Boards_Leads_Conflict_Unknown', { defaultValue: 'Conflict check unavailable' }),
	};

	const type = data.verdict === 'conflict' ? 'danger' : data.verdict === 'review' ? 'warning' : data.verdict === 'clear' ? 'success' : 'info';
	const icon = data.verdict === 'clear' ? 'check' : data.verdict === 'unknown' ? 'info' : 'warning';

	return (
		<Box mbe={8}>
			<Callout type={type} icon={icon} title={`${t('Boards_Leads_Conflict_Check', { defaultValue: 'Conflict check' })}: ${verdictLabel[data.verdict]}`}>
				{data.matches.length > 0 && (
					<Box>
						{data.matches.slice(0, 4).map((m, i) => (
							<Box key={`${m.matchedName}-${i}`} fontScale='c1'>
								{m.matchedName}
								{m.matterName ? ` · ${m.matterName}` : ''} ({Math.round(m.similarity * 100)}%)
							</Box>
						))}
					</Box>
				)}
			</Callout>
		</Box>
	);
};

const DuplicateBanner = ({ leadId, onOpenLead }: { leadId: string; onOpenLead: (cardId?: string) => void }): ReactElement | null => {
	const { t } = useTranslation();
	const checkDuplicates = useEndpoint('GET', '/v1/boards.leads.checkDuplicates');

	const { data } = useQuery({
		queryKey: ['boards', 'leads', 'duplicates', leadId],
		queryFn: () => checkDuplicates({ leadId }),
	});

	if (!data?.hasDuplicates) {
		return null;
	}

	return (
		<Box mbe={8}>
			<Callout type='warning' icon='copy' title={t('Boards_Leads_Duplicates', { defaultValue: 'Possible duplicates' })}>
				{data.leadCandidates.map((c) => (
					<Box key={c.leadId} display='flex' alignItems='center' justifyContent='space-between' mbe={2}>
						<Box fontScale='c1' withTruncatedText mie={8}>
							{c.name || t('Unnamed')} {c.refNo ? `(#${c.refNo})` : ''} · {Math.round(c.confidence * 100)}%
						</Box>
						<Button tiny onClick={() => onOpenLead()}>
							{t('Boards_Leads_Duplicate_Link', { defaultValue: 'Link' })}
						</Button>
					</Box>
				))}
				{data.matterCandidates.map((c) => (
					<Box key={c.matterId} fontScale='c1' mbe={2}>
						{c.matterName || c.clientName || c.matterId} · {Math.round(c.confidence * 100)}%
					</Box>
				))}
			</Callout>
		</Box>
	);
};

// ---------------------------------------------------------------------------
// Score + SOL chips (recomputed depth reads)
// ---------------------------------------------------------------------------

const ScoreChip = ({ leadId }: { leadId: string }): ReactElement | null => {
	const { t } = useTranslation();
	const computeScore = useEndpoint('GET', '/v1/boards.leads.computeScore');

	const { data } = useQuery({
		queryKey: ['boards', 'leads', 'score', leadId],
		queryFn: () => computeScore({ leadId }),
	});

	if (!data) {
		return null;
	}

	const factorsTitle = data.factors.map((f) => `${f.label}: ${f.points > 0 ? '+' : ''}${f.points}`).join('\n');

	return (
		<Chip title={`${t('Boards_Leads_Score_Factors', { defaultValue: 'Score factors' })}\n${factorsTitle}`}>
			<Icon name='discover' size='x12' mie={4} />
			{t('Boards_Leads_Score', { defaultValue: 'Lead score' })}: {data.score}
		</Chip>
	);
};

const SolChip = ({ leadId }: { leadId: string }): ReactElement | null => {
	const { t } = useTranslation();
	const computeSol = useEndpoint('GET', '/v1/boards.leads.computeSol');

	const { data } = useQuery({
		queryKey: ['boards', 'leads', 'sol', leadId],
		queryFn: () => computeSol({ leadId }),
	});

	if (!data?.solDate) {
		return null;
	}

	const sol = new Date(data.solDate);
	const expired = sol.getTime() < Date.now();
	const label = expired
		? t('Boards_Leads_SOL_Expired', { defaultValue: 'SOL expired' })
		: data.atRisk
			? t('Boards_Leads_SOL_At_Risk', { defaultValue: 'SOL at risk' })
			: t('Boards_Leads_SOL', { defaultValue: 'Statute of limitations' });

	return (
		<Tag variant={expired || data.atRisk ? 'secondary-danger' : 'secondary'} medium>
			<Icon name='clock' size='x12' mie={4} />
			{label}: {sol.toLocaleDateString()}
		</Tag>
	);
};

const LeadPanel = ({ leadId, boardId, cardId }: LeadPanelProps): ReactElement => {
	const { t } = useTranslation();
	const router = useRouter();
	const setModal = useSetModal();
	const dispatchToastMessage = useToastMessageDispatch();
	const queryClient = useQueryClient();

	const getLead = useEndpoint('GET', '/v1/boards.leads.get');
	const getTimeline = useEndpoint('GET', '/v1/boards.leads.timeline');
	const createTask = useEndpoint('POST', '/v1/boards.leads.createTask');
	const qualifyLead = useMethod('boards.leadQualify');
	const assignLead = useMethod('boards.leadAssign');
	// Convert-to-Matter (M3 sync service): creates a CasePro matter from the intake at
	// "POA Received", binds a matter card, and marks the lead converted. The server is
	// the conversion gate (requires caseproIntakeId, POA-Received column, not-already-
	// converted) and throws a descriptive error otherwise, which we surface on failure.
	const convertToMatter = useMethod('boards.leadConvertToMatter');

	const leadQueryKey = ['boards', 'leads', 'get', leadId];
	const timelineQueryKey = ['boards', 'leads', 'timeline', leadId];

	const { data, isLoading, isError } = useQuery({
		queryKey: leadQueryKey,
		queryFn: () => getLead({ leadId }),
	});

	// timeline is read separately so the depth actions (log / send) can refresh it
	// independently of the lead record.
	const { data: timelineData } = useQuery({
		queryKey: timelineQueryKey,
		queryFn: () => getTimeline({ leadId }),
	});

	const invalidate = (): void => {
		void queryClient.invalidateQueries({ queryKey: leadQueryKey });
		void queryClient.invalidateQueries({ queryKey: ['boards', 'card', cardId] });
		void queryClient.invalidateQueries({ queryKey: ['boards', 'cards', boardId] });
	};

	const refreshTimeline = (): void => {
		void queryClient.invalidateQueries({ queryKey: timelineQueryKey });
		void queryClient.invalidateQueries({ queryKey: leadQueryKey });
	};

	const qualifyMutation = useMutation({
		mutationFn: (qualified: boolean) => qualifyLead({ leadId, qualification: { qualified } }),
		onSuccess: () => {
			dispatchToastMessage({ type: 'success', message: t('Saved') });
			invalidate();
		},
		onError: (error) => dispatchToastMessage({ type: 'error', message: error }),
	});

	const assignMutation = useMutation({
		// round-robin assign: no ownerId lets the server pick from the board member pool
		mutationFn: () => assignLead({ leadId }),
		onSuccess: () => {
			dispatchToastMessage({ type: 'success', message: t('Boards_Lead_Assigned', { defaultValue: 'Lead assigned' }) });
			invalidate();
		},
		onError: (error) => dispatchToastMessage({ type: 'error', message: error }),
	});

	const convertMutation = useMutation({
		mutationFn: () => convertToMatter({ leadId }),
		onSuccess: (result) => {
			dispatchToastMessage({ type: 'success', message: t('Boards_Lead_Converted', { defaultValue: 'Converted to matter' }) });
			invalidate();
			// Jump the user to the freshly created matter's card on the Matters board.
			if (result?.matterCard?._id) {
				router.navigate({ name: 'boards-matters', params: { cardId: result.matterCard._id } });
			}
		},
		onError: (error) => dispatchToastMessage({ type: 'error', message: error }),
	});

	const taskMutation = useMutation({
		mutationFn: (title: string) => createTask({ leadId, title }),
		onSuccess: () => {
			dispatchToastMessage({ type: 'success', message: t('Boards_Leads_Task_New', { defaultValue: 'Task created' }) });
		},
		onError: (error) => dispatchToastMessage({ type: 'error', message: error }),
	});

	const openLogComm = (): void => {
		const close = (): void => setModal(null);
		setModal(<LogCommModal leadId={leadId} onClose={close} onSaved={refreshTimeline} />);
	};

	const openSendTemplate = (): void => {
		const close = (): void => setModal(null);
		setModal(<SendTemplateModal leadId={leadId} onClose={close} onSaved={refreshTimeline} />);
	};

	const openEnrollSequence = (): void => {
		const close = (): void => setModal(null);
		setModal(<EnrollSequenceModal leadId={leadId} onClose={close} onSaved={invalidate} />);
	};

	const openDuplicate = (): void => {
		// linking/merging is a server-owned action not yet exposed via REST; surface a hint.
		dispatchToastMessage({
			type: 'info',
			message: t('Boards_Leads_Duplicate_LinkHint', { defaultValue: 'Open the matching lead to merge or link manually.' }),
		});
	};

	if (isLoading) {
		return (
			<Box display='flex' justifyContent='center' p={24}>
				<Throbber />
			</Box>
		);
	}

	if (isError || !data?.lead) {
		return (
			<Box fontScale='c1' color='hint' p={8}>
				{t('Something_went_wrong')}
			</Box>
		);
	}

	const lead: Serialized<ILead> = data.lead;
	// prefer the dedicated timeline read; fall back to the comms returned by get
	const communications: Serialized<ICommunication>[] = timelineData?.communications ?? data.communications ?? [];

	const { contact } = lead;
	const fullName = contact.fullName || [contact.firstName, contact.lastName].filter(Boolean).join(' ') || t('Unnamed');
	const qualified = lead.qualification?.qualified;
	const converted = Boolean(lead.convertedMatterId);
	// Convert needs a synced CasePro intake; a local-only lead (no caseproIntakeId)
	// cannot become a CasePro matter until it is synced. The POA-Received column gate
	// is enforced server-side and reported via the onError toast.
	const canConvert = Boolean(lead.caseproIntakeId) && !converted;

	return (
		<Box pi={4}>
			{/* Header: ref + name + qualification chip */}
			<Box display='flex' alignItems='center' mbe={8}>
				<Box fontScale='h4' color='default' mie={8} withTruncatedText>
					{fullName}
				</Box>
				{typeof qualified === 'boolean' && (
					<Tag variant={qualified ? 'primary' : 'danger'} medium>
						{qualified ? t('Boards_Lead_Qualified', { defaultValue: 'Qualified' }) : t('Boards_Lead_Disqualified', { defaultValue: 'Disqualified' })}
					</Tag>
				)}
			</Box>
			<Box fontScale='c1' color='hint' mbe={8}>
				#{lead.refNo} · {lead.practiceArea ?? t('Boards_PracticeArea', { defaultValue: 'Practice area' })}
			</Box>

			{/* Depth chips: recomputed score + SOL */}
			<Box display='flex' flexWrap='wrap' alignItems='center' mbe={8} style={{ gap: '6px' }}>
				<ScoreChip leadId={leadId} />
				<SolChip leadId={leadId} />
			</Box>

			{/* Depth banners: conflict + duplicates (degrade gracefully) */}
			<ConflictBanner leadId={leadId} />
			<DuplicateBanner leadId={leadId} onOpenLead={openDuplicate} />

			<Divider />

			<SectionTitle>{t('Contact')}</SectionTitle>
			<Row label={t('Phone')}>{contact.phone || contact.mobile || '—'}</Row>
			<Row label={t('Email')}>{contact.email || '—'}</Row>
			{lead.preferredContact && <Row label={t('Boards_PreferredContact', { defaultValue: 'Preferred' })}>{lead.preferredContact}</Row>}

			<SectionTitle>{t('Status')}</SectionTitle>
			<Row label={t('Status')}>{lead.statusId}</Row>
			{lead.subStatus && <Row label={t('Boards_SubStatus', { defaultValue: 'Sub-status' })}>{lead.subStatus}</Row>}

			<SectionTitle>{t('Boards_Incident', { defaultValue: 'Incident' })}</SectionTitle>
			<Row label={t('Boards_IncidentType', { defaultValue: 'Type' })}>{lead.incident?.incidentType || '—'}</Row>
			<Row label={t('Boards_IncidentDate', { defaultValue: 'Date (DOI)' })}>{fmtDate(lead.incident?.incidentDate)}</Row>
			<Row label={t('Boards_JurisdictionState', { defaultValue: 'State' })}>{lead.incident?.jurisdictionState || '—'}</Row>

			<SectionTitle>{t('Boards_SourceReferral', { defaultValue: 'Source & referral' })}</SectionTitle>
			<Row label={t('Boards_Source', { defaultValue: 'Source' })}>{lead.attribution?.source || '—'}</Row>
			{lead.attribution?.referredByName && (
				<Row label={t('Boards_ReferredBy', { defaultValue: 'Referred by' })}>{lead.attribution.referredByName}</Row>
			)}

			<SectionTitle>{t('Boards_SLA_SOL', { defaultValue: 'SLA & SOL' })}</SectionTitle>
			<Row label={t('Boards_SLA_Due', { defaultValue: 'SLA due' })}>
				{lead.ownership?.slaDueAt ? fmtDateTime(lead.ownership.slaDueAt) : '—'}
				{lead.ownership?.slaBreached ? (
					<Tag variant='danger' medium>
						{t('Boards_SLA_Breached', { defaultValue: 'Breached' })}
					</Tag>
				) : null}
			</Row>
			<Row label={t('Boards_SOL_Date', { defaultValue: 'SOL date' })}>{fmtDate(lead.solDate)}</Row>
			<Row label={t('Owner')}>{lead.ownership?.ownerId || t('Unassigned', { defaultValue: 'Unassigned' })}</Row>

			{lead.tags && lead.tags.length > 0 && (
				<>
					<SectionTitle>{t('Tags')}</SectionTitle>
					<Box display='flex' flexWrap='wrap'>
						{lead.tags.map((tag) => (
							<Tag key={tag} mie={4} mbe={4}>
								{tag}
							</Tag>
						))}
					</Box>
				</>
			)}

			{/* Communications timeline + depth actions */}
			<Box display='flex' alignItems='center' justifyContent='space-between' mbs={16} mbe={8}>
				<Box fontScale='p2b' color='default'>
					{t('Boards_Leads_Timeline', { defaultValue: 'Communication timeline' })}
				</Box>
				<ButtonGroup>
					<Button tiny onClick={openLogComm}>
						<Icon name='plus' size='x12' mie={4} />
						{t('Boards_Leads_Task_New', { defaultValue: 'Log' })}
					</Button>
					<Button tiny onClick={openSendTemplate}>
						<Icon name='send' size='x12' mie={4} />
						{t('Boards_Leads_Template_Send', { defaultValue: 'Send template' })}
					</Button>
				</ButtonGroup>
			</Box>
			{communications.length === 0 && (
				<Box fontScale='c1' color='hint'>
					{t('No_results_found')}
				</Box>
			)}
			{communications.map((comm) => (
				<Box key={comm._id} display='flex' alignItems='flex-start' mbe={10}>
					<Icon name={commIcon(comm.kind)} size='x16' mie={8} mbs={2} color='hint' />
					<Box minWidth={0} flexGrow={1}>
						<Box display='flex' alignItems='center'>
							<Box fontScale='p2b' color='default' mie={4}>
								{comm.subject || t(`Boards_Comm_${comm.kind}` as Parameters<typeof t>[0], { defaultValue: comm.kind })}
							</Box>
							<Tag medium>{comm.direction}</Tag>
						</Box>
						{comm.body && (
							<Box fontScale='p2' color='default' withRichContent>
								{comm.body}
							</Box>
						)}
						<Box fontScale='micro' color='hint'>
							{fmtDateTime(comm.ts)}
							{comm.callDisposition ? ` · ${comm.callDisposition}` : ''}
							{comm.deliveryStatus ? ` · ${comm.deliveryStatus}` : ''}
						</Box>
					</Box>
				</Box>
			))}

			<Divider mbs={16} />

			{/* Depth secondary actions: enroll in sequence + quick intake tasks */}
			<Box mbe={8}>
				<ButtonGroup stretch>
					<Button small onClick={openEnrollSequence} disabled={converted}>
						<Icon name='discover' size='x14' mie={4} />
						{t('Boards_Leads_Sequence_Enroll', { defaultValue: 'Enroll in sequence' })}
					</Button>
					<Button
						small
						onClick={() => taskMutation.mutate(t('Boards_Leads_Task_Speed_To_Lead', { defaultValue: 'First contact (SLA)' }))}
						disabled={taskMutation.isPending || converted}
					>
						<Icon name='clock' size='x14' mie={4} />
						{t('Boards_Leads_Task_New', { defaultValue: 'New task' })}
					</Button>
				</ButtonGroup>
			</Box>

			<ButtonGroup stretch>
				<Button
					small
					success={qualified !== true}
					disabled={qualifyMutation.isPending || converted}
					onClick={() => qualifyMutation.mutate(true)}
				>
					{t('Boards_Lead_Qualify', { defaultValue: 'Qualify' })}
				</Button>
				<Button small disabled={assignMutation.isPending || converted} onClick={() => assignMutation.mutate()}>
					{t('Boards_Lead_Assign', { defaultValue: 'Assign' })}
				</Button>
			</ButtonGroup>
			<Box mbs={8}>
				<Button
					small
					primary
					width='100%'
					disabled={convertMutation.isPending || !canConvert}
					onClick={() => convertMutation.mutate()}
				>
					{convertMutation.isPending ? (
						<Throbber inheritColor size='x12' mie={4} />
					) : (
						<Icon name='arrow-forward' size='x16' mie={4} />
					)}
					{converted
						? t('Boards_Lead_AlreadyConverted', { defaultValue: 'Converted to matter' })
						: t('Boards_Lead_ConvertToMatter', { defaultValue: 'Convert to matter' })}
				</Button>
				{!converted && !lead.caseproIntakeId && (
					<Box fontScale='micro' color='hint' mbs={4} textAlign='center'>
						{t('Boards_Lead_ConvertNeedsSync', {
							defaultValue: 'Sync this lead to CasePro before converting to a matter.',
						})}
					</Box>
				)}
			</Box>
		</Box>
	);
};

export default LeadPanel;
