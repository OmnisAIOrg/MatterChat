/**
 * CasePro CLIENT (M2) barrel.
 *
 * The Matters server should import `caseProClient` from here:
 *   import { caseProClient } from '../lib/boards/casepro';
 *
 * Enablement/status (design §4–§5):
 *   - `caseProMode()`   — THE single enablement gate. `enabled === false` → all
 *     reads serve the stub (demo mode) and every write-through no-ops;
 *     `enabled === true` → reads AND writes use the configured transport.
 *     client.ts and leads/caseproSync.ts both align on this one helper.
 *   - `caseProStatus()` — admin status + cheap live probe (REST endpoint contract).
 */
export {
	caseProClient,
	CaseProClient,
	type ListMattersOpts,
	type ListMattersResult,
	type ListIntakesOpts,
	type ListIntakesResult,
	type ConvertIntakeResult,
} from './client';
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
	mapIntakeLead,
	mapIntakeStage,
	resolveIntakeStage,
	buildPartyRowFromCapture,
	buildIntakeRowFromCapture,
	buildIntakePatch,
	buildMatterRowFromIntake,
	type IntakeLead,
	type IntakeRowBundle,
	type IntakeStageDescriptor,
	type IntakeCaptureInput,
	type IntakePatchInput,
} from './mapping-intake';
export {
	StubTransport,
	NativeRestTransport,
	McpTransport,
	CaseProHttpError,
	instantiateTransport,
	resolveTransportFromConfig,
	type ICaseProTransport,
	type CaseProRow,
	type CaseProQuery,
	type CaseProQueryResult,
} from './transport';
export {
	caseProMode,
	resolveCaseProConfig,
	type CaseProConfig,
	type CaseProTransportKind,
	type CaseProAuthMode,
} from './config';
export { caseProStatus, type CaseProStatus } from './status';
