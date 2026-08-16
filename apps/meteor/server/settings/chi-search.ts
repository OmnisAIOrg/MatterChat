import { settingsRegistry } from '.';

/**
 * Settings for Chi "Ask Anything" (F9) — grounded retrieval over the workspace's own messages.
 * Engine: server/lib/chi/search/ + server/lib/chi/admin/search-tools.ts.
 *
 * STANDALONE-SAFE: every switch here is OFF/empty by default and the feature degrades to the
 * existing keyword search when nothing is set. A workspace that never opens this page sees
 * Ask Anything working on keywords, not an error.
 *
 * REGISTER ME: add `createChiSearchSettings()` to the list in server/settings/definitions.ts
 * (next to `createChiAssistantSettings()`), with the matching import at the top of that file.
 */
export const createChiSearchSettings = () =>
	settingsRegistry.addGroup('Chi_Search', async function () {
		// The master switch. Off ⇒ nothing is embedded, nothing is sent anywhere, and
		// Ask Anything answers from keyword matches instead.
		await this.add('Chi_Search_Embeddings_Enabled', false, {
			type: 'boolean',
			public: false,
			i18nLabel: 'Chi_Search_Embeddings_Enabled',
			i18nDescription: 'Chi_Search_Embeddings_Enabled_Description',
		});
		// Any OpenAI-compatible endpoint: the client POSTs {base}/embeddings. Point it at a
		// local Ollama/LM Studio to keep message text on the workspace's own machine.
		await this.add('Chi_Search_Embeddings_Base_URL', '', {
			type: 'string',
			public: false,
			enableQuery: { _id: 'Chi_Search_Embeddings_Enabled', value: true },
			i18nLabel: 'Chi_Search_Embeddings_Base_URL',
			i18nDescription: 'Chi_Search_Embeddings_Base_URL_Description',
		});
		await this.add('Chi_Search_Embeddings_API_Key', '', {
			type: 'password',
			secret: true,
			public: false,
			enableQuery: { _id: 'Chi_Search_Embeddings_Enabled', value: true },
			i18nLabel: 'Chi_Search_Embeddings_API_Key',
			i18nDescription: 'Chi_Search_Embeddings_API_Key_Description',
		});
		await this.add('Chi_Search_Embeddings_Model', 'text-embedding-3-small', {
			type: 'string',
			public: false,
			enableQuery: { _id: 'Chi_Search_Embeddings_Enabled', value: true },
			i18nLabel: 'Chi_Search_Embeddings_Model',
			i18nDescription: 'Chi_Search_Embeddings_Model_Description',
		});
		// 0 = whatever the model returns natively. Changing this (or the model) invalidates
		// every stored vector — vectors of different dimensions never compare.
		await this.add('Chi_Search_Embeddings_Dimensions', 0, {
			type: 'int',
			public: false,
			enableQuery: { _id: 'Chi_Search_Embeddings_Enabled', value: true },
			i18nLabel: 'Chi_Search_Embeddings_Dimensions',
			i18nDescription: 'Chi_Search_Embeddings_Dimensions_Description',
		});
		// Rooms that belong to no firm — workspace-wide channels and cross-firm rooms. OFF by
		// default because the firm layer is the whole point; a firm's members still need to be
		// subscribed to a room before anything in it can be retrieved.
		await this.add('Chi_Search_Include_Shared_Rooms', false, {
			type: 'boolean',
			public: false,
			i18nLabel: 'Chi_Search_Include_Shared_Rooms',
			i18nDescription: 'Chi_Search_Include_Shared_Rooms_Description',
		});
		// The backfill (server/cron/chiSearchIndexCron.ts). The live hook only ever sees NEW
		// messages, so without this the day semantic search is switched on the index is empty
		// and stays that way for whichever rooms nobody happens to post in. Off by default
		// because it is the one switch here that spends money on its own schedule.
		await this.add('Chi_Search_Backfill_Enabled', false, {
			type: 'boolean',
			public: false,
			enableQuery: { _id: 'Chi_Search_Embeddings_Enabled', value: true },
			i18nLabel: 'Chi_Search_Backfill_Enabled',
			i18nDescription: 'Chi_Search_Backfill_Enabled_Description',
		});
		await this.add('Chi_Search_Backfill_Schedule', '*/30 * * * *', {
			type: 'string',
			public: false,
			enableQuery: { _id: 'Chi_Search_Backfill_Enabled', value: true },
			i18nLabel: 'Chi_Search_Backfill_Schedule',
			i18nDescription: 'Chi_Search_Backfill_Schedule_Description',
		});
		await this.add('Chi_Search_Backfill_Rooms', 25, {
			type: 'int',
			public: false,
			enableQuery: { _id: 'Chi_Search_Backfill_Enabled', value: true },
			i18nLabel: 'Chi_Search_Backfill_Rooms',
			i18nDescription: 'Chi_Search_Backfill_Rooms_Description',
		});
	});
