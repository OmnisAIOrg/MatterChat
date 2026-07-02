import type {
	IBoardCard,
	IBoardCardLink,
	ICardCalendarSync,
	IMatterSnapshot,
	BoardsFieldValue,
	OmnisCardQuery,
	RocketChatRecordDeleted,
} from '@rocket.chat/core-typings';
import type { IBoardsCardsModel } from '@rocket.chat/model-typings';
import type { Collection, Db, Filter, FindCursor, FindOptions, IndexDescription, UpdateResult } from 'mongodb';

import { BaseRaw } from './BaseRaw';

export class BoardsCardsRaw extends BaseRaw<IBoardCard> implements IBoardsCardsModel {
	constructor(db: Db, trash?: Collection<RocketChatRecordDeleted<IBoardCard>>) {
		super(db, 'boards_cards', trash, {
			collectionNameResolver(name) {
				return name;
			},
		});
	}

	protected override modelIndexes(): IndexDescription[] {
		return [
			{ key: { listId: 1, position: 1, archived: 1 } },
			{ key: { boardId: 1, archived: 1 } },
			{ key: { boardId: 1, dueDate: 1 } },
			{ key: { assignees: 1, archived: 1 } },
			{ key: { labels: 1 } },
			{ key: { 'link.matterId': 1 }, sparse: true },
			{ key: { 'link.leadId': 1 }, sparse: true },
			{ key: { boardId: 1, cardNumber: 1 }, unique: true },
			{ key: { title: 'text', description: 'text' } },
		];
	}

	public findByList(listId: string, options?: FindOptions<IBoardCard>): FindCursor<IBoardCard> {
		return this.find({ listId, archived: { $ne: true } }, { sort: { position: 1 }, ...options });
	}

	public findByBoard(boardId: string, options?: FindOptions<IBoardCard>): FindCursor<IBoardCard> {
		return this.find({ boardId, archived: { $ne: true } }, options);
	}

	public findByAssignee(userId: string, options?: FindOptions<IBoardCard>): FindCursor<IBoardCard> {
		return this.find({ assignees: userId, archived: { $ne: true } }, options);
	}

	public findDueBetween(from: Date, to: Date, boardId?: string): FindCursor<IBoardCard> {
		return this.find({
			...(boardId ? { boardId } : {}),
			archived: { $ne: true },
			dueDate: { $gte: from, $lt: to },
		});
	}

	public findByMatterId(matterId: string): FindCursor<IBoardCard> {
		return this.find({ 'link.matterId': matterId });
	}

	public findOneByLeadId(leadId: string): Promise<IBoardCard | null> {
		return this.findOne({ 'link.leadId': leadId });
	}

	public search(boardId: string, query: OmnisCardQuery): FindCursor<IBoardCard> {
		// dotted custom-field paths aren't expressible on Filter<IBoardCard>, so build
		// the filter as a loose record and cast once at the end.
		const filter: Record<string, unknown> = { boardId };

		if (query.isOpen !== false) {
			filter.archived = { $ne: true };
		}
		if (query.text) {
			filter.$text = { $search: query.text };
		}
		if (query.labels?.length) {
			filter.labels = { $in: query.labels };
		}
		if (query.assignees?.length) {
			filter.assignees = { $in: query.assignees };
		}
		if (query.cardType?.length) {
			filter.cardType = { $in: query.cardType };
		}
		if (query.listIds?.length) {
			filter.listId = { $in: query.listIds };
		}
		if (query.due) {
			const now = new Date();
			switch (query.due) {
				case 'overdue':
					filter.dueDate = { $lt: now };
					filter.dueComplete = { $ne: true };
					break;
				case 'today': {
					const end = new Date(now);
					end.setHours(23, 59, 59, 999);
					filter.dueDate = { $gte: now, $lte: end };
					break;
				}
				case 'week': {
					const end = new Date(now);
					end.setDate(end.getDate() + 7);
					filter.dueDate = { $gte: now, $lte: end };
					break;
				}
				case 'none':
					filter.dueDate = { $exists: false };
					break;
				case 'complete':
					filter.dueComplete = true;
					break;
				case 'incomplete':
					filter.dueComplete = { $ne: true };
					break;
			}
		}
		if (query.fieldFilters?.length) {
			for (const f of query.fieldFilters) {
				const path = `fieldValues.${f.fieldId}`;
				switch (f.op) {
					case 'eq':
						filter[path] = f.value;
						break;
					case 'neq':
						filter[path] = { $ne: f.value };
						break;
					case 'gt':
						filter[path] = { $gt: f.value };
						break;
					case 'lt':
						filter[path] = { $lt: f.value };
						break;
					case 'contains':
						filter[path] = { $regex: String(f.value ?? ''), $options: 'i' };
						break;
					case 'set':
						filter[path] = { $exists: true, $nin: [null, ''] };
						break;
					case 'unset':
						filter[path] = { $in: [null, undefined] };
						break;
				}
			}
		}

		return this.find(filter as Filter<IBoardCard>, { sort: { position: 1 } });
	}

	public move(cardId: string, listId: string, position: number, subStatus?: string): Promise<UpdateResult> {
		return this.updateOne(
			{ _id: cardId },
			{
				$set: {
					listId,
					position,
					...(subStatus !== undefined ? { subStatus } : {}),
				},
				$inc: { rev: 1 },
			},
		);
	}

	public setFieldValue(cardId: string, fieldId: string, value: BoardsFieldValue): Promise<UpdateResult> {
		return this.updateOne({ _id: cardId }, { $set: { [`fieldValues.${fieldId}`]: value }, $inc: { rev: 1 } });
	}

	public setLink(cardId: string, link: IBoardCardLink): Promise<UpdateResult> {
		return this.updateOne({ _id: cardId }, { $set: { link }, $inc: { rev: 1 } });
	}

	public refreshMatterSnapshot(cardId: string, snapshot: IMatterSnapshot): Promise<UpdateResult> {
		return this.updateOne(
			{ '_id': cardId, 'link.kind': 'matter' },
			{ $set: { 'link.snapshot': snapshot, 'link.snapshotAt': new Date() } },
		);
	}

	public addLabel(cardId: string, labelId: string): Promise<UpdateResult> {
		return this.updateOne({ _id: cardId }, { $addToSet: { labels: labelId }, $inc: { rev: 1 } });
	}

	public removeLabel(cardId: string, labelId: string): Promise<UpdateResult> {
		return this.updateOne({ _id: cardId }, { $pull: { labels: labelId }, $inc: { rev: 1 } });
	}

	public archiveCard(cardId: string): Promise<UpdateResult> {
		return this.updateOne({ _id: cardId }, { $set: { archived: true }, $inc: { rev: 1 } });
	}

	public archiveByList(listId: string): Promise<UpdateResult> {
		return this.updateMany({ listId }, { $set: { archived: true } }) as Promise<UpdateResult>;
	}

	public archiveByBoard(boardId: string): Promise<UpdateResult> {
		return this.updateMany({ boardId }, { $set: { archived: true } }) as Promise<UpdateResult>;
	}

	public async maxPosition(listId: string): Promise<number> {
		const card = await this.findOne<Pick<IBoardCard, 'position'>>(
			{ listId, archived: { $ne: true } },
			{ sort: { position: -1 }, projection: { position: 1 } },
		);
		return card?.position ?? 0;
	}

	public async minPosition(listId: string): Promise<number> {
		const card = await this.findOne<Pick<IBoardCard, 'position'>>(
			{ listId, archived: { $ne: true } },
			{ sort: { position: 1 }, projection: { position: 1 } },
		);
		return card?.position ?? 0;
	}

	// ─── two-way calendar sync (Phase 3) ────────────────────────────────────────────────────────

	public findAssignedDueBetween(userId: string, from: Date, to: Date): FindCursor<IBoardCard> {
		return this.find({ assignees: userId, archived: { $ne: true }, dueDate: { $gte: from, $lt: to } });
	}

	public findOneByCalendarEvent(connectionId: string, externalEventId: string): Promise<IBoardCard | null> {
		return this.findOne({ calendarSync: { $elemMatch: { connectionId, externalEventId } } });
	}

	public findByCalendarConnection(connectionId: string): FindCursor<IBoardCard> {
		return this.find({ 'calendarSync.connectionId': connectionId });
	}

	public async upsertCalendarSync(cardId: string, sync: ICardCalendarSync): Promise<UpdateResult> {
		// Replace-if-present, else push: remove any existing entry for this connection, then add the new
		// one. Two writes keeps the semantics simple (Mongo has no single-op array upsert-by-key).
		await this.updateOne({ _id: cardId }, { $pull: { calendarSync: { connectionId: sync.connectionId } } });
		return this.updateOne({ _id: cardId }, { $push: { calendarSync: sync } });
	}

	public removeCalendarSync(cardId: string, connectionId: string): Promise<UpdateResult> {
		return this.updateOne({ _id: cardId }, { $pull: { calendarSync: { connectionId } } });
	}

	public setDueDate(cardId: string, dueDate: Date): Promise<UpdateResult> {
		return this.updateOne({ _id: cardId }, { $set: { dueDate }, $inc: { rev: 1 } });
	}
}
