import type { OmnisProductConfig } from '../omnis/config';
import { readString, resolveOmnisConfig } from '../omnis/config';

/**
 * CaseNotes connection config: the shared seven, plus the two consent settings.
 *
 * The consent settings are not decoration. Recording law varies by state and
 * this is a law firm, so the disclosure text is configurable per firm and the
 * bot's display name is explicit — the bot must appear as a **named, visible
 * participant**, never a silent recorder.
 */

export const CASENOTES_NS = { setting: 'CaseNotes', env: 'CASENOTES' } as const;

/** Fallbacks used when a firm has not set its own. Both are announced on join. */
export const DEFAULT_BOT_NAME = 'CaseNotes Notetaker';
export const DEFAULT_DISCLOSURE =
	'This meeting is being recorded and transcribed for the legal file. Please say so now if you would prefer not to be recorded.';

export type CaseNotesConfig = OmnisProductConfig & {
	/** Announced in-meeting on join, and logged against the recording. */
	recordingDisclosure: string;
	/** The bot's visible participant name. */
	botDisplayName: string;
};

export function resolveCaseNotesConfig(): CaseNotesConfig {
	return {
		...resolveOmnisConfig(CASENOTES_NS),
		recordingDisclosure: readString('CASENOTES_RECORDING_DISCLOSURE', 'CaseNotes_Recording_Disclosure', DEFAULT_DISCLOSURE),
		botDisplayName: readString('CASENOTES_BOT_DISPLAY_NAME', 'CaseNotes_Bot_Display_Name', DEFAULT_BOT_NAME),
	};
}
