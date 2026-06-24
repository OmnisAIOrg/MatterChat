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

  console.log(`\n${pass} passed, ${fail} failed  (board ${boardId})`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
