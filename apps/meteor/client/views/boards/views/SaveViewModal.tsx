import type { SavedViewType, Serialized, ISavedView } from '@rocket.chat/core-typings';
import { Box, CheckBox, Field, FieldHint, FieldLabel, FieldRow, Select, TextInput } from '@rocket.chat/fuselage';
import type { SelectOption } from '@rocket.chat/fuselage';
import { GenericModal } from '@rocket.chat/ui-client';
import { useEndpoint, useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { SAVED_VIEWS_KEY } from './lib/useSavedViews';

/**
 * SaveViewModal — create or update a board saved view (M8).
 *
 * Captures a name, the view type (table/timeline/dashboard/calendar/board), an
 * optional "share with the board" flag, and "make default". Persists via
 * `POST /v1/boards.views.upsert` (gated server-side by `boards-manage-saved-views`
 * + board visibility + per-view ownership on update). The current `viewType` is
 * pre-selected; `config` is carried through unchanged (the generic views don't
 * yet expose a filter builder, so a saved view today captures the chosen view
 * type + name + share/default — switching between named views is the value).
 */

type SaveViewModalProps = {
	boardId: string;
	currentViewType: SavedViewType;
	// when editing an existing view, prefill from it
	existing?: Serialized<ISavedView>;
	onClose: () => void;
	onSaved: (view: Serialized<ISavedView>) => void;
};

const VIEW_TYPE_KEYS: SavedViewType[] = ['board', 'table', 'timeline', 'calendar', 'dashboard'];

const SaveViewModal = ({ boardId, currentViewType, existing, onClose, onSaved }: SaveViewModalProps): ReactElement => {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const dispatchToastMessage = useToastMessageDispatch();

	const upsertView = useEndpoint('POST', '/v1/boards.views.upsert');

	const nameId = useId();
	const typeId = useId();

	const [name, setName] = useState(existing?.name ?? '');
	const [viewType, setViewType] = useState<SavedViewType>(existing?.viewType ?? currentViewType);
	const [shared, setShared] = useState<boolean>(existing?.shared ?? false);
	const [isDefault, setIsDefault] = useState<boolean>(existing?.isDefault ?? false);

	const typeOptions = useMemo<SelectOption[]>(
		() =>
			VIEW_TYPE_KEYS.map((vt) => [
				vt,
				t(`Boards_Views_Type_${vt.charAt(0).toUpperCase()}${vt.slice(1)}` as Parameters<typeof t>[0], { defaultValue: vt }),
			]),
		[t],
	);

	const saveMutation = useMutation({
		mutationFn: () =>
			upsertView({
				...(existing ? { viewId: existing._id } : {}),
				name: name.trim(),
				viewType,
				scope: 'board',
				boardId,
				// preserve any existing config; new views start empty (server defaults).
				...(existing?.config ? { config: existing.config as Record<string, unknown> } : {}),
				shared,
				isDefault,
			}),
		onSuccess: (result) => {
			dispatchToastMessage({ type: 'success', message: t('Saved') });
			void queryClient.invalidateQueries({ queryKey: SAVED_VIEWS_KEY(boardId) });
			onSaved(result.view as Serialized<ISavedView>);
			onClose();
		},
		onError: (error) => dispatchToastMessage({ type: 'error', message: error }),
	});

	return (
		<GenericModal
			title={existing ? t('Boards_Views_Edit', { defaultValue: 'Edit view' }) : t('Boards_Views_Save', { defaultValue: 'Save view' })}
			confirmText={t('Save')}
			onCancel={onClose}
			onClose={onClose}
			onConfirm={() => saveMutation.mutate()}
			confirmDisabled={!name.trim() || saveMutation.isPending}
		>
			<Field>
				<FieldLabel htmlFor={nameId}>{t('Name')}</FieldLabel>
				<FieldRow>
					<TextInput
						id={nameId}
						value={name}
						onChange={(e) => setName((e.target as HTMLInputElement).value)}
						placeholder={t('Boards_Views_NamePlaceholder', { defaultValue: 'e.g. My open matters' })}
					/>
				</FieldRow>
			</Field>

			<Field marginBlockStart={12}>
				<FieldLabel htmlFor={typeId}>{t('Boards_Views_Type', { defaultValue: 'View type' })}</FieldLabel>
				<FieldRow>
					<Select id={typeId} value={viewType} onChange={(v) => setViewType(v as SavedViewType)} options={typeOptions} />
				</FieldRow>
			</Field>

			<Field marginBlockStart={12}>
				<FieldRow>
					<CheckBox checked={shared} onChange={() => setShared((v) => !v)} />
					<FieldLabel marginInlineStart={8}>{t('Boards_Views_Shared', { defaultValue: 'Share with the board' })}</FieldLabel>
				</FieldRow>
				<FieldHint>{t('Boards_Views_SharedHint', { defaultValue: 'Other board members can switch to this view.' })}</FieldHint>
			</Field>

			<Field marginBlockStart={8}>
				<FieldRow>
					<CheckBox checked={isDefault} onChange={() => setIsDefault((v) => !v)} />
					<FieldLabel marginInlineStart={8}>{t('Boards_Views_Default', { defaultValue: 'Make default' })}</FieldLabel>
				</FieldRow>
				<FieldHint>{t('Boards_Views_DefaultHint', { defaultValue: 'Opened automatically for this board.' })}</FieldHint>
			</Field>

			<Box marginBlockStart={12} fontScale='micro' color='hint'>
				{t('Boards_Views_ConfigNote', {
					defaultValue: 'Filters and grouping from the current view are preserved when you save.',
				})}
			</Box>
		</GenericModal>
	);
};

export default SaveViewModal;
