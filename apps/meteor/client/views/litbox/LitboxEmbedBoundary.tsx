import { Box, Button, Callout } from '@rocket.chat/fuselage';
import { QueryErrorResetBoundary } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { useTranslation } from 'react-i18next';

type LitboxEmbedBoundaryProps = {
	children: ReactNode;
};

/**
 * LitboxEmbedBoundary — a local error boundary around the embedded LitBox file
 * browser (`LitboxEmbed`, wherever it is mounted: the `/litbox` Files rail and
 * the board card's MatterFilesModal).
 *
 * `LitboxEmbed` lazily loads the heavy, private `@omnisaiorg/litbox-file-browser`
 * package and talks to the `/_litbox` proxy. Any failure in that path — the lazy
 * chunk failing to load, the package being absent from a build, the proxy/token
 * erroring, or the browser component throwing — used to bubble straight to the
 * app-root OutermostErrorBoundary and white-screen the ENTIRE MatterChat client.
 * (Same class of bug the board card panels already guard against with
 * CardErrorBoundary.)
 *
 * Wrapping the embed here contains the blast radius to the file-browser area: the
 * page/modal chrome, the board, and the rest of the app keep working, and the
 * user gets an inline "couldn't load" callout with a retry instead of a crash.
 *
 * `QueryErrorResetBoundary` resets react-query error state on retry so a failed
 * query inside the embed refetches instead of instantly re-throwing.
 */
const LitboxEmbedBoundary = ({ children }: LitboxEmbedBoundaryProps): ReactElement => {
	const { t } = useTranslation();

	return (
		<QueryErrorResetBoundary>
			{({ reset }) => (
				<ErrorBoundary
					onError={(error, info): void => console.error('LitBox file browser crashed:', error, info)}
					onReset={reset}
					fallbackRender={({ error, resetErrorBoundary }) => (
						<Callout
							type='warning'
							icon='warning'
							title={t('Boards_Litbox_Embed_Failed', { defaultValue: 'The file browser could not be loaded' })}
						>
							<Box mbe={8} fontScale='c1'>
								{error instanceof Error ? error.message : String(error)}
							</Box>
							<Button small onClick={(): void => resetErrorBoundary()}>
								{t('Retry')}
							</Button>
						</Callout>
					)}
				>
					{children}
				</ErrorBoundary>
			)}
		</QueryErrorResetBoundary>
	);
};

export default LitboxEmbedBoundary;
