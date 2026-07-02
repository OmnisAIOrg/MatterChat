# Read Receipts

> Status: **landing** (branch `auto/read-receipts`, not yet merged to staging as of 2026-07-01)

## What it is

Read receipts let you see whether the messages you send have been seen. Two things change when the feature is on:

1. **Check marks on your messages.** A single check means the message was delivered; it becomes a double check once at least one *other* person in the room has read it. (Your own messages never flip to "read" just because you looked at them yourself.)
2. **A "read by" list per message** (optional, second setting). When the workspace also enables per-user detail, you can open a message's read receipts and see *who* has read it and when, ordered by read time.

This is a from-scratch reimplementation in MatterChat's open core of what Rocket.Chat ships as an enterprise-only feature — no enterprise license is required.

## Who it's for

- **Attorneys and staff** who need to know a time-sensitive message ("hearing moved to 9am") was actually seen.
- **Firm admins** who want delivery confidence without turning on per-person surveillance — the two settings are separable exactly for this.

## How to use it

1. Send a message in any channel, group, or direct message.
2. Watch the check mark next to it: one check = sent, two checks = read by someone else in the room.
3. If your admin has enabled per-user detail, open the message actions and choose the read receipts option to see the list of readers with timestamps.

Notes on behavior (by design):

- Editing a message does not create new receipts.
- Thread-specific receipts and livechat/omnichannel rooms are out of scope in this first version.
- Reads are batched over a couple of seconds, so receipts can lag a moment behind the actual read.

## Admin setup

Both settings live in **Admin → Settings → Message → Read Receipts** and are off by default:

| Setting | Default | What it does |
|---|---|---|
| `Message_Read_Receipt_Enabled` | off | Master switch. Turns on receipt tracking and the single/double check indicator. |
| `Message_Read_Receipt_Store_Users` | off | Per-user detail. Only when this is *also* on does the server store **who** read each message and expose the "read by" list. Only selectable once the master switch is on. |

**Privacy note:** with only the master switch on, the server records *that* a message has been read, not *by whom* — no per-user read data is stored. If your firm doesn't want per-person read tracking, leave `Message_Read_Receipt_Store_Users` off; the "read by" list is then unavailable to everyone (the server refuses the request), while the check-mark indicator still works. Access to a message's receipt list is also gated by room access — you can only query receipts for messages in rooms you can open.

## FAQ

**Does the sender count as a reader?**
The sender's receipt is stored at send time (they have trivially seen their own message), but the double-check indicator only flips when a *different* user reads the room.

**Can users opt out individually?**
No. The feature is workspace-level; there is no per-user toggle in this version.

**Do old messages get receipts retroactively?**
Messages a user had genuinely never seen get receipts the first time that user reads the room after the feature is enabled. Deleting a room deletes its receipts.

**Does this work in threads?**
Thread-level receipts are not tracked in this first version; receipts apply to main-room reads.

## Key files (for developers)

`apps/meteor/server/lib/message-read-receipt/ReadReceipt.ts` (core service), `apps/meteor/server/lib/message-read-receipt/hooks.ts` (send/read hooks, 2s debounce), `apps/meteor/server/methods/getReadReceipts.ts` (receipt list method with setting + room-access gates), REST `GET /api/v1/chat.getMessageReadReceipts`, `apps/meteor/server/settings/message.ts` (settings de-enterprised), `packages/models/src/models/ReadReceipts.ts` (model). The check-mark indicator and "Read Receipts" message action are the stock client UI (`client/components/message/ReadReceiptIndicator.tsx`, `toolbar/useReadReceiptsDetailsAction.tsx`), which this branch unlocks by de-enterprising the settings.
