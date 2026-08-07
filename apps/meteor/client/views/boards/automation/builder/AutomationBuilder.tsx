import type { IAutomation, Serialized } from '@rocket.chat/core-typings';
import {
	Accordion,
	AccordionItem,
	Box,
	Button,
	Divider,
	Field,
	FieldLabel,
	FieldRow,
	TextAreaInput,
	TextInput,
	Throbber,
	ToggleSwitch,
} from '@rocket.chat/fuselage';
import { useEndpoint, useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ActionRows from './ActionRows';
import ConditionRows from './ConditionRows';
import type { DryRunResult } from './DryRunPanel';
import DryRunPanel from './DryRunPanel';
import TriggerEditor from './TriggerEditor';
import { KIND_LABEL } from '../lib/catalog';
import { emptyDraft, isDraftValid, toBody, toDraft } from '../lib/draft';
import type { AutomationDraft } from '../lib/types';
import { useBoardOptions } from '../lib/useBoardOptions';

/**
 * AutomationBuilder — the rule/button/scheduled/sequence editor used inside the
 * per-board Automations contextualbar.
 *
 * Holds an `AutomationDraft` (loose editor state), composes the When / If / Then
 * sections, and on save serializes to the permissive REST body via `toBody`:
 *  - new  -> POST /v1/boards.automations.create
 *  - edit -> POST /v1/boards.automations.update { automationId, patch }
 *
 * "Test" calls POST /v1/boards.automations.dryRun with the INLINE draft body (no
 * save needed) + an optional sample card id, and renders DryRunPanel with the plan.
 * On success it invalidates the list query the contextualbar shows.
 */

type AutomationBuilderProps = {
	boardId?: string;
	/** the kind being created (new) — ignored when editing an existing automation */
	kind: AutomationDraft['kind'];
	existing?: Serialized<IAutomation>;
	listQueryKey: readonly unknown[];
	onClose: () => void;
};

const AutomationBuilder = ({ boardId, kind, existing, listQueryKey, onClose }: AutomationBuilderProps): ReactElement => {
	const { t } = useTranslation();
	const dispatchToastMessage = useToastMessageDispatch();
	const queryClient = useQueryClient();

	const { options, isLoading: optionsLoading } = useBoardOptions(boardId);

	const [draft, setDraft] = useState<AutomationDraft>(() => (existing ? toDraft(existing) : emptyDraft(kind, boardId)));
	const [sampleCardId, setSampleCardId] = useState('');
	const [dryRun, setDryRun] = useState<DryRunResult | null>(null);

	const createEndpoint = useEndpoint('POST', '/v1/boards.automations.create');
	const updateEndpoint = useEndpoint('POST', '/v1/boards.automations.update');
	const dryRunEndpoint = useEndpoint('POST', '/v1/boards.automations.dryRun');

	const patch = (next: Partial<AutomationDraft>): void => setDraft((prev) => ({ ...prev, ...next }));

	const valid = useMemo(() => isDraftValid(draft), [draft]);

	const saveMutation = useMutation({
		mutationFn: () => {
			const body = toBody(draft);
			if (draft._id) {
				return updateEndpoint({ automationId: draft._id, patch: body });
			}
			return createEndpoint(body as { name: string; boardId?: string });
		},
		onSuccess: () => {
			dispatchToastMessage({ type: 'success', message: t('Saved') });
			void queryClient.invalidateQueries({ queryKey: listQueryKey });
			onClose();
		},
		onError: (error) => dispatchToastMessage({ type: 'error', message: error }),
	});

	const dryRunMutation = useMutation({
		mutationFn: () =>
			dryRunEndpoint({
				...(draft._id ? { automationId: draft._id } : { automation: toBody(draft) }),
				...(sampleCardId.trim() ? { cardId: sampleCardId.trim() } : {}),
			}),
		onSuccess: (result) => setDryRun(result),
		onError: (error) => dispatchToastMessage({ type: 'error', message: error }),
	});

	const isSequence = draft.kind === 'sequence';

	return (
		<Box>
			<Box fontScale='h4' color='default' marginBlockEnd={4}>
				{existing
					? t('Boards_Automation_EditTitle', { defaultValue: 'Edit automation' })
					: t('Boards_Automation_NewOfKind', { defaultValue: 'New {{kind}}', kind: t(KIND_LABEL[draft.kind] as Parameters<typeof t>[0]) })}
			</Box>

			<Field marginBlockStart={12}>
				<FieldLabel>{t('Name')}</FieldLabel>
				<FieldRow>
					<TextInput
						value={draft.name}
						placeholder={t('Boards_Automation_NamePlaceholder', { defaultValue: 'e.g. Demand response timer' })}
						onChange={(e) => patch({ name: (e.target as HTMLInputElement).value })}
					/>
				</FieldRow>
			</Field>

			<Field marginBlockStart={8}>
				<FieldLabel>{t('Description')}</FieldLabel>
				<FieldRow>
					<TextAreaInput
						rows={2}
						value={draft.description ?? ''}
						onChange={(e) => patch({ description: (e.target as HTMLTextAreaElement).value })}
					/>
				</FieldRow>
			</Field>

			<Field marginBlockStart={8}>
				<Box display='flex' alignItems='center' justifyContent='space-between'>
					<FieldLabel>{t('Enabled', { defaultValue: 'Enabled' })}</FieldLabel>
					<ToggleSwitch checked={draft.enabled} onChange={(e) => patch({ enabled: (e.target as HTMLInputElement).checked })} />
				</Box>
			</Field>

			{optionsLoading && boardId ? (
				<Box display='flex' justifyContent='center' padding={16}>
					<Throbber />
				</Box>
			) : (
				<Accordion marginBlockStart={12}>
					{draft.kind !== 'card-button' && draft.kind !== 'board-button' && (
						<AccordionItem
							defaultExpanded
							title={
								isSequence
									? t('Boards_Automation_Sequence', { defaultValue: 'Sequence' })
									: t('Boards_Automation_When', { defaultValue: 'When' })
							}
						>
							<TriggerEditor draft={draft} options={options} boardId={boardId} onChange={patch} />
						</AccordionItem>
					)}

					{!isSequence && (
						<AccordionItem defaultExpanded title={t('Boards_Automation_If', { defaultValue: 'If (conditions)' })}>
							<ConditionRows
								conditions={draft.conditions}
								options={options}
								boardId={boardId}
								onChange={(conditions) => patch({ conditions })}
							/>
						</AccordionItem>
					)}

					<AccordionItem
						defaultExpanded
						title={
							isSequence
								? t('Boards_Automation_Steps', { defaultValue: 'Steps' })
								: t('Boards_Automation_Then', { defaultValue: 'Then (actions)' })
						}
					>
						<ActionRows
							actions={draft.actions}
							options={options}
							boardId={boardId}
							isSequence={isSequence}
							onChange={(actions) => patch({ actions })}
						/>
					</AccordionItem>

					{isSequence && (
						<AccordionItem title={t('Boards_Automation_StopConditions', { defaultValue: 'Stop conditions' })}>
							<Box display='flex' alignItems='center' justifyContent='space-between' marginBlockEnd={8}>
								<Box fontScale='p2'>{t('Boards_Automation_StopOnReply', { defaultValue: 'Stop when the lead replies' })}</Box>
								<ToggleSwitch
									checked={draft.sequence?.stopOnReply ?? false}
									onChange={(e) => patch({ sequence: { ...draft.sequence, stopOnReply: (e.target as HTMLInputElement).checked } })}
								/>
							</Box>
							<Box display='flex' alignItems='center' justifyContent='space-between'>
								<Box fontScale='p2'>{t('Boards_Automation_StopOnStageAdvance', { defaultValue: 'Stop when the card advances stage' })}</Box>
								<ToggleSwitch
									checked={draft.sequence?.stopOnStageAdvance ?? false}
									onChange={(e) => patch({ sequence: { ...draft.sequence, stopOnStageAdvance: (e.target as HTMLInputElement).checked } })}
								/>
							</Box>
						</AccordionItem>
					)}
				</Accordion>
			)}

			<Divider />

			{/* Dry run */}
			<Box marginBlockStart={12}>
				<Box fontScale='p2b' color='default' marginBlockEnd={4}>
					{t('Boards_Automation_Test', { defaultValue: 'Test (dry run)' })}
				</Box>
				<Field>
					<FieldLabel>{t('Boards_Automation_SampleCard', { defaultValue: 'Sample card id (optional)' })}</FieldLabel>
					<FieldRow>
						<TextInput
							value={sampleCardId}
							placeholder={t('Optional', { defaultValue: 'optional' })}
							onChange={(e) => setSampleCardId((e.target as HTMLInputElement).value)}
						/>
					</FieldRow>
				</Field>
				<Button small marginBlockStart={8} onClick={() => dryRunMutation.mutate()} disabled={!valid || dryRunMutation.isPending}>
					{dryRunMutation.isPending ? <Throbber inheritColor size='x12' /> : t('Boards_Automation_RunTest', { defaultValue: 'Run test' })}
				</Button>
				{dryRun && <DryRunPanel result={dryRun} />}
			</Box>

			<Divider />

			<Box display='flex' justifyContent='flex-end' marginBlockStart={12}>
				<Button marginInlineEnd={8} onClick={onClose}>
					{t('Cancel')}
				</Button>
				<Button primary disabled={!valid || saveMutation.isPending} onClick={() => saveMutation.mutate()}>
					{saveMutation.isPending ? <Throbber inheritColor size='x12' /> : t('Save')}
				</Button>
			</Box>
		</Box>
	);
};

export default AutomationBuilder;
