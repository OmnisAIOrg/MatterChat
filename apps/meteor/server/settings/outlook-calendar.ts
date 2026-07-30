import { settingsRegistry } from '../../app/settings/server';

// MATTERCHAT: re-declared in MIT. Calendar_BusyStatus_Enabled was previously registered only by the
// EE-only apps/meteor/ee/server/settings/outlookCalendar.ts, but it is read by MIT server code
// (apps/meteor/server/services/calendar/service.ts:216 and
// apps/meteor/server/services/calendar/statusEvents/cancelUpcomingStatusChanges.ts:9). Without an
// MIT declaration, removing the ee/ tree makes settings.get() return undefined and the calendar
// busy-status feature is permanently off. Same id/type/public flag/default as the EE declaration,
// minus the enterprise/modules/invalidValue license machinery.
//
// The rest of the EE Outlook_Calendar group (Outlook_Calendar_Enabled, Outlook_Calendar_Exchange_Url,
// Outlook_Calendar_Outlook_Url, Outlook_Calendar_Url_Mapping) is intentionally NOT re-declared: every
// MIT reader (apps/meteor/app/api/server/helpers/getUserInfo.ts:54-85, MIT client hooks with explicit
// fallbacks) treats undefined exactly like the stock disabled/empty defaults.
export const createOutlookCalendarSettings = () =>
	settingsRegistry.addGroup('Outlook_Calendar', async function () {
		await this.add('Calendar_BusyStatus_Enabled', true, {
			type: 'boolean',
			public: true,
		});
	});
