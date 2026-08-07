import type { IAutomation, Serialized } from '@rocket.chat/core-typings';
import { Box, Button, ButtonGroup, Icon, Throbber } from '@rocket.chat/fuselage';
import type { Keys as IconName } from '@rocket.chat/icons';
import { useEndpoint, usePermission, useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * CardButtonsRow — the M7 "card button" run surface on a card detail (CardDetail).
 *
 * Reads the board's enabled card-button automations via
 * `GET /v1/boards.automations.buttonsForBoard` (filtered by the card's `cardType`,
 * so a button scoped to matters only shows on matter cards) and renders a row of
 * Fuselage Buttons. Clicking one runs that automation against THIS card via
 * `POST /v1/boards.automations.run { automationId, cardId }` and toasts the run
 * status — mirroring AutomationList's run action exactly (same endpoint, same
 * `Boards_Automation_RanWithStatus` toast, same status-driven error/success type).
 *
 * Gated by `boards-run-automation`. The whole row is hidden when the user lacks
 * the permission, while loading, or when the board has no matching card buttons —
 * so it never renders an empty shell.
 */

type CardButtonsRowProps = {
	boardId: string;
	cardId: string;
	cardType: string;
};

const CardButtonsRow = ({ boardId, cardId, cardType }: CardButtonsRowProps): ReactElement | null => {
	const { t } = useTranslation();
	const dispatchToastMessage = useToastMessageDispatch();
	const queryClient = useQueryClient();
	const canRun = usePermission('boards-run-automation');

	const buttonsForBoard = useEndpoint('GET', '/v1/boards.automations.buttonsForBoard');
	const runEndpoint = useEndpoint('POST', '/v1/boards.automations.run');

	const { data, isLoading } = useQuery({
		queryKey: ['boards', 'automations', 'cardButtons', boardId, cardType],
		queryFn: () => buttonsForBoard({ boardId, cardType }),
		enabled: canRun,
	});

	const runMutation = useMutation({
		mutationFn: (automationId: string) => runEndpoint({ automationId, cardId }),
		onSuccess: (result) => {
			dispatchToastMessage({
				type: result.status === 'error' ? 'error' : 'success',
				message: t('Boards_Automation_RanWithStatus', { defaultValue: 'Ran ({{status}})', status: result.status }),
			});
			void queryClient.invalidateQueries({ queryKey: ['boards', 'card', cardId] });
			void queryClient.invalidateQueries({ queryKey: ['boards', 'cards', boardId] });
			void queryClient.invalidateQueries({ queryKey: ['boards', 'activities', cardId] });
		},
		onError: (error) => dispatchToastMessage({ type: 'error', message: error }),
	});

	if (!canRun || isLoading) {
		return null;
	}

	const buttons = (data?.automations as Serialized<IAutomation>[] | undefined) ?? [];

	if (buttons.length === 0) {
		return null;
	}

	return (
		<Box marginBlockStart={16}>
			<Box fontScale='c1' color='hint' marginBlockEnd={8}>
				{t('Boards_Automation_Card_Buttons', { defaultValue: 'Card buttons' })}
			</Box>
			<ButtonGroup>
				{buttons.map((automation) => (
					<Button
						key={automation._id}
						small
						disabled={runMutation.isPending}
						onClick={() => runMutation.mutate(automation._id)}
						title={automation.description ?? automation.name}
					>
						{runMutation.isPending && runMutation.variables === automation._id ? (
							<Throbber inheritColor size='x12' marginInlineEnd={4} />
						) : (
							<Icon name={(automation.icon as IconName) ?? 'play'} size='x16' marginInlineEnd={4} />
						)}
						{automation.name}
					</Button>
				))}
			</ButtonGroup>
		</Box>
	);
};

export default CardButtonsRow;
