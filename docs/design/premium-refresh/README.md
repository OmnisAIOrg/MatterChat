# Handoff: MatterChat Premium Refresh

## Overview
A full visual evolution of MatterChat (legal-matter chat + pipeline platform by Omnis AI) into a premium, enterprise-grade SaaS product — **without changing information architecture, navigation, workflows, or feature locations**. Every screen keeps its current purpose and position; every component was upgraded (depth, radii, spacing, typography, motion). Think "major design refresh," not "redesign."

## About the Design Files
The files in this bundle are **design references created in HTML** — high-fidelity prototypes showing intended look and behavior, **not production code to copy directly**. The task is to **recreate these designs in the target codebase's existing environment** (the MatterChat frontend — Rocket.Chat-derived React) using its established patterns and libraries. The `.dc.html` files open directly in a browser (keep `support.js` next to them). All styling is inline on elements, so any value can be read straight off the node you're recreating.

## Fidelity
**High-fidelity.** Colors, typography, spacing, radii, shadows, and interactions are final. Recreate pixel-perfectly using the codebase's component system. Every screen supports **light and dark themes** via the CSS custom-property sets below (the prototypes switch with a `data-theme="dark"` attribute on the app root).

## Files
| File | Screen |
|---|---|
| `Design System.dc.html` | Token + component library (source of truth) |
| `Dashboard.dc.html` | Home dashboard (greeting, stats, deadlines, my matters) |
| `Matters Board.dc.html` | Matters kanban (richest interaction set) |
| `Deadlines.dc.html` | Deadlines list (Overdue / Later) |
| `Reports.dc.html` | Financial stats + pipeline aging |
| `Leads.dc.html` | Leads kanban + empty state |
| `Caseload.dc.html` | Assignee workload table |
| `Chat.dc.html` | DM conversation view |
| `Admin Workspace.dc.html` | Admin → Workspace |
| `Bridge Teams.dc.html` | Microsoft Teams bridged conversation (purple `#4B53BC` bridge identity: panel header band, workspace-rail outline, header badge, "VIA TEAMS" composer chip) |
| `Bridge Google Chat.dc.html` | Google Chat bridged DM (bridge green `#128A5C`) + premium error state (icon tile, mono error chip, Retry/View-logs, auto-retry note) |
| `Mobile PWA.dc.html` | 4 mobile screens (Home, Board, Chat, Deadlines) |
| `support.js` | Runtime for the prototypes (not part of the design) |

## Design Tokens

### Typography
- **UI font:** `Geist` (Google Fonts), weights 400/500/600/700. **Data labels/badges:** `Geist Mono` 400–600.
- Scale: Display 25px/650/-0.02em · Page title 19–20px/650 · Card heading 14px/600 · Body 13.5px/400 · Secondary 12.5px · Tertiary 11–12px · **Mono label 10px, uppercase, letter-spacing .12–.18em** (used for all column headers, stat labels, section labels — a signature of the system).
- Numbers always `font-variant-numeric: tabular-nums`.

### Color — Brand
- Frame green gradient: `linear-gradient(155deg, #22A957 0%, #128044 100%)` (the app keeps its signature green window frame, 11px padding, 18px inner radius)
- Primary green `#17804D` · hover `#0F6A3D` · tint `#E8F3ED` · tint border `#CBE5D6` · green ink (text on tint) `#116240`
- Wordmark: "Matter" ink / "Chat" `#E4484D`. LitBox accent `#6D7BF2`.
- Dark-theme green: `#3FBC7C` (primary) / `#57CD90` (hover) / on-green text `#08130D` / tint `#152A1E` / tint border `#265C3F` / green ink `#6FD6A3`
- Presence green `#3FBC7C` (both themes)

### Color — Neutrals (light)
`--bg #F6F6F3` app bg · `--surface #FFFFFF` cards · `--surface2 #FAFAF7` nested/hover · `--border #E7E6E0` · `--border2 #DBDAD3` (controls) · ink `#171D19` · ink2 `#57615B` · ink3 `#8E968F`

### Color — Neutrals (dark)
bg `#0F1512` · surface `#151C17` · surface2 `#19211C` · border `#242D27` · border2 `#2D372F` · ink `#E9EDEA` · ink2 `#A2ACA5` · ink3 `#707B74`

### Color — Rails (dark in BOTH themes)
Rail bg `#0D1310` (dark theme `#0B100D`) · panel bg `#111814` · rail line `#1F2823` · rail hover `#1A231E` · rail ink `#AEB8B1` · rail ink2 `#6E7A73` · active nav text `#7CD8A8` · active nav pill `rgba(63,188,124,.16)`

### Color — Status
- Danger `#CF4438` / tint `#FBECEA` / line `#F2CFCB` (dark: `#E0685D` / `#32201D` / `#5C332D`)
- Warning `#A97A18` / `#F8F0DF` / `#EBD9B4` (dark: `#D3A24A` / `#2E2717` / `#5A4A24`)
- Info `#3C6EB4` / `#EAF1F9` / `#CDDDF0` (dark: `#7AA3D8` / `#1B2532` / `#324B69`)
- Pre-Litigation accent in charts: `#7A5FB8`
- Stage pill mapping: Intake/Investigation-ish greens per screen — see each file; Matters list uses Investigation=green, Initial Review=amber, Pre-Litigation=blue, Pre-Lit Settled=neutral.

### Radius
7px (small controls) · **9px buttons/inputs** · 11px nav pills · 12–13px cards on boards · **14px major cards/dialogs** · 18px app frame · 999px pills. Never sharp rectangles.

### Elevation
- `shadow1` (resting card): `0 1px 2px rgba(23,29,25,.05), 0 1px 3px rgba(23,29,25,.04)`
- `shadow2` (hover): `0 1px 2px rgba(23,29,25,.05), 0 8px 24px -8px rgba(23,29,25,.14)`
- `shadow3` (overlay/dialog/palette/drawer): `0 2px 6px rgba(23,29,25,.06), 0 24px 60px -12px rgba(23,29,25,.25)`
- Dark equivalents use black at .35–.6 alpha (see CSS vars in any file).
- Glass header: `backdrop-filter: blur(14px)` over `rgba(246,246,243,.82)` light / `rgba(15,21,18,.78)` dark, 1px bottom border.

### Spacing
Base-4 scale: 4/8/12/16/24/32. Card padding 14–20px. List rows 10–13px vertical. Page gutters 24–36px. Content max-widths: dashboard 1180, reports 1040, deadlines 920, caseload/admin 1000. Kanban column width 296px, gap 16px.

### Motion
- Hover 120–150ms; color/nav transitions 200ms; panel/drawer 240–280ms. Ease: `cubic-bezier(.2,.8,.3,1)`.
- Keyframes used: `mcFadeUp` (content entrance, 350ms, 5px rise), `mcPop` (overlays, 180ms, 6px rise + .98 scale), `mcSlide` (drawer, 240ms, 48px from right), `mcPulse` (presence dot ring, 2.6s infinite), `mcShimmer` (skeleton, 1.4s linear, 300% background sweep).
- Buttons lift `translateY(-1px)` on hover, return on press. Cards lift 1px + shadow2.
- Dashboard stat numbers count up over 900ms with cubic ease-out.

## Application Shell (identical on every desktop screen)
1. **Green frame:** gradient background, 11px padding, inner app radius 18px, `min-width 1240px / min-height 720px` (smaller viewports scroll — never squash).
2. **Top bar** 52px, rail bg: left icon buttons (channels/sort/new, 32px, radius 8), centered search field (max 640px, radius 9, rail-hover bg, ⌘K kbd chip — **clicking it opens the command palette**), nav arrows, right icons (directory, DND, settings), 29px avatar with pulsing presence dot.
3. **Workspace rail** 62px: 38px active workspace tile (green gradient, 2px `#3FBC7C` outline offset 2px), other workspaces 36px tiles with notification badge (`#D5375B`), dashed "+" tile.
4. **Menu rail** 96px: wordmark, mono "MENU" label, vertical nav items (19px icons + 10.5px labels). **Active state = sliding pill** (absolute-positioned rounded rect, `rgba(63,188,124,.16)`, animates `top/height` 280ms) + label color `#7CD8A8`.
5. **Context panel** 236–264px: dark (`#111814`) for Chats; light (`surface2`) for Boards/Admin. Active item: green tint bg + 3px green left bar. Footer wordmark + "Powered by Omnis AI".
6. **Content area:** themed bg, frosted-glass sticky header with page icon tile (30px, green tint), 19px/650 title, right-side actions.

## Interactions & Behavior
- **⌘K command palette** (every screen): backdrop `rgba(8,12,10,.45)` + 3px blur, 540px card at 14vh, search row + mono section labels + action rows with kbd hints. ESC closes.
- **Hover cards** (Dashboard matters list): fixed-position 264px card near the row — name, type, stage pill, SOL progress bar, care-team avatar stack. Pointer-events none.
- **Detail drawer** (Matters): click a card → 372px right slide-over (scrim `rgba(8,12,10,.28)`): id + stage pill header, SOL bar, care-team card, recent-activity feed with relative timestamps, footer actions (Open matter / Edit / Archive-danger).
- **Multi-select + bulk bar** (Matters): checkbox on card (green fill when checked, card border tints green); floating dark pill bar bottom-center: "N selected · Assign · Change stage · Archive · ✕".
- **Card hover quick-actions** (Matters, Chat messages): icon row fades in (opacity 0→1, 150ms) on row/card hover.
- **SOL progress bars:** 4–6px track (`surface2` + border), green fill; **red fill below ~35% remaining**.
- **Avatar stacks:** 20–24px circles, green gradient, 2px surface border, -6px overlap.
- **Skeleton loading** (Dashboard `loading` tweak): shimmer bars replacing list rows.
- **Empty states** (Leads "Further evaluation", Caseload): icon tile (green tint) + 13px/600 title + 12px explainer + CTA.
- **Presence:** 8–9px dots with 2px surround border + `mcPulse` ring animation.
- **Buttons:** primary (green, white/on-green text), secondary (surface + border2, hover border-ink3), ghost, danger (red tint → solid red on hover), icon 32–34px, split, loading (spinner 700ms), disabled (surface2 + ink3). Focus ring: `0 0 0 3px rgba(23,128,77,.22)` (dark `rgba(63,188,124,.28)`).
- **Tables:** mono uppercase header row on surface2, row hover surface2, selected row green tint, filter bar (search + pinned filter chips + dashed "+ Filter"), sticky headers where long.
- **Forms:** 34px fields radius 9, labels 12px/600 above, helper 11.5px below, error = red border + red ring + inline message with icon.

## State Management (per screen, as prototyped)
- Global: `theme` (light/dark), palette open (⌘K / ESC / backdrop click), active nav (drives sliding indicator via measured offsets).
- Dashboard: stat count-up animation state, hovered matter row (hover card), `loading` flag.
- Matters: selection set (bulk bar shows when >0), hovered card (quick actions), open drawer matter.
- Chat: hovered message (action toolbar).

## Assets
No raster assets. All icons are inline SVG, ~1.7px stroke, round caps/joins, 24px grid rendered at 13–20px (lucide-style — map to the icon set in the codebase, keep stroke weight consistent). Avatars in prototypes are initials tiles (green gradient); production uses real user photos. Fonts from Google Fonts (Geist, Geist Mono).

## Screens — implementation notes
- **Dashboard:** segmented 4-stat band in one card (internal 1px dividers, SOL segment gets 3px red left bar + red text), Due today + Activity cards row (1fr / 320px), Approaching deadlines card (red status dots with tint halo, mono overdue chips), My matters list (status dot, name+type baseline row, date, 106px fixed-width stage pill, mono SOL chip, chevron).
- **Matters:** kanban columns 296px; cards: checkbox + name/type + mono #id, SOL bar row, avatar stack + hover actions.
- **Deadlines:** grouped cards with 3.5px colored left bar (red overdue / green-line later), tag chips, due row with mono countdown chip, SOL elapsed bar, right-aligned Open + Acknowledge.
- **Reports:** 5 sparkline stat cards (Total balance sparkline is red/negative), open-matters card with stacked stage-mix bar + legend, aging table with inline share bars.
- **Caseload:** stat + workload table (stage-mix stacked bar per row), legend, assign empty-state card.
- **Chat:** day-divider pills (mono, bordered), message rows (32px avatar tile, name + mono ADMIN chip + time, green double-check receipts, hover toolbar floating above row), composer card with formatting toolbar + green send.
- **Admin:** version hero card (soft radial green glow decoration top-right, status checklist with circular tint icons, Register CTA), 3-card grid (Deployment / Users / Total rooms) with mono field labels and hairline-divided stat rows.
- **Mobile (PWA):** bottom tab bar (Home/Chats/Boards/Activity+badge/Admin, active green), dark top app bars, stage filter chips instead of horizontal kanban, full-width floating primary CTA, same tokens throughout.
