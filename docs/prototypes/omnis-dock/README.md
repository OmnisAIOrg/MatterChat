# Omnis Dock — web/desktop prototype

Open `index.html` in any browser. No build, no server, no dependencies.

A DOM port of `Omnis-Mobile-UI/src/ui/Dock.tsx` for the web/desktop apps, intended to be
**shared across all the Omnis desktop apps** rather than living in MatterChat.

## Nothing here is invented

Every value comes from the real source, cited in the CSS header:

| From | What |
| --- | --- |
| `Omnis-Mobile-UI/src/ui/Dock.tsx` | PAD_TOP 12, PAD_BOTTOM 14, ICON_SLOT 34, LABEL_GAP 3, LABEL_H 14, BEZEL 4, raise 26 → DOCK_HEIGHT 77 |
| `src/theme/skins.ts` → `matterchat` | bezel `#5FCB7A / #2BA14C / #1B7A2E` at 0/.52/1, lit top lip, dark bottom lip, shadow in the bezel's own hue |
| `src/ui/Glass.tsx` → `RECIPES.dock` | tint .74→.84, border .42, rim .34, blur 46 |
| `src/theme/tokens.ts` | radius.dock 34, paper `#FAF5EA`, onSky `#FFF`, accent `#175F35` |

The `matterchat` skin's own comment reads *"MatterChat — ensō green. The reference
implementation."* — the green was already named for this app; nothing was picked.

**The ensō is the real one.** It mounts `apps/meteor/public/enso/enso-loader.js`
(`window.EnsoLoader`, version `1.6.0-green`) via `EnsoLoader.mount(box, {size, assetBase})`.
Not a reimplementation — the actual charge on the 2.4s breath plus three `ensoRipple`s
staggered on 1.3s. The RN `EnsoLoader.tsx` is itself a *port of this web original*, which is
why the web app should use the original directly.

Asset paths are relative to the repo, so there is one source of truth. If you move this
file, fix the three `../../../apps/meteor/public/enso/...` references.

## What works

- **Drag** — grip on the top edge, clamped to the app
- **Resize** — either bottom corner (opposite edge stays put), plus Bigger/Smaller scaling
  from the bottom edge so it grows upward and stays anchored
- **Collapse into the bezel ring** — the tab reparents from `.app` into `.win`, because
  collapsed it is part of the **frame**, not the content. That is what stops the app's
  `overflow:hidden` clipping the mark. Square top corners, no shadow of its own.
- **Extensible** — items are a plain array; the centre is inserted at the midpoint so the
  dock stays balanced at any count
- **Per-app item sets** — `APPS` presets show the same dock carrying widgets (MatterChat),
  app tabs (AutoDoc), or both (LitDraft). No API change is needed for this: `DockItem` is
  `{key, icon, label, onPress, badge?}` and **`onPress` is opaque**, so what an item *means*
  is the host app's business — exactly as `centre.onPress` already is.

## Open — pick up here

**The collapsed tab should double as the lock/unlock + move handle.** Confirmed: the blue
pill in the reference screenshot is the lock control. Undecided:

1. Does dragging the tab slide the collapsed dock along the ring, or pull it back out expanded?
2. Is "locked" a distinct state from "collapsed"? A locked dock resists accidental nudges and
   the handle toggles it — if so that is a third state, not a variant of collapse.

Also unresolved: the exact collapsed proportions. It has been through several passes
(178×37 → 104×26 → 66×29 fully sunk → 84×38 straddling the ring). Current version keeps a
small tab visible with the mark whole and uncovered, which is the brief; the precise balance
is still a judgement call.

## Next real step

This is a prototype page, not a component. To be genuinely shared it belongs in
`omnis-common` — which already ships the suite frame to six apps — with the same props shape
as the native Dock (`items`, `active`, `centre`, plus web-only `onCollapse` / `onMove`).
