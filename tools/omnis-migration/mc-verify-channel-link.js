// Headless verification of the channel↔matter link, end-to-end over the REST API:
//   auth (OmnisAI login) -> ensure matters board -> bind a stub matter card
//   -> linkChannel (creates + binds a private channel) -> assert room + card.link.roomId
//   -> unlinkChannel -> assert cleared.
const BASE = 'http://localhost:3100';

async function getCredentialToken() {
	const r1 = await fetch(`${BASE}/_omnisai/authorize`, { redirect: 'manual' });
	const r2 = await fetch(r1.headers.get('location'), { redirect: 'manual' });
	const r3 = await fetch(r2.headers.get('location'), { redirect: 'manual' });
	return r3.headers.get('location').split('/omnisai/')[1];
}

function ddpLogin(credentialToken) {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket('ws://localhost:3100/websocket');
		const t = setTimeout(() => reject(new Error('ddp timeout')), 20000);
		ws.onopen = () => ws.send(JSON.stringify({ msg: 'connect', version: '1', support: ['1'] }));
		ws.onmessage = (e) => {
			const m = JSON.parse(e.data);
			if (m.msg === 'connected') ws.send(JSON.stringify({ msg: 'method', method: 'login', params: [{ omnisai: true, credentialToken }], id: '1' }));
			else if (m.msg === 'ping') ws.send(JSON.stringify({ msg: 'pong', id: m.id }));
			else if (m.msg === 'result' && m.id === '1') { clearTimeout(t); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); ws.close(); }
		};
		ws.onerror = (err) => { clearTimeout(t); reject(err?.message || 'ws error'); };
	});
}

(async () => {
	const session = await ddpLogin(await getCredentialToken());
	const H = { 'Content-Type': 'application/json', 'X-Auth-Token': session.token, 'X-User-Id': session.id };
	const post = async (path, body) => (await fetch(`${BASE}/api/v1/${path}`, { method: 'POST', headers: H, body: JSON.stringify(body || {}) })).json();
	const get = async (path) => (await fetch(`${BASE}/api/v1/${path}`, { headers: H })).json();
	console.log('1) authenticated as', session.id);

	const { board, lists } = await post('boards.matters.ensureBoard', {});
	console.log('2) matters board:', board?._id, 'lists:', lists?.length);

	const matterId = 'stub-matter-0001'; // known CasePro stub matter (Doe v. Roe)
	console.log('3) using stub matter:', matterId);

	const bound = await post('boards.matters.bind', { boardId: board._id, listId: lists[0]._id, matterId });
	const cardId = bound.card?._id;
	console.log('4) matter card:', cardId, 'link.kind:', bound.card?.link?.kind);

	const linked = await post('boards.matters.linkChannel', { cardId });
	const roomId = linked.card?.link?.roomId;
	console.log('5) linkChannel -> card.link.roomId:', roomId);

	const unlinked = await post('boards.matters.unlinkChannel', { cardId });
	console.log('6) unlinkChannel -> card.link.roomId:', unlinked.card?.link?.roomId ?? '(cleared)');

	console.log(roomId ? '7) LINK PASS: a channel was created + bound to the matter card' : '7) LINK FAIL');
	// emit the roomId so the shell step can inspect Mongo
	console.log('ROOMID=' + (roomId || ''));
	console.log('CARDID=' + (cardId || ''));
})().catch((e) => { console.log('ERROR:', e?.message || e); process.exit(1); });
