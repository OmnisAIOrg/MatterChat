import type { CalendarProvider, IBoardCalendarConnection, IBoardCalendarPushSubscription, IEncryptedTokenRef } from '@rocket.chat/core-typings';
import type { DeleteResult, FindCursor, UpdateResult } from 'mongodb';

import type { IBaseModel } from './IBaseModel';

/**
 * The mutable fields the OAuth callback writes when creating/refreshing a Boards calendar connection.
 * The identity pair (userId, provider) is supplied separately to upsertUserConnection.
 */
export type UpsertBoardCalendarConnection = {
	accountEmail?: string;
	status: IBoardCalendarConnection['status'];
	scopes: string[];
	credentials?: IEncryptedTokenRef;
	targetCalendarId: string;
	lastPushAt?: Date;
	lastPollAt?: Date;
};

/**
 * Model for the per-user `boards_calendar_connections` collection.
 *
 * Every method is scoped by `userId` by design — a user manages only their OWN calendar connection.
 * Callers (REST routes / sync jobs) pass the authenticated user's id; the model never returns another
 * user's connection from the ownership-scoped helpers.
 */
export interface IBoardCalendarConnectionsModel extends IBaseModel<IBoardCalendarConnection> {
	/** All calendar connections owned by a user (any status), newest first. */
	findByUserId(userId: string): FindCursor<IBoardCalendarConnection>;
	/** A single connection by the (user, provider) identity pair. */
	findOneByUserIdAndProvider(userId: string, provider: CalendarProvider): Promise<IBoardCalendarConnection | null>;
	/** A single connection by id, but only if it belongs to `userId` (ownership-scoped lookup). */
	findOneByIdAndUserId(id: string, userId: string): Promise<IBoardCalendarConnection | null>;
	/** Every connection currently `connected` (the sync jobs iterate this). */
	findConnected(provider?: CalendarProvider): FindCursor<IBoardCalendarConnection>;
	/** Create-or-update the connection for a (user, provider); returns its `_id`. */
	upsertUserConnection(userId: string, provider: CalendarProvider, data: UpsertBoardCalendarConnection): Promise<{ _id: string; result: UpdateResult }>;
	/** Delete a connection only if it belongs to `userId`. */
	deleteByIdAndUserId(id: string, userId: string): Promise<DeleteResult>;
	/**
	 * Persist a re-encrypted credential blob after a mid-call token refresh. Touches ONLY the
	 * credentials field — status/scopes/email are untouched.
	 */
	updateCredentialsById(id: string, credentials: IEncryptedTokenRef): Promise<UpdateResult>;
	/** Flip a connection's lifecycle status (e.g. `error` on refresh-token death). */
	setStatusById(id: string, status: IBoardCalendarConnection['status']): Promise<UpdateResult>;
	/** Persist the inbound sync cursor (Google syncToken / Graph deltaLink) after a poll. */
	setSyncCursorById(id: string, syncCursor: string | undefined): Promise<UpdateResult>;
	/** Set the opt-in inbound board/list a new calendar event becomes a card on. */
	setInboundBoardById(id: string, inboundBoardId: string | undefined, inboundListId: string | undefined): Promise<UpdateResult>;
	/** Stamp last successful push/poll times. */
	setLastPushAtById(id: string, when: Date): Promise<UpdateResult>;
	setLastPollAtById(id: string, when: Date): Promise<UpdateResult>;
	/**
	 * Record (or clear) the real-time PUSH subscription on a connection. Setting it enables webhook
	 * fast-path reconciles; clearing it (undefined) reverts to poll-only. Touches ONLY the `push` field.
	 */
	setPushSubscriptionById(id: string, push: IBoardCalendarPushSubscription | undefined): Promise<UpdateResult>;
	/** Every connected connection whose push subscription expires before `before` (renewal sweep). */
	findConnectedWithPushExpiringBefore(before: Date): FindCursor<IBoardCalendarConnection>;
	/** Resolve the connection that owns a provider push subscription id (webhook correlation). */
	findOneByPushSubscriptionId(subscriptionId: string): Promise<IBoardCalendarConnection | null>;
}
