/*
 * MatterChat service worker.
 *
 * This file historically ("enc.js") exists ONLY to decrypt encrypted file
 * downloads on the fly (the `/file-decrypt/` fetch + `attachment-download`
 * message paths below). That behavior MUST keep working byte-for-byte — it is
 * unrelated to PWA/offline.
 *
 * MatterChat extends it with a thin PWA "app-shell" layer (cache + offline page
 * + Web Push) because RC only allows ONE service worker at scope '/', so we layer
 * onto the existing one rather than registering a competing SW (see
 * docs/MATTERCHAT-DESKTOP-PWA-SPEC.md B.2).
 *
 * Hard rules (to avoid white-screening the app — a bad SW is as bad as a crash):
 *   1. The `/file-decrypt/` fetch branch runs FIRST and is untouched.
 *   2. We NEVER cache or intercept API / DDP / websocket / sockjs traffic — chat
 *      must always be live. Those simply fall through to the network.
 *   3. Navigation requests are network-FIRST (fall back to cache, then a tiny
 *      offline page) so a stale cached shell can never trap users on an old build.
 *   4. We do NOT call skipWaiting() on install anymore: a new SW waits until the
 *      page tells it to (SKIP_WAITING message) so the in-app "New version — Reload"
 *      toast drives activation instead of yanking the page out from under the user.
 */

const SW_VERSION = 'mc-pwa-v1';
const SHELL_CACHE = `mc-shell-${SW_VERSION}`;
const MEDIA_CACHE = `mc-media-${SW_VERSION}`;
const MEDIA_MAX_ENTRIES = 60;

const OFFLINE_URL = '/images/offline.html';

// Things we precache so a cold/offline launch can at least paint the offline page
// and the brand icon. The hashed JS/CSS bundles are cached lazily on first hit
// (stale-while-revalidate) because their names change every deploy.
const PRECACHE_URLS = [OFFLINE_URL, '/images/manifest.json', '/images/pwa/icon-192.png'];

self.addEventListener('install', (event) => {
	// NOTE: intentionally NOT skipWaiting() — see header rule #4.
	event.waitUntil(
		caches.open(SHELL_CACHE).then((cache) =>
			// Best-effort precache; never let a missing asset block install.
			Promise.allSettled(PRECACHE_URLS.map((u) => cache.add(new Request(u, { cache: 'reload' })))),
		),
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			// Drop caches from previous SW versions.
			const keys = await caches.keys();
			await Promise.all(
				keys
					.filter((k) => k.startsWith('mc-shell-') || k.startsWith('mc-media-'))
					.filter((k) => k !== SHELL_CACHE && k !== MEDIA_CACHE)
					.map((k) => caches.delete(k)),
			);
			await self.clients.claim(); // keep file-decrypt available to all pages immediately
		})(),
	);
});

function base64Decode(string) {
	string = atob(string);
	const length = string.length,
		buf = new ArrayBuffer(length),
		bufView = new Uint8Array(buf);
	for (var i = 0; i < string.length; i++) {
		bufView[i] = string.charCodeAt(i);
	}
	return buf;
}

function base64DecodeString(string) {
	return atob(string);
}

const decrypt = async (key, iv, file) => {
	const ivArray = base64Decode(iv);
	const cryptoKey = await crypto.subtle.importKey('jwk', key, { name: 'AES-CTR' }, true, ['encrypt', 'decrypt']);
	const result = await crypto.subtle.decrypt({ name: 'AES-CTR', counter: ivArray, length: 64 }, cryptoKey, file);

	return result;
};

const getUrlParams = (url) => {
	const urlObj = new URL(url, location.origin);

	const rawKey = urlObj.searchParams.get('key');
	if (!rawKey) {
		throw new Error('Missing "key" query param');
	}

	const k = base64DecodeString(decodeURIComponent(rawKey));

	urlObj.searchParams.delete('key');

	const { key, iv, name, type } = JSON.parse(k);

	const newUrl = urlObj.href.replace('/file-decrypt/', '/');

	return { key, iv, url: newUrl, name, type };
};

// ---------------------------------------------------------------------------
// PWA app-shell helpers (additive). All of these are pure-network on failure.
// ---------------------------------------------------------------------------

// Requests we must never touch — keep chat live, never serve a stale answer.
function isLiveTraffic(url) {
	const p = url.pathname;
	return (
		p.startsWith('/api/') ||
		p.startsWith('/sockjs/') ||
		p.startsWith('/websocket') ||
		p.startsWith('/_oauth/') ||
		p.startsWith('/_omnisai/') ||
		p.startsWith('/_teams/') ||
		p.startsWith('/_slack/') ||
		p.startsWith('/_google/') ||
		p.startsWith('/file-upload/') ||
		p.startsWith('/file-decrypt/') ||
		p.startsWith('/data-export/')
	);
}

// Hashed Meteor bundles + fonts + manifest + our PWA icons: safe to SWR-cache.
function isShellAsset(url) {
	const p = url.pathname;
	return (
		/^\/[a-f0-9]{32,}\.(js|css)$/i.test(p) || // meteor content-hashed bundles
		p.endsWith('.js') ||
		p.endsWith('.css') ||
		p.startsWith('/fonts/') ||
		p.startsWith('/images/pwa/') ||
		p === '/images/manifest.json'
	);
}

// Avatars + uploaded media (already-decrypted public URLs): cache-first w/ LRU cap.
function isMedia(url) {
	const p = url.pathname;
	return p.startsWith('/avatar/') || p.startsWith('/cdn-cgi/');
}

async function trimCache(cacheName, maxEntries) {
	const cache = await caches.open(cacheName);
	const keys = await cache.keys();
	if (keys.length <= maxEntries) {
		return;
	}
	// FIFO eviction (oldest inserted first).
	await Promise.all(keys.slice(0, keys.length - maxEntries).map((req) => cache.delete(req)));
}

async function staleWhileRevalidate(request) {
	const cache = await caches.open(SHELL_CACHE);
	const cached = await cache.match(request);
	const network = fetch(request)
		.then((res) => {
			if (res && res.status === 200 && res.type === 'basic') {
				cache.put(request, res.clone()).catch(() => {});
			}
			return res;
		})
		.catch(() => undefined);
	return cached || network || fetch(request);
}

async function cacheFirstMedia(request) {
	const cache = await caches.open(MEDIA_CACHE);
	const cached = await cache.match(request);
	if (cached) {
		return cached;
	}
	const res = await fetch(request);
	if (res && res.status === 200) {
		cache.put(request, res.clone()).catch(() => {});
		trimCache(MEDIA_CACHE, MEDIA_MAX_ENTRIES).catch(() => {});
	}
	return res;
}

// Navigations: network-first so users always get the freshest build; fall back
// to the cached shell, then a minimal offline page. Never an infinite-stale trap.
async function handleNavigation(request) {
	try {
		const res = await fetch(request);
		return res;
	} catch (_e) {
		const cache = await caches.open(SHELL_CACHE);
		const cachedShell = await cache.match('/home');
		if (cachedShell) {
			return cachedShell;
		}
		const offline = await cache.match(OFFLINE_URL);
		if (offline) {
			return offline;
		}
		return new Response('<h1>MatterChat is offline</h1><p>Reconnecting…</p>', {
			headers: { 'Content-Type': 'text/html' },
			status: 503,
		});
	}
}

self.addEventListener('fetch', (event) => {
	const { request } = event;

	// === 1) ORIGINAL behavior: encrypted file downloads. UNTOUCHED. ===
	if (request.url.includes('/file-decrypt/')) {
		try {
			const { url, key, iv, name, type } = getUrlParams(request.url);

			const requestToFetch = new Request(url, {
				...request,
				mode: 'cors',
			});

			event.respondWith(
				caches.match(requestToFetch).then((response) => {
					if (response) {
						return response;
					}

					return fetch(requestToFetch)
						.then(async (res) => {
							const file = await res.arrayBuffer();

							if (res.status !== 200 || file.byteLength === 0) {
								console.error('Failed to fetch file', { req: requestToFetch, res });
								return res;
							}

							const result = await decrypt(key, iv, file);

							const newHeaders = new Headers(res.headers);
							newHeaders.set('Content-Disposition', 'inline; filename="' + name + '"');
							newHeaders.set('Content-Type', type);

							const response = new Response(result, {
								status: res.status,
								statusText: res.statusText,
								headers: newHeaders,
							});

							await caches.open('v1').then((cache) => {
								cache.put(requestToFetch, response.clone());
							});

							return response;
						})
						.catch((error) => {
							console.error('Fetching failed:', error);

							throw error;
						});
				}),
			);
		} catch (error) {
			console.error(error);
			throw error;
		}
		return;
	}

	// === 2) PWA app-shell layer (additive). Only GET, only same-origin. ===
	if (request.method !== 'GET') {
		return;
	}

	let url;
	try {
		url = new URL(request.url);
	} catch (_e) {
		return;
	}
	if (url.origin !== self.location.origin) {
		return; // never touch cross-origin (CentralizedAuth, FCM, etc.)
	}
	if (isLiveTraffic(url)) {
		return; // network only — let the browser handle it
	}

	if (request.mode === 'navigate') {
		event.respondWith(handleNavigation(request));
		return;
	}
	if (isShellAsset(url)) {
		event.respondWith(staleWhileRevalidate(request));
		return;
	}
	if (isMedia(url)) {
		event.respondWith(cacheFirstMedia(request));
		return;
	}
	// Everything else: default network behavior (do not respondWith).
});

self.addEventListener('message', async (event) => {
	// Update flow: page asks the waiting SW to take over (drives the reload toast).
	if (event.data && event.data.type === 'SKIP_WAITING') {
		self.skipWaiting();
		return;
	}

	// === ORIGINAL behavior: attachment-download. UNTOUCHED. ===
	if (event.data.type !== 'attachment-download') {
		return;
	}

	const requestToFetch = new Request(event.data.url);

	const { url, key, iv } = getUrlParams(event.data.url);
	const res = (await caches.match(requestToFetch)) ?? (await fetch(url));

	const file = await res.arrayBuffer();
	const result = await decrypt(key, iv, file);
	event.source.postMessage({
		id: event.data.id,
		type: 'attachment-download-result',
		result,
	});
});

// ---------------------------------------------------------------------------
// Web Push (B.4). The server signs payloads with VAPID and POSTs to the push
// subscription endpoint; the browser wakes this SW with a `push` event.
// ---------------------------------------------------------------------------
self.addEventListener('push', (event) => {
	let payload = {};
	try {
		payload = event.data ? event.data.json() : {};
	} catch (_e) {
		payload = { title: 'MatterChat', body: event.data ? event.data.text() : '' };
	}

	const title = payload.title || 'MatterChat';
	const options = {
		body: payload.body || payload.text || '',
		icon: payload.icon || '/images/pwa/icon-192.png',
		badge: payload.badge || '/images/pwa/icon-192.png',
		tag: payload.tag || payload.notId || undefined,
		renotify: Boolean(payload.tag || payload.notId),
		data: { url: payload.url || (payload.payload && payload.payload.path) || '/' },
	};

	event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const targetUrl = (event.notification.data && event.notification.data.url) || '/';

	event.waitUntil(
		self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
			// Focus an existing MatterChat tab if one is open; else open a new one.
			for (const client of clientList) {
				try {
					const u = new URL(client.url);
					if (u.origin === self.location.origin && 'focus' in client) {
						client.navigate(targetUrl).catch(() => {});
						return client.focus();
					}
				} catch (_e) {
					/* ignore */
				}
			}
			if (self.clients.openWindow) {
				return self.clients.openWindow(targetUrl);
			}
			return undefined;
		}),
	);
});
