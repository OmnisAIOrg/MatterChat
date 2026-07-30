/**
 * MATTERCHAT: high-end email theme (mc-email-theme-v1).
 *
 * Pure constants + helpers — NO side effects (safe to import from settings files and the startup
 * applier alike). The stock Rocket.Chat email chrome (generic blue buttons, system fonts, flat white)
 * is replaced with the MatterChat site look: deep-forest → emerald gradient header, the ensō mark,
 * "Matter"/"Chat" wordmark, a rounded white card, and an emerald gradient CTA.
 *
 * The mailer assembles each email as  Email_Header + {{body}} + Email_Footer  and then inlines
 * `email_style` with juice (see app/mailer/server/api.ts). So the header/footer open+close a
 * table-based card, `email_style` carries the classes, and each per-template body just supplies the
 * heading / copy / button that drops into the card's content cell.
 *
 * Variables available to templates come from the mailer's replace(): [Site_URL], [Site_Url_Slash],
 * [Site_Name], plus per-email data ([name], [email], [Verification_Url], [Forgot_Password_Url]).
 */

export const THEME_VERSION = 'mc-email-theme-v1';

export const EMAIL_STYLE = `/* ${THEME_VERSION} */
body, .body { margin:0; padding:0; width:100%; background:#eef2ef; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif; color:#3a4a42; -webkit-font-smoothing:antialiased; }
a { color:#0e7a4a; text-decoration:none; font-weight:600; }
p { margin:0 0 16px 0; font-size:15px; line-height:1.7; color:#3a4a42; }
.container { max-width:600px; margin:0 auto; }
.card { background:#ffffff; border-radius:16px; overflow:hidden; border:1px solid #e4eae6; box-shadow:0 10px 34px rgba(11,26,20,.08); }
.brandbar { background:#0b3f28; background:linear-gradient(135deg,#0f6b3a 0%,#0b3f28 55%,#08160f 100%); padding:34px 40px 30px 40px; text-align:center; }
.enso { display:block; margin:0 auto 12px auto; border:0; }
.wordmark { font-size:23px; font-weight:700; letter-spacing:.2px; }
.content { padding:38px 40px 6px 40px; }
h1 { margin:0 0 14px 0; font-size:26px; line-height:1.25; font-weight:700; color:#0b1a14; letter-spacing:-.2px; }
h2 { margin:0 0 14px 0; font-size:22px; line-height:1.3; font-weight:700; color:#0b1a14; }
.lead { font-size:16px; line-height:1.7; color:#37473f; margin:0 0 16px 0; }
.btnwrap { padding:8px 0 26px 0; }
.btn { display:inline-block; background:#0e9c68; background:linear-gradient(180deg,#17c98d 0%,#0e9c68 100%); color:#ffffff !important; font-size:15px; font-weight:600; text-decoration:none; padding:15px 34px; border-radius:12px; box-shadow:0 8px 18px rgba(14,124,74,.30); }
.advice { color:#8a978f; font-size:12.5px; line-height:1.6; margin:2px 0 4px 0; }
.footer { padding:22px 40px 36px 40px; text-align:center; }
.footer a { color:#0e7a4a; font-weight:600; font-size:13px; }
.muted { color:#9aa7a0; font-size:12px; line-height:1.7; margin:8px 0 0 0; }
`;

export const EMAIL_HEADER =
	'<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">' +
	'<html xmlns="http://www.w3.org/1999/xhtml"><head>' +
	`<!--${THEME_VERSION}-->` +
	'<meta name="viewport" content="width=device-width" /><meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />' +
	'<title>MatterChat</title></head>' +
	'<body bgcolor="#eef2ef" style="background:#eef2ef;">' +
	'<table class="body" bgcolor="#eef2ef" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2ef;"><tr><td>' +
	'<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:28px 12px 12px 12px;">' +
	'<table class="container" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;"><tr><td class="card">' +
	'<table width="100%" cellpadding="0" cellspacing="0"><tr><td class="brandbar" align="center" bgcolor="#0b3f28">' +
	'<img class="enso" src="[Site_Url_Slash]images/logo/matterchat-enso-green-1024.png" width="46" height="46" alt="MatterChat" />' +
	'<span class="wordmark"><span style="color:#eafff4;">Matter</span><span style="color:#4fe3c0;">Chat</span></span>' +
	'</td></tr></table>' +
	'<table width="100%" cellpadding="0" cellspacing="0"><tr><td class="content">';

export const EMAIL_FOOTER =
	'</td></tr></table>' + // close content table
	'</td></tr></table>' + // close card + container
	'<table class="container" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;"><tr><td class="footer" align="center">' +
	'<a href="[Site_URL]">matterchat.com</a>' +
	'<p class="muted">© OmnisAI · MatterChat</p>' +
	'</td></tr></table>' +
	'</td></tr></table>' + // close centering table
	'</td></tr></table>' + // close body table
	'</body></html>';

const btn = (href: string, label: string, target = ' target="_blank"') =>
	`<table cellpadding="0" cellspacing="0" class="btnwrap"><tr><td><a class="btn" href="${href}"${target}>${label}</a></td></tr></table>`;

const sentinel = `<!--${THEME_VERSION}-->`;

/** Branded body for the self-signup welcome email (also the default for the MatterChat_Welcome_Email setting). */
export const WELCOME_BODY =
	`${sentinel}<h1>Welcome to MatterChat</h1>` +
	`<p class="lead">Hi [name], your account is ready — you're all set to jump in.</p>` +
	`<p>MatterChat is your team's secure home for messaging, boards, and Chi, your built-in AI assistant. Sign in any time to pick up right where your team left off.</p>` +
	btn('[Site_URL]', 'Open MatterChat') +
	`<p class="advice">If you didn't create this account, you can safely ignore this email.</p>`;

/** Themed bodies for the stock account emails, keyed by setting id. */
export const THEMED_BODIES: Record<string, string> = {
	MatterChat_Welcome_Email: WELCOME_BODY,
	Verification_Email:
		`${sentinel}<h1>Confirm your email</h1>` +
		`<p class="lead">Hi [name], welcome to MatterChat.</p>` +
		`<p>Please confirm this is your email address so we can secure your account and keep you in the loop.</p>` +
		btn('[Verification_Url]', 'Verify email address') +
		`<p class="advice">If you didn't create a MatterChat account, you can ignore this email.</p>`,
	Forgot_Password_Email:
		`${sentinel}<h1>Reset your password</h1>` +
		`<p class="lead">Hi [name], we got a request to reset your MatterChat password.</p>` +
		`<p>Click below to choose a new one. For your security, this link will expire soon.</p>` +
		btn('[Forgot_Password_Url]', 'Reset password', '') +
		`<p class="advice">If you didn't ask to reset your password, you can safely ignore this email — your password won't change.</p>`,
	Accounts_Enrollment_Email:
		`${sentinel}<h1>Welcome to MatterChat</h1>` +
		`<p class="lead">Hi [name], an account has been created for you on [Site_Name].</p>` +
		`<p>MatterChat is your team's secure home for messaging, boards, and Chi, your built-in AI assistant. Sign in to get started.</p>` +
		btn('[Site_URL]', 'Sign in to MatterChat'),
	Accounts_UserAddedEmail_Email:
		`${sentinel}<h1>Welcome to MatterChat</h1>` +
		`<p class="lead">Hi [name], an account has been created for you on [Site_Name].</p>` +
		`<p>Sign in with your email ([email]) to get started. MatterChat is your team's secure home for messaging, boards, and Chi, your built-in AI assistant.</p>` +
		btn('[Site_URL]', 'Sign in to MatterChat'),
	Invitation_Email:
		`${sentinel}<h1>You're invited to MatterChat</h1>` +
		`<p class="lead">You've been invited to join [Site_Name] on MatterChat.</p>` +
		`<p>MatterChat is a secure home for your team's messaging, boards, and Chi, your built-in AI assistant.</p>` +
		btn('[Site_URL]', 'Join MatterChat', ''),
};

/**
 * Signatures that mark a setting value as "still the stock/interim default", i.e. safe to overwrite.
 * If a value matches none of these (and isn't a prior theme), an admin has customised it — we skip.
 */
export const REPLACEABLE_SIGNATURES: Record<string, string[]> = {
	MatterChat_Welcome_Email: ['your MatterChat account is ready to go'],
	Verification_Email: ['{Verification_email_body}'],
	Forgot_Password_Email: ['{Lets_get_you_new_one'],
	Accounts_Enrollment_Email: ['open source chat solution'],
	Accounts_UserAddedEmail_Email: ['open source chat solution'],
	Invitation_Email: ['open source chat solution'],
};

/**
 * Decide whether a stored setting value should be replaced with the current theme's value.
 * - empty            → yes (nothing to preserve)
 * - current theme    → no  (already applied; idempotent)
 * - older mc theme   → yes (upgrade)
 * - a stock/interim signature → yes (still recognisably a default)
 * - otherwise        → no  (admin has customised it — respect their edit)
 */
export const shouldApplyTheme = (current: string | undefined, signatures: string[]): boolean => {
	if (!current || current.trim() === '') {
		return true;
	}
	if (current.includes(THEME_VERSION)) {
		return false;
	}
	if (current.includes('mc-email-theme-')) {
		return true;
	}
	return signatures.some((sig) => current.includes(sig));
};
