import { Button, Icon } from '@rocket.chat/fuselage';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AutomationsContextualBar from './AutomationsContextualBar';

/**
 * BoardAutomationsButton — the self-contained launcher for the per-board Automations
 * manager. Owns both the header button AND the contextualbar open state so the
 * board views can light up automations with a single one-line insertion:
 *
 *   <BoardAutomationsButton boardId={board._id} />
 *
 * placed inside the board header's <ButtonGroup> (BoardHeader / MattersBoardRoute /
 * LeadsBoardRoute). Keeping the state here means the board-view files (owned by other
 * phases) need no new state wiring — see WIRING_SCHEMA for the exact insertion points
 * reported to Integration.
 */

type BoardAutomationsButtonProps = {
	boardId: string;
	/** render as a small header button (default) */
	small?: boolean;
};

const BoardAutomationsButton = ({ boardId, small = true }: BoardAutomationsButtonProps): ReactElement => {
	const { t } = useTranslation();
	const [open, setOpen] = useState(false);

	return (
		<>
			<Button small={small} onClick={() => setOpen(true)} title={t('Boards_Automations', { defaultValue: 'Automations' })}>
				<Icon name='lightning' size='x16' marginInlineEnd={4} />
				{t('Boards_Automations', { defaultValue: 'Automations' })}
			</Button>
			{open && <AutomationsContextualBar boardId={boardId} onClose={() => setOpen(false)} />}
		</>
	);
};

export default BoardAutomationsButton;
