import type { BoardConditionField, BoardConditionOp } from '@rocket.chat/core-typings';
import type { SelectOption } from '@rocket.chat/fuselage';
import { Box, Button, Icon, Select } from '@rocket.chat/fuselage';
import type { ReactElement } from 'react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import ParamInput from './ParamInput';
import { CONDITION_FIELDS, CONDITION_OP_LABEL, CUSTOM_FIELD_OPS } from '../lib/catalog';
import { rowKey } from '../lib/draft';
import type { BoardContextOptions, ConditionDraft } from '../lib/types';

/**
 * The "If" section: an AND-combined list of condition rows. Each row is
 * [field Select] [op Select] [value input]. The value input + op set is driven by
 * the chosen field's catalog spec; `field:<id>` (custom field) is offered as a
 * special field whose id is picked from the board's fieldDefs and composed into the
 * `field:` prefix. Ops in `valuelessOps` (e.g. due 'set'/'unset', assignee 'none')
 * hide the value input.
 */

type ConditionRowsProps = {
	conditions: ConditionDraft[];
	options: BoardContextOptions;
	boardId?: string;
	onChange: (next: ConditionDraft[]) => void;
};

const CUSTOM_FIELD_SENTINEL = '__customField__';

const isCustomFieldCond = (field: string): boolean => field.startsWith('field:');

const ConditionRow = ({
	condition,
	options,
	boardId,
	onChange,
	onRemove,
}: {
	condition: ConditionDraft;
	options: BoardContextOptions;
	boardId?: string;
	onChange: (next: ConditionDraft) => void;
	onRemove: () => void;
}): ReactElement => {
	const { t } = useTranslation();

	const custom = isCustomFieldCond(condition.field);
	const spec = custom ? undefined : CONDITION_FIELDS.find((c) => c.field === condition.field);

	const fieldOptions = useMemo<SelectOption[]>(() => {
		const base = CONDITION_FIELDS.map((c) => [c.field, t(c.labelKey as Parameters<typeof t>[0])] as SelectOption);
		base.push([CUSTOM_FIELD_SENTINEL, t('Boards_Automation_Cond_customField', { defaultValue: 'Custom field' })]);
		return base;
	}, [t]);

	const ops = custom ? CUSTOM_FIELD_OPS : (spec?.ops ?? []);
	const opOptions = useMemo<SelectOption[]>(
		() => ops.map((op) => [op, t(CONDITION_OP_LABEL[op] as Parameters<typeof t>[0])] as SelectOption),
		[ops, t],
	);

	const valueless = !custom && (spec?.valuelessOps?.includes(condition.op) ?? false);
	const valueKind = custom ? 'text' : (spec?.valueKind ?? 'text');

	// the fieldDef id behind a `field:<id>` condition (for the secondary picker)
	const customFieldId = custom ? condition.field.slice('field:'.length) : '';
	const fieldDefOptions = useMemo<SelectOption[]>(() => options.fields.map((f) => [f.value, f.label] as SelectOption), [options.fields]);

	const handleFieldChange = (next: string): void => {
		if (next === CUSTOM_FIELD_SENTINEL) {
			onChange({ field: 'field:' as BoardConditionField, op: CUSTOM_FIELD_OPS[0], value: undefined });
			return;
		}
		const nextSpec = CONDITION_FIELDS.find((c) => c.field === next);
		onChange({ field: next as BoardConditionField, op: nextSpec?.ops[0] ?? 'is', value: undefined });
	};

	return (
		<Box display='flex' alignItems='flex-start' marginBlockEnd={8} marginInline='neg-x2'>
			<Box marginInline={2} flexGrow={1} flexBasis={0}>
				<Select
					value={custom ? CUSTOM_FIELD_SENTINEL : condition.field}
					placeholder={t('Boards_Automation_Field', { defaultValue: 'Field' })}
					options={fieldOptions}
					onChange={(next) => handleFieldChange(next as string)}
				/>
				{custom && (
					<Box marginBlockStart={4}>
						<ParamInput
							kind='field'
							value={customFieldId}
							onChange={(v) => onChange({ ...condition, field: `field:${String(v ?? '')}` as BoardConditionField })}
							options={options}
							boardId={boardId}
							placeholder={t('Boards_Automation_Filter_field', { defaultValue: 'Field' })}
						/>
						{fieldDefOptions.length === 0 && (
							<Box fontScale='micro' color='hint' marginBlockStart={2}>
								{t('Boards_Automation_NoFieldsHint', { defaultValue: 'Enter the field id' })}
							</Box>
						)}
					</Box>
				)}
			</Box>

			<Box marginInline={2} flexGrow={1} flexBasis={0}>
				<Select value={condition.op} options={opOptions} onChange={(next) => onChange({ ...condition, op: next as BoardConditionOp })} />
			</Box>

			<Box marginInline={2} flexGrow={1} flexBasis={0}>
				{!valueless && (
					<ParamInput
						kind={valueKind}
						value={condition.value}
						onChange={(v) => onChange({ ...condition, value: v })}
						options={options}
						boardId={boardId}
						placeholder={spec?.placeholder}
					/>
				)}
			</Box>

			<Button marginInline={2} small icon='trash' title={t('Remove')} onClick={onRemove} />
		</Box>
	);
};

const ConditionRows = ({ conditions, options, boardId, onChange }: ConditionRowsProps): ReactElement => {
	const { t } = useTranslation();

	const add = (): void => {
		onChange([...conditions, { _key: rowKey(), field: 'list', op: 'is', value: undefined }]);
	};
	const update = (index: number, next: ConditionDraft): void => {
		onChange(conditions.map((c, i) => (i === index ? next : c)));
	};
	const remove = (index: number): void => {
		onChange(conditions.filter((_, i) => i !== index));
	};

	return (
		<Box>
			{conditions.length === 0 && (
				<Box fontScale='c1' color='hint' marginBlockEnd={8}>
					{t('Boards_Automation_NoConditionsHint', { defaultValue: 'No conditions — runs whenever the trigger fires.' })}
				</Box>
			)}
			{conditions.map((condition, index) => (
				<ConditionRow
					key={condition._key ?? index}
					condition={condition}
					options={options}
					boardId={boardId}
					onChange={(next) => update(index, next)}
					onRemove={() => remove(index)}
				/>
			))}
			<Button small marginBlockStart={4} onClick={add}>
				<Icon name='plus' size='x16' marginInlineEnd={4} />
				{t('Boards_Automation_AddCondition', { defaultValue: 'Add condition' })}
			</Button>
		</Box>
	);
};

export default ConditionRows;
