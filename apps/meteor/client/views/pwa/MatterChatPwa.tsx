import type { ReactElement } from 'react';

import PwaInstallPrompt from './PwaInstallPrompt';
import PwaUpdatePrompt from './PwaUpdatePrompt';
import { useWebPushSubscription } from './useWebPushSubscription';

/**
 * MatterChatPwa — single mount point for the PWA glue (spec section B):
 *   • PwaUpdatePrompt  — "New version — Reload" toast (B.2 update flow)
 *   • PwaInstallPrompt — "Install MatterChat" affordance + iOS A2HS hint (B.3)
 *   • useWebPushSubscription — registers the browser for Web Push when granted (B.4)
 *
 * Mounted from AppLayout so it is always present regardless of route. Every piece
 * is feature-detected and best-effort: on any unsupported browser this renders
 * nothing and subscribes to nothing.
 */
const MatterChatPwa = (): ReactElement => {
	useWebPushSubscription();

	return (
		<>
			<PwaUpdatePrompt />
			<PwaInstallPrompt />
		</>
	);
};

export default MatterChatPwa;
