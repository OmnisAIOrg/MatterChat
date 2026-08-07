import type { IAutomationAction } from '@rocket.chat/core-typings';
import type { SelectOption } from '@rocket.chat/fuselage';
import { Box, Button, Chip, Field, FieldLabel, FieldRow, Icon, Select, TextInput } from '@rocket.chat/fuselage';
import type { ReactElement } from 'react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import ParamInput from './ParamInput';
import { ACTIONS, ACTION_BY_TYPE } from '../lib/catalog';
import { rowKey } from '../lib/draft';
import type { ActionDraft, BoardContextOptions } from '../lib/types';

/**
 * The "Then" section: an ordered list of action rows. Each row picks an action type
 * (the IAutomationAction union) then renders that arm's params from the catalog.
 * For `kind:'sequence'` each step also carries a `delay` (e.g. '1d','3d') shown as a
 * leading field. Gated actions (notifySms / caseproWriteback / litboxRequestFolder /
 * aiGenerate) show a "requires setting" chip so the user knows they no-op until
 * enabled server-side.
 */

type ActionRowsProps = {
	actions: ActionDraft[];
	options: BoardContextOptions;
	boardId?: string;
	isSequence: boolean;
	onChange: (next: ActionDraft[]) => void;
};

const ActionRow = ({
	action,
	index,
	count,
	options,
	boardId,
	isSequence,
	onChange,
	onRemove,
	onMove,
}: {
	action: ActionDraft;
	index: number;
	count: number;
	options: BoardContextOptions;
	boardId?: string;
	isSequence: boolean;
	onChange: (next: ActionDraft) => void;
	onRemove: () => void;
	onMove: (dir: -1 | 1) => void;
}): ReactElement => {
	const { t } = useTranslation();
	const spec = ACTION_BY_TYPE[action.type];

	const typeOptions = useMemo<SelectOption[]>(
		() => ACTIONS.map((a) => [a.type, t(a.labelKey as Parameters<typeof t>[0])] as SelectOption),
		[t],
	);

	const setParam = (key: string, value: unknown): void => {
		onChange({ ...action, [key]: value });
	};

	return (
		<Box marginBlockEnd={12} padding={12} backgroundColor='tint' borderRadius='x4'>
			<Box display='flex' alignItems='center' marginBlockEnd={8}>
				<Box fontScale='c1' color='hint' marginInlineEnd={8}>
					{index + 1}.
				</Box>
				<Box flexGrow={1}>
					<Select
						value={action.type}
						options={typeOptions}
						onChange={(next) =>
							onChange({
								// keep the stable row key + sequence delay; drop the old arm's params
								...(action._key ? { _key: action._key } : {}),
								...(action.delay !== undefined ? { delay: action.delay } : {}),
								type: next as IAutomationAction['type'],
							})
						}
					/>
				</Box>
				{isSequence && (
					<>
						<Button
							marginInlineStart={4}
							small
							icon='chevron-up'
							title={t('Move_up', { defaultValue: 'Move up' })}
							disabled={index === 0}
							onClick={() => onMove(-1)}
						/>
						<Button
							marginInlineStart={2}
							small
							icon='chevron-down'
							title={t('Move_down', { defaultValue: 'Move down' })}
							disabled={index === count - 1}
							onClick={() => onMove(1)}
						/>
					</>
				)}
				<Button marginInlineStart={4} small icon='trash' title={t('Remove')} onClick={onRemove} />
			</Box>

			{spec?.gated && (
				<Box marginBlockEnd={8}>
					<Chip>
						<Icon name='warning' size='x12' marginInlineEnd={4} />
						{t('Boards_Automation_GatedAction', { defaultValue: 'Requires a server setting to be enabled' })}
					</Chip>
				</Box>
			)}

			{isSequence && (
				<Field marginBlockEnd={8}>
					<FieldLabel>{t('Boards_Automation_StepDelay', { defaultValue: 'Delay before this step' })}</FieldLabel>
					<FieldRow>
						<TextInput
							value={action.delay ?? ''}
							placeholder='1d'
							onChange={(e) => setParam('delay', (e.target as HTMLInputElement).value)}
						/>
					</FieldRow>
				</Field>
			)}

			{spec?.params.map((p) => (
				<Field key={p.key} marginBlockEnd={8}>
					<FieldLabel>
						{t(p.labelKey as Parameters<typeof t>[0])}
						{p.required === false ? ` (${t('Optional', { defaultValue: 'optional' })})` : ''}
					</FieldLabel>
					<FieldRow>
						<ParamInput
							kind={p.kind}
							value={action[p.key]}
							onChange={(v) => setParam(p.key, v)}
							options={options}
							boardId={boardId}
							placeholder={p.placeholder}
						/>
					</FieldRow>
				</Field>
			))}

			{spec && spec.params.length === 0 && !isSequence && (
				<Box fontScale='micro' color='hint'>
					{t('Boards_Automation_NoParamsHint', { defaultValue: 'No options for this action.' })}
				</Box>
			)}
		</Box>
	);
};

const ActionRows = ({ actions, options, boardId, isSequence, onChange }: ActionRowsProps): ReactElement => {
	const { t } = useTranslation();

	const add = (): void => {
		onChange([...actions, { _key: rowKey(), type: 'addLabel', ...(isSequence ? { delay: '0' } : {}) }]);
	};
	const update = (index: number, next: ActionDraft): void => {
		onChange(actions.map((a, i) => (i === index ? next : a)));
	};
	const remove = (index: number): void => {
		onChange(actions.filter((_, i) => i !== index));
	};
	const move = (index: number, dir: -1 | 1): void => {
		const target = index + dir;
		if (target < 0 || target >= actions.length) {
			return;
		}
		const next = [...actions];
		const [item] = next.splice(index, 1);
		next.splice(target, 0, item);
		onChange(next);
	};

	return (
		<Box>
			{actions.length === 0 && (
				<Box fontScale='c1' color='hint' marginBlockEnd={8}>
					{t('Boards_Automation_NoActionsHint', { defaultValue: 'Add at least one action.' })}
				</Box>
			)}
			{actions.map((action, index) => (
				<ActionRow
					key={action._key ?? index}
					action={action}
					index={index}
					count={actions.length}
					options={options}
					boardId={boardId}
					isSequence={isSequence}
					onChange={(next) => update(index, next)}
					onRemove={() => remove(index)}
					onMove={(dir) => move(index, dir)}
				/>
			))}
			<Button small primary marginBlockStart={4} onClick={add}>
				<Icon name='plus' size='x16' marginInlineEnd={4} />
				{t('Boards_Automation_AddAction', { defaultValue: 'Add action' })}
			</Button>
		</Box>
	);
};

export default ActionRows;
