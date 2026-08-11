import type { TranslationKey } from '@rocket.chat/ui-contexts';

type ThemeItem = {
	id: string;
	title: TranslationKey;
	description: TranslationKey;
};

/**
 * MATTERCHAT — the colour schemes come first, then the Paper & Sky skins.
 *
 * The skins are a different axis: material, shape and typography rather than only
 * palette. They share this one list because they share one preference — see
 * `Skins` in core-typings for why that needs no backend change.
 *
 * Only the first skin carries a full description; the tints are the same skin on a
 * different sky, so they read as a family rather than six unrelated themes.
 */
export const themeItems: ThemeItem[] = [
	{
		id: 'light',
		title: 'Theme_light',
		description: 'Theme_light_description',
	},
	{
		id: 'dark',
		title: 'Theme_dark',
		description: 'Theme_dark_description',
	},
	{
		id: 'high-contrast',
		title: 'Theme_high_contrast',
		description: 'Theme_high_contrast_description',
	},
	{
		id: 'auto',
		title: 'Theme_match_system',
		description: 'Theme_match_system_description',
	},
	{
		id: 'paper-sky',
		title: 'Theme_paper_sky',
		description: 'Theme_paper_sky_description',
	},
	{
		id: 'paper-sky-blue',
		title: 'Theme_paper_sky_blue',
		description: 'Theme_paper_sky_tint_description',
	},
	{
		id: 'paper-sky-indigo',
		title: 'Theme_paper_sky_indigo',
		description: 'Theme_paper_sky_tint_description',
	},
	{
		id: 'paper-sky-amber',
		title: 'Theme_paper_sky_amber',
		description: 'Theme_paper_sky_tint_description',
	},
	{
		id: 'paper-sky-rose',
		title: 'Theme_paper_sky_rose',
		description: 'Theme_paper_sky_tint_description',
	},
	{
		id: 'paper-sky-graphite',
		title: 'Theme_paper_sky_graphite',
		description: 'Theme_paper_sky_tint_description',
	},
];
