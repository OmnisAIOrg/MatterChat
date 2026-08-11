# Paper & Sky — MatterChat theme

**Status:** design approved 2026-08-11 · Stage 1 (shell) not yet built
**Branch:** `auto/paper-sky-theme` · **Base:** `staging`
**Read first:** [`MATTERCHAT-UI-CUSTOMIZATION-GUIDE.md`](./MATTERCHAT-UI-CUSTOMIZATION-GUIDE.md) — the fork-discipline constitution. This spec obeys it: everything lands in our own files, token-driven, no in-place edits to Rocket.Chat core.

---

## What this is

A second, user-switchable skin for MatterChat: **liquid glass chrome over a living green sky, with warm paper carrying every word.** It sits alongside today's green "Variant B" look rather than replacing it. A user picks it in Settings → Accessibility & Appearance; it syncs across web, PWA and desktop.

It is **not a new design language.** Paper & Sky is already shipped inside OmnisAI — in the workspace loader, in CentralAuth, and on the landing page. MatterChat adopts it on a green tint. Signing in and using the app become one continuous world.

### The rule the whole thing hangs on

Lifted verbatim from the canonical stylesheet:

> **If you read it, it is PAPER. If it frames what you read, it is GLASS.**

Warm paper carries body copy. Glass is structure — rails, docks, bezels, fields — and never holds body copy. Sky is the ground behind both, and it is state-driven rather than decorative.

This rule settles the one ambiguity in the source mockups, which contained two competing answers (message bodies on green glass vs. on warm paper). **Paper wins**, for three independent reasons:

1. **It is the house rule**, and consistency with the loader/CentralAuth is the point of the exercise.
2. **Performance.** Every glass surface is a `backdrop-filter`, and each one becomes its own GPU compositing layer. A room with ~50 visible message rows at `blur(44px)` over a *moving* gradient is ~50 blur layers recompositing every scroll frame, none of them cacheable. Opaque paper rows cost nothing. Glass stays on the ~10 chrome elements where it is affordable.
3. **Accessibility.** White-only type at 70–85% opacity over a sky that shifts through four states cannot be guaranteed to hold contrast — `Meta 12 / white 70%` over "clear morning" is the failure case. Ink on paper is fixed and passes in every sky state. Firms ask about WCAG in procurement.

---

## Provenance — reuse, do not re-type

| Asset | Location | Use |
|---|---|---|
| Canonical stylesheet | `LandingPage/styles/omnis-paper-sky.css` (372 lines) | token names, sky structure, glass recipe, reduced-motion |
| Design-system page | `LandingPage/pages/design-system.tsx` | reference rendering |
| Loader / auth skin | `Infrastructure/workspace-loader/test/authfixture/auth-skin.css` (419 lines) | sky cycle, pinning (`.oa-pin-day/dusk/night`), paper cards |
| MatterChat spec sheet | source mockups, G1–G4 | the three materials, type scale, component states |

Values that look arbitrary in the canonical file usually are not — the comments say why. Do not re-derive them from screenshots.

---

## How the switch works — front-end only, verified

No backend change is required. Each claim below was checked against the tree, not assumed.

| Step | File | Note |
|---|---|---|
| Persist `'paper-sky'` | existing `themeAppearence` user preference | Server stores it as a free-form string — `{ type: 'string', nullable: true }` in `packages/rest-typings/src/v1/users/UsersSetPreferenceParamsPOST.ts:228`, and `Match.Optional(String)` in `apps/meteor/server/methods/saveUserPreferences.ts:124`. **No enum to widen.** Syncs cross-device for free. |
| Widen the union | `packages/core-typings/src/themes.ts` | Compile-time only. `Themes` gains `'paper-sky'`. |
| Add the updater | `packages/ui-client/src/hooks/useThemeMode.ts` | One more entry in the `updaters` record; extend the spec file alongside it. |
| Show it in the picker | `apps/meteor/client/views/account/accessibility/themeItems.ts` | One entry + two i18n keys. Appears in the existing UI with no new screen. |
| Keep Fuselage working | `MainLayoutStyleTags.tsx` | **Constraint:** Fuselage's own `Themes` is hard-coded `'light' \| 'dark' \| 'high-contrast'` (`@rocket.chat/fuselage/dist/components/PaletteStyleTag/types/themes.d.ts`). `paper-sky` must resolve to **`dark`** wherever it is handed to `PaletteStyleTag`, so core components keep their palette. |
| Turn today's skin off | `MainLayoutStyleTags.tsx:862` | The precedent already exists: `const branded = theme === 'light' \|\| theme === 'dark'` deliberately leaves high-contrast stock. Paper & Sky joins that gate as its own branch. |

### Two axes, one preference

`themeAppearence` currently means *colour scheme*. Paper & Sky is a *skin*. Rather than introduce a second preference key — which **would** need backend work, since both the AJV schema and the Meteor `check()` pattern reject unknown keys — the skin is encoded as its own value on the existing axis.

This is coherent, not a hack: **Paper & Sky has no light/dark variant.** Its four sky states replace that axis entirely (see below), and light/dark within the theme would be meaningless. A user who wants a colour-scheme switch picks `light`, `dark`, `auto` or `high-contrast` and gets the Variant B world.

### Desktop

The Electron shell contains no theme code, so it inherits the web app. Two shell touches only: the window background behind the rounded frame, and the existing titlebar drag region (`NAVBAR_DRAG_REGION_CSS`), which stays as-is.

---

## The three layers

### 1 · Sky

One `position: fixed` element behind everything, reusing the shipped `.ops-sky-*` structure (three stacked ramps, opacity cross-faded).

**Deriving the green ramp.** The first attempt was to rotate the shipped blue ramp's hue in OKLCH while holding lightness and chroma, so the loader's already-validated contrast profile would carry over for free. It rotates cleanly — no gamut clipping, contrast within 0.4 of the blue original — but it lands on **sage**, not the vivid green in the mockups:

```
blue    #8FBCE0  #4A84BC  #1F5B92  #0D3559
rotated #97C39E  #4F915C  #216835  #0F3E1C      (sage — in gamut, but not the design)
```

Pushing chroma to reach the mockup's vividness clips sRGB from ×1.4 upward, and the clipped mid-stops go crude (`#006E20`, `#007200`).

**Resolution: hand-tune the ramp to the mockups.** This is safe *because contrast is not carried by the sky* — white text lives only on smoked glass, and body copy lives on paper. Measured across every candidate, white-on-smoked stayed at ~6:1 regardless of how vivid the sky got. So vividness is a free aesthetic choice, provided the material rules below hold. Keep the loader's four-stop shape and stop positions (0 / 38 / 74 / 100%) so the two products stay structurally identical.

| State | Ramp | White on smoked |
|---|---|---|
| Clear morning | `#7AD397 · #2FA55E · #14813F · #0A5029` | 5.7:1 ✓ |
| Working day | `#5FC182 · #1E9350 · #0B6E33 · #07411F` | 6.7:1 ✓ |
| Deadline dusk | `#3E9E63 · #136B3B · #0A4A26 · #052D16` | 8.8:1 ✓ |
| Night / focus | `#12241A · #0C1912 · #070E09 · #040705` | 18.9:1 ✓ |

**Tint.** The source spec proposes one `mix-blend-mode: color` layer to recolour the whole app (Green / Blue / Indigo / Amber / Rosé / Graphite).

> **Changed from the source spec.** Do **not** use `mix-blend-mode` for this. A blend layer over the app root creates a stacking context that breaks `position: fixed` overlays — modals, menus, toasts escape it or get clipped — and adds a full-screen composite layer to every frame. Swapping the ramp's four stops via CSS custom properties produces the identical result, costs nothing, carries no stacking risk, and is the same one-line switch for per-firm white-label later.

**Living sky — state machine.** The background is data. All four states are derived client-side from data the app already holds; **no backend, no new endpoint.**

| State | Trigger | Source |
|---|---|---|
| Clear morning | caught up — no deadline < 48h | CasePro deadlines (already fetched) |
| Working day | default — unreads present | subscription unread counts |
| Deadline dusk | filing or SOL < 24h; header shows a countdown | CasePro deadlines |
| Night / focus | DND, voice mode, or after hours | user presence / local clock |

Transitions are 2s cross-fades. `prefers-reduced-motion` pins the sky to a single state — the shipped stylesheet already implements this; reuse it, do not rewrite it.

### 2 · Glass chrome

Three materials, from the spec sheet. Applied **only** to chrome: org rail, sidebar, search, room header, composer, tab bar, widgets.

| Material | Recipe | Used for |
|---|---|---|
| Clear | `blur(32) saturate(180%)`, fill W .08–.12, border W .20–.24, inset rim W .28 | chips, pills, secondary buttons, overlays that must stay legible-through |
| Frosted | `blur(44) saturate(185%)`, gradient 135° .24→.09→.15, border W .34, rim .45 + lift shadow | list containers, cards that are *not* body copy |
| Smoked | `blur(50) saturate(180%)`, dark gradient .42→.52, border W .24, rim .22 + deep shadow | tab bars, rails, org tab, search, composers, widgets |

> **Note the delta from shipped.** The loader's glass is `blur(20px) saturate(1.6)` — materially lighter than these. Three heavier materials on ~10 chrome elements is affordable; the same values applied per-row are not. Stage 1 must measure scroll and idle frame cost before Stage 2 inherits these numbers.

#### The darkness budget — a hard rule

White text against the effective backdrop at each sky's **brightest stop** — the worst case. Produced by [`paper-sky-contrast-check.mjs`](./paper-sky-contrast-check.mjs); re-run it after any ramp or material change rather than eyeballing it.

| Material | Clear morning | Working day | Deadline dusk | Night / focus |
|---|---|---|---|---|
| Bare sky | 1.8:1 **fail** | 2.2:1 **fail** | 3.3:1 large only | 16.2:1 ✓ |
| Clear glass | 1.7:1 **fail** | 2.1:1 **fail** | 2.9:1 **fail** | 12.0:1 ✓ |
| Frosted | 2.6:1 **fail** | 3.1:1 large only | 4.5:1 ✓ | 17.2:1 ✓ |
| Smoked | 5.7:1 ✓ | 6.7:1 ✓ | 8.8:1 ✓ | 18.9:1 ✓ |
| **Ink on paper** | **13.2:1 ✓** | **13.2:1 ✓** | **13.2:1 ✓** | **13.2:1 ✓** |

Two consequences, both binding:

1. **White body text requires a cumulative backdrop darkening of ≥ ~45% over the sky** — i.e. smoked, or enough stacked glass to equal it. Clear glass is *worse than bare sky* on bright states, because it lightens. Layers stack, so a card inside an already-smoked sidebar can be lighter; what must be checked is the **cumulative** veil at the point the text sits, not the topmost material alone.
2. **Room cards — resolved, with a number.** The spec sheet calls unread rows "bright glass" and read rows "dim glass", and that brightness *is* the unread signal, so it cannot be dimmed to buy contrast. Modelled as stacked layers (card on sidebar panel on sky), a smoked panel at the **`.42` end** of its gradient leaves two combinations short on the clear-morning sky — unread at 4.4:1 and hover at 4.1:1, both under AA body for 13px preview text.

   **Pin the sidebar panel to `.52`** — the dark end of the smoked material's own `.42→.52` range. Everything clears (unread 5.0:1, hover 4.6:1) with no new material and no change to the design language. The cards stay exactly as drawn.

   | Room card | Clear morning | Working day | Deadline dusk | Night / focus |
   |---|---|---|---|---|
   | Unread (bright) | 5.0:1 ✓ | 5.7:1 ✓ | 7.0:1 ✓ | 13.9:1 ✓ |
   | Read (dim) | 6.1:1 ✓ | 6.9:1 ✓ | 8.8:1 ✓ | 17.6:1 ✓ |
   | Muted (clear @60%) | 5.8:1 ✓ | 6.5:1 ✓ | 8.3:1 ✓ | 16.8:1 ✓ |
   | Hover | 4.6:1 ✓ | 5.1:1 ✓ | 6.2:1 ✓ | 12.2:1 ✓ |

   Hover on clear morning is the tightest point in the whole shell at 4.6:1. Treat it as the canary: if a later change moves the sidebar panel, the sky ramps, or the hover fill, re-run the checker before assuming it still holds.

   The general lesson generalises to Stage 2: **when a surface is short, darken the container, not the element** — the element's brightness is usually carrying meaning.

The `text-shadow: 0 1px 12px rgba(10,40,20,.35)` in the source spec helps perceptually on large type but **does not count toward WCAG contrast**. Treat it as polish, not as a fix.

This is also the number that settles paper vs. glass for body copy: **13.2:1 constant, versus 1.8–3.8:1 varying with the weather.**

### 3 · Paper content

Message rows, dashboard cards, stat tiles, file cards, settings rows, modals. Opaque — no `backdrop-filter`.

```
--paper        #FAF5EA   sheet
--paper-bright #FFFDF6   inputs, raised sheet
--rim          #FFFEFA   lit top edge
--hairline     #E4D9C0   dividers
--ink          #2C2A21   body
--ink-quiet    #4A463A   secondary
--ink-faint    #8A8471   meta
```

### Type

SF Pro. On sky: **white only** — hierarchy by weight and opacity, never colour. On paper: the three ink weights.

| Role | Spec |
|---|---|
| Hero numeral | 250 weight |
| Screen title | 30 / 800 |
| Card title | 19 / 800 |
| Body | 15 / 400 · white 100% |
| Secondary | 13 · white 85% |
| Meta | 12 · white 70% |
| Card label | 11 / 800 · W75 |

Hero and titles on sky carry `text-shadow: 0 1px 12px rgba(10,40,20,.35)` for lift off bright skies. On-white text (solid buttons) uses the sky's deep tone.

---

## Stage 1 — shell (this pass)

Approved scope. Roughly 90% of the perceived change.

- Sky element + the four-state machine + reduced-motion pin
- Org rail (smoked) and the org tab — opaque folder tab fused to the window edge, concave joints
- Sidebar / room list, including room-card states: unread = bright glass, read = dim glass, muted = clear glass @60%
- Top search (smoked, no border; white ring on focus)
- Room header
- Composer (smoked card on desktop, clear pill on mobile)
- Mobile/PWA tab bar — smoked, active white, inactive 55%, raised glass Chi orb
- Sidebar widget — smoked card, 200-weight clock, gold word-of-day label
- Window frame + Electron background
- Primitives the shell needs: buttons (primary solid white / secondary glass / outline / danger glass / disabled), badges (white = unread, coral = mention), toggles (on = solid white track, deep-tone thumb), presence mint `#8FE3A5`, skeletons (white @22–30% on clear glass)
- Icon-button hit target ≥ 44px everywhere

**Deferred:** Stage 2 chat surface (message rows as paper, mentions, attachments, Chi cards, receipts) · Stage 3 dashboard and settings · Stage 4 modals, admin, empty states, long tail.

Each stage is independently shippable. An unfinished theme is safe — nobody is forced to pick it.

---

## Constraints and risks

| Risk | Handling |
|---|---|
| **`backdrop-filter` cost** — the headline risk | Glass on chrome only. Measure scroll + idle frame cost at the end of Stage 1, before Stage 2 inherits the material values. Testing rule: >10s to interactive = broken. |
| **Vendor prefix — opposite rule to LandingPage** | In MatterChat, **write both** `backdrop-filter` and `-webkit-backdrop-filter`. These styles inject as runtime `<style>` tags, so they bypass PostCSS/autoprefixer entirely and the browser sees exactly what we wrote — older Safari needs the prefix. **Do not copy LandingPage's rule here.** That repo is Tailwind 4 / Lightning CSS, which *collapses* a hand-written pair down to the webkit form alone, so there the rule is unprefixed-only. Same design system, opposite instruction, because the build pipelines differ. Getting it backwards fails silently: background and border still paint, so the glass just looks like a slightly-wrong tint with no blur and no error. |
| **Stacking contexts** | No `mix-blend-mode`, no `transform` and no `filter` on the app root or `<body>` — each creates a containing block that breaks fixed-position modals, menus and toasts. The existing frame CSS is careful about this for the same reason; keep it careful. |
| **Contrast drift across sky states** | Measured, not assumed — see the darkness budget above. Body copy on paper is immune (13.2:1 constant). White chrome text is only safe on smoked; clear and frosted fail on the two bright skies. Verify at clear morning, the worst case. |
| **Fuselage palette mismatch** | `paper-sky` resolves to `dark` for `PaletteStyleTag`. Any core component not explicitly re-skinned falls back to a coherent dark palette rather than an unstyled one. |
| **Upstream merge cost** | Additive only, in our own files. No in-place edits to Rocket.Chat core. |

---

## Verification

- Theme switches live, both directions, with no reload and no flash of the wrong skin
- Preference survives logout, and follows the user from web to desktop
- Every other theme (`light`, `dark`, `auto`, `high-contrast`) is byte-for-byte unaffected — high-contrast especially, which must stay stock for a11y
- All four sky states reachable and observed on real data; `prefers-reduced-motion` pins the sky
- Darkness budget holds: no body-size white text anywhere its cumulative backdrop is lighter than smoked-equivalent, checked against the **clear morning** sky
- Glass renders in Safari and in the Electron shell (the prefix check)
- Modals, menus and toasts still render above everything, in the theme
- Scroll and idle frame cost measured and recorded here before Stage 2 begins
