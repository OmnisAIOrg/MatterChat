import { cronJobs } from '@rocket.chat/cron';
import { Boards } from '@rocket.chat/models';

import { caseProTransportDiagnostics } from '../lib/boards/casepro';
import { isCaseProEnabled as isCaseProEnabledLeads, pullFromCasePro as pullLeadsFromCasePro } from '../lib/boards/leads';
import { isCaseProEnabled as isCaseProEnabledMatters, pullFromCasePro as pullMattersFromCasePro } from '../lib/boards/matters';
import { SystemLogger } from '../lib/logger/system';

/**
 * CasePro leads-pull cron (live wire).
 *
 * Mirrors `boardsMattersCron`: a system-level periodic job that keeps the leads board
 * in step with CasePro's `intake_questionnaires` without anyone pressing "Sync from
 * CasePro" (the manual `boards.leads.syncFromCasePro` path stays untouched — same
 * `pullFromCasePro` engine, which is idempotent match-or-create by `caseproIntakeId`).
 *
 * Hard gates — the tick is a NO-OP unless ALL hold:
 *   1. `CasePro_Enabled` is on (the master integration switch), AND
 *   2. the transport is actually LIVE (`caseProTransportDiagnostics().effective !==
 *      'stub'`, i.e. native or mcp) — pulling stub rows on a schedule would fabricate fake leads, AND
 *   3. a leads board already exists — the cron NEVER creates boards; the first board
 *      comes from a human ensureBoard/manual sync (which supplies real user context).
 *
 * Actor: the existing board's `createdBy` — `pullFromCasePro` needs a uid for the
 * board-member/list writes and activity attribution; the board owner is the closest
 * durable stand-in for "the workspace" in a system job.
 */

async function runCaseProLeadsPull(): Promise<void> {
	if (!isCaseProEnabledLeads()) {
		return;
	}
	const diag = caseProTransportDiagnostics();
	if (diag.effective === 'stub') {
		SystemLogger.debug({ msg: 'boards.casepro.cron.leadsPull.skipped', reason: diag.reason ?? 'transport is stub' });
		return;
	}

	const boards = await Boards.findByPipelineType('leads').toArray();
	const board = boards.find((b) => !b.archived);
	if (!board) {
		// never create a board from the cron — nothing to sync into yet.
		return;
	}

	try {
		const result = await pullLeadsFromCasePro(board.createdBy);
		SystemLogger.info({ msg: 'boards.casepro.cron.leadsPull', ...result });
	} catch (err) {
		SystemLogger.warn({ msg: 'boards.casepro.cron.leadsPull.failed', err });
	}
}

/**
 * CasePro matters-pull cron (mirrors runCaseProLeadsPull).
 *
 * Same gating: CasePro_Enabled is on, transport is LIVE, and a matters board exists.
 * Actor: the existing board's `createdBy`.
 */
async function runCaseProMattersPull(): Promise<void> {
	if (!isCaseProEnabledMatters()) {
		return;
	}
	const diag = caseProTransportDiagnostics();
	if (diag.effective === 'stub') {
		SystemLogger.debug({ msg: 'boards.casepro.cron.mattersPull.skipped', reason: diag.reason ?? 'transport is stub' });
		return;
	}

	const boards = await Boards.findByPipelineType('matters').toArray();
	const board = boards.find((b) => !b.archived);
	if (!board) {
		// never create a board from the cron — nothing to sync into yet.
		return;
	}

	try {
		const result = await pullMattersFromCasePro(board.createdBy);
		if (result) {
			SystemLogger.info({ msg: 'boards.casepro.cron.mattersPull', ...result });
		}
	} catch (err) {
		SystemLogger.warn({ msg: 'boards.casepro.cron.mattersPull.failed', err });
	}
}

/**
 * Register the CasePro sync cron (called from `cron/start.ts`, mirroring
 * `boardsMattersCron`). Also the boot seam for the LOUD misconfiguration warning:
 * if the config asked for the live transport but it degraded to the stub (missing
 * key, bad URL, unimplemented auth mode), say so once at startup instead of
 * letting stub data quietly impersonate CasePro.
 */
export async function boardsCaseProSyncCron(): Promise<void> {
	const diag = caseProTransportDiagnostics();
	if (diag.requested !== 'stub' && diag.effective === 'stub') {
		SystemLogger.warn({
			msg: 'CasePro LIVE transport requested but NOT active — boards will serve STUB data and the leads-pull cron will not run',
			reason: diag.reason,
			authMode: diag.authMode,
			keyConfigured: diag.keyConfigured,
			orgConfigured: diag.orgConfigured,
		});
	} else if (diag.effective !== 'stub') {
		SystemLogger.info({ msg: 'CasePro live transport active', host: diag.host, orgConfigured: diag.orgConfigured });
	}

	// every 15 minutes — frequent enough for both pipelines, far below any rate ceiling.
	await cronJobs.add('BoardsCaseProLeadsPull', '*/15 * * * *', async () => runCaseProLeadsPull());
	await cronJobs.add('BoardsCaseProMattersPull', '*/15 * * * *', async () => runCaseProMattersPull());
}
