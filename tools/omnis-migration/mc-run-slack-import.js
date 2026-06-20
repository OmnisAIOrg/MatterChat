// Headless Slack import driver:
//   1. mint a credentialToken via the OmnisAI OIDC chain, then DDP-login (authenticates the
//      connection as the admin pat.paralegal — has run-import)
//   2. uploadImportFile(base64 zip, 'application/zip', name, 'slack')
//   3. poll getImportFileData until prepared
//   4. startImport({ users:all, channels:all })
//   5. poll getImportProgress until done/error
const fs = require('fs');
const BASE = 'http://localhost:3100';
const ZIP = '/Users/davidnguyen/slack-export.zip';

async function getCredentialToken() {
	const r1 = await fetch(`${BASE}/_omnisai/authorize`, { redirect: 'manual' });
	const r2 = await fetch(r1.headers.get('location'), { redirect: 'manual' });
	const r3 = await fetch(r2.headers.get('location'), { redirect: 'manual' });
	const l3 = r3.headers.get('location');
	return l3.split('/omnisai/')[1];
}

function ddp() {
	const ws = new WebSocket('ws://localhost:3100/websocket');
	const pending = new Map();
	let nextId = 1;
	const ready = new Promise((resolve, reject) => {
		ws.onopen = () => ws.send(JSON.stringify({ msg: 'connect', version: '1', support: ['1'] }));
		ws.onerror = (e) => reject(e?.message || 'ws error');
		ws.onmessage = (e) => {
			const m = JSON.parse(e.data);
			if (m.msg === 'connected') resolve();
			else if (m.msg === 'ping') ws.send(JSON.stringify({ msg: 'pong', id: m.id }));
			else if (m.msg === 'result' && pending.has(m.id)) {
				const { resolve, reject } = pending.get(m.id);
				pending.delete(m.id);
				m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
			}
		};
	});
	const call = (method, ...params) =>
		new Promise((resolve, reject) => {
			const id = String(nextId++);
			pending.set(id, { resolve, reject });
			ws.send(JSON.stringify({ msg: 'method', method, params, id }));
			setTimeout(() => pending.has(id) && reject(new Error(`timeout: ${method}`)), 60000);
		});
	return { ready, call, close: () => ws.close() };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
	const ct = await getCredentialToken();
	const c = ddp();
	await c.ready;
	const session = await c.call('login', { omnisai: true, credentialToken: ct });
	console.log('1) authenticated as', session.id);

	const b64 = fs.readFileSync(ZIP).toString('base64');
	await c.call('uploadImportFile', b64, 'application/zip', 'slack-export.zip', 'slack');
	console.log('2) uploaded slack-export.zip (', b64.length, 'b64 chars )');

	let selection;
	for (let i = 0; i < 40; i++) {
		const data = await c.call('getImportFileData');
		if (data && !data.waiting) { selection = data; break; }
		await sleep(500);
	}
	console.log('3) prepared selection:',
		'users=', selection?.users?.length, 'channels=', selection?.channels?.length,
		'messages=', selection?.message_count ?? selection?.messages);

	await c.call('startImport', { input: { users: { all: true }, channels: { all: true } } });
	console.log('4) startImport dispatched');

	let last = '';
	for (let i = 0; i < 60; i++) {
		const p = await c.call('getImportProgress').catch(() => null);
		const step = p?.step || 'n/a';
		if (step !== last) { console.log('   progress:', step, p?.count ? `(${p.count.completed}/${p.count.total})` : ''); last = step; }
		if (step === 'done' || step === 'error' || step === 'cancelled') break;
		await sleep(1000);
	}
	console.log('5) import finished:', last);
	c.close();
})().catch((e) => { console.log('ERROR:', e?.message || e); process.exit(1); });
