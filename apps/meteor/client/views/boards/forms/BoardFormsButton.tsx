import { IconButton } from '@rocket.chat/fuselage';
import { useRouter } from '@rocket.chat/ui-contexts';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * BoardFormsButton — one-line header launcher for the per-board Forms manager
 * (parity P0.7), mirroring BoardAutomationsButton's insertion pattern:
 *
 *   <BoardFormsButton boardId={board._id} />
 *
 * Ledger chrome: a compact ICON button (tooltip + aria-label carry the
 * "Forms" label) instead of the wide labelled button. Navigation target is
 * unchanged — the 'forms' view of the board route (BoardRouter renders
 * FormsManager for view === 'forms').
 */

type BoardFormsButtonProps = {
	boardId: string;
	small?: boolean;
};

const BoardFormsButton = ({ boardId, small = true }: BoardFormsButtonProps): ReactElement => {
	const { t } = useTranslation();
	const router = useRouter();

	return (
		<IconButton
			small={small}
			icon='clipboard'
			onClick={() => router.navigate({ name: 'boards-board', params: { id: boardId, view: 'forms' } })}
			title={t('Boards_Forms_Title', { defaultValue: 'Forms' })}
			aria-label={t('Boards_Forms_Title', { defaultValue: 'Forms' })}
		/>
	);
};

export default BoardFormsButton;
