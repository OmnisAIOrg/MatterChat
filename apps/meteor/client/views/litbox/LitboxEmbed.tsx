import { LitboxProvider, LitboxFileBrowser } from '@omnisaiorg/litbox-file-browser';
import '@omnisaiorg/litbox-file-browser/style.css';
import { Box } from '@rocket.chat/fuselage';

/**
 * The embedded LitBox file browser.
 *
 * This module is the ONLY place that imports the heavy `@omnisaiorg/litbox-file-browser`
 * package (+ its CSS), and it is loaded lazily (see LitboxFilesView) so it stays out of
 * MatterChat's main client bundle.
 *
 * The component talks to `apiBaseUrl`, which points at MatterChat's OWN server proxy
 * (`/api/litbox/v1`). The proxy forwards to the LitBox backend with the user's LitBox
 * token injected server-side — so (a) there is no cross-origin call from the browser
 * (no LitBox CORS allow-list change needed) and (b) the LitBox token never reaches the
 * client. `authToken` is the caller's MatterChat session token, which the proxy validates
 * before swapping in the real LitBox credential.
 */
const LITBOX_API_BASE = '/_litbox/v1';

type LitboxEmbedProps = {
	authToken: string;
};

const LitboxEmbed = ({ authToken }: LitboxEmbedProps) => (
	<Box display='flex' flexDirection='column' height='100%' width='100%' style={{ minHeight: 0 }}>
		<LitboxProvider config={{ apiBaseUrl: LITBOX_API_BASE, authToken, appSlug: 'matterchat' }}>
			<LitboxFileBrowser orgWide className='litbox-embed-root' />
		</LitboxProvider>
	</Box>
);

export default LitboxEmbed;
