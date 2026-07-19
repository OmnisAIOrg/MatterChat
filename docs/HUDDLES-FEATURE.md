# Huddles Feature (SPEC #10)

## Overview
Huddles enable 1-click audio/video rooms per channel or board in MatterChat. The feature reuses Rocket.Chat's built-in video conference infrastructure (Jitsi) and provides seamless integration with CaseNotes for automatic note-taking.

## Architecture

### Components

#### 1. useHuddleRoomAction Hook
**Location:** `apps/meteor/client/hooks/roomActions/useHuddleRoomAction.ts`

Provides the room action (toolbar button) for starting a huddle. Features:
- Returns a `RoomToolboxActionConfig` for display in room header
- Uses existing `useVideoConfDispatchOutgoing` from `@rocket.chat/ui-video-conf`
- Integrates with CaseNotes via `useCaseNotesHuddle` (best-effort, non-blocking)
- Respects permissions: `call-management`, `post-readonly`
- Supports all room types: DMs, groups, teams, channels
- Disabled for archived rooms and federated rooms

#### 2. useCaseNotesHuddle Hook
**Location:** `apps/meteor/client/hooks/useCaseNotesHuddle.ts`

Handles best-effort integration with CaseNotes:
- Called when a huddle starts
- Non-blocking (fails silently if CaseNotes is unavailable)
- Placeholder for future API integration
- Would eventually:
  - Query room metadata for linked case/matter ID
  - POST to CaseNotes API to create auto-note entry
  - Include huddle start time, participants, duration placeholder

#### 3. HuddleButton Component
**Location:** `apps/meteor/client/views/room/Header/Huddle/HuddleButton.tsx`

Premium-styled button component using design tokens from `docs/design/premium-refresh/README.md`:
- Radius: 8px (small controls)
- Colors: uses CSS variables (light: #8e968f ink3, dark: #707b74)
- Shadows: shadow1 (resting), shadow2 (hover)
- Transitions: 120ms cubic-bezier easing
- Icon: Microphone SVG (lucide-style, 1.7px stroke)

### Integration Points

#### Room Toolbox
The huddle action is registered in `apps/meteor/client/ui.ts`:
```typescript
export const roomActionHooks = [
  // ... other actions
  useHuddleRoomAction,
  // ... other actions
];
```

This makes the huddle button appear in the room header toolbar (featured position, order 2).

#### Video Conference Infrastructure
Reuses existing RC capabilities:
- `useVideoConfDispatchOutgoing()`: Opens video conference UI
- `useVideoConfLoadCapabilities()`: Loads provider capabilities
- `VideoConference.ts` types: `IGroupVideoConference` for multi-user rooms
- Jitsi provider (default RC provider)

#### Permissions
- Requires `call-management` permission
- Respects room settings:
  - `VideoConf_Enable_DMs`: Enable for direct messages
  - `VideoConf_Enable_Channels`: Enable for channels
  - `VideoConf_Enable_Teams`: Enable for teams
  - `VideoConf_Enable_Groups`: Enable for groups

### Styling

All UI components use the premium design tokens:
- **Font:** Geist (Google Fonts) 400/500/600/700 weights
- **Colors (Light):** `--bg #F6F6F3`, `--surface #FFFFFF`, `--border #E7E6E0`, `--ink #171D19`, `--ink3 #8E968F`
- **Colors (Dark):** bg `#0F1512`, surface `#151C17`, border `#242D27`, ink `#E9EDEA`, ink3 `#707B74`
- **Shadows:**
  - shadow1 (resting): `0 1px 2px rgba(23,29,25,.05), 0 1px 3px rgba(23,29,25,.04)`
  - shadow2 (hover): `0 1px 2px rgba(23,29,25,.05), 0 8px 24px -8px rgba(23,29,25,.14)`
- **Radius:** 8px for small controls, 9px for buttons
- **Motion:** 120–150ms transitions, cubic-bezier(.2,.8,.3,1)

## User Flow

1. **Start Huddle**
   - User clicks "Start Huddle" button in room header
   - CaseNotes is notified (if room linked to case/matter)
   - Video conference UI opens
   - Call participants join via Jitsi

2. **During Huddle**
   - Participants share audio/video
   - Chat messages continue in channel
   - CaseNotes (if integrated) may auto-record call metadata

3. **End Huddle**
   - Last participant disconnects
   - Call ends, returned to channel view
   - Call history available in room (via RC's built-in history)

## Translation Keys
- `Start_Huddle`: "Start Huddle" (button label)

## Future Enhancements

1. **CaseNotes Full Integration**
   - Real API endpoint for auto-note creation
   - Call recording storage
   - Participant list in case notes

2. **Huddle Scheduling**
   - Schedule future huddles
   - Calendar integration (if available)

3. **Recording**
   - Built-in recording via Jitsi
   - Auto-attach to case notes

4. **Board-Specific Features**
   - Huddle for card discussions
   - Task-specific audio rooms

5. **Analytics**
   - Huddle frequency per channel/case
   - Participant insights
   - Call duration tracking

## Implementation Notes

- **Video Provider:** Defaults to Jitsi (Rocket.Chat standard)
- **No Core RC Modifications:** Uses existing video conference infrastructure
- **Best-Effort CaseNotes:** Non-blocking integration allows feature to work independently
- **Accessibility:** Button includes title/tooltip, proper ARIA roles via RC components
- **Dark Mode:** Full support via CSS custom properties and @media (prefers-color-scheme: dark)
- **Parse Validation:** All TypeScript files verified with esbuild (no errors)

## Files
- `apps/meteor/client/hooks/roomActions/useHuddleRoomAction.ts` (81 lines)
- `apps/meteor/client/hooks/useCaseNotesHuddle.ts` (50 lines)
- `apps/meteor/client/views/room/Header/Huddle/HuddleButton.tsx` (102 lines)
- `apps/meteor/client/ui.ts` (updated with hook registration)
- `packages/i18n/src/locales/en.i18n.json` (translation string added)
