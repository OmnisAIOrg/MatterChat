import { useLoginWithPassword, useSetting, useSession } from '@rocket.chat/ui-contexts';
import type { LoginRoutes } from '@rocket.chat/web-ui-registration';
import RegistrationRoute from '@rocket.chat/web-ui-registration';
import type { FormEvent, ReactElement, ReactNode } from 'react';
import { useState } from 'react';

/**
 * MATTERCHAT: the redesigned sign-in experience (founder design, Login.dc.html port).
 *
 * Left "brand chamber": deep-green radial stage with aurora blooms, the breathing ensō
 * over concentric + slow-rotating dashed rings with a floor reflection, the lockup, the
 * Newsreader tagline and the AES-256 / SOC 2 / Bar-verified trust bar. Right: the cream
 * sign-in card with real auth.
 *
 * REAL WIRING (this is not a mockup):
 *   • email/password → useLoginWithPassword (same hook the stock LoginForm uses)
 *   • "Sign in with Omnis ID" → plain in-window /_omnisai/authorize (302s to sso.omnisai.io);
 *     stays IN the desktop app window (wrapper whitelists OmnisAI SSO hosts) — no browser bounce,
 *     no matterchat:// deep-link. Gated on the OmnisAI_OIDC_Enabled setting.
 *   • On the desktop app (window.matterchatDesktop) the page goes full-bleed so the native window
 *     chrome is the only frame (the decorative green frame otherwise clashes with the traffic lights).
 *   • "Forgot password?" / "Create an account" → falls back to the STOCK RegistrationRoute
 *     at 'reset-password' / 'register' (full stock flows preserved)
 *   • success → the green Ensō Loader bridges into the workspace
 *
 * Fonts are SELF-HOSTED at /fonts/brand (the app CSP blocks Google Fonts). Assets reuse
 * the shipped brand set: /images/pwa/icon-192.png, /images/logo/matterchat-wordmark-white.png,
 * /enso/enso-assets/omnis-enso-bristle.svg.
 */

const STYLE_ID = 'mclg-style';

const injectStyles = (): void => {
	if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
	const style = document.createElement('style');
	style.id = STYLE_ID;
	style.textContent = `
@font-face { font-family: 'Space Grotesk'; font-weight: 600; font-display: swap; src: url('/fonts/brand/space-grotesk-600.woff2') format('woff2'); }
@font-face { font-family: 'Space Grotesk'; font-weight: 700; font-display: swap; src: url('/fonts/brand/space-grotesk-700.woff2') format('woff2'); }
@font-face { font-family: 'Newsreader'; font-weight: 400; font-display: swap; src: url('/fonts/brand/newsreader-400.woff2') format('woff2'); }
@font-face { font-family: 'Newsreader'; font-weight: 400; font-style: italic; font-display: swap; src: url('/fonts/brand/newsreader-400-italic.woff2') format('woff2'); }
@font-face { font-family: 'JetBrains Mono'; font-weight: 400; font-display: swap; src: url('/fonts/brand/jetbrains-mono-400.woff2') format('woff2'); }
@font-face { font-family: 'JetBrains Mono'; font-weight: 500; font-display: swap; src: url('/fonts/brand/jetbrains-mono-500.woff2') format('woff2'); }
@font-face { font-family: 'Inter Tight'; font-weight: 400; font-display: swap; src: url('/fonts/brand/inter-tight-400.woff2') format('woff2'); }
@font-face { font-family: 'Inter Tight'; font-weight: 500; font-display: swap; src: url('/fonts/brand/inter-tight-500.woff2') format('woff2'); }
@font-face { font-family: 'Inter Tight'; font-weight: 600; font-display: swap; src: url('/fonts/brand/inter-tight-600.woff2') format('woff2'); }
@font-face { font-family: 'Inter Tight'; font-weight: 700; font-display: swap; src: url('/fonts/brand/inter-tight-700.woff2') format('woff2'); }

@keyframes mclgAurora { 0% { transform: translate(-6%, -4%) scale(1); } 50% { transform: translate(8%, 6%) scale(1.16); } 100% { transform: translate(-6%, -4%) scale(1); } }
@keyframes mclgSpinSlow { to { transform: rotate(360deg); } }
@keyframes mclgFadeUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
@keyframes mclgSpin { to { transform: rotate(360deg); } }
@keyframes mclgBreath { 0%,100% { transform: scale(1); filter: drop-shadow(0 0 20px rgba(52,230,168,.28)) drop-shadow(0 0 3px rgba(255,255,255,.4)); } 50% { transform: scale(1.035); filter: drop-shadow(0 0 34px rgba(52,230,168,.5)) drop-shadow(0 0 6px rgba(255,255,255,.6)); } }
@keyframes mclgSheen { 0% { transform: translateX(-120%) skewX(-18deg); } 60%,100% { transform: translateX(320%) skewX(-18deg); } }

.mclg-root { font-family: 'Inter Tight', system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
.mclg-root a { color: #0E7A4A; text-decoration: none; transition: color .15s; }
.mclg-root a:hover { color: #0c5f3a; }
.mclg-root input::placeholder { color: #a7b6af; }
.mclg-field { transition: border-color .18s, box-shadow .18s, background .18s; }
.mclg-field:focus { outline: none; border-color: #12b981 !important; box-shadow: 0 0 0 4px rgba(18,185,129,.14), inset 0 1px 2px rgba(11,26,20,.05) !important; background: #fff !important; }
.mclg-primary:hover { filter: brightness(1.05); }
.mclg-primary:active { transform: translateY(1px); }
.mclg-primary:hover .mclg-sheen { animation: mclgSheen 1.1s ease; }
.mclg-eye:hover { background: #f0f2ee; color: #4a5a52; }
.mclg-omnis:hover { border-color: #12b981 !important; background: #f4faf7 !important; box-shadow: 0 6px 16px -10px rgba(13,143,95,.55); }
/* RC ships an adopted-stylesheet rule that paints imgs at transform:scale(2.5) (invisible to
   document.styleSheets — cost a real debugging session). Pin sizes AND null the transform. */
.mclg-lockup-icon, .mclg-lockup-word, .mclg-omnis-icon { transform: none !important; }
.mclg-enso-reflect { transform: scaleY(-1) !important; }
.mclg-lockup-icon { width: 52px !important; height: 52px !important; }
.mclg-lockup-word { height: 52px !important; width: auto !important; max-width: 260px !important; object-fit: contain; }
.mclg-omnis-icon { width: 20px !important; height: 20px !important; }
.mclg-enso-img { width: 182px !important; height: 148px !important; }

/* DESKTOP (Electron): the wrapper uses a frameless hiddenInset title bar and expects the web
   content to provide the draggable region + host the macOS traffic lights. This full-screen
   login has no NavBar, so WITHOUT this the window can't be moved and the lights float loose.
   Make the left brand chamber + a top strip draggable; keep every interactive control no-drag.
   In a normal browser -webkit-app-region is a harmless no-op. */
.mclg-dragbar { position: absolute; top: 0; left: 0; right: 0; height: 46px; -webkit-app-region: drag; z-index: 55; }
/* Desktop app: KEEP the green frame (founder wants it to match web). The macOS traffic lights are
   repositioned by the wrapper (v0.1.4) to sit inside the frame on the dark brand chamber, so no
   full-bleed override is needed here. */
.mclg-left { -webkit-app-region: drag; }
.mclg-card, .mclg-card *, .mclg-field, .mclg-primary, .mclg-omnis, .mclg-eye, .mclg-root a, .mclg-root button, .mclg-root input { -webkit-app-region: no-drag; }

@media (max-width: 960px) {
	.mclg-frame { padding: 0 !important; }
	.mclg-shell { border-radius: 0 !important; grid-template-columns: 1fr !important; }
	.mclg-left { display: none !important; }
	.mclg-right { padding: 28px 18px !important; }
}
@media (prefers-reduced-motion: reduce) {
	.mclg-root * { animation: none !important; }
}
`;
	document.head.appendChild(style);
};

const TRUST = [
	{ k: 'AES-256', v: 'End-to-end encrypted' },
	{ k: 'SOC 2 Type II', v: 'Independently audited' },
	{ k: 'Bar-verified', v: 'Identity assurance' },
] as const;

const mapLoginError = (error: unknown): string => {
	const e = error as { error?: string; reason?: string; message?: string } | undefined;
	const code = e?.error ?? '';
	if (code === 403 || code === '403' || /invalid|Unauthorized|credentials/i.test(`${code} ${e?.reason ?? ''}`)) {
		return 'Invalid email or password.';
	}
	return e?.reason || e?.message || 'Sign-in failed — please try again.';
};

const MatterChatLoginPage = ({ defaultRoute, children }: { defaultRoute?: LoginRoutes; children?: ReactNode }): ReactElement => {
	injectStyles();

	// Flows that are NOT the plain login form (reset, register, invite/secret, CMS…) fall
	// back to the stock web-ui-registration router — full stock behavior preserved.
	const sessionRoute = useSession('loginDefaultState') as LoginRoutes | undefined;
	const initialStock = (): LoginRoutes | null => {
		const r = sessionRoute ?? defaultRoute;
		return r && r !== 'login' ? r : null;
	};
	const [stockRoute, setStockRoute] = useState<LoginRoutes | null>(initialStock);

	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [showPw, setShowPw] = useState(false);
	const [remember, setRemember] = useState(true);
	const [loading, setLoading] = useState(false);
	const [done, setDone] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const login = useLoginWithPassword();
	const omnisaiEnabled = useSetting('OmnisAI_OIDC_Enabled', false);
	const omnisaiLabel = useSetting('OmnisAI_OIDC_Button_Label', 'Sign in with Omnis ID') as string;
	const registrationForm = useSetting('Accounts_RegistrationForm', 'Public') as string;
	// MATTERCHAT: when CentralAuth is configured it OWNS identity — it becomes the
	// primary (and visually only) way in, and self-registration is hidden, because a
	// MatterChat-local account would be a second identity for the same person.
	// The workspace-password form stays reachable behind a link rather than being
	// removed: an admin must never be locked out of their own workspace if the IdP
	// is misconfigured or unreachable.
	const [showPasswordForm, setShowPasswordForm] = useState(false);
	const centralAuthPrimary = omnisaiEnabled === true;
	// Password fields are visible unless CentralAuth is leading and the user has
	// not explicitly asked for the fallback.
	const passwordFormVisible = !centralAuthPrimary || showPasswordForm;
	const resetEnabled = useSetting('Accounts_PasswordReset', true);

	if (stockRoute) {
		return <RegistrationRoute defaultRoute={stockRoute}>{children}</RegistrationRoute>;
	}

	// ALWAYS the plain in-window OAuth flow — navigate to /_omnisai/authorize, which 302s to
	// sso.omnisai.io/auth/login. On web this is the normal flow; in the desktop app it now stays
	// IN the app window (the wrapper whitelists OmnisAI's first-party SSO hosts) and completes on
	// the same-origin /_omnisai/callback — no system-browser bounce, no matterchat:// deep-link
	// (which needed a signed app). We deliberately do NOT call Meteor.loginWithOmnisai() here: that
	// triggers the old ?client=desktop external-browser flow that never returned to an unsigned app.
	const handleOmnisai = (): void => {
		window.location.href = '_omnisai/authorize';
	};

	const submit = async (e: FormEvent): Promise<void> => {
		e.preventDefault();
		if (loading || done) return;
		setError(null);
		if (!email.trim() || !password) {
			setError('Enter your email and password.');
			return;
		}
		setLoading(true);
		try {
			await login(email.trim(), password);
			// Success — the app transitions to the workspace on its own; the ensō bridges it.
			setDone(true);
			const loader = (window as unknown as { EnsoLoader?: { play: (o: unknown) => void; done: () => void } }).EnsoLoader;
			if (loader) {
				loader.play({ scrim: true, hold: true, size: 170 });
				setTimeout(() => loader.done(), 1400);
			}
		} catch (err) {
			setLoading(false);
			setError(mapLoginError(err));
		}
	};

	const emailValid = /\S+@\S+|\S{3,}/.test(email);

	return (
		<div
			className={`mclg-root${typeof window !== 'undefined' && (window as unknown as { matterchatDesktop?: unknown }).matterchatDesktop ? ' mclg-desktop' : ''}`}
			style={{ position: 'absolute', inset: 0, zIndex: 1, overflow: 'auto', background: '#041109' }}
		>
			<div
				className='mclg-frame'
				style={{
					minHeight: '100%',
					padding: 16,
					background: 'linear-gradient(140deg,#37a457 0%,#1f8a4c 46%,#0f6b3a 100%)',
					display: 'flex',
				}}
			>
				<div
					className='mclg-shell'
					style={{
						flex: 1,
						display: 'grid',
						gridTemplateColumns: '1.08fr 1fr',
						position: 'relative',
						background: '#041109',
						borderRadius: 26,
						overflow: 'hidden',
						boxShadow: '0 40px 90px -34px rgba(0,0,0,.65), inset 0 0 0 1px rgba(255,255,255,.04)',
					}}
				>
					{/* grain overlay */}
					<div
						style={{
							position: 'absolute',
							inset: 0,
							zIndex: 50,
							pointerEvents: 'none',
							opacity: 0.05,
							mixBlendMode: 'overlay',
							backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.82' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
						}}
					/>

					{/* Desktop window-drag strip (hosts the macOS traffic lights; lets the frameless
					    window be moved). No-op in a browser. */}
					<div className='mclg-dragbar' />


					{/* ============ LEFT — BRAND CHAMBER ============ */}
					<div
						className='mclg-left'
						style={{
							position: 'relative',
							overflow: 'hidden',
							background: 'radial-gradient(135% 115% at 14% -5%, #12402C 0%, #0A2417 34%, #06170F 62%, #030c07 100%)',
							display: 'flex',
							flexDirection: 'column',
							justifyContent: 'space-between',
							padding: '36px 54px 34px',
							color: '#fff',
						}}
					>
						<div
							style={{
								position: 'absolute',
								left: 0,
								right: 0,
								bottom: 0,
								height: '34%',
								pointerEvents: 'none',
								background: 'linear-gradient(180deg, transparent, rgba(2,8,5,.55))',
							}}
						/>
						{/* aurora blooms */}
						<div
							style={{
								position: 'absolute',
								width: 660,
								height: 660,
								left: -180,
								top: -160,
								background: 'radial-gradient(circle, rgba(18,185,129,.24), transparent 62%)',
								filter: 'blur(24px)',
								animation: 'mclgAurora 18s ease-in-out infinite',
								pointerEvents: 'none',
							}}
						/>
						<div
							style={{
								position: 'absolute',
								width: 520,
								height: 520,
								right: -200,
								bottom: -180,
								background: 'radial-gradient(circle, rgba(52,230,168,.13), transparent 64%)',
								filter: 'blur(20px)',
								animation: 'mclgAurora 22s ease-in-out infinite reverse',
								pointerEvents: 'none',
							}}
						/>
						<div
							style={{
								position: 'absolute',
								top: 0,
								right: -1,
								width: 40,
								height: '100%',
								pointerEvents: 'none',
								background: 'linear-gradient(90deg, transparent, rgba(3,12,7,.16))',
							}}
						/>

						{/* lockup */}
						<div style={{ position: 'relative', zIndex: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
							<img
								className='mclg-lockup-icon'
								src='/images/pwa/icon-192.png'
								alt='MatterChat'
								style={{
									width: 52,
									height: 52,
									borderRadius: 14,
									display: 'block',
									boxShadow: '0 8px 22px -8px rgba(0,0,0,.6), inset 0 0 0 1px rgba(255,255,255,.08)',
								}}
							/>
							<img className='mclg-lockup-word' src='/images/logo/matterchat-wordmark-white.png' alt='MatterChat' style={{ height: 52, width: 'auto', display: 'block' }} />
						</div>

						{/* ensō stage */}
						<div
							style={{
								position: 'relative',
								zIndex: 2,
								display: 'flex',
								flexDirection: 'column',
								alignItems: 'center',
								textAlign: 'center',
								margin: '6px 0',
							}}
						>
							<div style={{ position: 'relative', width: 252, height: 252, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
								<div
									style={{
										position: 'absolute',
										width: 290,
										height: 290,
										borderRadius: '50%',
										background: 'radial-gradient(circle, rgba(52,230,168,.16) 0%, rgba(18,185,129,.06) 40%, transparent 68%)',
									}}
								/>
								<div style={{ position: 'absolute', width: 244, height: 244, borderRadius: '50%', border: '1px solid rgba(255,255,255,.05)' }} />
								<div style={{ position: 'absolute', width: 200, height: 200, borderRadius: '50%', border: '1px solid rgba(255,255,255,.04)' }} />
								<div
									style={{
										position: 'absolute',
										width: 274,
										height: 274,
										borderRadius: '50%',
										border: '1px dashed rgba(79,227,192,.22)',
										animation: 'mclgSpinSlow 60s linear infinite',
									}}
								/>
								<img
									className='mclg-enso-img'
									src='/enso/enso-assets/omnis-enso-bristle.svg'
									alt=''
									style={{ position: 'relative', width: 182, height: 148, objectFit: 'contain', animation: 'mclgBreath 5.5s ease-in-out infinite' }}
								/>
								<img
									className='mclg-enso-img mclg-enso-reflect'
									src='/enso/enso-assets/omnis-enso-bristle.svg'
									alt=''
									style={{
										position: 'absolute',
										bottom: -4,
										width: 182,
										height: 148,
										objectFit: 'contain',
										transform: 'scaleY(-1)',
										opacity: 0.1,
										WebkitMaskImage: 'linear-gradient(to bottom, rgba(0,0,0,.7), transparent 62%)',
										maskImage: 'linear-gradient(to bottom, rgba(0,0,0,.7), transparent 62%)',
										pointerEvents: 'none',
									}}
								/>
							</div>
							<div
								style={{
									fontFamily: "'JetBrains Mono',monospace",
									fontSize: 10.5,
									letterSpacing: '.28em',
									textTransform: 'uppercase',
									color: '#5fbf95',
									margin: '14px 0 14px',
								}}
							>
								Omnis AI · Secure Communications for Legal
							</div>
							<h2
								style={{
									fontFamily: "'Newsreader',serif",
									fontWeight: 400,
									fontSize: 29,
									lineHeight: 1.24,
									letterSpacing: '-.01em',
									margin: 0,
									maxWidth: 380,
									textWrap: 'balance' as never,
									color: '#f4fff9',
								}}
							>
								Where privileged conversations <span style={{ fontStyle: 'italic', color: '#4fe3c0' }}>stay</span> privileged.
							</h2>
						</div>

						{/* trust bar */}
						<div
							style={{
								position: 'relative',
								zIndex: 3,
								display: 'flex',
								alignItems: 'stretch',
								border: '1px solid rgba(255,255,255,.08)',
								borderRadius: 14,
								background: 'rgba(255,255,255,.025)',
								backdropFilter: 'blur(8px)',
								overflow: 'hidden',
							}}
						>
							{TRUST.map((t) => (
								<div key={t.k} style={{ flex: 1, padding: '15px 18px', borderRight: '1px solid rgba(255,255,255,.07)' }}>
									<div style={{ fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: 15.5, color: '#eafff6', letterSpacing: '-.01em' }}>{t.k}</div>
									<div style={{ fontSize: 10.5, letterSpacing: '.05em', textTransform: 'uppercase', color: '#6f8d7e', marginTop: 4 }}>{t.v}</div>
								</div>
							))}
						</div>
					</div>

					{/* ============ RIGHT — SIGN IN ============ */}
					<div
						className='mclg-right'
						style={{
							position: 'relative',
							background: 'radial-gradient(120% 80% at 80% -10%, #FFFDF9 0%, #F6F1E8 55%, #F1EBDF 100%)',
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							padding: '44px 40px',
							overflowY: 'auto',
						}}
					>
						<div className='mclg-card' style={{ position: 'relative', zIndex: 2, width: '100%', maxWidth: 420, animation: 'mclgFadeUp .6s cubic-bezier(.2,.7,.3,1) both' }}>
							<form
								onSubmit={submit}
								style={{
									position: 'relative',
									background: 'linear-gradient(180deg,#ffffff, #fdfcf9)',
									border: '1px solid #ece6da',
									borderRadius: 22,
									padding: '32px 34px 28px',
									boxShadow: '0 1px 0 rgba(255,255,255,.9) inset, 0 30px 60px -28px rgba(20,50,35,.28), 0 8px 20px -12px rgba(20,50,35,.16)',
								}}
							>
								<div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 16 }}>
									<span
										style={{
											display: 'inline-flex',
											alignItems: 'center',
											justifyContent: 'center',
											width: 26,
											height: 26,
											borderRadius: 8,
											background: '#E8F7EF',
											color: '#0E7A4A',
										}}
									>
										<svg width='14' height='14' viewBox='0 0 24 24' fill='none'>
											<rect x='4' y='10' width='16' height='11' rx='2.5' stroke='currentColor' strokeWidth='1.8' />
											<path d='M8 10V7a4 4 0 0 1 8 0v3' stroke='currentColor' strokeWidth='1.8' />
										</svg>
									</span>
									<span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, letterSpacing: '.18em', textTransform: 'uppercase', color: '#0E7A4A' }}>
										Secure sign-in
									</span>
								</div>

								<h1 style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: 29, letterSpacing: '-.022em', margin: '0 0 22px', color: '#0b1a14' }}>
									Welcome back
								</h1>

								{passwordFormVisible && (
								<>
								<label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#33423b', marginBottom: 7, letterSpacing: '.01em' }}>
									Email or username
								</label>
								<div style={{ position: 'relative', marginBottom: 17 }}>
									<span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#a7b6af', display: 'flex' }}>
										<svg width='17' height='17' viewBox='0 0 24 24' fill='none'>
											<rect x='3' y='5' width='18' height='14' rx='2.5' stroke='currentColor' strokeWidth='1.7' />
											<path d='m4 7 8 6 8-6' stroke='currentColor' strokeWidth='1.7' strokeLinecap='round' />
										</svg>
									</span>
									<input
										className='mclg-field'
										type='text'
										value={email}
										onChange={(e) => setEmail(e.currentTarget.value)}
										placeholder='you@firm.com'
										autoComplete='username'
										style={{
											width: '100%',
											fontSize: 15,
											fontFamily: 'inherit',
											color: '#0b1a14',
											background: '#fbfcfb',
											border: `1.5px solid ${email && !emailValid ? '#e0725a' : '#e3ebe5'}`,
											borderRadius: 13,
											padding: '14px 14px 14px 42px',
											boxShadow: 'inset 0 1px 2px rgba(11,26,20,.04)',
										}}
									/>
								</div>

								<div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 7 }}>
									<label style={{ fontSize: 12.5, fontWeight: 600, color: '#33423b', letterSpacing: '.01em' }}>Password</label>
									{resetEnabled && (
										<a
											href='#forgot'
											onClick={(e) => {
												e.preventDefault();
												setStockRoute('reset-password');
											}}
											style={{ fontSize: 12, fontWeight: 600 }}
										>
											Forgot password?
										</a>
									)}
								</div>
								<div style={{ position: 'relative', marginBottom: 18 }}>
									<span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#a7b6af', display: 'flex' }}>
										<svg width='17' height='17' viewBox='0 0 24 24' fill='none'>
											<rect x='4' y='10' width='16' height='11' rx='2.5' stroke='currentColor' strokeWidth='1.7' />
											<path d='M8 10V7a4 4 0 0 1 8 0v3' stroke='currentColor' strokeWidth='1.7' strokeLinecap='round' />
										</svg>
									</span>
									<input
										className='mclg-field'
										type={showPw ? 'text' : 'password'}
										value={password}
										onChange={(e) => setPassword(e.currentTarget.value)}
										placeholder='Enter your password'
										autoComplete='current-password'
										style={{
											width: '100%',
											fontSize: 15,
											fontFamily: 'inherit',
											color: '#0b1a14',
											background: '#fbfcfb',
											border: '1.5px solid #e3ebe5',
											borderRadius: 13,
											padding: '14px 44px 14px 42px',
											boxShadow: 'inset 0 1px 2px rgba(11,26,20,.04)',
										}}
									/>
									<button
										type='button'
										aria-label='Toggle password'
										onClick={() => setShowPw((s) => !s)}
										className='mclg-eye'
										style={{
											position: 'absolute',
											right: 8,
											top: '50%',
											transform: 'translateY(-50%)',
											width: 32,
											height: 32,
											border: 'none',
											background: 'transparent',
											color: '#8496a0',
											cursor: 'pointer',
											display: 'flex',
											alignItems: 'center',
											justifyContent: 'center',
											borderRadius: 8,
											transition: 'background .15s',
										}}
									>
										{showPw ? (
											<svg width='18' height='18' viewBox='0 0 24 24' fill='none'>
												<path
													d='M3 3l18 18M10.6 10.7a2 2 0 0 0 2.8 2.8M9.4 5.2A9.3 9.3 0 0 1 12 5c5 0 9 5 9 7a12 12 0 0 1-2.2 2.9M6.2 6.6C3.9 8 2 10.6 2 12c0 1.3 3.2 5.4 7.5 6.6'
													stroke='currentColor'
													strokeWidth='1.7'
													strokeLinecap='round'
												/>
											</svg>
										) : (
											<svg width='18' height='18' viewBox='0 0 24 24' fill='none'>
												<path d='M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z' stroke='currentColor' strokeWidth='1.7' />
												<circle cx='12' cy='12' r='3' stroke='currentColor' strokeWidth='1.7' />
											</svg>
										)}
									</button>
								</div>

								<div style={{ display: 'flex', alignItems: 'center', marginBottom: 18 }}>
									<button
										type='button'
										onClick={() => setRemember((r) => !r)}
										style={{ display: 'flex', alignItems: 'center', gap: 9, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit' }}
									>
										<span
											style={{
												width: 19,
												height: 19,
												borderRadius: 6,
												border: `1.5px solid ${remember ? '#12b981' : '#c6d2cb'}`,
												background: remember ? '#12b981' : '#fff',
												display: 'flex',
												alignItems: 'center',
												justifyContent: 'center',
												transition: 'all .15s',
											}}
										>
											{remember && (
												<svg width='12' height='12' viewBox='0 0 24 24' fill='none'>
													<path d='M4 12.5 9.5 18 20 6.5' stroke='#fff' strokeWidth='2.6' strokeLinecap='round' strokeLinejoin='round' />
												</svg>
											)}
										</span>
										<span style={{ fontSize: 13.5, color: '#4a5a52' }}>Keep me signed in</span>
									</button>
								</div>

								{error && (
									<div
										role='alert'
										style={{
											background: '#fdf1ee',
											border: '1px solid #f0c8bd',
											color: '#b3402a',
											borderRadius: 11,
											padding: '10px 13px',
											fontSize: 13,
											marginBottom: 14,
										}}
									>
										{error}
									</div>
								)}

								<button
									type='submit'
									className='mclg-primary'
									style={{
										position: 'relative',
										overflow: 'hidden',
										width: '100%',
										border: 'none',
										cursor: 'pointer',
										fontFamily: "'Space Grotesk',sans-serif",
										fontSize: 15.5,
										fontWeight: 600,
										color: '#fff',
										background: 'linear-gradient(135deg,#0d8f5f 0%,#12b981 60%,#17c98a 100%)',
										padding: 15,
										borderRadius: 13,
										boxShadow: '0 10px 26px -10px rgba(13,143,95,.7), inset 0 1px 0 rgba(255,255,255,.25)',
										display: 'flex',
										alignItems: 'center',
										justifyContent: 'center',
										gap: 10,
										transition: 'filter .15s, transform .05s',
									}}
								>
									<span
										className='mclg-sheen'
										style={{
											position: 'absolute',
											top: 0,
											left: 0,
											width: '40%',
											height: '100%',
											background: 'linear-gradient(90deg, transparent, rgba(255,255,255,.4), transparent)',
											transform: 'translateX(-120%) skewX(-18deg)',
											pointerEvents: 'none',
										}}
									/>
									<span>{done ? 'Signed in' : loading ? 'Signing in' : 'Sign in'}</span>
									{loading ? (
										<span
											style={{
												width: 16,
												height: 16,
												border: '2px solid rgba(255,255,255,.4)',
												borderTopColor: '#fff',
												borderRadius: '50%',
												animation: 'mclgSpin .7s linear infinite',
												display: 'inline-block',
											}}
										/>
									) : (
										!done && (
											<svg width='17' height='17' viewBox='0 0 24 24' fill='none'>
												<path d='M5 12h14m-6-6 6 6-6 6' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' />
											</svg>
										)
									)}
								</button>
								</>
								)}

								{omnisaiEnabled && (
									<>
										{passwordFormVisible && (
										<div style={{ display: 'flex', alignItems: 'center', gap: 14, margin: '18px 0' }}>
											<span style={{ flex: 1, height: 1, background: 'linear-gradient(90deg, transparent, #e3e8e2)' }} />
											<span style={{ fontSize: 11.5, color: '#93a29b' }}>or</span>
											<span style={{ flex: 1, height: 1, background: 'linear-gradient(90deg, #e3e8e2, transparent)' }} />
										</div>
										)}
										<button
											type='button'
											onClick={handleOmnisai}
											className='mclg-omnis'
											style={{
												width: '100%',
												display: 'flex',
												alignItems: 'center',
												justifyContent: 'center',
												gap: 11,
												fontSize: 14.5,
												fontWeight: 600,
												color: '#0b1a14',
												background: '#fff',
												border: '1.5px solid #d3e3da',
												borderRadius: 13,
												padding: 13,
												cursor: 'pointer',
												fontFamily: 'inherit',
												transition: 'border-color .15s, background .15s, box-shadow .15s',
											}}
										>
											<img className='mclg-omnis-icon' src='/images/pwa/icon-192.png' alt='' style={{ width: 20, height: 20, borderRadius: 6, display: 'block' }} />
											{omnisaiLabel}
										</button>
										{centralAuthPrimary && !showPasswordForm && (
											<button
												type='button'
												onClick={() => setShowPasswordForm(true)}
												style={{
													width: '100%',
													marginTop: 14,
													background: 'none',
													border: 'none',
													color: '#5b6b86',
													fontSize: 13,
													fontFamily: 'inherit',
													cursor: 'pointer',
													textDecoration: 'underline',
												}}
											>
												Use a workspace password instead
											</button>
										)}
									</>
								)}
							</form>

							{registrationForm === 'Public' && !centralAuthPrimary && (
								<p style={{ textAlign: 'center', fontSize: 14.5, color: '#5b6b86', margin: '18px 0 0' }}>
									New to the firm?{' '}
									<a
										href='#register'
										onClick={(e) => {
											e.preventDefault();
											setStockRoute('register');
										}}
										style={{ fontWeight: 600 }}
									>
										Create an account
									</a>
								</p>
							)}

							<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 20, color: '#9aa8a1' }}>
								<svg width='12' height='12' viewBox='0 0 24 24' fill='none'>
									<rect x='4' y='10' width='16' height='11' rx='2.5' stroke='currentColor' strokeWidth='1.8' />
									<path d='M8 10V7a4 4 0 0 1 8 0v3' stroke='currentColor' strokeWidth='1.8' />
								</svg>
								<span style={{ fontSize: 11.5 }}>Protected with end-to-end encryption</span>
							</div>
							<p style={{ textAlign: 'center', fontSize: 11.5, color: '#a3b0a9', lineHeight: 1.55, margin: '14px 0 0' }}>
								By continuing you agree to MatterChat&apos;s{' '}
								<a href='/terms-of-service' style={{ color: '#6f8d7e', textDecoration: 'underline' }}>
									Terms
								</a>{' '}
								&amp;{' '}
								<a href='/privacy-policy' style={{ color: '#6f8d7e', textDecoration: 'underline' }}>
									Privacy Policy
								</a>
								.
							</p>
							<div style={{ textAlign: 'right', fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: '#c2ccc5', letterSpacing: '.08em', marginTop: 16 }}>v2.4 · SOC 2 · us-east</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
};

export default MatterChatLoginPage;
