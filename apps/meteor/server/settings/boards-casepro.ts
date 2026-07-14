import { settingsRegistry } from '../../app/settings/server';

/**
 * Settings for the CasePro integration (M2 read client + live transports + the
 * July-2 staging lanes: comms-log, client-sync, public intake capture).
 *
 * CORE (transport/auth — the E2E-verified release/production model):
 * - CasePro_Enabled   : master switch the read client + write-through sync honor
 *                       (public — the client banner logic needs it).
 * - CasePro_Transport : 'stub' (default — mock rows, zero config), 'native'
 *                       (direct REST against CasePro), or 'mcp' (the CasePro MCP
 *                       endpoint). Public so the client can tell stub vs live;
 *                       the value itself is not a secret.
 * - CasePro_Base_URL  : the live CasePro base URL (only used when transport != stub).
 * - CasePro_Auth_Mode : 'internal-key' (service-key header) or 'bearer' (bearer token).
 * - CasePro_Api_Key   : the secret credential for whichever auth mode is selected.
 * - CasePro_Org_Id    : the CasePro organization every read/write is scoped to.
 * - CasePro_Mcp_Path  : path of the MCP endpoint on the base URL (mcp transport only).
 * - CasePro_Snapshot_Refresh_Interval : minutes between snapshot refreshes
 *                       (default 30; consumers clamp to a minimum of 5).
 *
 * STAGING LANES (additive features on the same transport):
 * - CasePro_Web_URL   : the CasePro WEB APP base URL for "Open in CasePro" deep links
 *                       (empty = links hidden). This is the human UI, not the API.
 * - CasePro_Comms_Log_* : matter-channel message auto-log (comms-log lane) — a direct
 *                       authenticated POST to the CRM ingest REST controller.
 * - CasePro_Client_Sync_* : client↔firm portal-message two-way sync into a per-matter
 *                       "Client" channel (its own service client, same auth material).
 * - CasePro_Intake_Capture_Base : the CasePro CRM base URL for the PUBLIC intake
 *   capture endpoint (`{base}/api/v1/intake-questionnaires/capture?org=&source=`)
 *   used by boards forms with `intakeRouting:'casepro-direct'`. DISTINCT from
 *   CasePro_Base_URL — the capture lane is auth-less and points at the CRM backend
 *   itself. Must be https; the outbound POST is host-pinned to this base.
 *   Independent of CasePro_Enabled/CasePro_Transport by design: a firm can route
 *   public forms into CasePro without turning on the full board sync.
 *
 * Defaulting to the stub means a fresh MatterChat boots and renders a complete
 * MatterSnapshot with no CasePro credentials. Flip the transport to 'native' or
 * 'mcp' + set the base URL / auth settings to go live.
 */
export const createBoardsCaseProSettings = () =>
	settingsRegistry.addGroup('CasePro', async function () {
		await this.add('CasePro_Enabled', false, {
			type: 'boolean',
			public: true,
			i18nLabel: 'CasePro_Enabled',
			i18nDescription: 'CasePro_Enabled_Description',
		});

		await this.add('CasePro_Transport', 'stub', {
			type: 'select',
			public: true,
			i18nLabel: 'CasePro_Transport',
			i18nDescription: 'CasePro_Transport_Description',
			values: [
				{ key: 'stub', i18nLabel: 'CasePro_Transport_Stub' },
				{ key: 'native', i18nLabel: 'CasePro_Transport_Native' },
				{ key: 'mcp', i18nLabel: 'CasePro_Transport_Mcp' },
			],
		});

		await this.add('CasePro_Base_URL', '', {
			type: 'string',
			public: false,
			i18nLabel: 'CasePro_Base_URL',
			i18nDescription: 'CasePro_Base_URL_Description',
			placeholder: 'https://casepro-mcp-v2.stg-omnisai.io',
			enableQuery: {
				_id: 'CasePro_Transport',
				value: { $in: ['native', 'mcp'] },
			},
		});

		await this.add('CasePro_Auth_Mode', 'internal-key', {
			type: 'select',
			public: false,
			i18nLabel: 'CasePro_Auth_Mode',
			i18nDescription: 'CasePro_Auth_Mode_Description',
			values: [
				{ key: 'internal-key', i18nLabel: 'CasePro_Auth_Mode_Internal_Key' },
				{ key: 'bearer', i18nLabel: 'CasePro_Auth_Mode_Bearer' },
			],
			enableQuery: {
				_id: 'CasePro_Transport',
				value: { $in: ['native', 'mcp'] },
			},
		});

		await this.add('CasePro_Api_Key', '', {
			type: 'string',
			public: false,
			secret: true,
			i18nLabel: 'CasePro_Api_Key',
			i18nDescription: 'CasePro_Api_Key_Description',
			enableQuery: {
				_id: 'CasePro_Transport',
				value: { $in: ['native', 'mcp'] },
			},
		});

		await this.add('CasePro_Org_Id', '', {
			type: 'string',
			public: false,
			i18nLabel: 'CasePro_Org_Id',
			i18nDescription: 'CasePro_Org_Id_Description',
			enableQuery: {
				_id: 'CasePro_Transport',
				value: { $in: ['native', 'mcp'] },
			},
		});

		await this.add('CasePro_Mcp_Path', '/mcp/v2', {
			type: 'string',
			public: false,
			i18nLabel: 'CasePro_Mcp_Path',
			i18nDescription: 'CasePro_Mcp_Path_Description',
			placeholder: '/mcp/v2',
			enableQuery: {
				_id: 'CasePro_Transport',
				value: 'mcp',
			},
		});

		await this.add('CasePro_Snapshot_Refresh_Interval', 30, {
			type: 'int',
			public: false,
			i18nLabel: 'CasePro_Snapshot_Refresh_Interval',
			i18nDescription: 'CasePro_Snapshot_Refresh_Interval_Description',
		});

		await this.add('CasePro_Web_URL', '', {
			type: 'string',
			public: true,
			i18nLabel: 'CasePro_Web_URL',
			i18nDescription: 'CasePro_Web_URL_Description',
			placeholder: 'https://casepro.stg-omnisai.io',
		});

		// Comms-log: auto-log matter-linked channels' messages onto the matter's
		// communication history in CasePro. Global kill switch (the per-channel
		// opt-out lives on the room: caseProCommsLog.enabled, channel admin panel).
		// Default ON — but only effective while CasePro_Enabled is also on.
		await this.add('CasePro_Comms_Log_Enabled', true, {
			type: 'boolean',
			public: true,
			i18nLabel: 'CasePro_Comms_Log_Enabled',
			i18nDescription: 'CasePro_Comms_Log_Enabled_Description',
			enableQuery: {
				_id: 'CasePro_Enabled',
				value: true,
			},
		});

		// Where digests are POSTed. The CRM backend can live on a different host
		// than the transport base URL, so this may be an absolute URL
		// (e.g. https://casepro-api.stg-omnisai.io/matterchat-messages/ingest).
		// A bare path is resolved against CasePro_Base_URL.
		await this.add('CasePro_Comms_Log_Ingest_URL', 'matterchat-messages/ingest', {
			type: 'string',
			public: false,
			i18nLabel: 'CasePro_Comms_Log_Ingest_URL',
			i18nDescription: 'CasePro_Comms_Log_Ingest_URL_Description',
			placeholder: 'https://casepro-api.stg-omnisai.io/matterchat-messages/ingest',
			enableQuery: {
				_id: 'CasePro_Comms_Log_Enabled',
				value: true,
			},
		});

		// -------------------------------------------------------------------------
		// CasePro CLIENT-message two-way sync (client↔firm portal thread → a per-matter
		// "Client" channel, distinct from the internal matter channel). Gated OFF by
		// default until a firm configures it; the sync engine is inert while OFF.
		// Reads/writes to CasePro `client_messages` use the CasePro service endpoint
		// (GET/POST /service/matters/:id/client-messages) on the CRM API — this lane
		// carries its own service client (casepro-clientsync/client.ts), separate from
		// the boards transport, reusing the same auth material (CasePro_Api_Key/Org_Id).
		// -------------------------------------------------------------------------
		await this.add('CasePro_Client_Sync_Enabled', false, {
			type: 'boolean',
			public: true,
			i18nLabel: 'CasePro_Client_Sync_Enabled',
			i18nDescription: 'CasePro_Client_Sync_Enabled_Description',
			enableQuery: {
				_id: 'CasePro_Enabled',
				value: true,
			},
		});

		// The service base URL for the CasePro CRM backend (the `/service/*` endpoints
		// live on the CRM API, NOT the MCP connector). Blank => falls back to CasePro_Base_URL.
		await this.add('CasePro_Client_Sync_API_URL', '', {
			type: 'string',
			public: false,
			i18nLabel: 'CasePro_Client_Sync_API_URL',
			i18nDescription: 'CasePro_Client_Sync_API_URL_Description',
			placeholder: 'https://crm-app.stg-omnisai.io/api/v1',
			enableQuery: {
				_id: 'CasePro_Client_Sync_Enabled',
				value: true,
			},
		});

		// Inbound poll cadence (cron string). Default: every minute. The outbound leg is
		// event-driven (afterSaveMessage), so this only paces the client→firm ingest.
		await this.add('CasePro_Client_Sync_Poll_Schedule', '* * * * *', {
			type: 'string',
			public: false,
			i18nLabel: 'CasePro_Client_Sync_Poll_Schedule',
			i18nDescription: 'CasePro_Client_Sync_Poll_Schedule_Description',
			enableQuery: {
				_id: 'CasePro_Client_Sync_Enabled',
				value: true,
			},
		});

		await this.add('CasePro_Intake_Capture_Base', '', {
			type: 'string',
			public: false,
			i18nLabel: 'CasePro_Intake_Capture_Base',
			i18nDescription: 'CasePro_Intake_Capture_Base_Description',
			placeholder: 'https://crm.stg-omnisai.io',
		});
	});
