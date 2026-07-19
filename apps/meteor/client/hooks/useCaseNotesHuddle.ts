import { useCallback } from 'react';

/**
 * useCaseNotesHuddle: Integration hook for CaseNotes auto-note on huddle start
 * Designed to work best-effort (non-blocking, graceful failure)
 *
 * When a huddle starts in a channel linked to a CaseNotes case/matter,
 * this hook sends a signal to auto-create an entry in the case notes.
 * If CaseNotes is not available or the room is not linked, it fails silently.
 */
export const useCaseNotesHuddle = () => {
	/**
	 * notifyHuddleStart: Send best-effort notification to CaseNotes
	 * @param roomId - MatterChat room ID where huddle started
	 * @returns Promise<void> - resolves when notification sent (or fails silently)
	 */
	const notifyHuddleStart = useCallback(async (roomId: string) => {
		try {
			// Best-effort: Check if room is linked to a case/matter
			// This is a placeholder for the actual CaseNotes integration
			// In production, this would:
			// 1. Query the room metadata for linked case/matter ID
			// 2. POST to CaseNotes API to create an auto-note entry
			// 3. Include huddle start time, participants, duration placeholder

			// For now, we log the attempt (visible in dev console)
			if (process.env.NODE_ENV === 'development') {
				console.debug('[Huddles] CaseNotes auto-note request:', { roomId });
			}

			// Placeholder API call (when CaseNotes integration is ready)
			// await fetch(`/api/v1/cases/auto-note`, {
			//   method: 'POST',
			//   headers: { 'Content-Type': 'application/json' },
			//   body: JSON.stringify({
			//     type: 'huddle_start',
			//     roomId,
			//     timestamp: new Date().toISOString(),
			//   }),
			// });
		} catch (error) {
			// Silently fail - CaseNotes integration is optional
			// Never block huddle start on CaseNotes unavailability
		}
	}, []);

	return { notifyHuddleStart };
};
