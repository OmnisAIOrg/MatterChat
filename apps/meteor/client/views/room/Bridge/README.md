# Bridge Components — MatterChat External Workspace Integration

## Overview

Bridge components provide UI for MatterChat's external workspace connectors (Teams, Google Chat, Slack). These components display when a room is connected to an external workspace and provide affordances for bridged communication.

## Design Source

- **Reference:** `docs/design/premium-refresh/Bridge Teams.dc.html` (and corresponding Google Chat, Slack screens)
- **Design System:** `docs/design/premium-refresh/README.md`
- **Color Identity:** Teams uses purple `#4B53BC`, Google Chat uses green `#128A5C`

## Components

### BridgeTeamsBadge

Displays a pill badge in the conversation header showing the external workspace identity.

**Usage:**
```tsx
import { BridgeTeamsBadge } from './Bridge';

// In RoomHeader
<BridgeTeamsBadge room={room} />
```

**Renders when:**
- Room has `teamsId` field
- Room has `externalWorkspaceId?.provider === 'teams'`
- Room has import ID prefixed with `teams:`

**Visual:**
- Purple pill with white "T" icon and "Microsoft Teams" label
- **Light theme:** Dark text on light background
- **Dark theme:** Light text on dark background (not yet implemented)

### BridgeTeamsIdentifier

Shows "VIA TEAMS" chip to indicate a message or input is bridged with Teams.

**Usage:**
```tsx
import { BridgeTeamsIdentifier } from './Bridge';

// In composer footer or message area
<BridgeTeamsIdentifier room={room} />
```

**Visual:**
- Monospace uppercase "VIA TEAMS" text
- Blue background (`#EDEFFB`) with border (`#D4D8F4`)
- Purple text (`#4B53BC`)

### BridgeTeamsPanel

Sidebar panel showing connected Teams workspace, channels, and chats.

**Usage:**
```tsx
import { BridgeTeamsPanel } from './Bridge';

// In room layout alongside main content
<BridgeTeamsPanel room={room} />
```

**Features:**
- Purple gradient header band (`#4B53BC` → `#39408F`)
- Back button to close/navigate
- Teams logo and workspace name
- Channels list
- Direct chats section
- MatterChat footer branding

**Layout:**
- Fixed width: 236px
- Flex layout container for room view
- Scrollable chats section
- Built with CSS Grid for layouts (placeItems center)

### BridgeIntoMatterChatButton

Call-to-action button to bridge a Teams conversation into MatterChat.

**Usage:**
```tsx
import { BridgeIntoMatterChatButton } from './Bridge';

// In room header toolbar
<BridgeIntoMatterChatButton room={room} onBridge={handleBridge} />
```

**Visual:**
- Green primary button with link icon
- Soft green background (`var(--greenSoft)`)
- Hover state: solid green with white text
- Fits into header toolbar (31px height)

## Integration Points

### 1. Room Header (✅ Done)

**File:** `apps/meteor/client/views/room/Header/RoomHeader.tsx`

The `BridgeTeamsBadge` is imported and rendered in `HeaderContentRow` after the federated room indicator.

```tsx
{isRoomFederated(room) && <FederatedRoomOriginServer room={room} />}
{/* MATTERCHAT: Teams bridge badge */}
<BridgeTeamsBadge room={room} />
```

### 2. Room Layout (TODO)

**File:** `apps/meteor/client/views/room/layout/RoomLayout.tsx` or similar

The `BridgeTeamsPanel` would be mounted as a left sidebar when viewing a Teams-bridged room.

```tsx
{isBridged && <BridgeTeamsPanel room={room} />}
{/* Main content area */}
{/* Footer with composer */}
```

### 3. Composer Footer (TODO)

**File:** `apps/meteor/client/views/room/composer/RoomComposer.tsx` or similar

The `BridgeTeamsIdentifier` would display in the composer footer to indicate the message is being sent to Teams.

### 4. Header Toolbar (TODO)

**File:** `apps/meteor/client/views/room/Header/RoomToolbox.tsx` or similar

The `BridgeIntoMatterChatButton` would appear in the right-side header toolbar.

## Detection Logic

All components use the same bridge detection function:

```typescript
const isTeamsBridgedRoom = (room: IRoom): boolean => {
	if ((room as any).teamsId) return true;
	if ((room as any).externalWorkspaceId?.provider === 'teams') return true;
	if (room.importIds?.some((id) => id.startsWith('teams:'))) return true;
	return false;
};
```

**TODO:** Update detection logic once Teams bridge field is finalized in IRoom type.

## Styling & Tokens

All components use CSS custom properties from the design system:

- **Colors:** `var(--railBg)`, `var(--railInk)`, `var(--green)`, etc.
- **Radius:** 6px, 8px, 9px, 11px (matches design)
- **Spacing:** 4px-based scale
- **Typography:** Geist, Geist Mono from Google Fonts

### Teams Purple Identity
- Primary: `#4B53BC`
- Gradient: `linear-gradient(135deg, #4B53BC, #39408F)`

### Light/Dark Theme Support

Components use `var()` CSS custom properties defined in the theme system. Theme toggle applies `data-theme="dark"` attribute to document root.

## TypeScript

All components are fully typed with:
- `IRoom` type from `@rocket.chat/core-typings`
- `ReactElement` return type
- Proper `useMemo` for derived state

## Testing

Components are designed to:
- Render `null` when bridge conditions are not met
- Handle missing/partial room data gracefully
- Support light and dark themes via CSS variables
- Use semantic HTML where possible (buttons, anchors)

## Accessibility

- SVG icons use proper `viewBox` and sizing
- Buttons have proper `hover` states
- Color identity is distinct from main app (purple for Teams)
- Text contrast meets WCAG standards

## Future Extensibility

The pattern is designed to support additional bridges:
- **Google Chat:** Green identity (`#128A5C`)
- **Slack:** Already supported via `importIds` (Slack blue identity)

Create provider-specific variants:
```tsx
export { default as BridgeGoogleChatBadge } from './BridgeGoogleChatBadge';
export { default as BridgeSlackBadge } from './BridgeSlackBadge';
```

## Files

```
apps/meteor/client/views/room/Bridge/
├── README.md (this file)
├── index.ts (exports)
├── BridgeIntoMatterChatButton.tsx (CTA button)
├── BridgeTeamsBadge.tsx (header badge)
├── BridgeTeamsIdentifier.tsx (via Teams chip)
└── BridgeTeamsPanel.tsx (workspace panel)
```

## Related Files

- Design source: `docs/design/premium-refresh/Bridge Teams.dc.html`
- Room header: `apps/meteor/client/views/room/Header/RoomHeader.tsx`
- Room layout: `apps/meteor/client/views/room/layout/RoomLayout.tsx`
- Type definitions: `packages/core-typings/src/IRoom.ts`
