import { SidebarDivider, SidebarFooter as Footer } from '@rocket.chat/fuselage';

import { SidebarFooterWatermark } from './SidebarFooterWatermark';
import { WordClockMount } from '../../omnis/widgets/WordClockMount';

/**
 * White-label footer: the Omnis AI suite lockup, and nothing else.
 *
 * The "MatterChat" wordmark used to sit here above the lockup. It was removed 2026-08-06 (founder:
 * "remove the matterchat name from there, doesn't need it anymore at that spot") — the product name
 * already reads at the TOP of the nav rail (AppLeftRail's brand mark), so repeating it directly
 * above the suite lockup said it twice in the same glance and made the corner top-heavy.
 *
 * What's left is the sign-off proper: "Powered by" over the Omnis AI mark, centered, matching how
 * CasePro signs its frame from below the rails.
 */
const SidebarFooterDefault = () => {
	return (
		<Footer>
			<WordClockMount />
			<SidebarDivider />
			<SidebarFooterWatermark />
		</Footer>
	);
};

export default SidebarFooterDefault;
