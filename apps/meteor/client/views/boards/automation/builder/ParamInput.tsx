import type { SelectOption } from '@rocket.chat/fuselage';
import { Box, Select, TextInput, NumberInput, ToggleSwitch } from '@rocket.chat/fuselage';
import { useEndpoint } from '@rocket.chat/ui-contexts';
import { useQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { CARD_TYPES } from '../lib/catalog';
import type { ParamKind } from '../lib/catalog';
import type { BoardContextOptions } from '../lib/types';

/**
 * One dynamic input for a builder param (trigger filter / condition value / action
 * param). The `kind` (from the catalog) decides whether to render a board-context
 * Select (list/label/member/field), an entity Select fetched live (playbook /
 * sequence / template), a NumberInput, a ToggleSwitch, or a free-text TextInput.
 *
 * board-context options come from the parent (one `boards.info` read); the
 * playbook/sequence/template Selects fetch their own small lists here. When a
 * Select has no resolvable options (e.g. a GLOBAL automation with no board), we
 * degrade to a TextInput so the value can still be entered by id.
 */

type ParamInputProps = {
	kind: ParamKind;
	value: unknown;
	onChange: (next: unknown) => void;
	options: BoardContextOptions;
	boardId?: string;
	placeholder?: string;
	disabled?: boolean;
};

const toStr = (v: unknown): string => (v === undefined || v === null ? '' : String(v));

const useEntityOptions = (
	kind: ParamKind,
	boardId?: string,
): SelectOption[] => {
	const isPlaybook = kind === 'playbook';
	const isSequence = kind === 'sequence';
	const isTemplate = kind === 'template';

	const listPlaybooks = useEndpoint('GET', '/v1/boards.matters.playbooks.list');
	const listSequences = useEndpoint('GET', '/v1/boards.leads.sequences.list');
	const listTemplates = useEndpoint('GET', '/v1/boards.leads.template.list');

	const { data: playbookData } = useQuery({
		queryKey: ['boards', 'automation', 'playbooks', boardId],
		queryFn: () => listPlaybooks({}),
		enabled: isPlaybook,
	});
	const { data: sequenceData } = useQuery({
		queryKey: ['boards', 'automation', 'sequences', boardId],
		queryFn: () => listSequences({}),
		enabled: isSequence,
	});
	const { data: templateData } = useQuery({
		queryKey: ['boards', 'automation', 'templates', boardId],
		queryFn: () => listTemplates({}),
		enabled: isTemplate,
	});

	return useMemo<SelectOption[]>(() => {
		if (isPlaybook) {
			return (playbookData?.playbooks ?? []).map((p) => [p._id, p.name] as SelectOption);
		}
		if (isSequence) {
			return (sequenceData?.sequences ?? []).map((s) => [s._id, s.name] as SelectOption);
		}
		if (isTemplate) {
			return (templateData?.templates ?? []).map((tpl) => [tpl._id, tpl.name] as SelectOption);
		}
		return [];
	}, [isPlaybook, isSequence, isTemplate, playbookData, sequenceData, templateData]);
};

const ParamInput = ({ kind, value, onChange, options, boardId, placeholder, disabled }: ParamInputProps): ReactElement => {
	const { t } = useTranslation();

	const entityOptions = useEntityOptions(kind, boardId);

	const boardOptions = useMemo<SelectOption[]>(() => {
		switch (kind) {
			case 'list':
				return options.lists.map((o) => [o.value, o.label] as SelectOption);
			case 'label':
				return options.labels.map((o) => [o.value, o.label] as SelectOption);
			case 'member':
				return options.members.map((o) => [o.value, o.label] as SelectOption);
			case 'field':
				return options.fields.map((o) => [o.value, o.label] as SelectOption);
			case 'cardType':
				return CARD_TYPES.map((c) => [c, t(`Boards_CardType_${c}` as Parameters<typeof t>[0], { defaultValue: c })] as SelectOption);
			default:
				return [];
		}
	}, [kind, options, t]);

	if (kind === 'boolean') {
		return <ToggleSwitch checked={value === true} disabled={disabled} onChange={(e) => onChange((e.target as HTMLInputElement).checked)} />;
	}

	if (kind === 'number') {
		return (
			<NumberInput
				value={toStr(value)}
				placeholder={placeholder}
				disabled={disabled}
				onChange={(e) => {
					const raw = (e.target as HTMLInputElement).value;
					onChange(raw === '' ? undefined : Number(raw));
				}}
			/>
		);
	}

	// Select-backed kinds: render a Select if we have options, else fall back to text-by-id.
	const selectKinds: ParamKind[] = ['list', 'label', 'member', 'field', 'cardType', 'playbook', 'sequence', 'template'];
	if (selectKinds.includes(kind)) {
		const opts = ['playbook', 'sequence', 'template'].includes(kind) ? entityOptions : boardOptions;
		if (opts.length > 0) {
			return (
				<Select
					value={toStr(value) || undefined}
					placeholder={placeholder ?? t('Select_an_option')}
					disabled={disabled}
					options={opts}
					onChange={(next) => onChange(next)}
				/>
			);
		}
		// no options resolvable (global automation / empty board) -> raw id entry
		return (
			<Box display='flex' flexDirection='column'>
				<TextInput value={toStr(value)} placeholder={placeholder ?? t('ID')} disabled={disabled} onChange={(e) => onChange((e.target as HTMLInputElement).value)} />
			</Box>
		);
	}

	// text / duration -> free text (duration also supports {now+30d} tokens; the
	// token-insert affordance is provided by the parent TemplatedField where needed).
	return (
		<TextInput
			value={toStr(value)}
			placeholder={placeholder}
			disabled={disabled}
			onChange={(e) => onChange((e.target as HTMLInputElement).value)}
		/>
	);
};

export default ParamInput;
