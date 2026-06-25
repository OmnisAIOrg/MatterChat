import type { ExternalProvider } from '@rocket.chat/core-typings';
import type { ReactElement } from 'react';

/**
 * Provider-agnostic branding for the external-workspace tiles + workspace view.
 *
 * The rail tile, the workspace sidebar header and the channel-view chip all read their colour, mark
 * and default label from HERE keyed by the connection's `provider`, so adding a provider (Google
 * Chat alongside Teams) is data, not new branches scattered across components. Every consumer falls
 * back to `EXTERNAL_PROVIDER_FALLBACK` for an unknown provider so a future provider can never crash a
 * render — it just shows a neutral tile.
 *
 * Clean-room: marks are simple inline SVGs (never the vendors' trademarked logo files).
 */

export type ExternalProviderBranding = {
	/** Solid tile/header colour. */
	color: string;
	/** Short default label when the connection has no `externalOrgName`. */
	defaultName: string;
	/** The provider mark, rendered at the given pixel size. Never recoloured. */
	Mark: (props: { size: number }) => ReactElement;
};

const TEAMS_PURPLE = '#4B53BC';
const GOOGLE_CHAT_GREEN = '#00897B';

// The Microsoft Teams mark (on the purple tile). Rendered, never recoloured.
const TeamsMark = ({ size }: { size: number }): ReactElement => (
	<svg width={size} height={size} viewBox='0 0 24 24' aria-hidden focusable='false'>
		<rect x='2' y='5' width='12' height='14' rx='2' fill='#ffffff' opacity='0.95' />
		<text x='8' y='15' fontSize='9' fontWeight='700' textAnchor='middle' fill={TEAMS_PURPLE} fontFamily='Arial, sans-serif'>
			T
		</text>
		<circle cx='18' cy='8' r='3.4' fill='#ffffff' opacity='0.95' />
		<rect x='14.4' y='10.5' width='7.2' height='8' rx='2' fill='#ffffff' opacity='0.75' />
	</svg>
);

// A Google Chat-style speech-bubble mark (clean-room: the rounded chat bubble, not Google's logo).
const GoogleChatMark = ({ size }: { size: number }): ReactElement => (
	<svg width={size} height={size} viewBox='0 0 24 24' aria-hidden focusable='false'>
		<path
			d='M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H10l-4.4 3.3A.6.6 0 0 1 5 19.8V17a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z'
			fill='#ffffff'
			opacity='0.95'
		/>
		<circle cx='9' cy='10.5' r='1.4' fill={GOOGLE_CHAT_GREEN} />
		<circle cx='13' cy='10.5' r='1.4' fill={GOOGLE_CHAT_GREEN} />
		<circle cx='17' cy='10.5' r='1.4' fill={GOOGLE_CHAT_GREEN} />
	</svg>
);

const TEAMS_BRANDING: ExternalProviderBranding = {
	color: TEAMS_PURPLE,
	defaultName: 'Microsoft Teams',
	Mark: TeamsMark,
};

const GOOGLE_BRANDING: ExternalProviderBranding = {
	color: GOOGLE_CHAT_GREEN,
	defaultName: 'Google Chat',
	Mark: GoogleChatMark,
};

/** Neutral fallback so an unknown/future provider renders a plain tile instead of crashing. */
export const EXTERNAL_PROVIDER_FALLBACK: ExternalProviderBranding = {
	color: '#3a3d44',
	defaultName: 'Workspace',
	Mark: ({ size }: { size: number }): ReactElement => (
		<svg width={size} height={size} viewBox='0 0 24 24' aria-hidden focusable='false'>
			<rect x='4' y='5' width='16' height='12' rx='2' fill='#ffffff' opacity='0.9' />
		</svg>
	),
};

const BRANDING_BY_PROVIDER: Partial<Record<ExternalProvider, ExternalProviderBranding>> = {
	teams: TEAMS_BRANDING,
	google: GOOGLE_BRANDING,
};

/** Branding for a provider, falling back to a neutral tile for anything unmapped. */
export const externalProviderBranding = (provider: ExternalProvider | string | undefined): ExternalProviderBranding =>
	(provider && BRANDING_BY_PROVIDER[provider as ExternalProvider]) || EXTERNAL_PROVIDER_FALLBACK;
