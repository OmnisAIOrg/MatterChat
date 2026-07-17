import { Box } from '@rocket.chat/fuselage';
import { GenericMenu } from '@rocket.chat/ui-client';
import type { GenericMenuItemProps } from '@rocket.chat/ui-client';
import { useEndpoint, useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import { useMutation } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { BOARD_ACCENT_SWATCHES } from '../lib/boardSwatches';

/**
 * ListColorMenu — the per-list (column) accent-color picker in the board header.
 *
 * A small palette/swatch GenericMenu (mirroring BoardButtonsMenu's self-contained
 * launcher idiom) that lets the user pick an accent color for a list/column — or
 * clear it — via `POST /v1/boards.list.update { listId, patch: { color } }`. An
 * empty-string color clears the accent (the server treats '' as an unset).
 *
 * Colors are raw CSS color strings, exactly like board.background.value /
 * card.cover.value / label.color are rendered elsewhere in the boards UI.
 *
 * On success it asks the parent to refetch (so the freshly-colored list re-renders
 * with its new accent) — the parent owns the `['boards','info',boardId]` query.
 */

// Curated accent palette — the shared brand-derived accent set
// (lib/boardSwatches.ts); kept small so the menu stays a quick pick.
export const LIST_COLOR_SWATCHES: { id: string; value: string; label: string }[] = BOARD_ACCENT_SWATCHES;

type ListColorMenuProps = {
	listId: string;
	color?: string;
	onUpdated: () => void;
};

const ListColorMenu = ({ listId, color, onUpdated }: ListColorMenuProps): ReactElement => {
	const { t } = useTranslation();
	const dispatchToastMessage = useToastMessageDispatch();

	const listUpdate = useEndpoint('POST', '/v1/boards.list.update');

	const colorMutation = useMutation({
		// empty string clears the accent (server unsets it)
		mutationFn: (nextColor: string) => listUpdate({ listId, patch: { color: nextColor } }),
		onSuccess: () => onUpdated(),
		onError: (error) => dispatchToastMessage({ type: 'error', message: error }),
	});

	const swatch = (value?: string): ReactElement => (
		<Box
			width='x16'
			height='x16'
			borderRadius='x4'
			style={{
				backgroundColor: value || 'transparent',
				border: value ? '1px solid rgba(0,0,0,0.12)' : '1px dashed var(--rcx-color-stroke-medium, #cbced1)',
			}}
		/>
	);

	const items: GenericMenuItemProps[] = [
		...LIST_COLOR_SWATCHES.map((s) => ({
			id: s.id,
			status: swatch(s.value),
			content: t(`Boards_Color_${s.label}`, { defaultValue: s.label }),
			// a swatch already picked shows a check addon so the active color is obvious
			addon: color === s.value ? '✓' : undefined,
			disabled: colorMutation.isPending,
			onClick: () => colorMutation.mutate(s.value),
		})),
		{
			id: 'clear',
			status: swatch(undefined),
			content: t('Boards_Color_Clear', { defaultValue: 'No color' }),
			addon: !color ? '✓' : undefined,
			disabled: colorMutation.isPending,
			onClick: () => colorMutation.mutate(''),
		},
	];

	return <GenericMenu title={t('Boards_List_Color', { defaultValue: 'List color' })} icon='palette' items={items} placement='bottom-end' />;
};

export default ListColorMenu;
