import { expect } from 'chai';
import { describe, it } from 'mocha';

import { isMcpTool, mcpNeedsConfirm, mcpSlug, parseMcpServers, splitMcpName } from '../../../../../../server/lib/chi/admin/mcp';

describe('chi MCP connectors — pure parts', () => {
	describe('parseMcpServers', () => {
		it('parses a valid registry and defaults enabled to true', () => {
			const parsed = parseMcpServers('[{"name":"CasePro","url":"https://casepro-mcp-v2.stg-omnisai.io/mcp","apiKey":"k"}]');
			expect(parsed).to.have.length(1);
			expect(parsed[0]).to.deep.include({ name: 'casepro', url: 'https://casepro-mcp-v2.stg-omnisai.io/mcp', enabled: true });
		});

		it('skips rows without a usable http(s) url or name instead of failing the whole registry', () => {
			const parsed = parseMcpServers(
				'[{"name":"ok","url":"http://localhost:3002/mcp"},{"name":"","url":"https://x"},{"name":"bad","url":"ftp://nope"},"junk",null]',
			);
			expect(parsed.map((s) => s.name)).to.deep.equal(['ok']);
		});

		it('is never fatal on malformed JSON / non-arrays / empty input', () => {
			expect(parseMcpServers('')).to.deep.equal([]);
			expect(parseMcpServers('not json')).to.deep.equal([]);
			expect(parseMcpServers('{"name":"obj"}')).to.deep.equal([]);
		});

		it('slugs server names so they are safe inside tool names', () => {
			expect(mcpSlug('Case Pro v2!')).to.equal('caseprov2');
			expect(parseMcpServers('[{"name":"Case Notes","url":"https://x/mcp"}]')[0].name).to.equal('casenotes');
		});
	});

	describe('tool-name namespacing', () => {
		it('round-trips server + tool through the mcp_ namespace (tools may contain underscores)', () => {
			expect(isMcpTool('mcp_casepro_create_task')).to.equal(true);
			expect(isMcpTool('create_task')).to.equal(false);
			expect(splitMcpName('mcp_casepro_create_task')).to.deep.equal({ server: 'casepro', tool: 'create_task' });
			expect(splitMcpName('mcp_matterchat_get_my_day')).to.deep.equal({ server: 'matterchat', tool: 'get_my_day' });
		});

		it('rejects malformed namespaced names', () => {
			expect(splitMcpName('mcp_')).to.equal(undefined);
			expect(splitMcpName('mcp_serveronly')).to.equal(undefined);
			expect(splitMcpName('mcp_server_')).to.equal(undefined);
			expect(splitMcpName('plain_tool')).to.equal(undefined);
		});
	});

	describe('mcpNeedsConfirm', () => {
		it('lets read-only-annotated tools run without confirmation regardless of name', () => {
			expect(mcpNeedsConfirm('delete_everything', true, {})).to.equal(undefined);
		});

		it('parks write-looking tools for confirmation with a summary of the call', () => {
			const summary = mcpNeedsConfirm('create_card', false, { title: 'File Q3 brief' });
			expect(summary).to.be.a('string');
			expect(summary).to.contain('create card');
			expect(summary).to.contain('Q3 brief');
		});

		it('lets read-looking tools (list/get/search) run without confirmation', () => {
			expect(mcpNeedsConfirm('list_boards', false, {})).to.equal(undefined);
			expect(mcpNeedsConfirm('get_my_day', false, {})).to.equal(undefined);
			expect(mcpNeedsConfirm('search_cards', false, { q: 'depo' })).to.equal(undefined);
		});

		it('truncates huge argument payloads in the summary', () => {
			const summary = mcpNeedsConfirm('post_message', false, { text: 'x'.repeat(500) });
			expect(summary).to.be.a('string');
			expect((summary as string).length).to.be.lessThan(260);
			expect(summary).to.contain('…');
		});
	});
});
