import type { IMatterSnapshot } from '@rocket.chat/core-typings';

import {
	mapMatterSnapshot,
	mapMatterListItem,
	mapStage,
	type MatterListItem,
	type MatterRowBundle,
	type StageDescriptor,
} from './mapping';
import { resolveTransportFromConfig, type ICaseProTransport, type CaseProRow } from './transport';

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const onlyStrings = (rows: CaseProRow[], key = 'id'): string[] =>
	rows.map((r) => str(r[key])).filter((id): id is string => Boolean(id));

export type ListMattersOpts = { stageId?: string; caseTypeId?: string; query?: string; limit?: number; offset?: number };
export type ListMattersResult = { matters: MatterListItem[]; total: number };

/**
 * The single outbound CasePro read client (M2). All Matters reads go through here;
 * the transport (stub | rest) is config-selected. Sums are computed in JS — CasePro's
 * aggregate_data GROUP BY is broken (see casepro discovery docs).
 */
export class CaseProClient {
	private transport: ICaseProTransport | undefined;

	private get tx(): ICaseProTransport {
		if (!this.transport) {
			this.transport = resolveTransportFromConfig();
		}
		return this.transport;
	}

	/** Override the transport (tests / runtime swap); pass undefined to revert to config. */
	setTransport(transport?: ICaseProTransport): void {
		this.transport = transport;
	}

	/** Page an entity fully (CasePro caps page size; we accumulate then reduce in JS). */
	private async queryAll(entity: string, filter?: Record<string, unknown>): Promise<CaseProRow[]> {
		const out: CaseProRow[] = [];
		const limit = 200;
		let offset = 0;
		for (let page = 0; page < 50; page++) {
			const { data, total } = await this.tx.query(entity, { filter, limit, offset });
			out.push(...data);
			offset += data.length;
			if (data.length === 0 || out.length >= total) {
				break;
			}
		}
		return out;
	}

	async matterSnapshot(matterId: string): Promise<IMatterSnapshot | null> {
		const matter = await this.tx.get('matters', matterId);
		if (!matter) {
			return null;
		}

		const [caseTypes, matterStages, matterSubStages, settlementTypes] = await Promise.all([
			this.queryAll('case_types'),
			this.queryAll('matter_stages'),
			this.queryAll('matter_sub_stages'),
			this.queryAll('settlement_types'),
		]);

		const clientId = str(matter.client_id);
		const clientParty = clientId ? await this.tx.get('parties', clientId) : null;

		// bills have no matter_id — reach them via medical_providers.matter_id -> bills.medical_provider_id
		const providers = await this.queryAll('medical_providers', { matter_id: matterId });
		const providerIds = onlyStrings(providers);
		const bills = providerIds.length ? await this.queryAll('bills', { medical_provider_id: { $in: providerIds } }) : [];

		const [negotiations, resolutions, liens, expenses] = await Promise.all([
			this.queryAll('negotiations', { matter_id: matterId }),
			this.queryAll('resolutions', { matter_id: matterId }),
			this.queryAll('liens', { matter_id: matterId }),
			this.queryAll('expenses', { matter_id: matterId }),
		]);

		// reductions are polymorphic — only the Lien ones net against liens
		const lienIds = onlyStrings(liens);
		const reductions = lienIds.length
			? await this.queryAll('reductions', { reducible_type: 'Lien', reducible_id: { $in: lienIds } })
			: [];

		const bundle: MatterRowBundle = {
			matter,
			caseTypes,
			matterStages,
			matterSubStages,
			settlementTypes,
			clientParty,
			providerCount: providers.length,
			bills,
			negotiations,
			resolutions,
			liens,
			reductions,
			expenses,
		};

		return mapMatterSnapshot(bundle);
	}

	async listMatters(opts: ListMattersOpts = {}): Promise<ListMattersResult> {
		const filter: Record<string, unknown> = { archived: false };
		if (opts.stageId) {
			filter.stage_id = opts.stageId;
		}
		if (opts.caseTypeId) {
			filter.case_type = opts.caseTypeId;
		}
		const { data, total } = await this.tx.query('matters', {
			filter,
			limit: opts.limit ?? 50,
			offset: opts.offset ?? 0,
		});
		const matterStages = await this.queryAll('matter_stages');
		return { matters: data.map((m) => mapMatterListItem(m, matterStages)), total };
	}

	async listStages(): Promise<StageDescriptor[]> {
		const rows = await this.queryAll('matter_stages');
		return rows
			.map(mapStage)
			.filter((s) => Boolean(s.stageId))
			.sort((a, b) => a.orderIndex - b.orderIndex);
	}

	async providerCount(matterId: string): Promise<number> {
		const { total } = await this.tx.query('medical_providers', { filter: { matter_id: matterId }, limit: 1 });
		return total;
	}
}

export const caseProClient = new CaseProClient();
