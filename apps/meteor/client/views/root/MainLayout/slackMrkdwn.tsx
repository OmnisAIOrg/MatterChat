import type { CSSProperties, ReactNode } from 'react';

/**
 * slackMrkdwn — a PURE Slack-mrkdwn → React renderer for the external Slack view.
 *
 * Slack messages arrive as raw mrkdwn (`<url|label>`, `<@U123>`, `*bold*`, `&amp;`-escaped text…).
 * This module parses that into real React nodes — NO dangerouslySetInnerHTML anywhere, so message
 * content can never inject markup: everything user-controlled is emitted as text children.
 *
 * It is deliberately a NO-OP for plain text (Teams / Google Chat messages pass straight through
 * unchanged), and it NEVER throws: any unexpected/malformed input degrades to the literal text
 * (there is a belt-and-braces try/catch on the entry point on top of the defensive tokenizers).
 *
 * Supported (the practical Slack subset):
 *  - `<url>` / `<url|label>` and `mailto:` → clickable <a> (new tab, noopener, brand-green underline)
 *  - bare http(s) URLs in plain text → autolinked (trailing punctuation stays text)
 *  - `<@U123>` / `<@U123|label>` → bold `@DisplayName` from the passed mentions map, else label, else id
 *  - `<#C123|name>` / `<#C123>` → `#name`
 *  - `<!here>` / `<!channel>` / `<!everyone>` → bold `@here`…; other `<!…|fallback>` → fallback text
 *  - `*bold*`, `_italic_`, `~strike~` (nesting inside a span works), `` `code` ``, ``` fenced blocks ```
 *  - `&amp;` / `&lt;` / `&gt;` unescaped in text, labels, and code
 *  - newlines preserved (text leaves keep their `\n`; the caller renders inside `white-space: pre-wrap`)
 *
 * Ordering is load-bearing: fenced code first, then inline code (their contents are literal), then
 * angle tokens (BEFORE formatting/autolink, so `_` inside a `<https://…/some_path>` never italicizes),
 * then per plain fragment: entity unescape → bare-URL autolink → *_~ formatting.
 *
 * Styling is plain inline-style objects (not css-in-js classes) on native elements — a pure module
 * with zero runtime deps, trivially testable, and immune to the String(cssFn) class-resolution trap.
 */

export type ParseSlackMrkdwnOptions = {
	/** Slack user id → display name, used to resolve `<@U123>` mentions. */
	mentions?: Record<string, string>;
};

// MatterChat brand green (same token as AppLeftRail / ExternalBridgeControls).
const BRAND_GREEN = '#1B7A2E';

const linkStyle: CSSProperties = {
	color: BRAND_GREEN,
	textDecoration: 'underline',
	wordBreak: 'break-word',
};

const mentionStyle: CSSProperties = {
	fontWeight: 600,
	background: 'rgba(27, 122, 46, 0.12)',
	borderRadius: '3px',
	padding: '0 2px',
};

const channelStyle: CSSProperties = {
	fontWeight: 600,
	color: BRAND_GREEN,
};

const MONO = "'Menlo', 'Monaco', 'Consolas', monospace";

const inlineCodeStyle: CSSProperties = {
	fontFamily: MONO,
	fontSize: '0.85em',
	background: 'var(--rcx-color-surface-neutral, #f2f3f5)',
	border: '1px solid var(--rcx-color-stroke-extra-light, #e4e7ea)',
	borderRadius: '3px',
	padding: '1px 4px',
	color: 'var(--rcx-color-status-font-on-danger, #c14444)',
	wordBreak: 'break-word',
};

const codeBlockStyle: CSSProperties = {
	fontFamily: MONO,
	fontSize: '12px',
	background: 'var(--rcx-color-surface-neutral, #f2f3f5)',
	border: '1px solid var(--rcx-color-stroke-extra-light, #e4e7ea)',
	borderRadius: '4px',
	padding: '6px 8px',
	margin: '4px 0',
	whiteSpace: 'pre-wrap',
	overflowX: 'auto',
};

type Ctx = {
	mentions: Record<string, string>;
	nextKey: () => string;
};

/** Slack HTML-escapes & < > in message text; undo it for display. `&amp;` LAST so `&amp;lt;` → `&lt;`. */
const unescapeEntities = (text: string): string => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** Split `abc|def` once at the first `|`; label is undefined when there is no pipe. */
const splitOnce = (text: string): [string, string | undefined] => {
	const at = text.indexOf('|');
	return at === -1 ? [text, undefined] : [text.slice(0, at), text.slice(at + 1)];
};

/** Pull trailing sentence punctuation off an autolinked bare URL so `see https://a.com.` links cleanly. */
const splitTrailingPunctuation = (url: string): [string, string] => {
	const m = url.match(/[.,;:!?)\]}'"]+$/);
	return m ? [url.slice(0, url.length - m[0].length), m[0]] : [url, ''];
};

const renderLink = (href: string, label: string, ctx: Ctx): ReactNode => (
	<a key={ctx.nextKey()} href={href} target='_blank' rel='noopener noreferrer' style={linkStyle}>
		{label}
	</a>
);

const FORMATS: Array<{ re: RegExp; tag: 'strong' | 'em' | 'del' }> = [
	{ re: /\*([^*\n]+)\*/, tag: 'strong' },
	{ re: /_([^_\n]+)_/, tag: 'em' },
	{ re: /~([^~\n]+)~/, tag: 'del' },
];

/** `*bold*` / `_italic_` / `~strike~` over already-unescaped plain text; recurses so `*_both_*` nests. */
const parseFormatting = (text: string, ctx: Ctx): ReactNode[] => {
	const out: ReactNode[] = [];
	let rest = text;
	// Each pass consumes at least one character, so this terminates on any input.
	while (rest.length > 0) {
		let best: { index: number; length: number; inner: string; tag: 'strong' | 'em' | 'del' } | null = null;
		for (const { re, tag } of FORMATS) {
			const m = rest.match(re);
			if (m && typeof m.index === 'number' && (best === null || m.index < best.index)) {
				best = { index: m.index, length: m[0].length, inner: m[1], tag };
			}
		}
		if (!best) {
			out.push(rest);
			break;
		}
		if (best.index > 0) {
			out.push(rest.slice(0, best.index));
		}
		const Tag = best.tag;
		out.push(<Tag key={ctx.nextKey()}>{parseFormatting(best.inner, ctx)}</Tag>);
		rest = rest.slice(best.index + best.length);
	}
	return out;
};

/** Plain (non-token) fragment: unescape entities, autolink bare http(s) URLs, then *_~ formatting. */
const parsePlainFragment = (fragment: string, ctx: Ctx): ReactNode[] => {
	const out: ReactNode[] = [];
	const parts = unescapeEntities(fragment).split(/(https?:\/\/[^\s<>]+)/g);
	parts.forEach((part, i) => {
		if (i % 2 === 1) {
			const [href, trailing] = splitTrailingPunctuation(part);
			if (href) {
				out.push(renderLink(href, href, ctx));
			}
			if (trailing) {
				out.push(trailing);
			}
			return;
		}
		if (part) {
			out.push(...parseFormatting(part, ctx));
		}
	});
	return out;
};

/** One `<…>` token (inner = contents without the brackets). Unrecognized tokens fall back to literal text. */
const renderAngleToken = (inner: string, ctx: Ctx): ReactNode => {
	if (inner.startsWith('@')) {
		const [id, label] = splitOnce(inner.slice(1));
		const display = ctx.mentions[id] ?? label ?? id;
		return (
			<strong key={ctx.nextKey()} style={mentionStyle}>
				@{unescapeEntities(display)}
			</strong>
		);
	}
	if (inner.startsWith('#')) {
		const [id, label] = splitOnce(inner.slice(1));
		return (
			<strong key={ctx.nextKey()} style={channelStyle}>
				#{unescapeEntities(label ?? id)}
			</strong>
		);
	}
	if (inner.startsWith('!')) {
		const [name, label] = splitOnce(inner.slice(1));
		if (name === 'here' || name === 'channel' || name === 'everyone') {
			return (
				<strong key={ctx.nextKey()} style={mentionStyle}>
					@{name}
				</strong>
			);
		}
		// e.g. `<!date^1699999999^{date}|Nov 14 2023>` — show the human fallback, else the literal.
		return label !== undefined ? unescapeEntities(label) : `<${inner}>`;
	}
	const [target, label] = splitOnce(inner);
	if (/^https?:\/\//i.test(target)) {
		const href = unescapeEntities(target);
		return renderLink(href, label ? unescapeEntities(label) : href, ctx);
	}
	if (/^mailto:/i.test(target)) {
		const href = unescapeEntities(target);
		return renderLink(href, label ? unescapeEntities(label) : href.slice('mailto:'.length), ctx);
	}
	// Not a token we understand — emit it literally so nothing is ever silently dropped.
	return `<${inner}>`;
};

/** Non-code segment: split out `<…>` tokens FIRST (so URLs' `_`/`*` never trigger formatting), then plain. */
const parseTokensAndText = (segment: string, ctx: Ctx): ReactNode[] => {
	const out: ReactNode[] = [];
	const parts = segment.split(/(<[^<>\n]*>)/g);
	parts.forEach((part, i) => {
		if (i % 2 === 1) {
			out.push(renderAngleToken(part.slice(1, -1), ctx));
			return;
		}
		if (part) {
			out.push(...parsePlainFragment(part, ctx));
		}
	});
	return out;
};

/**
 * Parse Slack mrkdwn into React nodes. Pure, deterministic, never throws; plain text passes through
 * as a single string leaf (the no-op path Teams/Google messages take). Render the result inside a
 * container with `white-space: pre-wrap` so the preserved `\n`s show as line breaks.
 */
export const parseSlackMrkdwn = (text: unknown, options?: ParseSlackMrkdwnOptions): ReactNode[] => {
	if (typeof text !== 'string') {
		// Defensive: a provider sending null/undefined/number must never crash the view.
		return text === null || text === undefined ? [] : [String(text)];
	}
	if (text === '') {
		return [];
	}
	try {
		let key = 0;
		const ctx: Ctx = {
			mentions: options?.mentions && typeof options.mentions === 'object' ? options.mentions : {},
			nextKey: () => `mrkdwn-${key++}`,
		};
		const out: ReactNode[] = [];
		// Fenced code blocks first — their contents are literal (only entity-unescaped).
		const blocks = text.split(/(```[\s\S]*?```)/);
		blocks.forEach((block, i) => {
			if (i % 2 === 1) {
				const content = block.slice(3, -3).replace(/^\n/, '').replace(/\n$/, '');
				out.push(
					<pre key={ctx.nextKey()} style={codeBlockStyle}>
						<code style={{ fontFamily: 'inherit' }}>{unescapeEntities(content)}</code>
					</pre>,
				);
				return;
			}
			if (!block) {
				return;
			}
			// Inline code next — also literal inside.
			const codeParts = block.split(/(`[^`\n]+`)/g);
			codeParts.forEach((part, j) => {
				if (j % 2 === 1) {
					out.push(
						<code key={ctx.nextKey()} style={inlineCodeStyle}>
							{unescapeEntities(part.slice(1, -1))}
						</code>,
					);
					return;
				}
				if (part) {
					out.push(...parseTokensAndText(part, ctx));
				}
			});
		});
		return out;
	} catch {
		// Belt-and-braces: NEVER let a renderer bug take down the message list — show the raw text.
		return [text];
	}
};
