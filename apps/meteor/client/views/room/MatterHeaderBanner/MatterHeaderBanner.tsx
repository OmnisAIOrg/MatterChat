import type { IRoom } from '@rocket.chat/core-typings';
import { QueryErrorResetBoundary } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { ErrorBoundary } from 'react-error-boundary';

import MatterHeaderBannerContent from './MatterHeaderBannerContent';

type MatterHeaderBannerProps = {
	room: Pick<IRoom, '_id' | 'name' | 'fname' | 'matterId' | 'matterCardId'>;
};

/**
 * MatterHeaderBanner — a compact matter-context strip at the top of the message
 * body on matter-linked channels (rooms carrying `matterId`).
 *
 * FORK-OWNED and self-contained: this component holds ALL the logic; the ONLY
 * core touch is a single gated mount line in RoomBody.tsx (search `MATTERCHAT:`),
 * which keeps this — the biggest RoomBody merge-risk in the wave — off the core
 * diff except for one line.
 *
 * This wrapper is deliberately just an error boundary around the real content
 * (MatterHeaderBannerContent) so a snapshot fetch or render failure can NEVER
 * white-screen the room: on any throw the fallback renders nothing and the room
 * keeps working, while QueryErrorResetBoundary resets react-query error state so
 * a transient snapshot failure can recover on the next render. Mirrors boards'
 * CardErrorBoundary, but with a silent (null) fallback — a banner has no business
 * showing an error callout above the conversation.
 */
const MatterHeaderBanner = ({ room }: MatterHeaderBannerProps): ReactElement => (
	<QueryErrorResetBoundary>
		{({ reset }): ReactElement => (
			<ErrorBoundary
				onReset={reset}
				onError={(error, info): void => console.error('MatterHeaderBanner crashed:', error, info)}
				fallbackRender={(): null => null}
			>
				<MatterHeaderBannerContent room={room} />
			</ErrorBoundary>
		)}
	</QueryErrorResetBoundary>
);

export default MatterHeaderBanner;
