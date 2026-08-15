/**
 * MATTERCHAT: pure helpers for firm email-domain auto-join.
 *
 * No Meteor / model / settings imports — everything here is decidable from its
 * arguments so it can be unit-tested directly
 * (tests/unit/server/lib/firms/firmDomainHelpers.spec.ts). The stateful service
 * (`firmDomains.ts`) imports this module, never the other way around.
 */

/**
 * Public mailbox providers that may never be claimed by a firm.
 *
 * Claiming `gmail.com` would silently capture every unrelated gmail signup on
 * the workspace into a stranger's firm — the single worst failure mode this
 * feature has. The list is exported so it is testable and so an operator
 * reading the code can see exactly what is refused.
 */
export const PUBLIC_EMAIL_PROVIDERS: readonly string[] = [
	'gmail.com',
	'googlemail.com',
	'outlook.com',
	'hotmail.com',
	'live.com',
	'msn.com',
	'yahoo.com',
	'ymail.com',
	'aol.com',
	'icloud.com',
	'me.com',
	'mac.com',
	'proton.me',
	'protonmail.com',
	'pm.me',
	'gmx.com',
	'mail.com',
	'zoho.com',
	'yandex.com',
	'qq.com',
	'163.com',
];

const PUBLIC_EMAIL_PROVIDER_SET = new Set(PUBLIC_EMAIL_PROVIDERS);

/** Max length of a DNS name, and of one label within it. */
const MAX_DOMAIN_LENGTH = 253;
const MAX_LABEL_LENGTH = 63;

/** A label may not start or end with a hyphen, and holds only a-z 0-9 -. */
const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
/** A real TLD is alphabetic, or punycode. Numeric TLDs mean somebody pasted an IP. */
const TLD_RE = /^(?:[a-z]{2,}|xn--[a-z0-9-]{2,})$/;
const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/**
 * Normalize whatever the user typed into a bare, lowercase, punycode domain —
 * or null when it is not a usable mail domain.
 *
 * Deliberately forgiving about the SHAPE of the input (an office manager will
 * paste `https://smithlaw.com/`, `@smithlaw.com` or their own email address)
 * and deliberately strict about the RESULT: a claim grants automatic firm
 * membership to everyone at the domain, so anything ambiguous is refused rather
 * than guessed at.
 *
 * Unicode domains are folded to punycode via the WHATWG URL parser, so
 * `Müller.de` and `xn--mller-kva.de` normalize to the same string and cannot be
 * claimed twice.
 */
export const normalizeDomain = (raw: unknown): string | null => {
	if (typeof raw !== 'string') {
		return null;
	}

	let candidate = raw.trim().toLowerCase();
	if (!candidate) {
		return null;
	}

	// `https://smithlaw.com/contact?x=1#y` → `smithlaw.com`
	candidate = candidate.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
	candidate = candidate.split(/[/?#]/)[0];
	// `jane@smithlaw.com` → `smithlaw.com` (last @ wins; the local part may not
	// contain one in anything we accept, but taking the last is the safe read).
	const at = candidate.lastIndexOf('@');
	if (at !== -1) {
		candidate = candidate.slice(at + 1);
	}
	// `smithlaw.com:443` → `smithlaw.com`
	candidate = candidate.replace(/:\d+$/, '');
	// Root-anchored FQDNs (`smithlaw.com.`) are the same domain.
	candidate = candidate.replace(/^\.+/, '').replace(/\.+$/, '');

	if (!candidate || /\s/.test(candidate)) {
		return null;
	}

	// The URL parser does IDNA/punycode folding and rejects a good deal of
	// nonsense outright. Everything it lets through is still checked below.
	let host: string;
	try {
		host = new URL(`http://${candidate}`).hostname;
	} catch {
		return null;
	}
	host = host.replace(/\.+$/, '');

	if (!host || host.length > MAX_DOMAIN_LENGTH) {
		return null;
	}
	// IPv6 literals arrive bracketed; IPv4 literals look like a domain but are not one.
	if (host.includes('[') || host.includes(']') || IPV4_RE.test(host)) {
		return null;
	}

	const labels = host.split('.');
	// A single label ("localhost", "firm") is never a claimable mail domain.
	if (labels.length < 2) {
		return null;
	}
	if (labels.some((label) => label.length === 0 || label.length > MAX_LABEL_LENGTH || !LABEL_RE.test(label))) {
		return null;
	}
	if (!TLD_RE.test(labels[labels.length - 1])) {
		return null;
	}

	return host;
};

/**
 * Pull the domain out of an email address, or null if it is not one address
 * with one domain. Stricter than `normalizeDomain`: a bare domain passed here
 * is rejected, because "this is the user's email" is the caller's claim and a
 * missing local part means we were handed the wrong thing.
 */
export const extractEmailDomain = (raw: unknown): string | null => {
	if (typeof raw !== 'string') {
		return null;
	}
	const email = raw.trim().toLowerCase();
	if (!email || /\s/.test(email)) {
		return null;
	}
	// Exactly one @: `a@@b.com` and `a@b@c.com` are malformed, not "the last one wins".
	const parts = email.split('@');
	if (parts.length !== 2) {
		return null;
	}
	const [local, domain] = parts;
	if (!local || !domain) {
		return null;
	}
	return normalizeDomain(domain);
};

/**
 * True when this domain belongs to a public mailbox provider and must not be
 * claimable.
 *
 * ## Subdomain policy: subdomains of a blocked provider are ALSO blocked.
 *
 * `mail.gmail.com` is under Google's control, not the claimant's — nobody can
 * prove ownership of it, and treating it as a distinct claimable name would be
 * a way to dress a public provider up as a private one. So the test is
 * "equals, or is a subdomain of, a blocked entry".
 *
 * The accepted cost: a firm whose real domain sits under one of these names
 * (e.g. `smithlaw.mail.com`) cannot use domain auto-join. They can still invite
 * by link, which is the fallback for every domain this refuses.
 *
 * Note this is one-directional — `gmail.com.evil.example` is NOT a subdomain of
 * `gmail.com` and is not blocked by this rule (it is a different registrable
 * domain, and blocking it would be theatre).
 */
export const isPublicEmailProvider = (domain: unknown): boolean => {
	const normalized = typeof domain === 'string' ? normalizeDomain(domain) : null;
	if (!normalized) {
		return false;
	}
	if (PUBLIC_EMAIL_PROVIDER_SET.has(normalized)) {
		return true;
	}
	return PUBLIC_EMAIL_PROVIDERS.some((provider) => normalized.endsWith(`.${provider}`));
};

export type DomainClaimCheck = { ok: true; domain: string } | { ok: false; reason: 'invalid' | 'public-provider' };

/** Normalize + blocklist in one call — the shape the service actually wants. */
export const checkClaimableDomain = (raw: unknown): DomainClaimCheck => {
	const domain = normalizeDomain(raw);
	if (!domain) {
		return { ok: false, reason: 'invalid' };
	}
	if (isPublicEmailProvider(domain)) {
		return { ok: false, reason: 'public-provider' };
	}
	return { ok: true, domain };
};

export type AddressLike = { address?: unknown; verified?: unknown };

/**
 * Pick the address we are willing to auto-join on.
 *
 * A verified address is always preferred. When the workspace does not verify
 * email at all (`Accounts_EmailVerification` off) every address would be
 * unverified and the feature could never fire, so in that mode the first
 * address is accepted — the workspace has already decided that an address on an
 * account is good enough to log in with. When verification IS on, an unverified
 * address proves nothing and is refused.
 */
export const pickAdoptableEmail = (emails: unknown, options: { requireVerified: boolean }): string | null => {
	if (!Array.isArray(emails)) {
		return null;
	}
	const addresses = emails.filter((entry): entry is AddressLike => Boolean(entry) && typeof entry === 'object');

	const verified = addresses.find((entry) => entry.verified === true && typeof entry.address === 'string' && entry.address.trim());
	if (verified) {
		return String(verified.address).trim().toLowerCase();
	}
	if (options.requireVerified) {
		return null;
	}
	const any = addresses.find((entry) => typeof entry.address === 'string' && entry.address.trim());
	return any ? String(any.address).trim().toLowerCase() : null;
};
