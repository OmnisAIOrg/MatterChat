import { Box, SidebarDivider, SidebarFooter as Footer } from '@rocket.chat/fuselage';

import { SidebarFooterWatermark } from './SidebarFooterWatermark';
import { WordClockMount } from '../../omnis/widgets/WordClockMount';

// The MatterChat wordmark keeps its ORIGINAL red, even on the green theme.
const MATTERCHAT_RED = '#e1140a';

// White-label footer: the MatterChat wordmark sits above the "Powered by Omnis AI"
// line (SidebarFooterWatermark).
//
// The wordmark is rendered as TEXT, not the source PNG, on purpose: the supplied logo's
// "Chat" half is white (built for a dark background) so it vanished on the light sidebar,
// and Fuselage <Box is='img'> silently dropped the explicit pixel height (oversized/clipped).
// Text fixes both — "Matter" in the original MatterChat red, "Chat" in the theme's default font color so it
// stays legible on light *and* dark, crisp at any zoom, and perfectly aligned to the
// sidebar's inline padding.
const SidebarFooterDefault = () => {
	return (
		<Footer>
			<WordClockMount />
			<SidebarDivider />
			<Box is='footer' pbs={12} pbe={4} pi={16}>
				<Box is='span' style={{ fontSize: '20px', fontWeight: 700, letterSpacing: '-0.01em', lineHeight: 1 }}>
					<Box is='span' style={{ color: MATTERCHAT_RED }}>
						Matter
					</Box>
					<Box is='span' color='default'>
						Chat
					</Box>
				</Box>
			</Box>
			<SidebarFooterWatermark />
		</Footer>
	);
};

export default SidebarFooterDefault;
