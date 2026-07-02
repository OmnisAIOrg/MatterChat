#!/usr/bin/env node
/**
 * Boards API regression harness — instant verification of the boards.* REST
 * surface (the parity primitives) against a running MatterChat instance.
 * Replaces 15-min rebuild + manual browser clicking for server/API work.
 *
 *   MC_BASE=http://localhost:3100/api/v1 \
 *   MC_USER_ID=<id> MC_AUTH_TOKEN=<token> node boards-api-test.mjs
 *
 * Exits non-zero on any failure.
 */

const BASE = process.env.MC_BASE || 'http://localhost:3100/api/v1';
const USER = process.env.MC_USER_ID || '';
const TOKEN = process.env.MC_AUTH_TOKEN || '';

let pass = 0;
let fail = 0;
const ok = (cond, label, extra = '') => {
  if (cond) { pass += 1; console.log(`  ok   ${label}${extra ? '  ' + extra : ''}`); }
  else { fail += 1; console.log(`  FAIL ${label}${extra ? '  ' + extra : ''}`); }
};

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'X-User-Id': USER,
      'X-Auth-Token': TOKEN,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json };
}

async function main() {
  if (!USER || !TOKEN) { console.error('Set MC_USER_ID + MC_AUTH_TOKEN'); process.exit(2); }

  // --- scaffold: board + list + card ---
  const b = await api('POST', '/boards.create', { title: 'API Test Board', pipelineType: 'general' });
  const boardId = b.json?.board?._id;
  ok(!!boardId, 'create board', boardId || JSON.stringify(b.json));

  const l = await api('POST', '/boards.list.create', { boardId, title: 'To do' });
  const listId = l.json?.list?._id;
  ok(!!listId, 'create list', listId);

  const c = await api('POST', '/boards.card.create', { boardId, listId, title: 'Parity test card' });
  const cardId = c.json?.card?._id;
  ok(!!cardId, 'create card', cardId);

  // --- priority (batch 2) ---
  const today = new Date(); today.setHours(17, 0, 0, 0);
  const u = await api('POST', '/boards.card.update', { cardId, patch: { assignees: [USER], dueDate: today.toISOString(), priority: 'high' } });
  ok(u.json?.card?.priority === 'high', 'set priority=high', u.json?.card?.priority);

  // --- my day (shows the due card with priority) ---
  const md = await api('GET', '/boards.cards.myDay');
  const inMyDay = (md.json?.cards || []).find((x) => x._id === cardId);
  ok(!!inMyDay && inMyDay.priority === 'high', 'my-day shows card w/ priority', `${md.json?.count} cards`);

  // --- global search (batch 2) ---
  const s = await api('GET', '/boards.cards.search?text=Parity%20test');
  ok((s.json?.cards || []).some((x) => x._id === cardId), 'search finds card', `${s.json?.count} hits`);

  // --- card copy (batch 1) ---
  const cp = await api('POST', '/boards.card.copy', { cardId });
  ok(cp.json?.card?.title === 'Copy of Parity test card', 'copy card', cp.json?.card?.title);

  // --- dependencies (batch 1) ---
  const c2 = await api('POST', '/boards.card.create', { boardId, listId, title: 'Blocker card' });
  const card2 = c2.json?.card?._id;
  await api('POST', '/boards.card.relations.add', { cardId, type: 'blocked-by', targetCardId: card2 });
  const got1 = await api('GET', `/boards.card?cardId=${cardId}`);
  const got2 = await api('GET', `/boards.card?cardId=${card2}`);
  const rel1 = (got1.json?.card?.relations || []).some((r) => r.type === 'blocked-by' && r.cardId === card2);
  const rel2 = (got2.json?.card?.relations || []).some((r) => r.type === 'blocks' && r.cardId === cardId);
  ok(rel1 && rel2, 'dependency + inverse edge', `self=${rel1} inverse=${rel2}`);

  // --- recurrence (prior) ---
  const rc = await api('POST', '/boards.card.recurrence.set', { cardId, recurrence: { freq: 'weekly', interval: 1 } });
  ok(rc.json?.card?.recurrence?.freq === 'weekly', 'set recurrence', rc.json?.card?.recurrence?.freq);

  // --- completion (batch 1) — and recurrence materialization on complete ---
  const cmp = await api('POST', '/boards.card.complete', { cardId });
  ok(cmp.json?.card?.completed === true, 'complete card', `completed=${cmp.json?.card?.completed}`);
  const listAfter = await api('GET', `/boards.cards?boardId=${boardId}`);
  const titles = (listAfter.json?.cards || []).map((x) => x.title);
  const recurredAgain = titles.filter((t) => t === 'Parity test card').length >= 1; // next occurrence exists
  ok(recurredAgain, 'recurrence spawned next on complete', `${titles.length} cards on board`);

  // --- board copy (batch 3) ---
  const bc = await api('POST', '/boards.copy', { boardId });
  const newBoardId = bc.json?.board?._id;
  ok(bc.json?.board?.title === 'Copy of API Test Board', 'copy board', bc.json?.board?.title);
  const newLists = await api('GET', `/boards.lists?boardId=${newBoardId}`);
  ok((newLists.json?.lists || []).length >= 1, 'copied board has lists', `${newLists.json?.lists?.length} lists`);

  // --- card from template (batch 3) ---
  const ft = await api('POST', '/boards.card.fromTemplate', { templateCardId: cardId, listId });
  ok(ft.json?.card?.title === 'Parity test card' && ft.json?.card?._id !== cardId, 'card from template', ft.json?.card?.title);

  // --- milestones (batch) ---
  const ms = await api('POST', '/boards.card.milestone.set', { cardId, isMilestone: true });
  ok(ms.json?.card?.isMilestone === true, 'set milestone', `isMilestone=${ms.json?.card?.isMilestone}`);

  // --- approvals (batch) ---
  await api('POST', '/boards.card.approval.request', { cardId, approvers: [USER] });
  const dec = await api('POST', '/boards.card.approval.decide', { cardId, decision: 'approved' });
  ok(dec.json?.card?.approval?.status === 'approved', 'approval request+decide', `status=${dec.json?.card?.approval?.status}`);

  // --- bulk card operations (batch) ---
  const bk1 = await api('POST', '/boards.card.create', { boardId, listId, title: 'Bulk card 1' });
  const bk2 = await api('POST', '/boards.card.create', { boardId, listId, title: 'Bulk card 2' });
  const bk3 = await api('POST', '/boards.card.create', { boardId, listId, title: 'Bulk card 3' });
  const bulkIds = [bk1.json?.card?._id, bk2.json?.card?._id, bk3.json?.card?._id];
  const bulk = await api('POST', '/boards.cards.bulk', { cardIds: bulkIds, action: 'complete' });
  ok(bulk.json?.updated === 3 && bulk.json?.failed === 0, 'bulk complete 3 cards', `updated=${bulk.json?.updated} failed=${bulk.json?.failed}`);
  const bulkVerify = await api('GET', `/boards.card?cardId=${bulkIds[0]}`);
  ok(bulkVerify.json?.card?.completed === true, 'bulk-completed card is completed', `completed=${bulkVerify.json?.card?.completed}`);
  // one bad card id must not abort the batch (partial success)
  const bulkPartial = await api('POST', '/boards.cards.bulk', { cardIds: [bulkIds[1], 'nonexistent-card-id'], action: 'setPriority', priority: 'urgent' });
  ok(bulkPartial.json?.updated === 1 && bulkPartial.json?.failed === 1, 'bulk partial (1 ok, 1 fail)', `updated=${bulkPartial.json?.updated} failed=${bulkPartial.json?.failed}`);

  // --- board status (batch) ---
  const st1 = await api('POST', '/boards.setStatus', { boardId, status: 'on_hold' });
  ok(st1.json?.board?.status === 'on_hold' && st1.json?.board?.archived === false, 'set status=on_hold', `status=${st1.json?.board?.status} archived=${st1.json?.board?.archived}`);

  const st2 = await api('POST', '/boards.setStatus', { boardId, status: 'archived' });
  ok(st2.json?.board?.status === 'archived' && st2.json?.board?.archived === true, 'set status=archived keeps archived flag', `status=${st2.json?.board?.status} archived=${st2.json?.board?.archived}`);

  const st3 = await api('POST', '/boards.setStatus', { boardId, status: 'active' });
  ok(st3.json?.board?.status === 'active' && st3.json?.board?.archived === false, 're-activate archived board', `status=${st3.json?.board?.status} archived=${st3.json?.board?.archived}`);

  const stBad = await api('POST', '/boards.setStatus', { boardId, status: 'bogus' });
  ok(stBad.status === 400, 'reject invalid status value', `http=${stBad.status}`);

  // --- list colors (batch) ---
  const lc = await api('POST', '/boards.list.create', { boardId, title: 'Colored column' });
  const colorListId = lc.json?.list?._id;
  ok(!!colorListId, 'create list for color', colorListId);
  const setColor = await api('POST', '/boards.list.update', { listId: colorListId, patch: { color: '#1d74f5' } });
  ok(setColor.json?.list?.color === '#1d74f5', 'set list color', setColor.json?.list?.color);
  const listsRead = await api('GET', `/boards.lists?boardId=${boardId}`);
  const readBack = (listsRead.json?.lists || []).find((x) => x._id === colorListId);
  ok(readBack?.color === '#1d74f5', 'list color persisted on read-back', readBack?.color);

  // --- list reorder (batch) ---
  const rb = await api('POST', '/boards.create', { title: 'Reorder Board', pipelineType: 'general' });
  const reorderBoardId = rb.json?.board?._id;
  const rl1 = await api('POST', '/boards.list.create', { boardId: reorderBoardId, title: 'Reorder A' });
  const rl2 = await api('POST', '/boards.list.create', { boardId: reorderBoardId, title: 'Reorder B' });
  const rl3 = await api('POST', '/boards.list.create', { boardId: reorderBoardId, title: 'Reorder C' });
  const rA = rl1.json?.list?._id;
  const rB = rl2.json?.list?._id;
  const rC = rl3.json?.list?._id;
  ok(!!rA && !!rB && !!rC, 'create 3 lists for reorder', `${rA},${rB},${rC}`);
  // created in A,B,C order -> sanity check the initial sequence
  const before = await api('GET', `/boards.lists?boardId=${reorderBoardId}`);
  const beforeOrder = (before.json?.lists || []).map((x) => x._id);
  ok(JSON.stringify(beforeOrder) === JSON.stringify([rA, rB, rC]), 'initial list order is A,B,C', beforeOrder.join(','));
  // reorder to C,A,B via the full-ordering form { boardId, listIds }
  const ro = await api('POST', '/boards.list.reorder', { boardId: reorderBoardId, listIds: [rC, rA, rB] });
  ok((ro.json?.lists || []).map((x) => x._id).join(',') === [rC, rA, rB].join(','), 'reorder response in new order', (ro.json?.lists || []).map((x) => x._id).join(','));
  // GET boards.lists and assert the new persisted sequence
  const after = await api('GET', `/boards.lists?boardId=${reorderBoardId}`);
  const afterOrder = (after.json?.lists || []).map((x) => x._id);
  ok(JSON.stringify(afterOrder) === JSON.stringify([rC, rA, rB]), 'boards.lists reflects new order C,A,B', afterOrder.join(','));
  // single-list move form { listId, position }: bump B to the front via an absolute position
  const roSingle = await api('POST', '/boards.list.reorder', { listId: rB, position: 1 });
  const afterSingle = (roSingle.json?.lists || []).map((x) => x._id);
  ok(afterSingle[0] === rB, 'single-list move puts B first', afterSingle.join(','));

  // --- labels / tags (batch) ---
  // create a board-level palette label
  const lbl = await api('POST', '/boards.label.create', { boardId, name: 'Urgent', color: '#f5455c' });
  const labelId = (lbl.json?.board?.labelDefs || []).find((d) => d.name === 'Urgent')?.id;
  ok(!!labelId, 'create board label', labelId || JSON.stringify(lbl.json));

  // assign it to a card, then read the card back and assert the label is present
  const assign = await api('POST', '/boards.card.labels.set', { cardId, labelIds: [labelId] });
  ok((assign.json?.card?.labels || []).includes(labelId), 'assign label to card', `labels=${JSON.stringify(assign.json?.card?.labels)}`);
  const cardWithLabel = await api('GET', `/boards.card?cardId=${cardId}`);
  ok((cardWithLabel.json?.card?.labels || []).includes(labelId), 'card read-back has label', `labels=${JSON.stringify(cardWithLabel.json?.card?.labels)}`);

  // rename the label, then unassign it (empty set), and reject an unknown id
  const ren = await api('POST', '/boards.label.update', { boardId, labelId, patch: { name: 'Critical' } });
  ok((ren.json?.board?.labelDefs || []).some((d) => d.id === labelId && d.name === 'Critical'), 'rename board label', 'Critical');
  const unassign = await api('POST', '/boards.card.labels.set', { cardId, labelIds: [] });
  ok((unassign.json?.card?.labels || []).length === 0, 'unassign labels from card', `labels=${JSON.stringify(unassign.json?.card?.labels)}`);
  const badAssign = await api('POST', '/boards.card.labels.set', { cardId, labelIds: ['nope-not-a-real-label'] });
  ok(badAssign.status === 400, 'reject unknown label id', `http=${badAssign.status}`);

  // delete the label and confirm it is gone from the palette
  const del = await api('POST', '/boards.label.delete', { boardId, labelId });
  ok(!(del.json?.board?.labelDefs || []).some((d) => d.id === labelId), 'delete board label', `${del.json?.board?.labelDefs?.length} labels left`);

  // --- checklists / sub-tasks (batch) ---
  const clCard = await api('POST', '/boards.card.create', { boardId, listId, title: 'Checklist card' });
  const clCardId = clCard.json?.card?._id;
  ok(!!clCardId, 'create card for checklist', clCardId);
  // add two checklist items
  const add1 = await api('POST', '/boards.card.checklist.add', { cardId: clCardId, text: 'Draft motion' });
  const add2 = await api('POST', '/boards.card.checklist.add', { cardId: clCardId, text: 'File with court' });
  const itemsAfterAdd = (add2.json?.card?.checklists || []).flatMap((cl) => cl.items || []);
  ok(itemsAfterAdd.length === 2, 'add 2 checklist items', `${itemsAfterAdd.length} items`);
  const firstItemId = (add1.json?.card?.checklists || []).flatMap((cl) => cl.items || [])[0]?.id;
  ok(!!firstItemId, 'first item has generated id', firstItemId);
  // toggle the first item done
  const tog = await api('POST', '/boards.card.checklist.toggle', { cardId: clCardId, itemId: firstItemId, done: true });
  const toggledItem = (tog.json?.card?.checklists || []).flatMap((cl) => cl.items || []).find((it) => it.id === firstItemId);
  ok(toggledItem?.done === true, 'toggle checklist item done', `done=${toggledItem?.done}`);
  // read the card back and assert persisted state: 2 items, exactly 1 done
  const clRead = await api('GET', `/boards.card?cardId=${clCardId}`);
  const readItems = (clRead.json?.card?.checklists || []).flatMap((cl) => cl.items || []);
  const doneCount = readItems.filter((it) => it.done).length;
  ok(readItems.length === 2 && doneCount === 1, 'read-back: 2 items, 1 done', `items=${readItems.length} done=${doneCount}`);

  // --- iCal (.ics) feed of due cards (batch: calendar subscription) ---
  // Create a fresh card with a due date assigned to me, then pull the authenticated ical feed and
  // assert it is a valid VCALENDAR containing a VEVENT/SUMMARY for that card.
  const icalTitle = `iCal feed card ${Date.now()}`;
  const ic = await api('POST', '/boards.card.create', { boardId, listId, title: icalTitle });
  const icalCardId = ic.json?.card?._id;
  ok(!!icalCardId, 'create card for ical feed', icalCardId);
  const dueIcal = new Date(); dueIcal.setHours(14, 30, 0, 0);
  await api('POST', '/boards.card.update', { cardId: icalCardId, patch: { assignees: [USER], dueDate: dueIcal.toISOString() } });

  const icalRes = await fetch(`${BASE}/boards.cards.ical`, {
    method: 'GET',
    headers: { 'X-User-Id': USER, 'X-Auth-Token': TOKEN, Accept: 'text/calendar' },
  });
  const icalCt = icalRes.headers.get('content-type') || '';
  const icalBody = await icalRes.text();
  ok(icalCt.includes('text/calendar'), 'ical Content-Type is text/calendar', icalCt);
  ok(icalBody.includes('BEGIN:VCALENDAR') && icalBody.includes('END:VCALENDAR'), 'ical wraps VCALENDAR', `${icalBody.length} bytes`);
  ok(icalBody.includes('VERSION:2.0') && icalBody.includes('PRODID:'), 'ical has VERSION + PRODID');
  ok(icalBody.includes('BEGIN:VEVENT') && icalBody.includes(`SUMMARY:${icalTitle}`), 'ical has VEVENT/SUMMARY for due card', icalTitle);
  ok(icalBody.includes(`UID:boards-card-${icalCardId}@matterchat`), 'ical event has stable per-card UID');

  // --- public iCal subscription token (batch: calendar subscription) ---
  // Mint the per-user feed token, then fetch the PUBLIC feed with ?token= and NO auth headers and
  // assert it returns the same text/calendar VCALENDAR. Idempotency + bad-token rejection too.
  const tk1 = await api('POST', '/boards.cards.ical.token', {});
  const icalToken = tk1.json?.token;
  ok(!!icalToken && typeof icalToken === 'string', 'mint ical feed token', icalToken ? `${icalToken.slice(0, 6)}…` : JSON.stringify(tk1.json));
  const tk2 = await api('POST', '/boards.cards.ical.token', {});
  ok(tk2.json?.token === icalToken, 'ical token is idempotent (same token on re-call)');

  // Fetch the public feed with ONLY ?token= — no X-User-Id / X-Auth-Token headers.
  const pubRes = await fetch(`${BASE}/boards.cards.ical.public?token=${encodeURIComponent(icalToken)}`, {
    method: 'GET',
    headers: { Accept: 'text/calendar' },
  });
  const pubCt = pubRes.headers.get('content-type') || '';
  const pubBody = await pubRes.text();
  ok(pubRes.status === 200, 'public ical feed returns 200 with token + no auth headers', `http=${pubRes.status}`);
  ok(pubCt.includes('text/calendar'), 'public ical Content-Type is text/calendar', pubCt);
  ok(pubBody.includes('BEGIN:VCALENDAR') && pubBody.includes('END:VCALENDAR'), 'public ical wraps VCALENDAR', `${pubBody.length} bytes`);
  ok(pubBody.includes(`SUMMARY:${icalTitle}`), 'public ical contains the due card', icalTitle);

  // A bad/unknown token must be rejected (401) and leak no calendar body.
  const badRes = await fetch(`${BASE}/boards.cards.ical.public?token=not-a-real-token`, {
    method: 'GET',
    headers: { Accept: 'text/calendar' },
  });
  const badBody = await badRes.text();
  ok(badRes.status === 401, 'public ical rejects unknown token with 401', `http=${badRes.status}`);
  ok(!badBody.includes('BEGIN:VCALENDAR'), 'public ical leaks no feed body for bad token');

  // A missing token must be rejected by schema validation (400) — token is required.
  const noTokRes = await fetch(`${BASE}/boards.cards.ical.public`, { method: 'GET', headers: { Accept: 'text/calendar' } });
  ok(noTokRes.status === 400 || noTokRes.status === 401, 'public ical rejects missing token', `http=${noTokRes.status}`);

  // --- server-side pagination (offset/count/total envelope) ---
  // Fresh board + list with 7 cards, then walk it in pages of 3 and assert the
  // pages are disjoint, ordered, and union to the full set.
  const pb = await api('POST', '/boards.create', { title: 'Pagination Board', pipelineType: 'general' });
  const pgBoardId = pb.json?.board?._id;
  const pl = await api('POST', '/boards.list.create', { boardId: pgBoardId, title: 'Paged list' });
  const pgListId = pl.json?.list?._id;
  const pgIds = [];
  for (let i = 1; i <= 7; i++) {
    const pc = await api('POST', '/boards.card.create', { boardId: pgBoardId, listId: pgListId, title: `Paged card ${i}` });
    pgIds.push(pc.json?.card?._id);
  }
  ok(pgIds.every(Boolean), 'create 7 cards for pagination', `${pgIds.length} cards`);

  const pg1 = await api('GET', `/boards.cards?boardId=${pgBoardId}&listId=${pgListId}&count=3`);
  ok(pg1.json?.cards?.length === 3 && pg1.json?.total === 7 && pg1.json?.offset === 0,
    'cards page 1: 3 rows, total=7, offset=0', `rows=${pg1.json?.cards?.length} total=${pg1.json?.total} offset=${pg1.json?.offset}`);

  const pg2 = await api('GET', `/boards.cards?boardId=${pgBoardId}&listId=${pgListId}&count=3&offset=3`);
  ok(pg2.json?.cards?.length === 3 && pg2.json?.offset === 3, 'cards page 2: 3 rows at offset=3', `rows=${pg2.json?.cards?.length}`);

  const pg3 = await api('GET', `/boards.cards?boardId=${pgBoardId}&listId=${pgListId}&count=3&offset=6`);
  ok(pg3.json?.cards?.length === 1 && pg3.json?.total === 7, 'cards page 3: 1 remaining row', `rows=${pg3.json?.cards?.length}`);

  const pagedIds = [...(pg1.json?.cards || []), ...(pg2.json?.cards || []), ...(pg3.json?.cards || [])].map((x) => x._id);
  const disjoint = new Set(pagedIds).size === 7;
  const complete = pgIds.every((id) => pagedIds.includes(id));
  ok(disjoint && complete, 'pages are disjoint and union to all 7 cards', `unique=${new Set(pagedIds).size} complete=${complete}`);

  // position-ordered pages: creation order == position order for sequentially created cards
  ok(JSON.stringify(pagedIds) === JSON.stringify(pgIds), 'pages come back in stable position order');

  // board-wide (no listId) call still honors the envelope
  const pgBoardWide = await api('GET', `/boards.cards?boardId=${pgBoardId}&count=5`);
  ok(pgBoardWide.json?.cards?.length === 5 && pgBoardWide.json?.total === 7, 'board-wide cards page (no listId)', `rows=${pgBoardWide.json?.cards?.length} total=${pgBoardWide.json?.total}`);

  // no-params call keeps working (default page size >= 7 here, so the full set + total)
  const pgDefault = await api('GET', `/boards.cards?boardId=${pgBoardId}`);
  ok(pgDefault.json?.cards?.length === 7 && pgDefault.json?.total === 7, 'cards without paging params returns full set + total', `rows=${pgDefault.json?.cards?.length}`);

  // a cross-board listId must page to an empty set, not leak another board's cards
  const pgCross = await api('GET', `/boards.cards?boardId=${boardId}&listId=${pgListId}&count=3`);
  ok(pgCross.json?.cards?.length === 0 && pgCross.json?.total === 0, 'cross-board listId pages to empty set', `rows=${pgCross.json?.cards?.length}`);

  // --- boards.list pagination ---
  const bl1 = await api('GET', '/boards.list?count=1');
  ok(bl1.json?.boards?.length === 1 && bl1.json?.total >= 2, 'boards.list count=1 returns 1 board + total', `total=${bl1.json?.total}`);
  const bl2 = await api('GET', `/boards.list?count=1&offset=1`);
  ok(bl2.json?.boards?.length === 1 && bl2.json?.boards?.[0]?._id !== bl1.json?.boards?.[0]?._id, 'boards.list offset=1 returns a different board');

  // --- boards.activities pagination (7 card creations logged above) ---
  const act1 = await api('GET', `/boards.activities?boardId=${pgBoardId}&count=2`);
  ok(act1.json?.activities?.length === 2 && act1.json?.total >= 7, 'activities page: 2 rows + total', `total=${act1.json?.total}`);
  const act2 = await api('GET', `/boards.activities?boardId=${pgBoardId}&count=2&offset=2`);
  const actOverlap = (act1.json?.activities || []).some((a) => (act2.json?.activities || []).some((b) => b._id === a._id));
  ok(act2.json?.activities?.length === 2 && !actOverlap, 'activities offset page is disjoint', `overlap=${actOverlap}`);

  // --- myDay pagination (opt-in; no params keeps the full set) ---
  const due = new Date(); due.setHours(16, 0, 0, 0);
  await api('POST', '/boards.card.update', { cardId: pgIds[0], patch: { assignees: [USER], dueDate: due.toISOString() } });
  await api('POST', '/boards.card.update', { cardId: pgIds[1], patch: { assignees: [USER], dueDate: due.toISOString() } });
  const mdFull = await api('GET', '/boards.cards.myDay');
  ok(typeof mdFull.json?.total === 'number' && mdFull.json?.cards?.length === mdFull.json?.total,
    'myDay without params returns full set + total', `rows=${mdFull.json?.cards?.length} total=${mdFull.json?.total}`);
  const mdPage = await api('GET', '/boards.cards.myDay?count=1');
  ok(mdPage.json?.cards?.length === 1 && mdPage.json?.total === mdFull.json?.total, 'myDay count=1 pages to 1 row, same total', `total=${mdPage.json?.total}`);

  // --- search pagination (opt-in; no params keeps the 50-hit cap) ---
  const s1 = await api('GET', `/boards.cards.search?text=${encodeURIComponent('Paged card')}`);
  ok(s1.json?.cards?.length === 7 && s1.json?.total === 7, 'search without params returns hits + total', `hits=${s1.json?.cards?.length}`);
  const s2 = await api('GET', `/boards.cards.search?text=${encodeURIComponent('Paged card')}&count=3&offset=3`);
  ok(s2.json?.cards?.length === 3 && s2.json?.total === 7 && s2.json?.offset === 3, 'search count=3 offset=3 pages hits', `hits=${s2.json?.cards?.length} total=${s2.json?.total}`);

  // --- boards.views.cards pagination (opt-in flat offset/count + per-group cap) ---
  // second list on the pagination board so groupBy=list yields two groups (7 + 3 = 10 cards)
  const pl2 = await api('POST', '/boards.list.create', { boardId: pgBoardId, title: 'Paged list B' });
  const pgListB = pl2.json?.list?._id;
  const pgIdsB = [];
  for (let i = 1; i <= 3; i++) {
    const pc = await api('POST', '/boards.card.create', { boardId: pgBoardId, listId: pgListB, title: `Paged-B card ${i}` });
    pgIdsB.push(pc.json?.card?._id);
  }
  ok(pgIdsB.every(Boolean), 'create 3 cards in second list', `${pgIdsB.length} cards`);

  const sv = await api('POST', '/boards.views.upsert', { name: 'Grouped by list', viewType: 'table', scope: 'board', boardId: pgBoardId, config: { groupBy: 'list' } });
  const svId = sv.json?.view?._id;
  ok(!!svId, 'create saved view (groupBy=list)', svId);

  // no-params compat: full 10-card set + total, groups uncapped with exact per-group totals
  const vc0 = await api('GET', `/boards.views.cards?boardId=${pgBoardId}&viewId=${svId}`);
  const vc0r = vc0.json?.result;
  const vc0Groups = vc0r?.groups || [];
  ok(vc0r?.cards?.length === 10 && vc0r?.total === 10, 'views.cards without params returns full set + total', `rows=${vc0r?.cards?.length} total=${vc0r?.total}`);
  ok(vc0Groups.length === 2 && vc0Groups.every((g) => g.total === g.cards.length && g.hasMore === false),
    'uncapped groups carry exact total + hasMore=false', vc0Groups.map((g) => `${g.cards.length}/${g.total}`).join(' '));

  // flat paging: walk the 10 cards in pages of 4 (disjoint, union-complete, total constant)
  const vp1 = await api('GET', `/boards.views.cards?boardId=${pgBoardId}&viewId=${svId}&count=4`);
  const vp2 = await api('GET', `/boards.views.cards?boardId=${pgBoardId}&viewId=${svId}&count=4&offset=4`);
  const vp3 = await api('GET', `/boards.views.cards?boardId=${pgBoardId}&viewId=${svId}&count=4&offset=8`);
  ok(vp1.json?.result?.cards?.length === 4 && vp1.json?.result?.total === 10 && vp1.json?.result?.offset === 0,
    'views.cards page 1: 4 rows, total=10, offset=0', `rows=${vp1.json?.result?.cards?.length}`);
  ok(vp3.json?.result?.cards?.length === 2 && vp3.json?.result?.total === 10, 'views.cards page 3: 2 remaining rows', `rows=${vp3.json?.result?.cards?.length}`);
  const vpIds = [vp1, vp2, vp3].flatMap((r) => (r.json?.result?.cards || []).map((x) => x._id));
  const vpAll = [...pgIds, ...pgIdsB];
  ok(new Set(vpIds).size === 10 && vpAll.every((id) => vpIds.includes(id)),
    'views.cards pages are disjoint and union to all 10 cards', `unique=${new Set(vpIds).size}`);

  // groups keep bucketing the FULL match set (exact totals) while the flat array is paged
  ok((vp1.json?.result?.groups || []).reduce((n, g) => n + g.total, 0) === 10,
    'group totals stay complete while cards page', `sum=${(vp1.json?.result?.groups || []).reduce((n, g) => n + g.total, 0)}`);

  // per-group cap: groupLimit=2 caps every bucket; per-group total/hasMore stay exact
  const vgl = await api('GET', `/boards.views.cards?boardId=${pgBoardId}&viewId=${svId}&groupLimit=2`);
  const vglr = vgl.json?.result;
  const gA = (vglr?.groups || []).find((g) => g.key === pgListId);
  const gB = (vglr?.groups || []).find((g) => g.key === pgListB);
  ok(gA?.cards?.length === 2 && gA?.total === 7 && gA?.hasMore === true, 'groupLimit=2 caps 7-card group (total=7, hasMore)', `${gA?.cards?.length}/${gA?.total}`);
  ok(gB?.cards?.length === 2 && gB?.total === 3 && gB?.hasMore === true, 'groupLimit=2 caps 3-card group (total=3, hasMore)', `${gB?.cards?.length}/${gB?.total}`);
  ok(vglr?.cards?.length === 10, 'groupLimit alone leaves flat cards unpaged (orthogonal)', `rows=${vglr?.cards?.length}`);

  // --- boards.leads.list pagination (Mongo-paged envelope) ---
  const tok = `PagLead${Date.now()}`;
  const lb = await api('POST', '/boards.leads.ensureBoard', {});
  const leadsBoardId = lb.json?.board?._id;
  ok(!!leadsBoardId, 'ensure leads board', leadsBoardId);
  const leadIds = [];
  let leadStatusId;
  for (let i = 1; i <= 5; i++) {
    const lc = await api('POST', '/boards.leads.create', {
      contact: { firstName: tok, lastName: `Case ${i}`, phone: `+1555${String(Date.now()).slice(-5)}${i}` },
      allowDuplicate: true,
    });
    leadIds.push(lc.json?.lead?._id);
    leadStatusId = lc.json?.lead?.statusId ?? leadStatusId;
  }
  ok(leadIds.every(Boolean), 'create 5 leads', `${leadIds.filter(Boolean).length} leads`);

  // q-scoped full list: exactly our 5 (q narrows in the Mongo query, not in JS)
  const lq = await api('GET', `/boards.leads.list?q=${encodeURIComponent(tok)}`);
  ok(lq.json?.leads?.length === 5 && lq.json?.total === 5, 'leads.list q-filter returns the 5 created + total', `rows=${lq.json?.leads?.length} total=${lq.json?.total}`);

  // page walk 2+2+1: disjoint, union-complete, total constant across pages
  const lp1 = await api('GET', `/boards.leads.list?q=${encodeURIComponent(tok)}&count=2`);
  const lp2 = await api('GET', `/boards.leads.list?q=${encodeURIComponent(tok)}&count=2&offset=2`);
  const lp3 = await api('GET', `/boards.leads.list?q=${encodeURIComponent(tok)}&count=2&offset=4`);
  ok(lp1.json?.leads?.length === 2 && lp1.json?.total === 5 && lp1.json?.offset === 0, 'leads page 1: 2 rows, total=5', `rows=${lp1.json?.leads?.length}`);
  ok(lp3.json?.leads?.length === 1 && lp3.json?.total === 5, 'leads page 3: 1 remaining row', `rows=${lp3.json?.leads?.length}`);
  const lpIds = [lp1, lp2, lp3].flatMap((r) => (r.json?.leads || []).map((x) => x._id));
  ok(new Set(lpIds).size === 5 && leadIds.every((id) => lpIds.includes(id)),
    'lead pages are disjoint and union to all 5 leads', `unique=${new Set(lpIds).size}`);

  // composed filters run in the same Mongo query (boardId + q, statusId + q)
  const lbq = await api('GET', `/boards.leads.list?boardId=${leadsBoardId}&q=${encodeURIComponent(tok)}`);
  ok(lbq.json?.leads?.length === 5 && lbq.json?.total === 5, 'leads.list boardId+q composed filter', `rows=${lbq.json?.leads?.length}`);
  const lsq = await api('GET', `/boards.leads.list?statusId=${leadStatusId}&q=${encodeURIComponent(tok)}`);
  ok(lsq.json?.leads?.length === 5 && lsq.json?.total === 5, 'leads.list statusId+q composed filter', `rows=${lsq.json?.leads?.length}`);

  // no-params compat: historical default page (API_Default_Count), enforced by the
  // query's limit — rows = min(total, 50) and never more than the 100 hard cap
  const l0 = await api('GET', '/boards.leads.list');
  ok(typeof l0.json?.total === 'number' && l0.json?.leads?.length === Math.min(l0.json?.total, 50),
    'leads.list without params returns the default-capped page + total', `rows=${l0.json?.leads?.length} total=${l0.json?.total}`);

  console.log(`\n${pass} passed, ${fail} failed  (board ${boardId})`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
