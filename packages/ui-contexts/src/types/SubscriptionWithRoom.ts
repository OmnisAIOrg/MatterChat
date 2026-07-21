import type { IOmnichannelRoom, IRoom, IRoomWithRetentionPolicy, ISubscription } from '@rocket.chat/core-typings';

export type SubscriptionWithRoom = ISubscription &
	Pick<
		IRoom,
		| 'description'
		| 'cl'
		| 'topic'
		| 'announcement'
		| 'avatarETag'
		| 'lastMessage'
		| 'uids'
		| 'usernames'
		| 'usersCount'
		| 'muted'
		| 'federated'
		| 'lm'
		| 'abacAttributes'
		| 'matterCardId'
		| 'matterId'
		| 'importIds'
	> &
	Pick<
		IOmnichannelRoom,
		| 'transcriptRequest'
		| 'servedBy'
		| 'tags'
		| 'onHold'
		| 'closedAt'
		| 'metrics'
		| 'waitingResponse'
		| 'responseBy'
		| 'priorityId'
		| 'priorityWeight'
		| 'slaId'
		| 'estimatedWaitingTimeQueue'
		| 'livechatData'
		| 'departmentId'
		| 'queuedAt'
	> & {
		source?: IOmnichannelRoom['source'];
	} & Pick<Partial<IRoomWithRetentionPolicy>, 'retention'> & {
		lowerCaseName: string;
		lowerCaseFName: string;
		/**
		 * Connector-bridge tag (Omnis fork): present on rooms mirroring an external Slack/Teams/
		 * Google Chat conversation (from `room.customFields.connectorBridge`, stamped at bridge
		 * creation) — drives the per-provider bridge sections in the sidebar.
		 */
		connectorBridge?: { provider: string; connectionId: string; channelExternalId: string };
	};
