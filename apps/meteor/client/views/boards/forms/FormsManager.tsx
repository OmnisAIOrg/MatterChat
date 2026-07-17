import type {
	BoardFormFieldType,
	BoardFormIntakeRouting,
	IBoard,
	IBoardForm,
	IBoardFormIntakeMapping,
	IBoardList,
	Serialized,
} from '@rocket.chat/core-typings';
import type { SelectOption } from '@rocket.chat/fuselage';
import {
	Box,
	Button,
	ButtonGroup,
	Callout,
	CheckBox,
	Field,
	FieldLabel,
	FieldRow,
	Icon,
	IconButton,
	Select,
	TextAreaInput,
	TextInput,
	Throbber,
} from '@rocket.chat/fuselage';
import { useEndpoint, useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { serifCaption, useLedgerTones } from '../lib/ledgerTheme';

/**
 * FormsManager — the per-board "Forms" management surface (parity P0.7), mounted
 * by BoardRouter at /boards/board/:id/forms. Lists the board's intake forms,
 * builds/edits them (ordered field builder), toggles enable, copies the public
 * link (/form/:slug), and deletes. Submissions land as cards in the target list.
 * Standalone-safe: plain boards.* REST; the OPTIONAL "Send to intake" section
 * (routing none / board lead / CasePro-direct) degrades gracefully — the default
 * stays card-only with zero CasePro coupling.
 */

const FIELD_TYPES: BoardFormFieldType[] = ['text', 'textarea', 'select', 'date', 'checkbox', 'email', 'phone'];

const INTAKE_ROUTINGS: BoardFormIntakeRouting[] = ['none', 'lead', 'casepro-direct'];

/** intake-mapping keys, in display order, with their default labels. */
const MAPPING_KEYS: { key: keyof IBoardFormIntakeMapping; label: string }[] = [
	{ key: 'fullName', label: 'Full name' },
	{ key: 'firstName', label: 'First name' },
	{ key: 'lastName', label: 'Last name' },
	{ key: 'email', label: 'Email' },
	{ key: 'phone', label: 'Phone' },
	{ key: 'caseType', label: 'Case type' },
	{ key: 'incidentDate', label: 'Incident date' },
];

const CONTACT_MAPPING_KEYS: (keyof IBoardFormIntakeMapping)[] = ['fullName', 'firstName', 'lastName', 'email', 'phone'];

/** Client-minted stable field id (matches the server's /^[A-Za-z0-9_-]{1,64}$/) so mapping can reference unsaved fields. */
const mintFieldId = (): string => `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

type EditorField = {
	id?: string;
	label: string;
	type: BoardFormFieldType;
	required: boolean;
	optionsCsv: string;
	placeholder: string;
};

type EditorState = {
	formId?: string;
	title: string;
	description: string;
	targetListId: string;
	titleTemplate: string;
	enabled: boolean;
	fields: EditorField[];
	intakeRouting: BoardFormIntakeRouting;
	intakeMapping: IBoardFormIntakeMapping;
	caseproOrgId: string;
	caseproSourceToken: string;
};

const emptyField = (): EditorField => ({ id: mintFieldId(), label: '', type: 'text', required: false, optionsCsv: '', placeholder: '' });

const toEditor = (form: Serialized<IBoardForm>): EditorState => ({
	formId: form._id,
	title: form.title,
	description: form.description ?? '',
	targetListId: form.targetListId,
	titleTemplate: form.titleTemplate ?? '',
	enabled: form.enabled,
	intakeRouting: form.intakeRouting ?? 'none',
	intakeMapping: form.intakeMapping ?? {},
	caseproOrgId: form.caseproOrgId ?? '',
	caseproSourceToken: form.caseproSourceToken ?? '',
	fields: form.fields.map((f) => ({
		id: f.id,
		label: f.label,
		type: f.type,
		required: Boolean(f.required),
		optionsCsv: (f.options ?? []).join(', '),
		placeholder: f.placeholder ?? '',
	})),
});

const toPayloadFields = (fields: EditorField[]) =>
	fields.map((f) => ({
		...(f.id ? { id: f.id } : {}),
		label: f.label,
		type: f.type,
		...(f.required ? { required: true } : {}),
		...(f.type === 'select'
			? {
					options: f.optionsCsv
						.split(',')
						.map((o) => o.trim())
						.filter(Boolean),
				}
			: {}),
		...(f.placeholder.trim() ? { placeholder: f.placeholder.trim() } : {}),
	}));

const publicUrlFor = (slug: string): string => `${window.location.origin}/form/${slug}`;

type FormsManagerProps = {
	board: Serialized<IBoard>;
	lists: Serialized<IBoardList>[];
};

const FormsManager = ({ board, lists }: FormsManagerProps): ReactElement => {
	const { t } = useTranslation();
	const tones = useLedgerTones();
	const dispatchToastMessage = useToastMessageDispatch();
	const queryClient = useQueryClient();

	const [editor, setEditor] = useState<EditorState | null>(null);

	const listForms = useEndpoint('GET', '/v1/boards.forms.list');
	const createForm = useEndpoint('POST', '/v1/boards.forms.create');
	const updateForm = useEndpoint('POST', '/v1/boards.forms.update');
	const deleteForm = useEndpoint('POST', '/v1/boards.forms.delete');

	const { data, isLoading } = useQuery({
		queryKey: ['boards', 'forms', board._id],
		queryFn: () => listForms({ boardId: board._id }),
	});

	const invalidate = () => queryClient.invalidateQueries({ queryKey: ['boards', 'forms', board._id] });

	const saveMutation = useMutation({
		mutationFn: async (state: EditorState) => {
			// prune mapping entries pointing at fields removed in this edit session
			const fieldIds = new Set(state.fields.map((f) => f.id).filter(Boolean));
			const intakeMapping = Object.fromEntries(
				Object.entries(state.intakeMapping).filter(([, fieldId]) => fieldId && fieldIds.has(fieldId)),
			) as IBoardFormIntakeMapping;
			const common = {
				targetListId: state.targetListId,
				title: state.title,
				description: state.description,
				fields: toPayloadFields(state.fields),
				titleTemplate: state.titleTemplate,
				enabled: state.enabled,
				intakeRouting: state.intakeRouting,
				intakeMapping,
				caseproOrgId: state.caseproOrgId.trim(),
				caseproSourceToken: state.caseproSourceToken.trim(),
			};
			if (state.formId) {
				return updateForm({ formId: state.formId, ...common });
			}
			return createForm({ boardId: board._id, ...common });
		},
		onSuccess: () => {
			setEditor(null);
			invalidate();
			dispatchToastMessage({ type: 'success', message: t('Boards_Forms_Saved', { defaultValue: 'Form saved' }) });
		},
		onError: (error) => dispatchToastMessage({ type: 'error', message: error }),
	});

	const toggleMutation = useMutation({
		mutationFn: (form: Serialized<IBoardForm>) => updateForm({ formId: form._id, enabled: !form.enabled }),
		onSuccess: () => invalidate(),
		onError: (error) => dispatchToastMessage({ type: 'error', message: error }),
	});

	const deleteMutation = useMutation({
		mutationFn: (formId: string) => deleteForm({ formId }),
		onSuccess: () => {
			invalidate();
			dispatchToastMessage({ type: 'success', message: t('Boards_Forms_Deleted', { defaultValue: 'Form deleted' }) });
		},
		onError: (error) => dispatchToastMessage({ type: 'error', message: error }),
	});

	const listOptions = useMemo<SelectOption[]>(() => lists.map((l) => [l._id, l.title]), [lists]);
	const typeOptions = useMemo<SelectOption[]>(
		() =>
			FIELD_TYPES.map((type) => [
				type,
				t(`Boards_Forms_FieldType_${type}`, { defaultValue: type.charAt(0).toUpperCase() + type.slice(1) }),
			]),
		[t],
	);

	const listTitle = (listId: string) => lists.find((l) => l._id === listId)?.title ?? listId;

	const copyLink = async (slug: string) => {
		await navigator.clipboard.writeText(publicUrlFor(slug));
		dispatchToastMessage({ type: 'success', message: t('Boards_Forms_LinkCopied', { defaultValue: 'Public link copied' }) });
	};

	const patchField = (index: number, patch: Partial<EditorField>) => {
		setEditor((prev) => (prev ? { ...prev, fields: prev.fields.map((f, i) => (i === index ? { ...f, ...patch } : f)) } : prev));
	};

	const moveField = (index: number, delta: -1 | 1) => {
		setEditor((prev) => {
			if (!prev) {
				return prev;
			}
			const next = [...prev.fields];
			const target = index + delta;
			if (target < 0 || target >= next.length) {
				return prev;
			}
			[next[index], next[target]] = [next[target], next[index]];
			return { ...prev, fields: next };
		});
	};

	const removeField = (index: number) => {
		setEditor((prev) => (prev ? { ...prev, fields: prev.fields.filter((_, i) => i !== index) } : prev));
	};

	const mappedToExistingField = (key: keyof IBoardFormIntakeMapping): boolean => {
		const fieldId = editor?.intakeMapping[key];
		return Boolean(fieldId && editor?.fields.some((f) => f.id === fieldId));
	};

	// mirrors the server's assertIntakeConfig: 'lead' needs a mapped contact field,
	// 'casepro-direct' needs the per-form org id + source token.
	const intakeConfigValid =
		editor !== null &&
		(editor.intakeRouting === 'none' ||
			(editor.intakeRouting === 'lead' && CONTACT_MAPPING_KEYS.some(mappedToExistingField)) ||
			(editor.intakeRouting === 'casepro-direct' && editor.caseproOrgId.trim().length > 0 && editor.caseproSourceToken.trim().length > 0));

	const canSave =
		editor !== null &&
		editor.title.trim().length > 0 &&
		editor.targetListId.length > 0 &&
		editor.fields.length > 0 &&
		editor.fields.every((f) => f.label.trim().length > 0 && (f.type !== 'select' || f.optionsCsv.trim().length > 0)) &&
		intakeConfigValid;

	if (isLoading) {
		return (
			<Box display='flex' justifyContent='center' alignItems='center' height='100%'>
				<Throbber />
			</Box>
		);
	}

	const forms = data?.forms ?? [];

	return (
		// Ledger-dense skin (style-only): paper ground + serif caption + card-tone
		// panels — parity with the redesigned board views around this surface.
		<Box padding={16} overflow='auto' height='100%' style={{ background: tones.paper }}>
			<Box display='flex' alignItems='center' justifyContent='space-between' mbe={12}>
				<Box fontScale='h3' style={serifCaption}>
					{t('Boards_Forms_Title', { defaultValue: 'Forms' })}
				</Box>
				{!editor && (
					<Button
						primary
						small
						onClick={() =>
							setEditor({
								title: '',
								description: '',
								targetListId: lists[0]?._id ?? '',
								titleTemplate: '',
								enabled: true,
								intakeRouting: 'none',
								intakeMapping: {},
								caseproOrgId: '',
								caseproSourceToken: '',
								fields: [emptyField()],
							})
						}
					>
						<Icon name='plus' size='x16' mie={4} />
						{t('Boards_Forms_New', { defaultValue: 'New form' })}
					</Button>
				)}
			</Box>

			<Callout type='info' mbe={16} title={t('Boards_Forms_Intro_Title', { defaultValue: 'Intake without an account' })}>
				{t('Boards_Forms_Intro', {
					defaultValue:
						'Share a form link publicly — every submission becomes a card in the list you choose. Disable a form any time to kill its link.',
				})}
			</Callout>

			{/* ------------------------------------------------ editor */}
			{editor && (
				<Box mbe={20} padding={16} style={{ background: tones.card, border: `1px solid ${tones.strokeSoft}`, borderRadius: 6 }}>
					<Box fontScale='h4' mbe={12} style={serifCaption}>
						{editor.formId ? t('Boards_Forms_Edit', { defaultValue: 'Edit form' }) : t('Boards_Forms_New', { defaultValue: 'New form' })}
					</Box>

					<Field mbe={8}>
						<FieldLabel>{t('Title', { defaultValue: 'Title' })}</FieldLabel>
						<FieldRow>
							<TextInput value={editor.title} onChange={(e) => setEditor({ ...editor, title: (e.target as HTMLInputElement).value })} />
						</FieldRow>
					</Field>

					<Field mbe={8}>
						<FieldLabel>{t('Description', { defaultValue: 'Description' })}</FieldLabel>
						<FieldRow>
							<TextAreaInput
								rows={2}
								value={editor.description}
								onChange={(e) => setEditor({ ...editor, description: (e.target as HTMLTextAreaElement).value })}
							/>
						</FieldRow>
					</Field>

					<Field mbe={8}>
						<FieldLabel>{t('Boards_Forms_TargetList', { defaultValue: 'Cards go to list' })}</FieldLabel>
						<FieldRow>
							<Select
								value={editor.targetListId}
								options={listOptions}
								onChange={(value) => setEditor({ ...editor, targetListId: String(value) })}
							/>
						</FieldRow>
					</Field>

					<Field mbe={16}>
						<FieldLabel>{t('Boards_Forms_TitleTemplate', { defaultValue: 'Card title template (optional)' })}</FieldLabel>
						<FieldRow>
							<TextInput
								placeholder={t('Boards_Forms_TitleTemplate_Placeholder', {
									defaultValue: 'e.g. Intake — {{fieldId}} · blank = "<form title> submission"',
								})}
								value={editor.titleTemplate}
								onChange={(e) => setEditor({ ...editor, titleTemplate: (e.target as HTMLInputElement).value })}
							/>
						</FieldRow>
					</Field>

					<Box fontScale='p2b' mbe={8}>
						{t('Boards_Forms_Fields', { defaultValue: 'Fields (in order)' })}
					</Box>
					{editor.fields.map((field, index) => (
						<Box key={field.id ?? `new-${index}`} display='flex' alignItems='flex-start' mbe={8} style={{ gap: '8px' }}>
							<Box flexGrow={2} minWidth={0}>
								<TextInput
									placeholder={t('Boards_Forms_FieldLabel', { defaultValue: 'Label' })}
									value={field.label}
									onChange={(e) => patchField(index, { label: (e.target as HTMLInputElement).value })}
								/>
							</Box>
							<Box width='x120' flexShrink={0}>
								<Select
									value={field.type}
									options={typeOptions}
									onChange={(value) => patchField(index, { type: value as BoardFormFieldType })}
								/>
							</Box>
							{field.type === 'select' && (
								<Box flexGrow={1} minWidth={0}>
									<TextInput
										placeholder={t('Boards_Forms_FieldOptions', { defaultValue: 'Options, comma-separated' })}
										value={field.optionsCsv}
										onChange={(e) => patchField(index, { optionsCsv: (e.target as HTMLInputElement).value })}
									/>
								</Box>
							)}
							<Box
								display='flex'
								alignItems='center'
								flexShrink={0}
								mbs={8}
								title={t('Boards_Forms_FieldRequired', { defaultValue: 'Required' })}
							>
								<CheckBox checked={field.required} onChange={() => patchField(index, { required: !field.required })} />
							</Box>
							<ButtonGroup>
								<IconButton small icon='chevron-up' disabled={index === 0} onClick={() => moveField(index, -1)} />
								<IconButton small icon='chevron-down' disabled={index === editor.fields.length - 1} onClick={() => moveField(index, 1)} />
								<IconButton small icon='trash' disabled={editor.fields.length === 1} onClick={() => removeField(index)} />
							</ButtonGroup>
						</Box>
					))}
					<Button small mbe={16} onClick={() => setEditor({ ...editor, fields: [...editor.fields, emptyField()] })}>
						<Icon name='plus' size='x16' mie={4} />
						{t('Boards_Forms_AddField', { defaultValue: 'Add field' })}
					</Button>

					{/* ------------------------------------------ send to intake */}
					<Box fontScale='p2b' mbe={8}>
						{t('Boards_Forms_Intake_Title', { defaultValue: 'Send to intake' })}
					</Box>
					<Field mbe={8}>
						<FieldRow>
							<Select
								value={editor.intakeRouting}
								options={INTAKE_ROUTINGS.map((routing) => [
									routing,
									{
										'none': t('Boards_Forms_Intake_None', { defaultValue: 'None — card only' }),
										'lead': t('Boards_Forms_Intake_Lead', { defaultValue: 'Create board lead' }),
										'casepro-direct': t('Boards_Forms_Intake_CaseProDirect', { defaultValue: 'Send directly to CasePro' }),
									}[routing],
								])}
								onChange={(value) => setEditor({ ...editor, intakeRouting: value as BoardFormIntakeRouting })}
							/>
						</FieldRow>
					</Field>

					{editor.intakeRouting !== 'none' && (
						<Box mbe={16} padding={12} style={{ background: tones.cardAlt, border: `1px solid ${tones.strokeSoft}`, borderRadius: 6 }}>
							<Box fontScale='c1' color='hint' mbe={8}>
								{editor.intakeRouting === 'lead'
									? t('Boards_Forms_Intake_Lead_Help', {
											defaultValue:
												'Each submission also creates a lead on the Leads board (and syncs to CasePro when the CasePro connection is on). Map at least one contact field.',
										})
									: t('Boards_Forms_Intake_CaseProDirect_Help', {
											defaultValue:
												'Each submission is also posted to your CasePro intake capture endpoint. Needs the workspace capture URL (admin setting) plus this form’s CasePro org id and source token.',
										})}
							</Box>

							{MAPPING_KEYS.map(({ key, label }) => (
								<Field key={key} mbe={4}>
									<Box display='flex' alignItems='center' style={{ gap: '8px' }}>
										<Box width='x140' flexShrink={0} fontScale='c1'>
											{t(`Boards_Forms_Intake_Map_${key}`, { defaultValue: label })}
										</Box>
										<Box flexGrow={1} minWidth={0}>
											<Select
												value={editor.intakeMapping[key] ?? ''}
												options={[
													['', t('Boards_Forms_Intake_Map_None', { defaultValue: '— not mapped —' })],
													...editor.fields
														.filter((f): f is EditorField & { id: string } => Boolean(f.id))
														.map((f): SelectOption => [f.id, f.label || f.id]),
												]}
												onChange={(value) =>
													setEditor({
														...editor,
														intakeMapping: { ...editor.intakeMapping, [key]: value ? String(value) : undefined },
													})
												}
											/>
										</Box>
									</Box>
								</Field>
							))}

							{editor.intakeRouting === 'casepro-direct' && (
								<>
									<Field mbe={8} mbs={8}>
										<FieldLabel>{t('Boards_Forms_Intake_CaseProOrgId', { defaultValue: 'CasePro org id' })}</FieldLabel>
										<FieldRow>
											<TextInput
												value={editor.caseproOrgId}
												onChange={(e) => setEditor({ ...editor, caseproOrgId: (e.target as HTMLInputElement).value })}
											/>
										</FieldRow>
									</Field>
									<Field mbe={4}>
										<FieldLabel>{t('Boards_Forms_Intake_CaseProSourceToken', { defaultValue: 'CasePro source token' })}</FieldLabel>
										<FieldRow>
											<TextInput
												value={editor.caseproSourceToken}
												onChange={(e) => setEditor({ ...editor, caseproSourceToken: (e.target as HTMLInputElement).value })}
											/>
										</FieldRow>
									</Field>
								</>
							)}
						</Box>
					)}

					<Box display='flex' justifyContent='flex-end' style={{ gap: '8px' }}>
						<Button small onClick={() => setEditor(null)}>
							{t('Cancel', { defaultValue: 'Cancel' })}
						</Button>
						<Button primary small disabled={!canSave || saveMutation.isPending} onClick={() => editor && saveMutation.mutate(editor)}>
							{t('Save', { defaultValue: 'Save' })}
						</Button>
					</Box>
				</Box>
			)}

			{/* ------------------------------------------------ form list */}
			{forms.length === 0 && !editor && (
				<Box color='hint'>{t('Boards_Forms_Empty', { defaultValue: 'No forms yet — create one to start collecting intake.' })}</Box>
			)}
			{forms.map((form: Serialized<IBoardForm>) => (
				<Box
					key={form._id}
					display='flex'
					alignItems='center'
					justifyContent='space-between'
					padding={10}
					mbe={6}
					style={{ background: tones.card, border: `1px solid ${tones.strokeSoft}`, borderRadius: 6 }}
				>
					<Box minWidth={0}>
						<Box display='flex' alignItems='center' style={{ gap: '8px' }}>
							<Box fontScale='p1b' withTruncatedText>
								{form.title}
							</Box>
							{!form.enabled && (
								<Box is='span' fontScale='c1' color='annotation'>
									{t('Boards_Forms_Disabled', { defaultValue: 'disabled' })}
								</Box>
							)}
						</Box>
						<Box fontScale='c1' color='hint' withTruncatedText>
							{t('Boards_Forms_Meta', {
								defaultValue: '{{count}} submissions · cards go to "{{list}}"',
								count: form.submissionCount,
								list: listTitle(form.targetListId),
							})}
						</Box>
					</Box>
					<ButtonGroup>
						<Button small onClick={() => copyLink(form.slug)} title={publicUrlFor(form.slug)}>
							<Icon name='link' size='x16' mie={4} />
							{t('Boards_Forms_CopyLink', { defaultValue: 'Copy link' })}
						</Button>
						<Button small onClick={() => toggleMutation.mutate(form)} disabled={toggleMutation.isPending}>
							{form.enabled ? t('Boards_Forms_Disable', { defaultValue: 'Disable' }) : t('Boards_Forms_Enable', { defaultValue: 'Enable' })}
						</Button>
						<Button small onClick={() => setEditor(toEditor(form))}>
							{t('Edit', { defaultValue: 'Edit' })}
						</Button>
						<IconButton small danger icon='trash' disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate(form._id)} />
					</ButtonGroup>
				</Box>
			))}
		</Box>
	);
};

export default FormsManager;
