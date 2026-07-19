import type { IBoardCard, IBoard, IBoardList, IBoardComment, Serialized, IUser } from '@rocket.chat/core-typings';
import { Rooms, Users } from '../../../app/models/server';
import { getCardsForBoard, getListsForBoard, getBoardInfo } from './index';
import { db } from '../../../server/database/client';

export type ExportFormat = 'csv' | 'json';

interface ExportOptions {
  boardId: string;
  format: ExportFormat;
  listIds?: string[];
}

/**
 * Check if a user has guest role and should have watermarked exports.
 * MATTERCHAT: Guests can only access invited boards/channels and exports are watermarked.
 */
async function shouldWatermarkExport(userId: string): Promise<boolean> {
  const user = await Users.findOneById(userId);
  return user?.roles?.includes('guest') ?? false;
}

/**
 * CSV export for board cards.
 * Returns a map of list names to CSV content.
 */
export async function generateBoardExportCSV(
  userId: string,
  boardId: string,
  listIds?: string[],
): Promise<Record<string, string>> {
  const { board, lists } = await getBoardInfo(userId, boardId);

  if (!board) {
    throw new Error('Board not found');
  }

  const filteredLists = listIds ? lists.filter((l) => listIds.includes(l._id)) : lists;
  const result: Record<string, string> = {};
  const isGuest = await shouldWatermarkExport(userId);

  // CSV header
  const header = [
    'ID',
    'Title',
    'Description',
    'List',
    'Status',
    'Assignees',
    'Labels',
    'Due Date',
    'Time Estimate (mins)',
    'Time Spent (mins)',
    'Created By',
    'Created Date',
    'Updated Date',
  ].join(',');

  for (const list of filteredLists) {
    const cards = await getCardsForBoard(userId, boardId, { offset: 0, count: 10000 });
    const listCards = cards.cards.filter((c) => c.listId === list._id);

    // MATTERCHAT: Add watermark for guest users
    const csvRows: string[] = [];
    if (isGuest) {
      csvRows.push(`# GUEST USER EXPORT - ${new Date().toISOString()}`);
      csvRows.push(`# This export is confidential and for authorized recipients only.`);
      csvRows.push('');
    }
    csvRows.push(header);

    for (const card of listCards) {
      const assigneeNames = card.assignees?.length
        ? (
            await Users.findByIds(card.assignees, { projection: { name: 1 } }).toArray()
          )
            .map((u) => u.name)
            .join('; ')
        : '';

      const labelNames = card.labels?.join('; ') ?? '';
      const dueDate = card.dueDate ? new Date(card.dueDate).toISOString().split('T')[0] : '';
      const timeEstimate = card.timeEstimateMinutes ?? '';
      const timeSpent = card.timeEntries
        ? card.timeEntries.reduce((sum, entry) => sum + (entry.minutes ?? 0), 0)
        : '';

      const createdBy = card.createdBy ? (await Users.findOneById(card.createdBy))?.name : '';
      const createdDate = new Date(card.createdAt).toISOString().split('T')[0];
      const updatedDate = new Date(card.updatedAt).toISOString().split('T')[0];

      const row = [
        escapeCSV(card._id),
        escapeCSV(card.title),
        escapeCSV(card.description ?? ''),
        escapeCSV(list.title),
        escapeCSV(card.status ?? ''),
        escapeCSV(assigneeNames),
        escapeCSV(labelNames),
        dueDate,
        timeEstimate,
        timeSpent,
        escapeCSV(createdBy ?? ''),
        createdDate,
        updatedDate,
      ];

      csvRows.push(row.join(','));
    }

    result[list.title] = csvRows.join('\n');
  }

  return result;
}

/**
 * JSON export for board (includes all structure and activity).
 */
export async function generateBoardExportJSON(
  userId: string,
  boardId: string,
): Promise<{
  board: Serialized<IBoard>;
  lists: Serialized<IBoardList>[];
  cards: Serialized<IBoardCard>[];
  comments: any[];
  activities: any[];
  watermark?: { isGuest: boolean; exportedAt: string };
}> {
  const { board, lists } = await getBoardInfo(userId, boardId);

  if (!board) {
    throw new Error('Board not found');
  }

  const cardsResult = await getCardsForBoard(userId, boardId, { offset: 0, count: 10000 });
  const cards = cardsResult.cards;
  const isGuest = await shouldWatermarkExport(userId);

  // Fetch comments for all cards
  const Rooms_collection = db.getCollection('rocketchat_subscription');
  const commentsCollection = db.getCollection('rocketchat_room');

  const comments: any[] = [];
  const activities: any[] = [];

  // Gather all comments from cards
  for (const card of cards) {
    if (card.comments && Array.isArray(card.comments)) {
      comments.push(
        ...card.comments.map((comment: any) => ({
          ...comment,
          cardId: card._id,
        })),
      );
    }
  }

  return {
    board: board as Serialized<IBoard>,
    lists: lists as Serialized<IBoardList>[],
    cards: cards as Serialized<IBoardCard>[],
    comments,
    activities,
    // MATTERCHAT: Add watermark for guest users
    ...(isGuest && {
      watermark: {
        isGuest: true,
        exportedAt: new Date().toISOString(),
      },
    }),
  };
}

/**
 * Escape CSV field values (handle quotes, commas, newlines).
 */
function escapeCSV(value: string): string {
  if (!value) return '';
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
