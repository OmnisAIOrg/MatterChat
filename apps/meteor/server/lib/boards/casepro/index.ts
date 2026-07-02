/**
 * CasePro READ CLIENT (M2) barrel.
 *
 * The Matters server should import `caseProClient` from here:
 *   import { caseProClient } from '../lib/boards/casepro';
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
	McpGatewayTransport,
	resolveTransportFromConfig,
	caseProTransportDiagnostics,
	deriveMcpEndpoint,
	buildMcpFilters,
	type ICaseProTransport,
	type CaseProRow,
	type CaseProQuery,
	type CaseProQueryResult,
	type CaseProCallContext,
	type CaseProTransportDiagnostics,
	type McpGatewayTransportConfig,
} from './transport';
