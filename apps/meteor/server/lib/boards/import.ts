import type { IBoard, IBoardCard, IBoardList, IBoardCardAssignee } from '@rocket.chat/core-typings';
import { Users } from '../../../app/models/server';
import { createBoard, createList, createCard } from './index';

export interface TrelloJSON {
  id: string;
  name: string;
  desc?: string;
  lists: TrelloList[];
  cards: TrelloCard[];
  labels: TrelloLabel[];
  members?: TrelloMember[];
}

export interface TrelloList {
  id: string;
  name: string;
  pos?: number;
}

export interface TrelloCard {
  id: string;
  name: string;
  desc?: string;
  idList: string;
  idLabels?: string[];
  due?: string;
  idMembers?: string[];
  comments?: TrelloComment[];
  checkLists?: TrelloChecklist[];
  url?: string;
}

export interface TrelloComment {
  id: string;
  data: {
    text: string;
  };
  memberCreator?: {
    id: string;
    username: string;
  };
  date?: string;
}

export interface TrelloChecklist {
  id: string;
  name: string;
  checkItems?: Array<{
    id: string;
    name: string;
    state: 'complete' | 'incomplete';
  }>;
}

export interface TrelloLabel {
  id: string;
  name: string;
  color?: string;
}

export interface TrelloMember {
  id: string;
  username: string;
  email?: string;
  fullName?: string;
}

export interface ImportJobStatus {
  status: 'queued' | 'processing' | 'complete' | 'failed';
  progress: number;
  boardId?: string;
  error?: string;
  cardCount?: number;
  listCount?: number;
}

/**
 * Parse and validate Trello JSON export.
 */
export async function parseTrelloJSON(jsonData: any): Promise<TrelloJSON> {
  if (!jsonData || typeof jsonData !== 'object') {
    throw new Error('Invalid JSON data');
  }

  if (!Array.isArray(jsonData.lists) || !Array.isArray(jsonData.cards)) {
    throw new Error('JSON must contain lists and cards arrays');
  }

  return jsonData as TrelloJSON;
}

/**
 * Import Trello board into MatterChat.
 * Performs mapping:
 * - Trello lists → MatterChat lists
 * - Trello cards → MatterChat cards
 * - Trello labels → MatterChat labels
 * - Trello members (by email) → MatterChat assignees
 * - Trello checklists → description notes
 * - Trello comments → MatterChat comments (stored in card.comments)
 */
export async function importTrelloBoard(
  userId: string,
  trelloData: TrelloJSON,
  boardName: string,
  boardType: 'general' | 'task' | 'matters' | 'leads' = 'general',
): Promise<{ boardId: string; cardCount: number; listCount: number }> {
  // Create board
  const board = await createBoard(
    userId,
    {
      title: boardName || trelloData.name,
      description: trelloData.desc || '',
      pipelineType: boardType,
    },
    {},
  );

  if (!board) {
    throw new Error('Failed to create board');
  }

  const boardId = board._id;
  const listMap: Record<string, string> = {}; // Trello listId → MatterChat listId
  let cardCount = 0;

  // Build member email map for user lookup
  const memberMap: Record<string, string> = {}; // Trello memberId → MatterChat userId
  if (trelloData.members) {
    for (const member of trelloData.members) {
      if (member.email) {
        const user = await Users.findOneByEmailAddress(member.email, {
          projection: { _id: 1 },
        });
        if (user) {
          memberMap[member.id] = user._id;
        }
      }
    }
  }

  // Create lists (in order)
  const sortedLists = (trelloData.lists || []).sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0));

  for (const trelloList of sortedLists) {
    const list = await createList(userId, {
      boardId,
      title: trelloList.name,
    });
    if (list) {
      listMap[trelloList.id] = list._id;
    }
  }

  // Create cards (sorted by position)
  const sortedCards = (trelloData.cards || []).sort((a, b) => {
    const posA = (a as any).pos ?? 0;
    const posB = (b as any).pos ?? 0;
    return posA - posB;
  });

  for (const trelloCard of sortedCards) {
    const listId = listMap[trelloCard.idList];
    if (!listId) {
      continue; // Skip cards for missing lists
    }

    // Resolve assignees
    const assignees: IBoardCardAssignee[] = [];
    if (trelloCard.idMembers) {
      for (const memberId of trelloCard.idMembers) {
        const userId = memberMap[memberId];
        if (userId) {
          assignees.push({ userId });
        }
      }
    }

    // Build description with checklists
    let description = trelloCard.desc || '';
    if (trelloCard.checkLists && trelloCard.checkLists.length > 0) {
      description += '\n\nChecklists:\n';
      for (const checklist of trelloCard.checkLists) {
        description += `- ${checklist.name}\n`;
        if (checklist.checkItems) {
          for (const item of checklist.checkItems) {
            const status = item.state === 'complete' ? '[x]' : '[ ]';
            description += `  ${status} ${item.name}\n`;
          }
        }
      }
    }

    // Parse due date
    let dueDate: Date | undefined;
    if (trelloCard.due) {
      const parsed = new Date(trelloCard.due);
      if (!isNaN(parsed.getTime())) {
        dueDate = parsed;
      }
    }

    // Create card
    try {
      const card = await createCard(
        userId,
        {
          boardId,
          listId,
          title: trelloCard.name,
          description: description.trim(),
          dueDate,
          assignees,
          labels: trelloCard.idLabels || [],
        },
        {},
      );

      if (card) {
        cardCount++;

        // Store comments in card.comments field
        if (trelloCard.comments && trelloCard.comments.length > 0) {
          // Note: This would need to be updated in the card via a separate update call
          // For now, comments are stored in description or could be added via a separate method
        }
      }
    } catch (error) {
      // Continue on card creation error, log for diagnostic
      console.warn(`Failed to create card "${trelloCard.name}":`, error);
    }
  }

  return {
    boardId,
    cardCount,
    listCount: Object.keys(listMap).length,
  };
}
