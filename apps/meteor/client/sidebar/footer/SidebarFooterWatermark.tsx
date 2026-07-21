import { Box, Icon } from '@rocket.chat/fuselage';

const DESKTOP_RELEASES_URL = 'https://github.com/OmnisAIOrg/MatterChat-Desktop-releases/releases/latest';

// True only in a normal browser — the desktop app exposes window.matterchatDesktop, so it hides its
// own "Get the desktop app" link.
const inDesktopApp = typeof window !== 'undefined' && Boolean((window as unknown as { matterchatDesktop?: unknown }).matterchatDesktop);

// MatterChat is white-labeled under the OmnisAI house brand: the sidebar footer always shows
// "Powered by Omnis AI" (no Rocket.Chat link / license watermark), plus a "Get the desktop app"
// link so anyone on the web can download the installer (macOS / Windows / Linux).
export const SidebarFooterWatermark = () => {
	return (
		<Box pi={16} pbe={8}>
			{!inDesktopApp && (
				<Box
					is='a'
					href={DESKTOP_RELEASES_URL}
					target='_blank'
					rel='noopener noreferrer'
					title='Download the MatterChat desktop app (macOS, Windows, Linux)'
					display='flex'
					alignItems='center'
					pbe={6}
				>
					<Icon name='download' size='x14' color='hint' mie={4} />
					<Box fontScale='micro' color='hint'>
						Get the desktop app
					</Box>
				</Box>
			)}
			<Box is='a' href='https://omnisai.io' target='_blank' rel='noopener noreferrer'>
				<Box fontScale='micro' color='hint' pbe={4}>
					Powered by Omnis AI
				</Box>
			</Box>
		</Box>
	);
};
