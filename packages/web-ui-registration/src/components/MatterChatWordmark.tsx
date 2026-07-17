import type { ReactElement } from 'react';

/**
 * MatterChatWordmark — the brand mark for the LOGGED-OUT surfaces (login /
 * register / reset-password), shown in the wizard-layout logo slot whenever the
 * admin has not uploaded a custom logo asset.
 *
 * Mirrors the AppLeftRail mark (client/views/root/MainLayout/AppLeftRail.tsx):
 * "Matter" in the surface ink + "Chat" in the ORIGINAL MatterChat red — the
 * green redesign recolors the theme, but the brand name itself stays red.
 * Ink color is inherited from the page (dark ink on warm paper in light, white
 * on the calm dark surface in dark), so the mark reads in both themes.
 */

// Same red as MATTERCHAT_RED in AppLeftRail — keep the two in sync.
const MATTERCHAT_RED = '#e1140a';

export const MatterChatWordmark = (): ReactElement => (
	<span style={{ fontSize: '28px', fontWeight: 800, letterSpacing: '0.2px', lineHeight: 1 }}>
		Matter
		<span style={{ color: MATTERCHAT_RED }}>Chat</span>
	</span>
);

export default MatterChatWordmark;
