// Link a fresh channel to the existing matter card and report the LINKED state (no unlink),
// so we can see room.matterCardId / room.matterId stamped + card.link.roomId set.
const BASE = 'http://localhost:3100';
const CARD_ID = process.argv[2];
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
		ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.msg === 'connected') ws.send(JSON.stringify({ msg: 'method', method: 'login', params: [{ omnisai: true, credentialToken: ct }], id: '1' })); else if (m.msg === 'ping') ws.send(JSON.stringify({ msg: 'pong', id: m.id })); else if (m.msg === 'result' && m.id === '1') { res(m.result); ws.close(); } };
		ws.onerror = rej;
	});
}
(async () => {
	const s = await login(await getCT());
	const H = { 'Content-Type': 'application/json', 'X-Auth-Token': s.token, 'X-User-Id': s.id };
	const r = await (await fetch(`${BASE}/api/v1/boards.matters.linkChannel`, { method: 'POST', headers: H, body: JSON.stringify({ cardId: CARD_ID }) })).json();
	console.log('LINKED_ROOMID=' + (r.card?.link?.roomId || ''));
})();
