/**
 * Calendar-provider registry. Callers resolve a provider by kind and program against
 * ICalendarProviderImpl — they NEVER branch on the provider value (mirrors the connector
 * providerRegistry). Adding a provider is: implement ICalendarProviderImpl + register it here.
 */
import type { CalendarProvider } from '@rocket.chat/core-typings';

import type { ICalendarProviderImpl } from './CalendarProvider';
import { googleCalendarProvider } from './providers/googleCalendar';
import { outlookCalendarProvider } from './providers/outlookCalendar';

const providers = new Map<CalendarProvider, ICalendarProviderImpl>([
	['google', googleCalendarProvider],
	['outlook', outlookCalendarProvider],
]);

export function getCalendarProvider(kind: CalendarProvider): ICalendarProviderImpl {
	const impl = providers.get(kind);
	if (!impl) {
		throw new Error(`unknown_calendar_provider:${kind}`);
	}
	return impl;
}

export function hasCalendarProvider(kind: string): kind is CalendarProvider {
	return providers.has(kind as CalendarProvider);
}
