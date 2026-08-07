import { useSetting } from '@rocket.chat/ui-contexts';
import { useCallback } from 'react';

import { omnisPost } from '../omnis/shell/omnisRest';

/**
 * useCaseNotesHuddle: CaseNotes capture when a huddle starts.
 *
 * Previously a placeholder that only `console.debug`d in development. It now
 * calls the real dispatch endpoint — but its original contract is preserved
 * DELIBERATELY and completely: **best-effort, non-blocking, fail-silent.**
 *
 * A huddle must start whether or not CaseNotes is reachable. Nothing in this
 * hook is awaited by the caller, no error is surfaced, and every failure path
 * returns normally. If CaseNotes is disabled, the room is not matter-linked, or
 * the backend is down, the huddle is simply not recorded.
 *
 * The matter binding is resolved SERVER-side from `roomId` (the shared
 * matter-context rule), so a huddle in a matter channel is filed to that matter
 * and a huddle anywhere else is filed to nobody rather than guessed at.
 *
 * Consent still applies: the server refuses to start any capture without a bot
 * display name and disclosure text, so this path cannot produce a silent
 * recorder either.
 */
export const useCaseNotesHuddle = () => {
	const caseNotesEnabled = useSetting('CaseNotes_Enabled', false);

	/**
	 * @param roomId - MatterChat room where the huddle started
	 * @returns resolves once the attempt is made (or immediately skipped)
	 */
	const notifyHuddleStart = useCallback(
		async (roomId: string) => {
			if (!caseNotesEnabled) {
				return;
			}
			try {
				await omnisPost('/v1/casenotes.startRecording', {
					// `internal-strategy` is the conservative default for a huddle
					// nobody has classified: it is treated as WORK PRODUCT, so the
					// summary is filed to the matter but never posted to a
					// client-facing channel. Guessing "client check-in" here would
					// risk publishing an internal discussion to a client.
					kind: 'internal-strategy',
					roomId,
				});
			} catch {
				// Silent by design — CaseNotes is optional and must never block a
				// huddle. See the contract note above.
			}
		},
		[caseNotesEnabled],
	);

	return { notifyHuddleStart };
};
