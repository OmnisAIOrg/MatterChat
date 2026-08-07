import type { BoardAutomationScheduleKind, BoardAutomationTriggerEvent } from '@rocket.chat/core-typings';
import type { SelectOption } from '@rocket.chat/fuselage';
import { Box, Field, FieldLabel, FieldRow, NumberInput, Select, TextInput } from '@rocket.chat/fuselage';
import type { ReactElement } from 'react';
import { useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import ParamInput from './ParamInput';
import { DOW_LABELS, SCHEDULE_CADENCES, SCHEDULE_KINDS, TRIGGERS, TRIGGER_BY_EVENT } from '../lib/catalog';
import type { AutomationDraft, BoardContextOptions, ScheduleDraft } from '../lib/types';

/**
 * The "When" section of the builder.
 *  - rule  -> event picker (BoardAutomationTriggerEvent) + the event's dynamic filters.
 *  - scheduled -> a cadence/time editor (every|at|cron) evaluated in the firm tz.
 *  - card-button / board-button / sequence -> no trigger (buttons fire on click,
 *    sequences fire on enrollment); a hint is shown instead.
 */

type TriggerEditorProps = {
	draft: AutomationDraft;
	options: BoardContextOptions;
	boardId?: string;
	onChange: (patch: Partial<AutomationDraft>) => void;
};

const RuleTrigger = ({ draft, options, boardId, onChange }: TriggerEditorProps): ReactElement => {
	const { t } = useTranslation();
	const eventId = useId();

	const eventOptions = useMemo<SelectOption[]>(
		() => TRIGGERS.map((tr) => [tr.event, t(tr.labelKey as Parameters<typeof t>[0])] as SelectOption),
		[t],
	);

	const spec = draft.triggerEvent ? TRIGGER_BY_EVENT[draft.triggerEvent] : undefined;

	const setFilter = (key: string, value: unknown): void => {
		onChange({ triggerFilters: { ...draft.triggerFilters, [key]: value } });
	};

	return (
		<Box>
			<Field>
				<FieldLabel htmlFor={eventId}>{t('Boards_Automation_Event', { defaultValue: 'Event' })}</FieldLabel>
				<FieldRow>
					<Select
						id={eventId}
						value={draft.triggerEvent}
						placeholder={t('Boards_Automation_SelectEvent', { defaultValue: 'Select an event' })}
						options={eventOptions}
						onChange={(next) => onChange({ triggerEvent: next as BoardAutomationTriggerEvent, triggerFilters: {} })}
					/>
				</FieldRow>
			</Field>

			{spec && spec.filters.length > 0 && (
				<Box marginBlockStart={8} paddingInlineStart={12} style={{ borderInlineStart: '2px solid var(--rcx-color-stroke-light, #e4e7ea)' }}>
					{spec.filters.map((f) => (
						<Field key={f.key} marginBlockStart={8}>
							<FieldLabel>
								{t(f.labelKey as Parameters<typeof t>[0])}
								{f.required === false ? ` (${t('Optional', { defaultValue: 'optional' })})` : ''}
							</FieldLabel>
							<FieldRow>
								<ParamInput
									kind={f.kind}
									value={draft.triggerFilters[f.key]}
									onChange={(v) => setFilter(f.key, v)}
									options={options}
									boardId={boardId}
									placeholder={f.placeholder}
								/>
							</FieldRow>
						</Field>
					))}
				</Box>
			)}
		</Box>
	);
};

const ScheduleTrigger = ({ draft, onChange }: TriggerEditorProps): ReactElement => {
	const { t } = useTranslation();
	const kindId = useId();
	const cadenceId = useId();
	const schedule: ScheduleDraft = draft.schedule ?? { kind: 'every', cadence: 'daily', hour: 8, minute: 0 };

	const patchSchedule = (patch: Partial<ScheduleDraft>): void => {
		onChange({ schedule: { ...schedule, ...patch } });
	};

	const kindOptions = useMemo<SelectOption[]>(
		() =>
			SCHEDULE_KINDS.map(
				(k) => [k, t(`Boards_Automation_ScheduleKind_${k}` as Parameters<typeof t>[0], { defaultValue: k })] as SelectOption,
			),
		[t],
	);
	const cadenceOptions = useMemo<SelectOption[]>(
		() =>
			SCHEDULE_CADENCES.map(
				(c) => [c, t(`Boards_Automation_Cadence_${c}` as Parameters<typeof t>[0], { defaultValue: c })] as SelectOption,
			),
		[t],
	);
	const dowOptions = useMemo<SelectOption[]>(
		() => DOW_LABELS.map((labelKey, idx) => [String(idx), t(labelKey as Parameters<typeof t>[0])] as SelectOption),
		[t],
	);

	return (
		<Box>
			<Field>
				<FieldLabel htmlFor={kindId}>{t('Boards_Automation_ScheduleKind', { defaultValue: 'Schedule' })}</FieldLabel>
				<FieldRow>
					<Select
						id={kindId}
						value={schedule.kind}
						options={kindOptions}
						onChange={(next) => patchSchedule({ kind: next as BoardAutomationScheduleKind })}
					/>
				</FieldRow>
			</Field>

			{schedule.kind === 'every' && (
				<>
					<Field marginBlockStart={8}>
						<FieldLabel htmlFor={cadenceId}>{t('Boards_Automation_Cadence', { defaultValue: 'Cadence' })}</FieldLabel>
						<FieldRow>
							<Select
								id={cadenceId}
								value={schedule.cadence ?? 'daily'}
								options={cadenceOptions}
								onChange={(next) => patchSchedule({ cadence: next as ScheduleDraft['cadence'] })}
							/>
						</FieldRow>
					</Field>
					{schedule.cadence === 'weekly' && (
						<Field marginBlockStart={8}>
							<FieldLabel>{t('Boards_Automation_DayOfWeek', { defaultValue: 'Day of week' })}</FieldLabel>
							<FieldRow>
								<Select
									value={String(schedule.dayOfWeek ?? 1)}
									options={dowOptions}
									onChange={(next) => patchSchedule({ dayOfWeek: Number(next) })}
								/>
							</FieldRow>
						</Field>
					)}
					<Box display='flex' marginBlockStart={8} marginInline='neg-x4'>
						<Field marginInline={4}>
							<FieldLabel>{t('Boards_Automation_Hour', { defaultValue: 'Hour' })}</FieldLabel>
							<FieldRow>
								<NumberInput
									value={String(schedule.hour ?? 8)}
									onChange={(e) => patchSchedule({ hour: Number((e.target as HTMLInputElement).value) })}
								/>
							</FieldRow>
						</Field>
						<Field marginInline={4}>
							<FieldLabel>{t('Boards_Automation_Minute', { defaultValue: 'Minute' })}</FieldLabel>
							<FieldRow>
								<NumberInput
									value={String(schedule.minute ?? 0)}
									onChange={(e) => patchSchedule({ minute: Number((e.target as HTMLInputElement).value) })}
								/>
							</FieldRow>
						</Field>
					</Box>
				</>
			)}

			{schedule.kind === 'at' && (
				<Field marginBlockStart={8}>
					<FieldLabel>{t('Boards_Automation_At', { defaultValue: 'At (ISO datetime)' })}</FieldLabel>
					<FieldRow>
						<TextInput
							value={schedule.at ?? ''}
							placeholder='2026-07-01T08:00:00Z'
							onChange={(e) => patchSchedule({ at: (e.target as HTMLInputElement).value })}
						/>
					</FieldRow>
				</Field>
			)}

			{schedule.kind === 'cron' && (
				<Field marginBlockStart={8}>
					<FieldLabel>{t('Boards_Automation_Cron', { defaultValue: 'Cron expression' })}</FieldLabel>
					<FieldRow>
						<TextInput
							value={schedule.cron ?? ''}
							placeholder='0 8 * * 1-5'
							onChange={(e) => patchSchedule({ cron: (e.target as HTMLInputElement).value })}
						/>
					</FieldRow>
				</Field>
			)}
		</Box>
	);
};

const TriggerEditor = (props: TriggerEditorProps): ReactElement | null => {
	const { t } = useTranslation();
	const { draft } = props;

	if (draft.kind === 'rule') {
		return <RuleTrigger {...props} />;
	}
	if (draft.kind === 'scheduled') {
		return <ScheduleTrigger {...props} />;
	}
	// buttons + sequence: no event trigger
	return (
		<Box fontScale='c1' color='hint'>
			{draft.kind === 'sequence'
				? t('Boards_Automation_SequenceTriggerHint', { defaultValue: 'Sequences run when a lead is enrolled. Add timed steps below.' })
				: t('Boards_Automation_ButtonTriggerHint', { defaultValue: 'Buttons run on demand when clicked from a card or board.' })}
		</Box>
	);
};

export default TriggerEditor;
