import type { ICommunication, ICommTemplate, IIntakeTask, ILead, ISequence, ISignUpPacket, Serialized } from '@rocket.chat/core-typings';
import type { SelectOption } from '@rocket.chat/fuselage';
import {
	Box,
	Button,
	ButtonGroup,
	Callout,
	CheckBox,
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

import type { LedgerHeat } from './ledgerStyles';
import {
	heatChipStyle,
	heatColor,
	heatDotStyle,
	ledgerHead,
	ledgerRule,
	serifCaption,
	tabularFigures,
	useLedgerTone,
} from './ledgerStyles';

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

// Ledger-dense rows: figures/dates align via tabular-nums, ~15-20% tighter rhythm.
const Row = ({ label, children }: { label: string; children: React.ReactNode }): ReactElement => (
	<Box display='flex' justifyContent='space-between' alignItems='flex-start' marginBlockEnd={4}>
		<Box fontScale='c1' color='hint' marginInlineEnd={8} flexShrink={0}>
			{label}
		</Box>
		<Box fontScale='p2' color='default' textAlign='end' withTruncatedText style={tabularFigures}>
			{children}
		</Box>
	</Box>
);

// Compact small-caps section head over a khaki rule (the "ledger" section break).
const SectionTitle = ({ children }: { children: React.ReactNode }): ReactElement => {
	const tone = useLedgerTone();
	return (
		<Box marginBlockStart={13} marginBlockEnd={6} paddingBlockEnd={2} style={{ ...ledgerHead(tone), ...ledgerRule(tone) }}>
			{children}
		</Box>
	);
};

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
			<Box display='flex' marginInline='neg-x4'>
				<Field marginInline={4}>
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
				<Field marginInline={4}>
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
				<Field marginBlockStart={12}>
					<FieldLabel>{t('Subject')}</FieldLabel>
					<FieldRow>
						<TextInput {...register('subject')} />
					</FieldRow>
				</Field>
			)}

			<Field marginBlockStart={12}>
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
				<Box display='flex' justifyContent='center' marginBlockEnd={8}>
					<Throbber />
				</Box>
			)}
			<Field>
				<FieldLabel htmlFor={templateId}>{t('Boards_Leads_Templates', { defaultValue: 'Templates' })}</FieldLabel>
				<FieldRow>
					<Select
						id={templateId}
						value={selected}
						onChange={(next) => setSelected(next as string)}
						options={options}
						placeholder={t('Select_an_option')}
					/>
				</FieldRow>
			</Field>
			{selectedTemplate && (
				<Box marginBlockStart={12} padding={12} backgroundColor='tint' borderRadius='x4'>
					{selectedTemplate.subject && (
						<Box fontScale='p2b' color='default' marginBlockEnd={4}>
							{selectedTemplate.subject}
						</Box>
					)}
					<Box fontScale='p2' color='default' withRichContent>
						{selectedTemplate.body}
					</Box>
					<Box fontScale='micro' color='hint' marginBlockStart={4}>
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
				<Box display='flex' justifyContent='center' marginBlockEnd={8}>
					<Throbber />
				</Box>
			)}
			<Field>
				<FieldLabel htmlFor={seqId}>{t('Boards_Leads_Sequences', { defaultValue: 'Sequences' })}</FieldLabel>
				<FieldRow>
					<Select
						id={seqId}
						value={selected}
						onChange={(next) => setSelected(next as string)}
						options={options}
						placeholder={t('Select_an_option')}
					/>
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

	const type =
		data.verdict === 'conflict' ? 'danger' : data.verdict === 'review' ? 'warning' : data.verdict === 'clear' ? 'success' : 'info';
	const icon = data.verdict === 'clear' ? 'check' : data.verdict === 'unknown' ? 'info' : 'warning';

	return (
		<Box marginBlockEnd={8}>
			<Callout
				type={type}
				icon={icon}
				title={`${t('Boards_Leads_Conflict_Check', { defaultValue: 'Conflict check' })}: ${verdictLabel[data.verdict]}`}
			>
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
		<Box marginBlockEnd={8}>
			<Callout type='warning' icon='copy' title={t('Boards_Leads_Duplicates', { defaultValue: 'Possible duplicates' })}>
				{data.leadCandidates.map((c) => (
					<Box key={c.leadId} display='flex' alignItems='center' justifyContent='space-between' marginBlockEnd={2}>
						<Box fontScale='c1' withTruncatedText marginInlineEnd={8}>
							{c.name || t('Unnamed')} {c.refNo ? `(#${c.refNo})` : ''} · {Math.round(c.confidence * 100)}%
						</Box>
						<Button tiny onClick={() => onOpenLead()}>
							{t('Boards_Leads_Duplicate_Link', { defaultValue: 'Link' })}
						</Button>
					</Box>
				))}
				{data.matterCandidates.map((c) => (
					<Box key={c.matterId} fontScale='c1' marginBlockEnd={2}>
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

	const tone = useLedgerTone();

	if (!data) {
		return null;
	}

	const factorsTitle = data.factors.map((f) => `${f.label}: ${f.points > 0 ? '+' : ''}${f.points}`).join('\n');

	return (
		<Box
			is='span'
			style={heatChipStyle(tone, 'green')}
			title={`${t('Boards_Leads_Score_Factors', { defaultValue: 'Score factors' })}\n${factorsTitle}`}
		>
			<span aria-hidden='true' style={heatDotStyle(heatColor(tone, 'green'))} />
			{t('Boards_Leads_Score', { defaultValue: 'Lead score' })}: <b>{data.score}</b>
		</Box>
	);
};

const SolChip = ({ leadId }: { leadId: string }): ReactElement | null => {
	const { t } = useTranslation();
	const computeSol = useEndpoint('GET', '/v1/boards.leads.computeSol');

	const { data } = useQuery({
		queryKey: ['boards', 'leads', 'sol', leadId],
		queryFn: () => computeSol({ leadId }),
	});

	const tone = useLedgerTone();

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

	// SOL heat: green (clear) / amber (at risk) / red (expired) — ledger heat scale.
	let heat: LedgerHeat = 'green';
	if (expired) {
		heat = 'red';
	} else if (data.atRisk) {
		heat = 'amber';
	}

	return (
		<Box is='span' style={heatChipStyle(tone, heat)}>
			<span aria-hidden='true' style={heatDotStyle(heatColor(tone, heat))} />
			{label}: {sol.toLocaleDateString()}
		</Box>
	);
};

// ---------------------------------------------------------------------------
// Tasks section (GET /v1/boards.leads.tasks.list + POST .tasks.complete)
// ---------------------------------------------------------------------------

const TASK_ORIGINS = ['sla', 'cold', 'sequence'] as const;
const isAutoOrigin = (v?: string): v is (typeof TASK_ORIGINS)[number] => !!v && (TASK_ORIGINS as readonly string[]).includes(v);

/**
 * The lead's intake tasks (speed-to-lead + cold-lead ticklers + sequence steps +
 * manual follow-ups), each with a complete toggle — so the auto-created ticklers
 * are no longer write-only. Auto-created tasks carry an origin badge.
 */
const TasksSection = ({ leadId }: { leadId: string }): ReactElement => {
	const { t } = useTranslation();
	const dispatchToastMessage = useToastMessageDispatch();
	const queryClient = useQueryClient();
	const listTasks = useEndpoint('GET', '/v1/boards.leads.tasks.list');
	const completeTask = useEndpoint('POST', '/v1/boards.leads.tasks.complete');

	const tasksQueryKey = ['boards', 'leads', 'tasks', leadId];
	const { data, isLoading } = useQuery({
		queryKey: tasksQueryKey,
		queryFn: () => listTasks({ leadId }),
	});

	const completeMutation = useMutation({
		mutationFn: (taskId: string) => completeTask({ taskId }),
		onSuccess: () => {
			dispatchToastMessage({ type: 'success', message: t('Saved') });
			void queryClient.invalidateQueries({ queryKey: tasksQueryKey });
		},
		onError: (error) => dispatchToastMessage({ type: 'error', message: error }),
	});

	const tasks: Serialized<IIntakeTask>[] = data?.tasks ?? [];
	const open = tasks.filter((task) => !task.done);
	const done = tasks.filter((task) => task.done);

	return (
		<>
			<SectionTitle>{t('Boards_Leads_Tasks', { defaultValue: 'Tasks' })}</SectionTitle>
			{isLoading && (
				<Box display='flex' justifyContent='center' padding={8}>
					<Throbber />
				</Box>
			)}
			{!isLoading && tasks.length === 0 && (
				<Box fontScale='c1' color='hint'>
					{t('No_results_found')}
				</Box>
			)}
			{[...open, ...done].map((task) => (
				<Box key={task._id} display='flex' alignItems='flex-start' marginBlockEnd={6}>
					<Box marginInlineEnd={8} marginBlockStart={2}>
						<CheckBox
							checked={task.done}
							disabled={task.done || completeMutation.isPending}
							onChange={() => !task.done && completeMutation.mutate(task._id)}
							aria-label={t('Boards_Leads_Task_Complete', { defaultValue: 'Complete task' })}
						/>
					</Box>
					<Box minWidth={0} flexGrow={1}>
						<Box display='flex' alignItems='center'>
							<Box
								fontScale='p2'
								color={task.done ? 'hint' : 'default'}
								marginInlineEnd={4}
								withTruncatedText
								style={task.done ? { textDecoration: 'line-through' } : undefined}
							>
								{task.title}
							</Box>
							{isAutoOrigin(task.autoCreatedBy) && (
								<Tag medium>
									{t(`Boards_Leads_Task_Origin_${task.autoCreatedBy}` as Parameters<typeof t>[0], { defaultValue: task.autoCreatedBy })}
								</Tag>
							)}
						</Box>
						<Box fontScale='micro' color='hint' style={tabularFigures}>
							{task.dueAt
								? `${t('Boards_Leads_Task_Due', { defaultValue: 'Due' })}: ${fmtDateTime(task.dueAt)}`
								: t('Boards_Leads_Task_NoDue', { defaultValue: 'No due date' })}
							{task.done && task.doneAt ? ` · ${t('Boards_Leads_Task_DoneAt', { defaultValue: 'Done' })} ${fmtDateTime(task.doneAt)}` : ''}
						</Box>
					</Box>
				</Box>
			))}
		</>
	);
};

// ---------------------------------------------------------------------------
// Sign-up packet section (GET /v1/boards.leads.signupPacket.get +
// POST .signupPacket.send + POST .signupPacket.setStatus + .generate)
// ---------------------------------------------------------------------------

const PACKET_FLOW: ISignUpPacket['status'][] = ['draft', 'generated', 'sent', 'viewed', 'signed'];

const packetStatusVariant = (status: ISignUpPacket['status']): 'primary' | 'danger' | 'secondary' => {
	if (status === 'signed') {
		return 'primary';
	}
	if (status === 'declined' || status === 'voided') {
		return 'danger';
	}
	return 'secondary';
};

/**
 * Sign-up / retainer packet (intake-lead-management.md §10). Shows the latest
 * packet's e-sign state-machine state (draft→generated→sent→viewed→signed/declined)
 * with Generate / Send / Mark-signed actions over the existing manual e-sign seam
 * (no live creds). On `signed` the packet arms conversion; we lift that up via
 * `onArmedChange` so the panel highlights Convert-to-matter.
 */
const SignupPacketSection = ({
	leadId,
	onArmedChange,
	onInvalidateLead,
}: {
	leadId: string;
	onArmedChange: (armed: boolean) => void;
	onInvalidateLead: () => void;
}): ReactElement => {
	const { t } = useTranslation();
	const dispatchToastMessage = useToastMessageDispatch();
	const queryClient = useQueryClient();

	const getPacket = useEndpoint('GET', '/v1/boards.leads.signupPacket.get');
	const generatePacket = useEndpoint('POST', '/v1/boards.leads.signupPacket.generate');
	const sendPacket = useEndpoint('POST', '/v1/boards.leads.signupPacket.send');
	const setPacketStatus = useEndpoint('POST', '/v1/boards.leads.signupPacket.setStatus');

	const packetQueryKey = ['boards', 'leads', 'signupPacket', leadId];
	const { data, isLoading } = useQuery({
		queryKey: packetQueryKey,
		queryFn: () => getPacket({ leadId }),
	});

	const packet = data?.packet ?? null;

	// surface conversion-armed (a signed packet) up to the panel.
	const armed = packet?.status === 'signed';
	useMemo(() => onArmedChange(Boolean(armed)), [armed, onArmedChange]);

	const refresh = (): void => {
		void queryClient.invalidateQueries({ queryKey: packetQueryKey });
		onInvalidateLead();
	};

	// the doc render is a LitBox/OnlyOffice concern; here Generate seeds a packet
	// with a placeholder generated ref so the manual e-sign flow can proceed.
	const generateMutation = useMutation({
		mutationFn: () => generatePacket({ leadId, docTemplateId: 'default-retainer', generatedDocRef: `pending:${leadId}:${Date.now()}` }),
		onSuccess: () => {
			dispatchToastMessage({ type: 'success', message: t('Boards_Leads_Signup_Generate', { defaultValue: 'Packet generated' }) });
			refresh();
		},
		onError: (error) => dispatchToastMessage({ type: 'error', message: error }),
	});

	const sendMutation = useMutation({
		mutationFn: () => {
			if (!packet) {
				throw new Error('No packet');
			}
			return sendPacket({ packetId: packet._id });
		},
		onSuccess: () => {
			dispatchToastMessage({ type: 'success', message: t('Boards_Leads_Signup_Send', { defaultValue: 'Packet sent for signature' }) });
			refresh();
		},
		onError: (error) => dispatchToastMessage({ type: 'error', message: error }),
	});

	const markSignedMutation = useMutation({
		mutationFn: () => {
			if (!packet) {
				throw new Error('No packet');
			}
			// manual provider: record the executed-doc ref by hand (no live webhook).
			return setPacketStatus({ packetId: packet._id, status: 'signed', signedDocRef: `signed:${packet._id}` });
		},
		onSuccess: (result) => {
			dispatchToastMessage({ type: 'success', message: t('Boards_Leads_Signup_Signed', { defaultValue: 'Marked signed' }) });
			onArmedChange(Boolean(result?.conversionArmed));
			refresh();
		},
		onError: (error) => dispatchToastMessage({ type: 'error', message: error }),
	});

	const canSend = packet ? packet.status === 'generated' || packet.status === 'draft' : false;
	const canMarkSigned = packet ? packet.status === 'sent' || packet.status === 'viewed' : false;
	const terminal = packet ? packet.status === 'declined' || packet.status === 'voided' : false;

	return (
		<>
			<SectionTitle>{t('Boards_Leads_Signup_Packet', { defaultValue: 'Sign-up packet' })}</SectionTitle>
			{isLoading && (
				<Box display='flex' justifyContent='center' padding={8}>
					<Throbber />
				</Box>
			)}
			{!isLoading && !packet && (
				<>
					<Box fontScale='c1' color='hint' marginBlockEnd={8}>
						{t('Boards_Leads_Signup_None', { defaultValue: 'No sign-up packet yet. Generate a retainer packet to start the e-sign flow.' })}
					</Box>
					<Button small onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending}>
						<Icon name='file-document' size='x14' marginInlineEnd={4} />
						{t('Boards_Leads_Signup_Generate', { defaultValue: 'Generate packet' })}
					</Button>
				</>
			)}
			{packet && (
				<Box>
					{/* status pill + state-machine breadcrumb */}
					<Box display='flex' alignItems='center' flexWrap='wrap' marginBlockEnd={8} style={{ gap: '6px' }}>
						<Tag variant={packetStatusVariant(packet.status)} medium>
							{t(`Boards_Leads_Signup_Status_${packet.status}` as Parameters<typeof t>[0], { defaultValue: packet.status })}
						</Tag>
						{!terminal && (
							<Box fontScale='micro' color='hint'>
								{PACKET_FLOW.map((s, i) => `${i > 0 ? ' → ' : ''}${s === packet.status ? `[${s}]` : s}`).join('')}
							</Box>
						)}
					</Box>
					{armed && (
						<Callout
							type='success'
							icon='check'
							marginBlockEnd={8}
							title={t('Boards_Leads_Signup_Armed', { defaultValue: 'Signed — conversion is armed' })}
						>
							{t('Boards_Leads_Signup_ArmedHint', { defaultValue: 'The retainer is signed; convert this lead to a matter below.' })}
						</Callout>
					)}
					<ButtonGroup>
						<Button tiny onClick={() => sendMutation.mutate()} disabled={!canSend || sendMutation.isPending}>
							<Icon name='send' size='x12' marginInlineEnd={4} />
							{t('Boards_Leads_Signup_Send', { defaultValue: 'Send for signature' })}
						</Button>
						<Button tiny success onClick={() => markSignedMutation.mutate()} disabled={!canMarkSigned || markSignedMutation.isPending}>
							<Icon name='check' size='x12' marginInlineEnd={4} />
							{t('Boards_Leads_Signup_MarkSigned', { defaultValue: 'Mark signed' })}
						</Button>
					</ButtonGroup>
				</Box>
			)}
		</>
	);
};

// ---------------------------------------------------------------------------
// Disqualify modal (boards.leadQualify with { qualified:false, disqualifyReason })
// ---------------------------------------------------------------------------

/**
 * Disqualify a lead with a reason (intake-lead-management.md §4). The server's
 * `qualifyLead` already persists `ILeadQualification.disqualifyReason` and pushes it
 * to CasePro form_data; the panel previously only sent `{ qualified:true }` and had no
 * disqualify path. This modal captures the reason and drives the same qualify mutation
 * with `{ qualified:false, disqualifyReason }` — no new endpoint needed (the wire
 * already carries `disqualifyReason`).
 */
const DisqualifyModal = ({
	onClose,
	onConfirm,
	pending,
}: {
	onClose: () => void;
	onConfirm: (reason: string) => void;
	pending: boolean;
}): ReactElement => {
	const { t } = useTranslation();
	const [reason, setReason] = useState('');

	return (
		<GenericModal
			variant='danger'
			title={t('Boards_Lead_Disqualify', { defaultValue: 'Disqualify lead' })}
			confirmText={t('Boards_Lead_Disqualify', { defaultValue: 'Disqualify' })}
			onCancel={onClose}
			onClose={onClose}
			onConfirm={() => onConfirm(reason.trim())}
			confirmDisabled={!reason.trim() || pending}
		>
			<Field>
				<FieldLabel>{t('Boards_Lead_DisqualifyReason', { defaultValue: 'Reason for disqualifying' })}</FieldLabel>
				<FieldRow>
					<TextAreaInput
						rows={3}
						value={reason}
						onChange={(e) => setReason((e.target as HTMLTextAreaElement).value)}
						placeholder={t('Boards_Lead_DisqualifyReasonPlaceholder', {
							defaultValue: 'e.g. Outside SOL, no injuries, conflict of interest',
						})}
					/>
				</FieldRow>
			</Field>
		</GenericModal>
	);
};

const LeadPanel = ({ leadId, boardId, cardId }: LeadPanelProps): ReactElement => {
	const { t } = useTranslation();
	const tone = useLedgerTone();
	const router = useRouter();
	const setModal = useSetModal();
	const dispatchToastMessage = useToastMessageDispatch();
	const queryClient = useQueryClient();

	const getLead = useEndpoint('GET', '/v1/boards.leads.get');
	const getTimeline = useEndpoint('GET', '/v1/boards.leads.timeline');
	const getLists = useEndpoint('GET', '/v1/boards.lists');
	const updateLead = useEndpoint('POST', '/v1/boards.leads.update');
	const createTask = useEndpoint('POST', '/v1/boards.leads.createTask');
	const qualifyLead = useMethod('boards.leadQualify');
	const assignLead = useMethod('boards.leadAssign');
	// Convert-to-Matter (M3 sync service): creates a CasePro matter from the intake at
	// "POA Received", binds a matter card, and marks the lead converted. The server is
	// the conversion gate (requires caseproIntakeId, POA-Received column, not-already-
	// converted) and throws a descriptive error otherwise, which we surface on failure.
	const convertToMatter = useMethod('boards.leadConvertToMatter');

	// lifted from the sign-up packet section: a signed packet arms conversion, which
	// we use to highlight the Convert-to-matter action below (intake §10/§11).
	const [packetArmed, setPacketArmed] = useState(false);

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
		// accepts the full qualification so the disqualify path can carry a disqualifyReason
		// (server persists it + pushes it to CasePro). Qualify sends just { qualified:true }.
		mutationFn: (qualification: { qualified: boolean; disqualifyReason?: string }) => qualifyLead({ leadId, qualification }),
		onSuccess: () => {
			dispatchToastMessage({ type: 'success', message: t('Saved') });
			invalidate();
		},
		onError: (error) => dispatchToastMessage({ type: 'error', message: error }),
	});

	// the lead's current intake column's sub-statuses populate the picker (item 2). We
	// read the board's lists and locate the one the lead sits in (lead.statusId == list._id).
	const { data: listsData } = useQuery({
		queryKey: ['boards', 'lists', boardId],
		queryFn: () => getLists({ boardId }),
	});

	const subStatusMutation = useMutation({
		mutationFn: (subStatus: string) => updateLead({ leadId, patch: { subStatus } }),
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

	const openDisqualify = (): void => {
		const close = (): void => setModal(null);
		setModal(
			<DisqualifyModal
				pending={qualifyMutation.isPending}
				onClose={close}
				onConfirm={(reason) => {
					qualifyMutation.mutate({ qualified: false, ...(reason ? { disqualifyReason: reason } : {}) }, { onSuccess: close });
				}}
			/>,
		);
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
			<Box display='flex' justifyContent='center' padding={24}>
				<Throbber />
			</Box>
		);
	}

	if (isError || !data?.lead) {
		return (
			<Box fontScale='c1' color='hint' padding={8}>
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

	// sub-status options for the lead's current intake column (item 2). lead.statusId
	// is the boards_lists._id the lead's card sits in; its subStatuses[] are the picker
	// options (seeded Lead-Docket-style on ensureLeadsBoard when absent).
	const currentList = (listsData?.lists ?? []).find((l) => l._id === lead.statusId);
	const subStatusOptions: SelectOption[] = (currentList?.subStatuses ?? []).map((s) => [s, s]);
	// Convert needs a synced CasePro intake; a local-only lead (no caseproIntakeId)
	// cannot become a CasePro matter until it is synced. The POA-Received column gate
	// is enforced server-side and reported via the onError toast.
	const canConvert = Boolean(lead.caseproIntakeId) && !converted;

	return (
		<Box paddingInline={4}>
			{/* Serif "case caption" lead name (mirrors the room-header caption treatment). */}
			<Box fontScale='h4' color='default' withTruncatedText marginBlockEnd={2} style={serifCaption}>
				{fullName}
			</Box>

			{/* Dense single-strip identity row — ref · practice area · qualification ·
			    recomputed score · SOL heat, all on one wrapped line (less chrome, more data). */}
			<Box display='flex' alignItems='center' flexWrap='wrap' marginBlockEnd={8} style={{ gap: '6px', rowGap: '4px' }}>
				<Box is='span' fontScale='c1' color='hint' style={tabularFigures}>
					#{lead.refNo}
				</Box>
				<Box is='span' fontScale='c1' color='hint'>
					·
				</Box>
				<Box is='span' fontScale='c1' color='hint' withTruncatedText>
					{lead.practiceArea ?? t('Boards_PracticeArea', { defaultValue: 'Practice area' })}
				</Box>
				{typeof qualified === 'boolean' && (
					<Box is='span' style={heatChipStyle(tone, qualified ? 'green' : 'red')}>
						<span aria-hidden='true' style={heatDotStyle(heatColor(tone, qualified ? 'green' : 'red'))} />
						{qualified
							? t('Boards_Lead_Qualified', { defaultValue: 'Qualified' })
							: t('Boards_Lead_Disqualified', { defaultValue: 'Disqualified' })}
					</Box>
				)}
				<ScoreChip leadId={leadId} />
				<SolChip leadId={leadId} />
			</Box>

			{/* Disqualify reason (item 1): show why a disqualified lead was declined. */}
			{qualified === false && lead.qualification?.disqualifyReason && (
				<Box marginBlockEnd={8}>
					<Callout type='warning' icon='ban' title={t('Boards_Lead_DisqualifyReason', { defaultValue: 'Reason for disqualifying' })}>
						{lead.qualification.disqualifyReason}
					</Callout>
				</Box>
			)}

			{/* Depth banners: conflict + duplicates (degrade gracefully) */}
			<ConflictBanner leadId={leadId} />
			<DuplicateBanner leadId={leadId} onOpenLead={openDuplicate} />

			<Divider />

			<SectionTitle>{t('Contact')}</SectionTitle>
			<Row label={t('Phone')}>{contact.phone || contact.mobile || '—'}</Row>
			<Row label={t('Email')}>{contact.email || '—'}</Row>
			{lead.preferredContact && <Row label={t('Boards_PreferredContact', { defaultValue: 'Preferred' })}>{lead.preferredContact}</Row>}

			<SectionTitle>{t('Status')}</SectionTitle>
			<Row label={t('Status')}>{currentList?.title ?? lead.statusId}</Row>
			{subStatusOptions.length > 0 ? (
				<Field marginBlockEnd={6}>
					<FieldLabel>{t('Boards_SubStatus', { defaultValue: 'Sub-status' })}</FieldLabel>
					<FieldRow>
						<Select
							value={lead.subStatus ?? ''}
							onChange={(next) => subStatusMutation.mutate(next as string)}
							options={subStatusOptions}
							placeholder={t('Boards_SubStatus_Select', { defaultValue: 'Set sub-status' })}
							disabled={subStatusMutation.isPending || converted}
						/>
					</FieldRow>
				</Field>
			) : (
				lead.subStatus && <Row label={t('Boards_SubStatus', { defaultValue: 'Sub-status' })}>{lead.subStatus}</Row>
			)}

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
							<Tag key={tag} marginInlineEnd={4} marginBlockEnd={4}>
								{tag}
							</Tag>
						))}
					</Box>
				</>
			)}

			{/* Intake tasks (speed-to-lead + cold-lead ticklers + manual follow-ups) */}
			<TasksSection leadId={leadId} />

			{/* Sign-up / retainer packet (e-sign state machine; signing arms conversion) */}
			<SignupPacketSection leadId={leadId} onArmedChange={setPacketArmed} onInvalidateLead={invalidate} />

			{/* Communications timeline + depth actions */}
			<Box
				display='flex'
				alignItems='center'
				justifyContent='space-between'
				marginBlockStart={13}
				marginBlockEnd={6}
				paddingBlockEnd={2}
				style={ledgerRule(tone)}
			>
				<Box style={ledgerHead(tone)}>{t('Boards_Leads_Timeline', { defaultValue: 'Communication timeline' })}</Box>
				<ButtonGroup>
					<Button tiny onClick={openLogComm}>
						<Icon name='plus' size='x12' marginInlineEnd={4} />
						{t('Boards_Leads_Task_New', { defaultValue: 'Log' })}
					</Button>
					<Button tiny onClick={openSendTemplate}>
						<Icon name='send' size='x12' marginInlineEnd={4} />
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
				<Box key={comm._id} display='flex' alignItems='flex-start' marginBlockEnd={6} paddingBlockEnd={4} style={ledgerRule(tone)}>
					<Icon name={commIcon(comm.kind)} size='x16' marginInlineEnd={8} marginBlockStart={2} color='hint' />
					<Box minWidth={0} flexGrow={1}>
						<Box display='flex' alignItems='center'>
							<Box fontScale='p2b' color='default' marginInlineEnd={4}>
								{comm.subject || t(`Boards_Comm_${comm.kind}` as Parameters<typeof t>[0], { defaultValue: comm.kind })}
							</Box>
							<Tag medium>{comm.direction}</Tag>
						</Box>
						{comm.body && (
							<Box fontScale='p2' color='default' withRichContent>
								{comm.body}
							</Box>
						)}
						<Box fontScale='micro' color='hint' style={tabularFigures}>
							{fmtDateTime(comm.ts)}
							{comm.callDisposition ? ` · ${comm.callDisposition}` : ''}
							{comm.deliveryStatus ? ` · ${comm.deliveryStatus}` : ''}
						</Box>
					</Box>
				</Box>
			))}

			<Divider marginBlockStart={16} />

			{/* Depth secondary actions: enroll in sequence + quick intake tasks */}
			<Box marginBlockEnd={8}>
				<ButtonGroup stretch>
					<Button small onClick={openEnrollSequence} disabled={converted}>
						<Icon name='discover' size='x14' marginInlineEnd={4} />
						{t('Boards_Leads_Sequence_Enroll', { defaultValue: 'Enroll in sequence' })}
					</Button>
					<Button
						small
						onClick={() => taskMutation.mutate(t('Boards_Leads_Task_Speed_To_Lead', { defaultValue: 'First contact (SLA)' }))}
						disabled={taskMutation.isPending || converted}
					>
						<Icon name='clock' size='x14' marginInlineEnd={4} />
						{t('Boards_Leads_Task_New', { defaultValue: 'New task' })}
					</Button>
				</ButtonGroup>
			</Box>

			<ButtonGroup stretch>
				<Button
					small
					success={qualified !== true}
					disabled={qualifyMutation.isPending || converted}
					onClick={() => qualifyMutation.mutate({ qualified: true })}
				>
					{t('Boards_Lead_Qualify', { defaultValue: 'Qualify' })}
				</Button>
				<Button small danger={qualified !== false} disabled={qualifyMutation.isPending || converted} onClick={openDisqualify}>
					{t('Boards_Lead_Disqualify', { defaultValue: 'Disqualify' })}
				</Button>
				<Button small disabled={assignMutation.isPending || converted} onClick={() => assignMutation.mutate()}>
					{t('Boards_Lead_Assign', { defaultValue: 'Assign' })}
				</Button>
			</ButtonGroup>
			<Box marginBlockStart={8}>
				<Button small primary width='100%' disabled={convertMutation.isPending || !canConvert} onClick={() => convertMutation.mutate()}>
					{convertMutation.isPending ? (
						<Throbber inheritColor size='x12' marginInlineEnd={4} />
					) : (
						<Icon name='arrow-forward' size='x16' marginInlineEnd={4} />
					)}
					{converted
						? t('Boards_Lead_AlreadyConverted', { defaultValue: 'Converted to matter' })
						: t('Boards_Lead_ConvertToMatter', { defaultValue: 'Convert to matter' })}
				</Button>
				{!converted && !lead.caseproIntakeId && (
					<Box fontScale='micro' color='hint' marginBlockStart={4} textAlign='center'>
						{t('Boards_Lead_ConvertNeedsSync', {
							defaultValue: 'Sync this lead to CasePro before converting to a matter.',
						})}
					</Box>
				)}
				{/* signed retainer arms conversion (intake §10/§11) — nudge the user to convert. */}
				{!converted && canConvert && packetArmed && (
					<Box fontScale='micro' color='status-font-on-success' marginBlockStart={4} textAlign='center'>
						<Icon name='check' size='x12' marginInlineEnd={2} />
						{t('Boards_Lead_ConvertArmed', { defaultValue: 'Retainer signed — ready to convert to a matter.' })}
					</Box>
				)}
			</Box>
		</Box>
	);
};

export default LeadPanel;
