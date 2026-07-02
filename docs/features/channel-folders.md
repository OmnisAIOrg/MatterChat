# Channel Folders

> Status: **live** (merged to staging, commit `bf93ea5614`)

## What it is

Channel folders let each person organize their sidebar into named, collapsible groups — for example a folder per matter, per practice group, or per client. You file a channel into a folder with one command, and the sidebar shows that folder as its own collapsible section (with an unread badge), sitting alongside the standard Teams/Channels/Direct Messages groups.

Folders are **personal**: filing a channel under "Smith v. Jones" organizes *your* sidebar only and doesn't change anything for other members of the channel.

## Who it's for

Anyone juggling many channels — attorneys on multiple matters, paralegals supporting several teams, admins in every channel at once.

## How to use it

1. Open the channel you want to file.
2. Type `/folder <name>` — e.g. `/folder Smith v. Jones` — and press Enter. You'll get a private confirmation ("Filed this channel under…") that only you can see.
3. The channel now appears under a collapsible **Smith v. Jones** section in your sidebar. Folders are sorted alphabetically and sit just above the Channels group.
4. Click the folder header to collapse or expand it; the header shows a combined unread badge while collapsed.
5. To remove a channel from its folder, type `/folder` in it with no name.

A channel lives in at most one folder at a time; filing it under a new name moves it.

## Admin setup

None — no settings, no permissions, works out of the box for every user.

One dependency to know about: folder grouping renders when the sidebar is in **grouped mode** ("Group by type" in your sidebar sort preferences, which is the default). If a user has grouping turned off (single flat list), folder assignments are kept but not displayed until grouping is turned back on.

## FAQ

**Are folders shared with my team?**
No. Folder assignments are stored on your personal subscription to the channel. Two people can file the same channel under different names.

**Can I file direct messages or private groups?**
You can run `/folder` in any room you're a member of.

**Do unread counts still work?**
Yes — each folder header aggregates the unread state of the channels inside it, like the built-in sidebar groups.

**Is there a folder management screen?**
Not in this version. Folders exist implicitly: they appear when at least one channel is filed under the name and disappear when empty.

## Key files (for developers)

`apps/meteor/server/methods/setRoomFolder.ts` (per-user folder assignment on the subscription), `apps/meteor/app/slashcommands-omnis/server/index.ts` (`/folder` command), `apps/meteor/client/sidebar/hooks/useRoomList.ts` (dynamic `folder:<name>` groups woven above Channels), `apps/meteor/client/sidebar/RoomList/RoomListCollapser.tsx` (folder label rendering), `packages/core-typings/src/ISubscription.ts` (`folder` field).
