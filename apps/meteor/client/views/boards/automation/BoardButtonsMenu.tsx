import type { IAutomation, Serialized } from '@rocket.chat/core-typings';
import type { Keys as IconName } from '@rocket.chat/icons';
import { GenericMenu } from '@rocket.chat/ui-client';
import type { GenericMenuItemProps } from '@rocket.chat/ui-client';
import { useEndpoint, usePermission, useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * BoardButtonsMenu — the M7 "board button" run surface in the board header.
 *
 * A self-contained kebab/overflow menu (mirroring ViewSwitcher's GenericMenu use
 * and BoardAutomationsButton's owns-its-own-state launcher pattern) that lists the
 * board's enabled board-button automations via
 * `GET /v1/boards.automations.buttonsForBoard` (no cardType — board buttons have no
 * card subject) and runs the picked one via `POST /v1/boards.automations.run
 * { automationId }`, toasting the run status exactly like AutomationList's run
 * action.
 *
 * Gated by `boards-run-automation`. Renders nothing when the user lacks the
 * permission or the board has no board buttons — so the header stays clean.
 */

type BoardButtonsMenuProps = {
	boardId: string;
};

const BoardButtonsMenu = ({ boardId }: BoardButtonsMenuProps): ReactElement | null => {
	const { t } = useTranslation();
	const dispatchToastMessage = useToastMessageDispatch();
	const canRun = usePermission('boards-run-automation');

	const buttonsForBoard = useEndpoint('GET', '/v1/boards.automations.buttonsForBoard');
	const runEndpoint = useEndpoint('POST', '/v1/boards.automations.run');

	const { data } = useQuery({
		queryKey: ['boards', 'automations', 'boardButtons', boardId],
		queryFn: () => buttonsForBoard({ boardId }),
		enabled: canRun,
	});

	const runMutation = useMutation({
		mutationFn: (automationId: string) => runEndpoint({ automationId }),
		onSuccess: (result) => {
			dispatchToastMessage({
				type: result.status === 'error' ? 'error' : 'success',
				message: t('Boards_Automation_RanWithStatus', { defaultValue: 'Ran ({{status}})', status: result.status }),
			});
		},
		onError: (error) => dispatchToastMessage({ type: 'error', message: error }),
	});

	if (!canRun) {
		return null;
	}

	// board buttons only (the read endpoint already returns all board-buttons + card-buttons;
	// without a cardType filter we keep only the board-scoped ones for this header surface).
	const buttons = ((data?.automations as Serialized<IAutomation>[] | undefined) ?? []).filter((a) => a.kind === 'board-button');

	if (buttons.length === 0) {
		return null;
	}

	const items: GenericMenuItemProps[] = buttons.map((automation) => ({
		id: automation._id,
		icon: (automation.icon as IconName) ?? 'play',
		content: automation.name,
		disabled: runMutation.isPending,
		onClick: () => runMutation.mutate(automation._id),
	}));

	return (
		<GenericMenu
			title={t('Boards_Automation_Board_Buttons', { defaultValue: 'Board buttons' })}
			icon='lightning'
			items={items}
			placement='bottom-end'
		/>
	);
};

export default BoardButtonsMenu;
