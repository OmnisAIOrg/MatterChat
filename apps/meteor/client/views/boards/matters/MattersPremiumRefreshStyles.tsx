import { useSurfaceMode } from '@rocket.chat/ui-client';

/**
 * ============================================================================
 * MATTERS BOARD — Premium Refresh Design System
 * ============================================================================
 *
 * Premium visual refresh for the Matters kanban board, introducing:
 * - Geist typography (via Google Fonts)
 * - Color-coded stage pills (intake green, initial review amber, investigation blue)
 * - Rich card design (SOL bar, avatar stacks, quick action icons)
 * - Light + dark theme support via CSS variables
 *
 * Mounted from MattersBoardRoute, injected once per page load.
 * All styles scoped under `.mc-matters-board` to avoid conflicts.
 *
 * FORK-SAFE: Presentation only; no core RC components edited.
 */

type PremiumTokens = {
	/** Primary surfaces */
	bg: string;
	surface: string;
	surface2: string;
	border: string;
	border2: string;

	/** Text colors */
	ink: string;
	ink2: string;
	ink3: string;

	/** Brand green */
	green: string;
	green2: string;
	onGreen: string;
	greenSoft: string;
	greenLine: string;
	greenInk: string;

	/** Status colors */
	red: string;
	redSoft: string;
	redLine: string;
	amber: string;
	amberSoft: string;
	amberLine: string;
	blue: string;
	blueSoft: string;
	blueLine: string;

	/** Rail/sidebar */
	railBg: string;
	railBg2: string;
	railInk: string;
	railInk2: string;
	railLine: string;
	railHover: string;

	/** Shadows */
	shadow1: string;
	shadow2: string;
	shadow3: string;
};

const LIGHT: PremiumTokens = {
	bg: '#F6F6F3',
	surface: '#FFFFFF',
	surface2: '#FAFAF7',
	border: '#E7E6E0',
	border2: '#DBDAD3',
	ink: '#171D19',
	ink2: '#57615B',
	ink3: '#8E968F',
	green: '#17804D',
	green2: '#0F6A3D',
	onGreen: '#FFFFFF',
	greenSoft: '#E8F3ED',
	greenLine: '#CBE5D6',
	greenInk: '#116240',
	red: '#CF4438',
	redSoft: '#FBECEA',
	redLine: '#F2CFCB',
	amber: '#A97A18',
	amberSoft: '#F8F0DF',
	amberLine: '#EBD9B4',
	blue: '#3C6EB4',
	blueSoft: '#EAF1F9',
	blueLine: '#CDDDF0',
	railBg: '#0D1310',
	railBg2: '#111814',
	railInk: '#AEB8B1',
	railInk2: '#6E7A73',
	railLine: '#1F2823',
	railHover: '#1A231E',
	shadow1: '0 1px 2px rgba(23,29,25,.05),0 1px 3px rgba(23,29,25,.04)',
	shadow2: '0 1px 2px rgba(23,29,25,.05),0 8px 24px -8px rgba(23,29,25,.14)',
	shadow3: '0 2px 6px rgba(23,29,25,.06),0 24px 60px -12px rgba(23,29,25,.25)',
};

const DARK: PremiumTokens = {
	bg: '#0F1512',
	surface: '#151C17',
	surface2: '#19211C',
	border: '#242D27',
	border2: '#2D372F',
	ink: '#E9EDEA',
	ink2: '#A2ACA5',
	ink3: '#707B74',
	green: '#3FBC7C',
	green2: '#57CD90',
	onGreen: '#08130D',
	greenSoft: '#152A1E',
	greenLine: '#265C3F',
	greenInk: '#6FD6A3',
	red: '#E0685D',
	redSoft: '#32201D',
	redLine: '#5C332D',
	amber: '#D3A24A',
	amberSoft: '#2E2717',
	amberLine: '#5A4A24',
	blue: '#7AA3D8',
	blueSoft: '#1B2532',
	blueLine: '#324B69',
	railBg: '#0B100D',
	railBg2: '#0F1511',
	railInk: '#AEB8B1',
	railInk2: '#69746D',
	railLine: '#1D2620',
	railHover: '#18201B',
	shadow1: '0 1px 2px rgba(0,0,0,.35)',
	shadow2: '0 1px 2px rgba(0,0,0,.4),0 10px 28px -8px rgba(0,0,0,.5)',
	shadow3: '0 2px 6px rgba(0,0,0,.4),0 24px 60px -12px rgba(0,0,0,.6)',
};

const buildMattersBoardCss = (t: PremiumTokens): string => `
/* Geist is vendored locally (public/fonts + the foundation @font-face). No CDN @import:
   it is CSP-blocked on prod and was masking that the local woff2 files were corrupt HTML. */
.mc-matters-board {
	--mc-premium-bg: ${t.bg};
	--mc-premium-surface: ${t.surface};
	--mc-premium-surface2: ${t.surface2};
	--mc-premium-border: ${t.border};
	--mc-premium-border2: ${t.border2};
	--mc-premium-ink: ${t.ink};
	--mc-premium-ink2: ${t.ink2};
	--mc-premium-ink3: ${t.ink3};
	--mc-premium-green: ${t.green};
	--mc-premium-green2: ${t.green2};
	--mc-premium-onGreen: ${t.onGreen};
	--mc-premium-greenSoft: ${t.greenSoft};
	--mc-premium-greenLine: ${t.greenLine};
	--mc-premium-greenInk: ${t.greenInk};
	--mc-premium-red: ${t.red};
	--mc-premium-redSoft: ${t.redSoft};
	--mc-premium-redLine: ${t.redLine};
	--mc-premium-amber: ${t.amber};
	--mc-premium-amberSoft: ${t.amberSoft};
	--mc-premium-amberLine: ${t.amberLine};
	--mc-premium-blue: ${t.blue};
	--mc-premium-blueSoft: ${t.blueSoft};
	--mc-premium-blueLine: ${t.blueLine};
	--mc-premium-shadow1: ${t.shadow1};
	--mc-premium-shadow2: ${t.shadow2};
	--mc-premium-shadow3: ${t.shadow3};
}

/* Column Headers - Mono uppercase labels with counts */
.mc-matters-column-header {
	font-family: 'Geist Mono', monospace;
	font-size: 10px;
	font-weight: 600;
	letter-spacing: 0.12em;
	text-transform: uppercase;
	color: var(--mc-premium-ink2);
	text-transform: uppercase;
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 2px 4px 10px;
	position: sticky;
	top: 0;
}

.mc-matters-column-count {
	font-family: 'Geist Mono', monospace;
	font-size: 10.5px;
	color: var(--mc-premium-ink3);
	padding: 1px 7px;
	border-radius: 99px;
	border: 1px solid var(--mc-premium-border);
	background: var(--mc-premium-surface);
	margin-left: auto;
}

/* Card Tiles - Premium design */
.mc-matters-card-tile {
	background: var(--mc-premium-surface);
	border: 1px solid var(--mc-premium-border);
	border-radius: 12px;
	box-shadow: var(--mc-premium-shadow1);
	padding: 12px 13px;
	cursor: pointer;
	transition: all 0.15s ease;
}

.mc-matters-card-tile:hover {
	box-shadow: var(--mc-premium-shadow2);
	transform: translateY(-1px);
}

.mc-matters-card-tile.selected {
	border-color: var(--mc-premium-greenLine);
	background: var(--mc-premium-greenSoft);
}

/* Card Header - Checkbox, name, type, ID */
.mc-matters-card-header {
	display: flex;
	align-items: flex-start;
	gap: 9px;
}

.mc-matters-card-checkbox {
	margin-top: 1px;
	flex: none;
	width: 15px;
	height: 15px;
	border-radius: 4.5px;
	border: 1.5px solid var(--mc-premium-border2);
	background: var(--mc-premium-surface);
	display: grid;
	place-items: center;
	box-sizing: border-box;
	transition: all 0.12s ease;
	cursor: pointer;
}

.mc-matters-card-checkbox.checked {
	border-color: var(--mc-premium-green);
	background: var(--mc-premium-green);
}

.mc-matters-card-checkbox.checked svg {
	color: var(--mc-premium-onGreen);
	display: block;
}

.mc-matters-card-name {
	font-size: 13px;
	font-weight: 600;
	color: var(--mc-premium-ink);
	line-height: 1.35;
	flex: 1;
	min-width: 0;
}

.mc-matters-card-type {
	margin-top: 2px;
	font-size: 11.5px;
	color: var(--mc-premium-ink3);
}

.mc-matters-card-id {
	font-family: 'Geist Mono', monospace;
	font-size: 10px;
	color: var(--mc-premium-ink3);
}

/* SOL Progress Bar */
.mc-matters-sol-bar {
	margin-top: 10px;
	display: flex;
	align-items: center;
	gap: 8px;
}

.mc-matters-sol-track {
	flex: 1;
	height: 4px;
	border-radius: 99px;
	background: var(--mc-premium-surface2);
	border: 1px solid var(--mc-premium-border);
	overflow: hidden;
}

.mc-matters-sol-fill {
	height: 100%;
	border-radius: 99px;
	background: var(--mc-premium-green);
	transition: width 0.3s ease;
}

.mc-matters-sol-fill.low {
	background: var(--mc-premium-red);
}

.mc-matters-sol-label {
	font-family: 'Geist Mono', monospace;
	font-size: 9.5px;
	color: var(--mc-premium-ink3);
	white-space: nowrap;
	font-variant-numeric: tabular-nums;
}

/* Card Footer - Avatar stack and quick actions */
.mc-matters-card-footer {
	margin-top: 9px;
	display: flex;
	align-items: center;
}

.mc-matters-avatar-stack {
	display: inline-flex;
	padding-left: 6px;
}

.mc-matters-avatar {
	width: 20px;
	height: 20px;
	border-radius: 99px;
	background: linear-gradient(135deg, #2FA268, #186B44);
	border: 2px solid var(--mc-premium-surface);
	display: inline-grid;
	place-items: center;
	color: #fff;
	font-size: 8px;
	font-weight: 600;
	margin-left: -6px;
}

.mc-matters-card-actions {
	flex: 1;
}

.mc-matters-quick-actions {
	display: inline-flex;
	gap: 2px;
	opacity: 0;
	transition: opacity 0.15s ease;
	margin-left: auto;
}

.mc-matters-card-tile:hover .mc-matters-quick-actions {
	opacity: 1;
}

.mc-matters-quick-action-btn {
	width: 24px;
	height: 24px;
	border-radius: 7px;
	border: 0;
	background: transparent;
	color: var(--mc-premium-ink3);
	display: grid;
	place-items: center;
	cursor: pointer;
	transition: all 0.12s ease;
}

.mc-matters-quick-action-btn:hover {
	background: var(--mc-premium-surface2);
	color: var(--mc-premium-ink);
}

/* Stage Pills */
.mc-matters-stage-pill {
	font-size: 10.5px;
	font-weight: 600;
	padding: 3px 10px;
	border-radius: 99px;
	border: 1px solid;
	display: inline-block;
}

.mc-matters-stage-pill.intake {
	background: var(--mc-premium-greenSoft);
	color: var(--mc-premium-greenInk);
	border-color: var(--mc-premium-greenLine);
}

.mc-matters-stage-pill.initial-review {
	background: var(--mc-premium-amberSoft);
	color: var(--mc-premium-amber);
	border-color: var(--mc-premium-amberLine);
}

.mc-matters-stage-pill.investigation {
	background: var(--mc-premium-blueSoft);
	color: var(--mc-premium-blue);
	border-color: var(--mc-premium-blueLine);
}

.mc-matters-stage-pill.settled {
	background: var(--mc-premium-surface2);
	color: var(--mc-premium-ink2);
	border-color: var(--mc-premium-border);
}

/* Column Container */
.mc-matters-column {
	display: flex;
	flex-direction: column;
	width: 296px;
	flex: none;
}

/* Add Card Button */
.mc-matters-add-card-btn {
	height: 34px;
	border-radius: 10px;
	border: 1.5px dashed var(--mc-premium-border2);
	background: transparent;
	color: var(--mc-premium-ink3);
	font-family: inherit;
	font-size: 12.5px;
	font-weight: 500;
	cursor: pointer;
	transition: all 0.15s ease;
	width: 100%;
}

.mc-matters-add-card-btn:hover {
	border-color: var(--mc-premium-green);
	color: var(--mc-premium-green);
	background: var(--mc-premium-greenSoft);
}

/* Bulk Selection Bar */
.mc-matters-bulk-bar {
	position: absolute;
	left: 50%;
	bottom: 22px;
	transform: translateX(-50%);
	z-index: 40;
	display: inline-flex;
	align-items: center;
	gap: 14px;
	padding: 9px 18px;
	border-radius: 13px;
	background: var(--mc-premium-railBg);
	color: #E9EDEA;
	box-shadow: var(--mc-premium-shadow3);
	animation: mcPop 0.2s cubic-bezier(0.2, 0.8, 0.3, 1) both;
}

.mc-matters-bulk-bar-count {
	font-size: 12.5px;
	font-weight: 600;
	font-variant-numeric: tabular-nums;
}

.mc-matters-bulk-bar-divider {
	width: 1px;
	height: 16px;
	background: var(--mc-premium-railLine);
}

.mc-matters-bulk-bar-action {
	font-size: 12.5px;
	color: var(--mc-premium-railInk);
	cursor: pointer;
	transition: color 0.12s ease;
}

.mc-matters-bulk-bar-action:hover {
	color: #fff;
}

.mc-matters-bulk-bar-action.danger {
	color: var(--mc-premium-red);
}

.mc-matters-bulk-bar-close {
	font-size: 12.5px;
	color: var(--mc-premium-railInk2);
	cursor: pointer;
	padding-left: 4px;
	transition: color 0.12s ease;
}

.mc-matters-bulk-bar-close:hover {
	color: #fff;
}

@keyframes mcPop {
	from {
		opacity: 0;
		transform: translate(-50%, 6px) scale(0.98);
	}
	to {
		opacity: 1;
		transform: translate(-50%, 0) scale(1);
	}
}
`;

const MattersPremiumRefreshStyles = () => {
	const theme = useSurfaceMode();

	// Only apply to branded light/dark themes, not high-contrast
	if (theme !== 'light' && theme !== 'dark') {
		return null;
	}

	const tokens = theme === 'dark' ? DARK : LIGHT;

	return <style dangerouslySetInnerHTML={{ __html: buildMattersBoardCss(tokens) }} />;
};

export default MattersPremiumRefreshStyles;
