/**
 * Mobile PWA Screens — Design System Token Overrides
 * These screens use a premium refresh (MC Premium Refresh tokens) optimized for small viewports.
 * Light + dark themes via CSS variables.
 */

export const MOBILE_PWA_PALETTE_LIGHT = {
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
	railInk: '#AEB8B1',
	railInk2: '#6E7A73',
	railLine: '#1F2823',
	railHover: '#1A231E',
};

export const MOBILE_PWA_PALETTE_DARK = {
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
	railInk: '#AEB8B1',
	railInk2: '#69746D',
	railLine: '#1D2620',
	railHover: '#18201B',
};

export const getColorValue = (isDark: boolean, key: keyof typeof MOBILE_PWA_PALETTE_LIGHT): string => {
	const palette = isDark ? MOBILE_PWA_PALETTE_DARK : MOBILE_PWA_PALETTE_LIGHT;
	return palette[key];
};
