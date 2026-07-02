import { Button, Icon } from '@rocket.chat/fuselage';
import { useRouter } from '@rocket.chat/ui-contexts';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * BoardFormsButton — one-line header launcher for the per-board Forms manager
 * (parity P0.7), mirroring BoardAutomationsButton's insertion pattern:
 *
 *   <BoardFormsButton boardId={board._id} />
 *
 * Navigates to the 'forms' view of the board route (BoardRouter renders
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
		<Button
			small={small}
			onClick={() => router.navigate({ name: 'boards-board', params: { id: boardId, view: 'forms' } })}
			title={t('Boards_Forms_Title', { defaultValue: 'Forms' })}
		>
			<Icon name='clipboard' size='x16' mie={4} />
			{t('Boards_Forms_Title', { defaultValue: 'Forms' })}
		</Button>
	);
};

export default BoardFormsButton;
