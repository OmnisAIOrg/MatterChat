# Boards: Big Boards Load Fully and Fast (Server-Side Pagination)

> Status: **landing** (branches `auto/boards-pagination` / `auto/boards-pagination-2`, not yet merged to staging as of 2026-07-01)

## What it is

Omnis Boards now loads board data in pages served straight from the database instead of pulling every card in one unbounded request. Two user-visible effects:

1. **The >100-card truncation is fixed.** Previously the board view asked the server for up to 1,000 cards in a single request, but the API's hard per-request ceiling (`API_Upper_Count_Limit`, default 100) silently capped the response — so any board with more than 100 cards *silently dropped* the rest. The board view now fetches cards in pages of 100 and keeps going until it has the whole board, so every card shows up.
2. **Big boards feel fast.** The first page paints the board immediately while the remaining pages stream in, and the server never builds an unbounded result set in memory — paging (skip/limit + a separate total count) happens in MongoDB on an indexed, deterministic sort.

## Who it's for

Any firm running real matter pipelines on Boards — once a pipeline passes ~100 cards this is the difference between seeing your whole caseload and silently missing cards.

## How to use it

Nothing to do. Open any board; all cards load, largest boards paint progressively. Drag & drop, multi-select, and bulk actions operate on the full card set as before.

## What's paginated (API level)

For integrators and the CHI tools:

- **Boards list, cards, activities** — standard Rocket.Chat `offset`/`count` paging with a `total` in the response envelope; deterministic sorts (creation order for boards, position for cards, newest-first for activity) so pages never skip or repeat rows.
- **`boards.cards.myDay`** — paging is **opt-in**: pass `offset`/`count` to page; pass neither and you keep the historical full result set (the planner, calendar, and CHI clients bucket the whole feed client-side). `total` is returned either way.
- **`boards.cards.search`** — paging opt-in the same way; without params the historical 50-hit cap remains (now enforced by the query limit rather than an in-memory slice).

## Admin setup

None. No new settings. The client's page size (100) stays at the API's default `API_Upper_Count_Limit` so every page request is honored in full.

## FAQ

**Will my automations or API scripts break?**
No. Responses keep the same shape and add `offset`/`total`; endpoints that previously returned everything still do when called without paging params.

**Is there a new limit on board size?**
No — the opposite. The former silent 100-card ceiling is gone; the client pages to the end of the board regardless of size.

## Key files (for developers)

`apps/meteor/server/lib/boards/reads.ts` (Mongo-level paged read helpers), `apps/meteor/app/api/server/v1/boards.ts` (opt-in paging on myDay/search), `apps/meteor/client/views/boards/board/BoardView.tsx` (infinite-query paging, optimistic move over paged cache), `scripts/boards-api-test.mjs` (harness cases).
