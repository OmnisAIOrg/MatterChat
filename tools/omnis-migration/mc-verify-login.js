// Headless end-to-end verification of the "Sign in with OmnisAI" keystone:
//   1. drive the server OIDC chain to mint a real one-time credentialToken
//   2. call the Meteor DDP `login` method with { omnisai, credentialToken } — runs our login handler
//   3. assert it returns a session ({ id: userId, token }) == the user was created/linked + logged in
const BASE = 'http://localhost:3100';

async function getCredentialToken() {
	const r1 = await fetch(`${BASE}/_omnisai/authorize`, { redirect: 'manual' });
	const l1 = r1.headers.get('location'); // -> mock authorize
	const r2 = await fetch(l1, { redirect: 'manual' });
	const l2 = r2.headers.get('location'); // -> /_omnisai/callback?code&state
	const r3 = await fetch(l2, { redirect: 'manual' });
	const l3 = r3.headers.get('location'); // -> /omnisai/<credentialToken>
	if (!l3 || !l3.includes('/omnisai/')) throw new Error(`unexpected final redirect: ${l3}`);
	return l3.split('/omnisai/')[1];
}

function ddpLogin(credentialToken) {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket('ws://localhost:3100/websocket');
		const timer = setTimeout(() => { reject(new Error('DDP timeout')); ws.close(); }, 20000);
		ws.onopen = () => ws.send(JSON.stringify({ msg: 'connect', version: '1', support: ['1'] }));
		ws.onmessage = (e) => {
			const m = JSON.parse(e.data);
			if (m.msg === 'connected') {
				ws.send(JSON.stringify({ msg: 'method', method: 'login', params: [{ omnisai: true, credentialToken }], id: '1' }));
			} else if (m.msg === 'ping') {
				ws.send(JSON.stringify({ msg: 'pong', id: m.id }));
			} else if (m.msg === 'result' && m.id === '1') {
				clearTimeout(timer);
				resolve(m);
				ws.close();
			}
		};
		ws.onerror = (err) => { clearTimeout(timer); reject(err?.message || err || 'ws error'); };
	});
}

(async () => {
	const ct = await getCredentialToken();
	console.log('1) minted credentialToken:', ct);
	const res = await ddpLogin(ct);
	if (res.error) {
		console.log('2) LOGIN FAILED:', JSON.stringify(res.error));
		process.exit(1);
	}
	console.log('2) DDP login result:', JSON.stringify(res.result));
	console.log(res.result?.id && res.result?.token ? '3) PASS: session issued (user logged in)' : '3) FAIL: no session');
})().catch((e) => { console.log('ERROR:', e?.message || e); process.exit(1); });
