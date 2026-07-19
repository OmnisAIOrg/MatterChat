/**
 * MatterChat unread badge treatment — the brand-red flashing dot with a white count,
 * shared by the rail's ambient-ensō beacon and every room-list unread badge so the
 * whole app pulses with ONE definition.
 *
 * Implemented as a real global class (style tag injected once on import) rather than
 * css-in-js: Fuselage's SidebarV2ItemBadge STRINGIFIES its className prop, so a css()
 * object arrives as "()=>e" and no styles apply — a plain string class works in every
 * component. `!important` wins over Fuselage's badge variant background (same trick as
 * the mobile PWA work — the variant class otherwise repaints it grey/blue).
 *
 * The pulse is a scale + fading ring (never an opacity blink — the number must stay
 * readable) and goes fully static for prefers-reduced-motion users.
 */

export const MATTERCHAT_BADGE_RED = '#e1140a';

export const UNREAD_PULSE_BADGE_CLASS = 'mc-unread-pulse-badge';

const STYLE_ID = 'mc-unread-pulse-style';

if (typeof document !== 'undefined' && !document.getElementById(STYLE_ID)) {
	const style = document.createElement('style');
	style.id = STYLE_ID;
	// .rcx-sidebar-v2-item__badge = every room-list unread badge (both the classic sidebar and
	// the navigation sidepanel render through Fuselage's SidebarV2ItemBadge) — styled here by
	// SELECTOR so no Rocket.Chat core file is edited (additive-only rule, CLAUDE.md).
	style.textContent = `
.${UNREAD_PULSE_BADGE_CLASS},
.rcx-sidebar-v2-item__badge {
	background-color: ${MATTERCHAT_BADGE_RED} !important;
	color: #ffffff !important;
	font-weight: 700;
	animation: mc-unread-pulse 1.6s ease-in-out infinite;
}
@keyframes mc-unread-pulse {
	0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(225, 20, 10, 0.55); }
	50% { transform: scale(1.1); box-shadow: 0 0 0 6px rgba(225, 20, 10, 0); }
}
@media (prefers-reduced-motion: reduce) {
	.${UNREAD_PULSE_BADGE_CLASS},
	.rcx-sidebar-v2-item__badge { animation: none; }
}
`;
	document.head.appendChild(style);
}
