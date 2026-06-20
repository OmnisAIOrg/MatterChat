// Comprehensive channel↔matter verification over REST:
//   bind matter card -> link (CREATE) -> unlink (DETACH) -> link again (REUSE, no collision).
const BASE = 'http://localhost:3100';
async function getCT() {
	const r1 = await fetch(`${BASE}/_omnisai/authorize`, { redirect: 'manual' });
	const r2 = await fetch(r1.headers.get('location'), { redirect: 'manual' });
	const r3 = await fetch(r2.headers.get('location'), { redirect: 'manual' });
	return r3.headers.get('location').split('/omnisai/')[1];
}
function login(ct) {
	return new Promise((res, rej) => {
		const ws = new WebSocket('ws://localhost:3100/websocket');
		ws.onopen = () => ws.send(JSON.stringify({ msg: 'connect', version: '1', support: ['1'] }));
		ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.msg === 'connected') ws.send(JSON.stringify({ msg: 'method', method: 'login', params: [{ omnisai: true, credentialToken: ct }], id: '1' })); else if (m.msg === 'ping') ws.send(JSON.stringify({ msg: 'pong', id: m.id })); else if (m.msg === 'result' && m.id === '1') { m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); ws.close(); } };
		ws.onerror = rej;
	});
}
(async () => {
	const s = await login(await getCT());
	const H = { 'Content-Type': 'application/json', 'X-Auth-Token': s.token, 'X-User-Id': s.id };
	const post = async (p, b) => (await fetch(`${BASE}/api/v1/${p}`, { method: 'POST', headers: H, body: JSON.stringify(b) })).json();
	const { board, lists } = await post('boards.matters.ensureBoard', {});
	const bound = await post('boards.matters.bind', { boardId: board._id, listId: lists[0]._id, matterId: 'stub-matter-0001' });
	const cardId = bound.card._id;
	console.log('card:', cardId);

	const link1 = await post('boards.matters.linkChannel', { cardId });
	const room1 = link1.card?.link?.roomId;
	console.log('LINK (create)   -> roomId:', room1, link1.success === false ? `ERR ${link1.error}` : '');

	const unlink = await post('boards.matters.unlinkChannel', { cardId });
	console.log('UNLINK (detach) -> roomId:', unlink.card?.link?.roomId ?? '(cleared)');

	const link2 = await post('boards.matters.linkChannel', { cardId });
	const room2 = link2.card?.link?.roomId;
	console.log('LINK (reuse)    -> roomId:', room2, link2.success === false ? `ERR ${link2.error}` : '');

	const pass = !!room1 && !unlink.card?.link?.roomId && room2 === room1;
	console.log(pass ? 'PASS: create + detach + reuse-same-room (no collision)' : 'FAIL');
	console.log('FINAL_ROOMID=' + (room2 || ''));
	console.log('CARDID=' + cardId);
})().catch((e) => { console.log('ERR:', e.message); process.exit(1); });
