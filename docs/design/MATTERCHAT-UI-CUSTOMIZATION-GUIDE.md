# MatterChat — UI Customization & Fork-Discipline Guide

> **Read this before designing, redesigning, restyling, or adding ANY UI in MatterChat.**
> It is the constitution for how we customize a Rocket.Chat fork without making future
> upstream updates painful. Following it is not optional — it is what keeps merges cheap.

---

## TL;DR — the one rule

MatterChat is a **full source fork of Rocket.Chat 8.6** (Meteor 3 + React/Fuselage). We own the
whole codebase, so we **can change literally anything** — theme, screens, whole features, core
behavior. The only real constraint is **upstream mergeability**: we periodically merge upstream
Rocket.Chat for security patches and features, and every place we edited *their* files becomes a
merge conflict.

> ### 🥇 THE RULE: **Additive, in our own files — not in-place edits to Rocket.Chat core.**
> New component in a new file/dir → merges clean forever. A line changed inside a core RC file →
> conflicts on every upstream merge. Bias every design decision toward the former.

This is why the ceiling is "anything" but the *discipline* is narrow.

---

## Why this matters (the trade-off, concretely)

- We stay on upstream Rocket.Chat for **security fixes + new platform features** — we do NOT want to
  freeze the fork. (See the `feature/*` reconciliation-merge history and `DECISIONS.md`.)
- A merge of upstream RC touches thousands of their files. Where our changes live in **our own
  files/dirs**, git merges them with zero conflict. Where we edited **their** files in-place, we
  hand-resolve a conflict — every single merge, forever.
- ~29k `rocket.chat` references in the tree are `@rocket.chat/*` **package imports** — never touch
  those; they are the platform's public API.

So: the same visible result ("move this button", "restyle this panel") can be built two ways — one
that costs nothing at merge time and one that taxes every future update. Always pick the first.

---

## The customization ladder — where to put what

From lowest merge-cost to highest. Prefer the highest tier that achieves the goal.

### 1. Theme & brand — **do freely, near-zero merge cost**
Colors, fonts, spacing, density, logos, the whole look. Rocket.Chat renders through the **Fuselage**
design system with a CSS-variable **palette** + theme tokens.
- Global look lives in our own style-tag layer: `apps/meteor/client/views/root/MainLayout/MainLayoutStyleTags.tsx`
  (the green "Variant B" rounded-frame theme). Add/override tokens here, not scattered inline styles.
- Drive color from the palette / theme tokens (`PaletteStyleTag`, `useThemeMode`) — **never hardcode
  hex in components.** One token change reskins everywhere.
- Brand assets have canonical homes (see **Branding** below).

### 2. Restyle / rearrange an existing screen — **easy, keep the edit thin**
Every screen is a React component under `apps/meteor/client/**`. To change one, prefer **wrapping or
swapping at the mount point** and putting the real UI in **your own file**, rather than rewriting the
core component in place.
- Proven examples: the custom left rail `client/views/root/MainLayout/AppLeftRail.tsx`; the home
  screen replaced by `client/views/home/MyDayHomePage.tsx` (a one-line swap at the route → our
  component).

### 3. New surface / feature — **the preferred pattern for anything substantial**
Build it as a **self-contained module in its own directory** — client + server + settings + i18n
keys. This is how the entire **Omnis Boards** product lives inside the fork with clean merges:
- Client: `apps/meteor/client/views/boards/**`
- Server: `apps/meteor/server/lib/boards/**`
- REST: `apps/meteor/app/api/server/v1/boards*.ts`
- Settings: `apps/meteor/server/settings/boards-casepro.ts`
- Connectors (Slack/Teams): `apps/meteor/app/connectors/server/**`
- PWA: `apps/meteor/client/serviceWorker.ts`, `apps/meteor/client/views/pwa/**`

New feature? New directory. Touch core only at the single mount/registration point.

### 4. Core behavior change — **last resort, and make it findable**
Sometimes you must edit an RC core file (a shared hook, a router, a settings default). When you do:
- Keep the diff **minimal** — change the fewest lines possible.
- **Mark every in-place edit** with a searchable comment: `// MATTERCHAT: <why>` (and close blocks
  with `// /MATTERCHAT`). At upstream-merge time these are grep-able so the resolver knows exactly
  what is ours and why.
- Prefer isolating the logic in a **helper in our own file** that the core file calls in one line,
  over inlining a block into core.

---

## Our custom-code map (the "these are ours" index)

Keep this list current. At merge time, changes in these paths are **ours** and take priority; the
rest is upstream.

| Area | Path | Notes |
|---|---|---|
| Global theme / frame | `client/views/root/MainLayout/MainLayoutStyleTags.tsx` | green "Variant B" reskin |
| Left rail | `client/views/root/MainLayout/AppLeftRail.tsx` | custom product rail |
| Home screen | `client/views/home/MyDayHomePage.tsx` | replaces RC generic home |
| Omnis Boards (client) | `client/views/boards/**` | kanban / Leads / Matters / Gantt / Matter Workspace |
| Omnis Boards (server) | `server/lib/boards/**` | services, matter binding, calendar-sync |
| Boards REST | `app/api/server/v1/boards*.ts` | `boards.*` endpoints |
| Connectors | `app/connectors/server/**` | Slack + Teams two-way bridges, desktop OAuth |
| PWA | `client/serviceWorker.ts`, `client/views/pwa/**` | update prompt, web push, install |
| Error isolation | `client/views/boards/card/CardErrorBoundary.tsx` | keep panel bugs from white-screening the app |
| Settings (ours) | `server/settings/boards-casepro.ts` (+ our edits marked in shared settings files) | env-first, graceful-degrade |
| Branding assets | `public/images/pwa/**`, `public/images/logo/**`, `public/favicon.ico`, `public/images/manifest.json` | see Branding |

---

## Hard rules — the PR checklist for any UI/design change

- [ ] **New files over editing core.** Could this be a new component/dir instead of a core edit? If yes, do that.
- [ ] **In-place core edits are marked** `// MATTERCHAT:` and are as small as possible.
- [ ] **No hardcoded colors/spacing** — use Fuselage tokens / the palette so theming stays global.
- [ ] **Use Fuselage components** (`@rocket.chat/fuselage`) — wrap or compose them; don't fork their internals.
- [ ] **New feature = its own directory** (client + server + settings + i18n), mounted at one point.
- [ ] **i18n:** add keys to `packages/i18n/src/locales/en.i18n.json`; don't inline user-facing strings. Values say "MatterChat", never "Rocket.Chat".
- [ ] **Settings:** add via our settings files, **env-first with graceful degradation** (unset = feature off, no crash).
- [ ] **Branding:** change assets in their canonical homes (below), not by adding parallel copies.
- [ ] **Wrap risky new panels** in an error boundary so a bug can't take down the whole client.
- [ ] Updated **this file's custom-code map** if you added a new custom area.

---

## Theming specifics

- **Palette-first:** MatterChat's brand is expressed as theme tokens/CSS variables applied in
  `MainLayoutStyleTags.tsx` + Fuselage's `PaletteStyleTag`. To rebrand a color, change the token, not
  the components.
- **Light + dark:** Fuselage carries both; drive off the theme mode (`useThemeMode`) rather than
  assuming a background.
- **Density / radius / typography:** these are token-level too — a global change, not a per-component one.
- **Don't** reach for raw CSS or inline `style={{color:'#...'}}` — it fragments the brand and resists
  future re-theming.

---

## Branding / white-label — canonical asset homes

(So the brand ships automatically on deploy, with no Admin → Assets upload. All verified as
code-default files, not DB overrides.)

- **PWA install icons** (manifest `any`/`maskable` + apple-touch): `public/images/pwa/` — referenced by
  `public/images/manifest.json` + `client/views/root/AppRoot.tsx`.
- **Browser tab / OS / tile / Safari-pinned favicons + login logo**: `public/favicon.ico` +
  `public/images/logo/**` (these are the Rocket.Chat **Assets defaults** in `app/assets/server/assets.ts`;
  replacing the files rebrands automatically).
- **Brand colors in markup:** `public/images/browserconfig.xml` (`TileColor`) + the `mask-icon` color in
  `client/views/root/AppRoot.tsx`.
- **Email footer / transactional email brand:** `server/settings/email.ts` (`Email_Footer` default).
- ⚠️ Anything that can *also* be overridden in **Admin → Assets / Admin → Email** wins over the code
  default in the DB — if a surface won't rebrand from code, check for an admin override.

---

## Upstream-merge playbook (keep the fork current safely)

- Merge upstream Rocket.Chat **into a feature branch**, resolve, verify, then bring to `staging`
  (the prod source line). Never rebuild the prod image from a stale tree — **promote via ECR retag**
  (see `DECISIONS.md` / the July-5 postmortem).
- Conflicts should cluster only in the **marked** (`// MATTERCHAT:`) core edits + the mount points —
  if a merge conflicts deep in a feature dir, something got edited in-place that shouldn't have.
- After merging upstream, re-run the boards API harness + a smoke of the custom surfaces before promoting.

---

_The point: MatterChat's UI is as customizable as any React app we own — because it is one. Spend the
freedom on **new files and tokens**, not on editing Rocket.Chat's core, and every future update stays
easy._
