/**
 * Desktop OAuth hand-off — shared helper for the `matterchat://` custom-protocol return path.
 *
 * WHY: Microsoft (Entra) and Google block OAuth in embedded webviews (Google
 * `disallowed_useragent`; Microsoft embedded-webview policy). The MatterChat desktop app is an
 * Electron `BrowserWindow` (an embedded webview), so the connector OAuth flows AND OmnisAI SSO must
 * run in the user's SYSTEM browser and return to the running desktop app via the `matterchat://`
 * custom scheme. See MATTERCHAT-DESKTOP-PWA-SPEC.md §A.4 + §A.5.
 *
 * This module is the ONE place that knows how to:
 *   1. detect the desktop flag on the inbound `/authorize` request (a `client=desktop` query param),
 *   2. carry that flag TAMPER-PROOF — it is stored INSIDE the server-side parked OAuth state doc
 *      (CredentialTokens), NEVER echoed as a raw query param the user could forge, and read back at
 *      callback time,
 *   3. finish a desktop callback with a `302` to `matterchat://oauth/<provider>?status=...` (status
 *      only — NO token ever transits the custom-scheme URL) plus a tiny "Return to MatterChat" HTML
 *      interstitial as a fallback for OSes that don't auto-hand-off the scheme.
 *
 * ADDITIVE + BROWSER-COMPATIBLE: when the desktop flag is absent (every web/PWA flow), each caller
 * keeps its existing HTTPS landing behaviour byte-for-byte. The only branch this module introduces is
 * taken exclusively when `client=desktop` was present at authorize time.
 *
 * Clean-room: built from the public OAuth dance already in this repo (omnisai-oauth + the connector
 * provider routes). Nothing under apps/meteor/ee/ was read.
 */

/** The custom protocol the desktop shell registers as its default protocol client (spec §A.4). */
export const DESKTOP_SCHEME = 'matterchat';

/**
 * Read the desktop flag off an inbound `/authorize` request URL.
 *
 * The flag arrives as a plain query param `client=desktop` (the only thing the desktop shell can set
 * when it does `shell.openExternal(.../_omnisai/authorize?client=desktop)`). It is NOT trusted past
 * this point: the caller immediately folds the boolean into the server-side parked state doc, so the
 * value that actually drives the callback branch is tamper-proof (the user never sees or signs it).
 *
 * @param reqUrl the raw request URL (may be a full URL or just `/authorize?...`)
 */
export function isDesktopAuthorizeRequest(reqUrl: string | undefined): boolean {
	if (!reqUrl) {
		return false;
	}
	try {
		const url = new URL(reqUrl, 'http://localhost');
		return url.searchParams.get('client') === 'desktop';
	} catch {
		return false;
	}
}

/** Normalize the boolean read out of the parked state doc (stored as a real boolean; be defensive). */
export function isDesktopState(value: unknown): boolean {
	return value === true || value === 'true' || value === 'desktop';
}

/**
 * Build the `matterchat://oauth/<provider>?status=...` deep-link the desktop callback redirects to.
 * STATUS ONLY — never a token. On error we attach a short, URL-safe `reason` for the desktop toast.
 */
export function buildDesktopOAuthDeepLink(provider: string, status: 'ok' | 'error', reason?: string): string {
	const safeProvider = encodeURIComponent(provider);
	const params = new URLSearchParams({ status });
	if (status === 'error' && reason) {
		params.set('reason', reason);
	}
	return `${DESKTOP_SCHEME}://oauth/${safeProvider}?${params.toString()}`;
}

/**
 * Build the `matterchat://login?token=<credentialToken>` deep-link for desktop OmnisAI SSO (spec
 * §A.5). The credentialToken is RC's standard one-time, short-lived OAuth credential token — it is
 * single-use and redeemed immediately by the desktop shell loading `/omnisai/<token>` inside the app
 * window — so it is safe to carry on the scheme back into our OWN app (unlike a long-lived token).
 */
export function buildDesktopLoginDeepLink(credentialToken: string): string {
	const params = new URLSearchParams({ token: credentialToken });
	return `${DESKTOP_SCHEME}://login?${params.toString()}`;
}

/**
 * A minimal, self-contained HTML interstitial served as the desktop callback body. The `Location`
 * header drives the auto-hand-off; this page is the FALLBACK for OSes/browsers that don't auto-open
 * the custom scheme (it offers a manual "Return to MatterChat" link to the same deep-link, plus a
 * tiny script that re-attempts the hand-off). No secrets are rendered — only the status deep-link.
 */
function interstitialHtml(deepLink: string, title: string, message: string): string {
	// The deep-link is server-built from a fixed scheme + provider/status (no user-controlled HTML),
	// but escape it for href/JS context anyway as defence-in-depth.
	const esc = (s: string): string =>
		s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
	const safeLink = esc(deepLink);
	const jsLink = JSON.stringify(deepLink);
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<style>
  html,body{height:100%;margin:0}
  body{display:flex;align-items:center;justify-content:center;background:#0b1220;color:#e8edf5;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
  .card{max-width:420px;padding:32px;text-align:center}
  h1{font-size:18px;margin:0 0 8px}
  p{font-size:14px;line-height:1.5;color:#b6c2d4;margin:0 0 20px}
  a.btn{display:inline-block;padding:10px 18px;border-radius:8px;background:#2f6df6;color:#fff;
    text-decoration:none;font-size:14px;font-weight:600}
</style>
</head>
<body>
  <div class="card">
    <h1>${esc(title)}</h1>
    <p>${esc(message)}</p>
    <a class="btn" href="${safeLink}">Return to MatterChat</a>
  </div>
  <script>
    // Auto-attempt the hand-off in case the 302 Location didn't trigger the OS protocol handler.
    try { window.location.href = ${jsLink}; } catch (e) {}
  </script>
</body>
</html>`;
}

/**
 * Finish a DESKTOP OAuth callback: 302 to the `matterchat://` deep-link (so the OS hands control back
 * to the running app) AND serve the interstitial as a fallback body. Mirrors the existing
 * `res.writeHead(302, ...); res.end()` shape used across the OAuth routes, but with an HTML body and
 * a Content-Type so the fallback renders when the scheme isn't auto-handled.
 *
 * @param res          the node response
 * @param provider     'teams' | 'slack' | 'google' (the path segment in the deep-link)
 * @param status       'ok' | 'error'
 * @param reason       short reason code on error (surfaced in the desktop toast)
 * @param extraHeaders e.g. the state-cookie-clear Set-Cookie the web flow also emits
 */
export function finishDesktopConnectorCallback(
	res: any,
	provider: string,
	status: 'ok' | 'error',
	reason: string | undefined,
	extraHeaders: Record<string, string> = {},
): void {
	const deepLink = buildDesktopOAuthDeepLink(provider, status, reason);
	const body =
		status === 'ok'
			? interstitialHtml(deepLink, 'Connected', 'You can return to the MatterChat app — your workspace is connecting.')
			: interstitialHtml(deepLink, 'Could not connect', 'Something went wrong. Return to MatterChat and try again.');
	res.writeHead(302, {
		'Location': deepLink,
		'Content-Type': 'text/html; charset=utf-8',
		...extraHeaders,
	});
	res.end(body);
}

/**
 * Finish a DESKTOP OmnisAI SSO callback: 302 to `matterchat://login?token=<credentialToken>` plus the
 * interstitial fallback (spec §A.5). Token is the one-time RC credential token, redeemed immediately.
 */
export function finishDesktopLoginCallback(
	res: any,
	credentialToken: string,
	extraHeaders: Record<string, string> = {},
): void {
	const deepLink = buildDesktopLoginDeepLink(credentialToken);
	const body = interstitialHtml(deepLink, 'Signed in', 'Return to the MatterChat app to finish signing in.');
	res.writeHead(302, {
		'Location': deepLink,
		'Content-Type': 'text/html; charset=utf-8',
		...extraHeaders,
	});
	res.end(body);
}

/**
 * Finish a DESKTOP OmnisAI SSO callback that FAILED before a credentialToken could be minted: 302 to
 * `matterchat://login?status=error&reason=...` (no token). Lets the desktop shell show the error
 * instead of dead-ending on an HTTPS page the app window never sees.
 */
export function finishDesktopLoginError(res: any, reason: string, extraHeaders: Record<string, string> = {}): void {
	const params = new URLSearchParams({ status: 'error', reason });
	const deepLink = `${DESKTOP_SCHEME}://login?${params.toString()}`;
	const body = interstitialHtml(deepLink, 'Could not sign in', 'Something went wrong. Return to MatterChat and try again.');
	res.writeHead(302, {
		'Location': deepLink,
		'Content-Type': 'text/html; charset=utf-8',
		...extraHeaders,
	});
	res.end(body);
}
