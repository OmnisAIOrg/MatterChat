import type { BoardsCardType, BoardsPipelineType } from '@rocket.chat/core-typings';
import type { Keys as IconName } from '@rocket.chat/icons';

/**
 * cardType -> fuselage icon. NB: the spec named `kanban`/`briefcase`, which do
 * NOT exist in this fork's `@rocket.chat/icons`. Verified-present substitutes
 * are used here (kept consistent with the shell phase's choices: matters=`bag`,
 * leads=`magnifier`, generic=`squares`).
 */
export const cardTypeIcon: Record<BoardsCardType, IconName> = {
	task: 'circle-check',
	matter: 'bag',
	lead: 'magnifier',
	document: 'clip',
	evidence: 'flag',
};

/** pipelineType -> fuselage icon (board tile / header glyph). */
export const pipelineTypeIcon: Record<BoardsPipelineType, IconName> = {
	general: 'squares',
	matters: 'bag',
	leads: 'magnifier',
};

export const getCardTypeIcon = (cardType: BoardsCardType): IconName => cardTypeIcon[cardType] ?? 'circle-check';

export const getPipelineTypeIcon = (pipelineType: BoardsPipelineType): IconName => pipelineTypeIcon[pipelineType] ?? 'squares';
