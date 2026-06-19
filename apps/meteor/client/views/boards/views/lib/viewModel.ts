import type {
	IBoard,
	IBoardCard,
	IBoardLabelDef,
	ISavedView,
	SavedViewType,
	Serialized,
} from '@rocket.chat/core-typings';
import type { Keys as IconName } from '@rocket.chat/icons';

/**
 * Shared view-model helpers for the M8 generic Boards views (Table / Timeline /
 * Dashboard) and the saved-view switcher.
 *
 * The server's `boards.views.cards` engine does the filtering / sorting /
 * grouping (translating `ISavedViewConfig` -> the indexed BoardsCards.search +
 * JS sort/group); these helpers are PURELY presentational — resolve a label-def
 * to its color, format a due date, pick an icon per view type, etc. Card Date
 * fields arrive as ISO strings over the wire, hence `Serialized<IBoardCard>`.
 */

export type SerializedCard = Serialized<IBoardCard>;
export type SerializedBoard = Serialized<IBoard>;
export type SerializedSavedView = Serialized<ISavedView>;

// The four switchable generic views (Board/kanban is handled by the existing
// BoardView; calendar by the matters calendar). These are the M8 additions.
export const GENERIC_VIEW_TYPES: SavedViewType[] = ['table', 'timeline', 'dashboard'];

// `kanban`/`table` glyphs vary by fork; resolve defensively to verified-present icons.
export const safeViewTypeIcon = (viewType: SavedViewType): IconName => {
	switch (viewType) {
		case 'table':
			return 'list-bullets';
		case 'timeline':
			return 'clock';
		case 'dashboard':
			return 'dashboard';
		case 'calendar':
			return 'calendar';
		case 'board':
		default:
			return 'squares';
	}
};

export const fmtDate = (value?: string | Date): string => {
	if (!value) {
		return '—';
	}
	const d = typeof value === 'string' ? new Date(value) : value;
	if (Number.isNaN(d.getTime())) {
		return '—';
	}
	return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

export const fmtShortDate = (value?: string | Date): string => {
	if (!value) {
		return '';
	}
	const d = typeof value === 'string' ? new Date(value) : value;
	if (Number.isNaN(d.getTime())) {
		return '';
	}
	return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

export const asTime = (value?: string | Date): number | undefined => {
	if (!value) {
		return undefined;
	}
	const d = typeof value === 'string' ? new Date(value) : value;
	const ms = d.getTime();
	return Number.isNaN(ms) ? undefined : ms;
};

export const isOverdue = (dueDate?: string | Date, dueComplete?: boolean): boolean => {
	const ms = asTime(dueDate);
	if (ms === undefined || dueComplete) {
		return false;
	}
	return ms < Date.now();
};

/** Resolve a board label id -> its def (name + color) for chips/columns. */
export const labelDefById = (board: SerializedBoard | undefined, labelId: string): IBoardLabelDef | undefined =>
	board?.labelDefs?.find((l) => l.id === labelId);

/** Resolve a board field def id -> its name (for visibleFields columns / groupBy). */
export const fieldNameById = (board: SerializedBoard | undefined, fieldId: string): string =>
	board?.fieldDefs?.find((f) => f.id === fieldId)?.name ?? fieldId;

/** A card field value rendered as a string (BoardsFieldValue is string|number|boolean|null). */
export const fieldValueToString = (card: SerializedCard, fieldId: string): string => {
	const raw = card.fieldValues?.[fieldId];
	if (raw === undefined || raw === null || raw === '') {
		return '';
	}
	if (typeof raw === 'boolean') {
		return raw ? '✓' : '';
	}
	return String(raw);
};

/**
 * The list of date fields a Timeline/Calendar view can plot, paired with a
 * resolver that reads the field off a (serialized) card. `field:<id>` is read
 * from fieldValues (string dates only). Mirrors the server queryBoardCards
 * dateField echo.
 */
export const cardDateValue = (card: SerializedCard, dateField: string | undefined): string | Date | undefined => {
	switch (dateField) {
		case undefined:
		case '':
		case 'dueDate':
			return card.dueDate;
		case 'startDate':
			// startDate is an optional card date in some pipelines; read defensively.
			return (card as unknown as { startDate?: string | Date }).startDate;
		default:
			if (dateField.startsWith('field:')) {
				const raw = card.fieldValues?.[dateField.slice('field:'.length)];
				return typeof raw === 'string' ? raw : undefined;
			}
			return card.dueDate;
	}
};
