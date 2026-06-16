/**
 * CasePro READ CLIENT (M2) barrel.
 *
 * The Matters server should import `caseProClient` from here:
 *   import { caseProClient } from '../lib/boards/casepro';
 */
export { caseProClient, CaseProClient } from './client';
export {
	mapMatterSnapshot,
	mapMatterListItem,
	mapStage,
	mapTeam,
	num,
	toDate,
	computeProjectedNet,
	MATTER_TEAM_ROLE_COLUMNS,
	type MatterListItem,
	type MatterRowBundle,
	type StageDescriptor,
} from './mapping';
export {
	StubTransport,
	RestTransport,
	resolveTransportFromConfig,
	type ICaseProTransport,
	type CaseProRow,
	type CaseProQuery,
	type CaseProQueryResult,
} from './transport';
