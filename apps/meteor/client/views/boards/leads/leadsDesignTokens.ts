/**
 * Leads Board Premium Refresh Design Tokens
 * Derived from docs/design/premium-refresh/Leads.dc.html
 * Light + dark theme CSS custom properties for the kanban, cards, and empty state.
 */

export type LeadsDesignTokens = {
	// Backgrounds
	bg: string;
	surface: string;
	surface2: string;
	// Borders
	border: string;
	border2: string;
	// Text (ink)
	ink: string;
	ink2: string;
	ink3: string;
	// Green (primary accent)
	green: string;
	green2: string;
	onGreen: string;
	greenSoft: string;
	greenLine: string;
	greenInk: string;
	// Shadows
	shadow1: string;
	shadow2: string;
	shadow3: string;
	// Glass effect
	bgGlass: string;
};

// Light theme tokens — matching Leads.dc.html CSS vars (light mode)
export const LEADS_LIGHT: LeadsDesignTokens = {
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
	shadow1: '0 1px 2px rgba(23,29,25,.05), 0 1px 3px rgba(23,29,25,.04)',
	shadow2: '0 1px 2px rgba(23,29,25,.05), 0 8px 24px -8px rgba(23,29,25,.14)',
	shadow3: '0 2px 6px rgba(23,29,25,.06), 0 24px 60px -12px rgba(23,29,25,.25)',
	bgGlass: 'rgba(246,246,243,.82)',
};

// Dark theme tokens
export const LEADS_DARK: LeadsDesignTokens = {
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
	shadow1: '0 1px 2px rgba(0,0,0,.35)',
	shadow2: '0 1px 2px rgba(0,0,0,.4), 0 10px 28px -8px rgba(0,0,0,.5)',
	shadow3: '0 2px 6px rgba(0,0,0,.4), 0 24px 60px -12px rgba(0,0,0,.6)',
	bgGlass: 'rgba(15,21,18,.78)',
};

/** Mono label styling — used for column headers, badges, uppercase eye-brow labels. */
export const LEADS_MONO_LABEL_STYLE = {
	fontFamily: "'Geist Mono', ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Consolas, monospace",
	fontSize: '11px',
	fontWeight: 600,
	letterSpacing: '0.12em',
	textTransform: 'uppercase' as const,
} as const;

/** Body text styling — Geist sans-serif. */
export const LEADS_BODY_STYLE = {
	fontFamily: "'Geist', system-ui, -apple-system, sans-serif",
	fontSize: '13px',
	fontWeight: 400,
} as const;

/** Card title styling. */
export const LEADS_CARD_TITLE_STYLE = {
	fontFamily: "'Geist', system-ui, -apple-system, sans-serif",
	fontSize: '13px',
	fontWeight: 600,
} as const;

/** Page heading styling. */
export const LEADS_PAGE_TITLE_STYLE = {
	fontFamily: "'Geist', system-ui, -apple-system, sans-serif",
	fontSize: '19px',
	fontWeight: 650,
	letterSpacing: '-0.02em',
} as const;

/**
 * Radius constants from the design system.
 */
export const LEADS_RADIUS = {
	small: '7px',   // small controls
	button: '9px',  // buttons/inputs
	nav: '11px',    // nav pills
	card: '12px',   // cards
	frame: '18px',  // app frame
	full: '999px',  // pills
} as const;

/**
 * Get the appropriate tokens for the current theme.
 */
export const getLeadsTokens = (isDark: boolean): LeadsDesignTokens => {
	return isDark ? LEADS_DARK : LEADS_LIGHT;
};
