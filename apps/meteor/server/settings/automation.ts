import { settingsRegistry } from '.';

/**
 * Settings for the Boards AUTOMATION ENGINE (M7 — the Butler-equivalent).
 *
 * The engine + cron read these every tick; the Engine phase consumes them:
 * - Boards_Automation_Enabled            : master kill switch (engine + cron honor it).
 * - Boards_Automation_Scheduling_Enabled : toggles the 1-min cron tick (watch → add/remove).
 * - Boards_Automation_Action_Budget      : per-run action cap (loop guard — caps cascade work).
 * - Boards_Automation_Max_Depth          : re-emit depth cap (A→B→A oscillation guard).
 * - Boards_Automation_Daily_Run_Cap      : per-board daily run cap (runaway guard).
 * - Boards_Automation_Timezone           : firm tz used to resolve scheduled times.
 * - Boards_Automation_Run_Retention_Days : prune window for boards_automation_runs.
 * - Boards_Automation_CasePro_Writeback_Enabled : P3 CasePro write-back gate (also perm-gated).
 * - Boards_Automation_SMS_Enabled        : P3 telephony (Twilio) gate for notifySms actions.
 *
 * Mirrors createBoardsCaseProSettings (the addGroup/this.add idiom) so the
 * Automations group auto-surfaces in Admin → Settings.
 */
export const createBoardsAutomationSettings = () =>
	settingsRegistry.addGroup('Boards_Automation', async function () {
		await this.add('Boards_Automation_Enabled', true, {
			type: 'boolean',
			public: true,
			i18nLabel: 'Boards_Automation_Enabled',
			i18nDescription: 'Boards_Automation_Enabled_Description',
		});

		await this.add('Boards_Automation_Scheduling_Enabled', true, {
			type: 'boolean',
			public: false,
			i18nLabel: 'Boards_Automation_Scheduling_Enabled',
			i18nDescription: 'Boards_Automation_Scheduling_Enabled_Description',
			enableQuery: {
				_id: 'Boards_Automation_Enabled',
				value: true,
			},
		});

		await this.add('Boards_Automation_Action_Budget', 50, {
			type: 'int',
			public: false,
			i18nLabel: 'Boards_Automation_Action_Budget',
			i18nDescription: 'Boards_Automation_Action_Budget_Description',
		});

		await this.add('Boards_Automation_Max_Depth', 5, {
			type: 'int',
			public: false,
			i18nLabel: 'Boards_Automation_Max_Depth',
			i18nDescription: 'Boards_Automation_Max_Depth_Description',
		});

		await this.add('Boards_Automation_Daily_Run_Cap', 5000, {
			type: 'int',
			public: false,
			i18nLabel: 'Boards_Automation_Daily_Run_Cap',
			i18nDescription: 'Boards_Automation_Daily_Run_Cap_Description',
		});

		await this.add('Boards_Automation_Timezone', 'America/Chicago', {
			type: 'string',
			public: false,
			i18nLabel: 'Boards_Automation_Timezone',
			i18nDescription: 'Boards_Automation_Timezone_Description',
			placeholder: 'America/Chicago',
		});

		await this.add('Boards_Automation_Run_Retention_Days', 90, {
			type: 'int',
			public: false,
			i18nLabel: 'Boards_Automation_Run_Retention_Days',
			i18nDescription: 'Boards_Automation_Run_Retention_Days_Description',
		});

		await this.add('Boards_Automation_CasePro_Writeback_Enabled', false, {
			type: 'boolean',
			public: false,
			i18nLabel: 'Boards_Automation_CasePro_Writeback_Enabled',
			i18nDescription: 'Boards_Automation_CasePro_Writeback_Enabled_Description',
		});

		await this.add('Boards_Automation_SMS_Enabled', false, {
			type: 'boolean',
			public: false,
			i18nLabel: 'Boards_Automation_SMS_Enabled',
			i18nDescription: 'Boards_Automation_SMS_Enabled_Description',
		});
	});
