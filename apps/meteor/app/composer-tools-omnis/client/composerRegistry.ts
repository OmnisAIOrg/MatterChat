/**
 * MatterChat fork — active-composer registry.
 *
 * clientOnly slash-command callbacks do NOT receive the ChatAPI (see
 * client/lib/chats/flows/processSlashCommand.ts), so a `/canned` command cannot
 * reach the room's composer on its own. This tiny rid-keyed registry lets the
 * composer "+" menu actions (which DO receive `chat`) hand the live ChatAPI to a
 * later slash command in the same room. Keying by rid avoids any cross-room
 * staleness: if the stored ChatAPI belongs to a different/closed room, its
 * `.composer` is undefined and callers fall back to sending.
 */
import type { ChatAPI } from '../../../client/lib/chats/ChatAPI';

const registry = new Map<string, ChatAPI>();

export const rememberChat = (rid: string, chat: ChatAPI): void => {
	registry.set(rid, chat);
};

export const getChatForRid = (rid: string): ChatAPI | undefined => registry.get(rid);
