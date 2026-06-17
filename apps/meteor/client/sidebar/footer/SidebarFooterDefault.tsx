import { Box, SidebarDivider, SidebarFooter as Footer } from '@rocket.chat/fuselage';

import { SidebarFooterWatermark } from './SidebarFooterWatermark';

// White-label footer: the MatterChat wordmark sits above the "Powered by Omnis AI"
// line (SidebarFooterWatermark). Replaces the RC setting-driven logo.
const SidebarFooterDefault = () => {
	return (
		<Footer>
			<SidebarDivider />
			<Box is='footer' pbs={12} pi={16} display='flex' alignItems='center'>
				<Box
					is='img'
					src='/images/matterchat-logo.png'
					alt='MatterChat'
					height='x28'
					style={{ width: 'auto', maxWidth: '100%', objectFit: 'contain' }}
				/>
			</Box>
			<SidebarFooterWatermark />
		</Footer>
	);
};

export default SidebarFooterDefault;
