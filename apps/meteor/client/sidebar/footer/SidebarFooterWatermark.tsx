import { Box } from '@rocket.chat/fuselage';

// MatterChat is white-labeled under the OmnisAI house brand: the sidebar footer
// always shows "Powered by Omnis AI" (no Rocket.Chat link / license watermark).
export const SidebarFooterWatermark = () => {
	return (
		<Box pi={16} pbe={8}>
			<Box is='a' href='https://omnisai.io' target='_blank' rel='noopener noreferrer'>
				<Box fontScale='micro' color='hint' pbe={4}>
					Powered by Omnis AI
				</Box>
			</Box>
		</Box>
	);
};
