import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import { parseSlackMrkdwn } from './slackMrkdwn';

/**
 * parseSlackMrkdwn — the pure Slack-mrkdwn → React renderer behind the external Slack view.
 *
 * Covered here: every token type (links, autolinks, mentions, channels, specials, bold/italic/
 * strike, inline + fenced code, entity unescaping, newlines), the plain-text NO-OP path Teams/
 * Google messages ride, mixed messages, and the "malformed input never throws" guarantee.
 */

const renderNodes = (nodes: ReactNode[]) => render(<div data-testid='out'>{nodes}</div>);

// RTL binds queries to document.body, so multiple renders in one test would collide on the testid —
// read the text straight off THIS render's own container instead.
const textOf = (nodes: ReactNode[]): string => {
	const { container } = renderNodes(nodes);
	return container.textContent ?? '';
};

describe('parseSlackMrkdwn', () => {
	describe('plain text (the Teams/Google no-op path)', () => {
		it('passes plain text through as a single string leaf', () => {
			expect(parseSlackMrkdwn('hello world')).toEqual(['hello world']);
		});

		it('preserves newlines in text leaves', () => {
			expect(parseSlackMrkdwn('line one\nline two')).toEqual(['line one\nline two']);
		});

		it('returns [] for empty / null / undefined input', () => {
			expect(parseSlackMrkdwn('')).toEqual([]);
			expect(parseSlackMrkdwn(null)).toEqual([]);
			expect(parseSlackMrkdwn(undefined)).toEqual([]);
		});

		it('coerces non-string input instead of throwing', () => {
			expect(parseSlackMrkdwn(42)).toEqual(['42']);
		});
	});

	describe('links', () => {
		it('renders <url> as a safe new-tab anchor with the url as label', () => {
			renderNodes(parseSlackMrkdwn('see <https://example.com/a>'));
			const a = screen.getByRole('link', { name: 'https://example.com/a' });
			expect(a).toHaveAttribute('href', 'https://example.com/a');
			expect(a).toHaveAttribute('target', '_blank');
			expect(a).toHaveAttribute('rel', 'noopener noreferrer');
		});

		it('renders <url|label> with the label text', () => {
			renderNodes(parseSlackMrkdwn('<https://example.com|click here>'));
			const a = screen.getByRole('link', { name: 'click here' });
			expect(a).toHaveAttribute('href', 'https://example.com');
		});

		it('unescapes &amp; inside token urls', () => {
			renderNodes(parseSlackMrkdwn('<https://example.com/?a=1&amp;b=2|q>'));
			expect(screen.getByRole('link', { name: 'q' })).toHaveAttribute('href', 'https://example.com/?a=1&b=2');
		});

		it('renders mailto links with the address as fallback label', () => {
			renderNodes(parseSlackMrkdwn('<mailto:amy@firm.com>'));
			expect(screen.getByRole('link', { name: 'amy@firm.com' })).toHaveAttribute('href', 'mailto:amy@firm.com');
		});

		it('autolinks bare http(s) urls in plain text', () => {
			renderNodes(parseSlackMrkdwn('go to https://example.com/x now'));
			expect(screen.getByRole('link', { name: 'https://example.com/x' })).toHaveAttribute('href', 'https://example.com/x');
		});

		it('keeps trailing punctuation OUT of an autolinked url', () => {
			const nodes = parseSlackMrkdwn('see https://example.com/x.');
			renderNodes(nodes);
			expect(screen.getByRole('link', { name: 'https://example.com/x' })).toBeInTheDocument();
			expect(textOf(parseSlackMrkdwn('see https://example.com/x.'))).toBe('see https://example.com/x.');
		});

		it('does NOT italicize underscores inside a token url', () => {
			renderNodes(parseSlackMrkdwn('<https://example.com/some_long_path|doc>'));
			expect(screen.getByRole('link', { name: 'doc' })).toHaveAttribute('href', 'https://example.com/some_long_path');
			expect(document.querySelector('em')).toBeNull();
		});

		it('does NOT italicize underscores inside a bare url', () => {
			renderNodes(parseSlackMrkdwn('https://example.com/a_b_c'));
			expect(screen.getByRole('link', { name: 'https://example.com/a_b_c' })).toBeInTheDocument();
			expect(document.querySelector('em')).toBeNull();
		});
	});

	describe('mentions and channels', () => {
		it('resolves <@U123> through the mentions map, bold', () => {
			renderNodes(parseSlackMrkdwn('hi <@U123>', { mentions: { U123: 'Amy Chen' } }));
			const strong = document.querySelector('strong');
			expect(strong).not.toBeNull();
			expect(strong).toHaveTextContent('@Amy Chen');
		});

		it('falls back to the token label, then the raw id', () => {
			expect(textOf(parseSlackMrkdwn('<@U9|amy>'))).toBe('@amy');
			expect(textOf(parseSlackMrkdwn('<@U9>'))).toBe('@U9');
		});

		it('prefers the mentions map over the token label', () => {
			expect(textOf(parseSlackMrkdwn('<@U9|old>', { mentions: { U9: 'New Name' } }))).toBe('@New Name');
		});

		it('renders <#C123|general> as #general and <#C123> as #C123', () => {
			expect(textOf(parseSlackMrkdwn('<#C123|general>'))).toBe('#general');
			expect(textOf(parseSlackMrkdwn('<#C123>'))).toBe('#C123');
		});

		it('renders <!here> / <!channel> / <!everyone> as bold specials', () => {
			expect(textOf(parseSlackMrkdwn('<!here> ping'))).toBe('@here ping');
			expect(textOf(parseSlackMrkdwn('<!channel>'))).toBe('@channel');
			expect(textOf(parseSlackMrkdwn('<!everyone>'))).toBe('@everyone');
		});

		it('renders the human fallback of other <!…|fallback> tokens', () => {
			expect(textOf(parseSlackMrkdwn('<!date^1699999999^{date}|Nov 14 2023>'))).toBe('Nov 14 2023');
		});
	});

	describe('formatting', () => {
		it('renders *bold*, _italic_ and ~strike~', () => {
			renderNodes(parseSlackMrkdwn('*b* _i_ ~s~'));
			expect(document.querySelector('strong')).toHaveTextContent('b');
			expect(document.querySelector('em')).toHaveTextContent('i');
			expect(document.querySelector('del')).toHaveTextContent('s');
		});

		it('nests formatting (*_both_*)', () => {
			renderNodes(parseSlackMrkdwn('*_both_*'));
			const strong = document.querySelector('strong');
			expect(strong).not.toBeNull();
			expect(strong?.querySelector('em')).toHaveTextContent('both');
		});

		it('keeps surrounding text intact', () => {
			expect(textOf(parseSlackMrkdwn('say *hi* there'))).toBe('say hi there');
		});

		it('does not span formatting across newlines', () => {
			expect(parseSlackMrkdwn('a *b\nc* d')).toEqual(['a *b\nc* d']);
		});
	});

	describe('code', () => {
		it('renders `inline code` literally (mrkdwn inside is NOT parsed)', () => {
			renderNodes(parseSlackMrkdwn('run `*not bold* <@U1>` ok'));
			const code = document.querySelector('code');
			expect(code).toHaveTextContent('*not bold* <@U1>');
			expect(document.querySelector('strong')).toBeNull();
		});

		it('renders ```fenced blocks``` as <pre> with literal, unescaped content', () => {
			renderNodes(parseSlackMrkdwn('```\nif (a &lt; b) { go(); }\n```'));
			const pre = document.querySelector('pre');
			expect(pre).not.toBeNull();
			expect(pre?.textContent).toBe('if (a < b) { go(); }');
		});

		it('unescapes entities inside inline code', () => {
			renderNodes(parseSlackMrkdwn('`a &amp;&amp; b`'));
			expect(document.querySelector('code')?.textContent).toBe('a && b');
		});
	});

	describe('entities', () => {
		it('unescapes &amp; &lt; &gt; in plain text', () => {
			expect(parseSlackMrkdwn('Tom &amp; Jerry &lt;3 &gt;&gt;')).toEqual(['Tom & Jerry <3 >>']);
		});

		it('renders escaped markup as TEXT, never as elements (no injection)', () => {
			renderNodes(parseSlackMrkdwn('&lt;script&gt;alert(1)&lt;/script&gt;'));
			expect(document.querySelector('script')).toBeNull();
			expect(screen.getByTestId('out').textContent).toBe('<script>alert(1)</script>');
		});

		it('unescapes double-escaped &amp;lt; to the literal &lt;', () => {
			expect(parseSlackMrkdwn('&amp;lt;')).toEqual(['&lt;']);
		});
	});

	describe('mixed messages', () => {
		it('handles a realistic message combining every token type', () => {
			const text =
				'hey <@U1|amy>, *see* the _doc_ at <https://ex.com/a_b|the doc> in <#C9|general> — `x &amp; y` and ~old~ https://ex.com/z';
			renderNodes(parseSlackMrkdwn(text, { mentions: { U1: 'Amy' } }));
			expect(screen.getByRole('link', { name: 'the doc' })).toHaveAttribute('href', 'https://ex.com/a_b');
			expect(screen.getByRole('link', { name: 'https://ex.com/z' })).toBeInTheDocument();
			expect(screen.getByTestId('out').textContent).toContain('@Amy');
			expect(screen.getByTestId('out').textContent).toContain('#general');
			expect(document.querySelector('code')?.textContent).toBe('x & y');
			expect(document.querySelector('del')).toHaveTextContent('old');
			expect(document.querySelector('em')).toHaveTextContent('doc');
		});

		it('every element in the output arrays has a key (no React key warnings)', () => {
			const errors: unknown[] = [];
			const spy = jest.spyOn(console, 'error').mockImplementation((...args) => {
				errors.push(args);
			});
			try {
				renderNodes(parseSlackMrkdwn('<@U1> *b* `c` <https://a.com|x> ```y```'));
				expect(errors.filter((a) => String(a).includes('key'))).toHaveLength(0);
			} finally {
				spy.mockRestore();
			}
		});
	});

	describe('malformed input never throws', () => {
		const nasty = [
			'<',
			'>',
			'<>',
			'<@',
			'<@|',
			'<@U1',
			'<#',
			'<!',
			'<|>',
			'<https://',
			'***',
			'*',
			'* *a',
			'___',
			'~~~',
			'`',
			'``',
			'```',
			'```unclosed',
			'`unclosed',
			'<a<b>c>',
			'|||',
			'&amp',
			'&;',
			'<@U1|<@U2>>',
			'\n\n\n',
			'   ',
			'a'.repeat(10000),
			'*'.repeat(500),
			'<'.repeat(500),
		];

		it.each(nasty)('does not throw on %j', (input) => {
			expect(() => renderNodes(parseSlackMrkdwn(input))).not.toThrow();
		});

		it('renders an unrecognized token literally', () => {
			expect(textOf(parseSlackMrkdwn('a <b> c'))).toBe('a <b> c');
		});

		it('leaves an unclosed fence as literal text', () => {
			expect(textOf(parseSlackMrkdwn('```not closed'))).toBe('```not closed');
		});

		it('does not throw on object/array/date inputs', () => {
			expect(() => parseSlackMrkdwn({} as unknown)).not.toThrow();
			expect(() => parseSlackMrkdwn([] as unknown)).not.toThrow();
			expect(() => parseSlackMrkdwn(new Date() as unknown)).not.toThrow();
		});
	});
});
