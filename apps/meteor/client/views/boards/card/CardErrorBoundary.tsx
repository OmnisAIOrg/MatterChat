import { Box, Button, Callout } from '@rocket.chat/fuselage';
import { QueryErrorResetBoundary } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { useTranslation } from 'react-i18next';

type CardErrorBoundaryProps = {
	children: ReactNode;
};

/**
 * CardErrorBoundary — a local error boundary for the board card detail panels
 * (MatterPanel / LeadPanel and friends).
 *
 * Before this existed, a render-time bug inside a card panel (e.g. the missing
 * `useSetting` import that made every matter-card click throw a ReferenceError)
 * bubbled all the way up to the app-root OutermostErrorBoundary and replaced
 * the ENTIRE client with the full-screen error page. Wrapping each panel here
 * contains the blast radius to the panel itself: the rest of the card detail,
 * the board, and the app keep working, and the user gets an inline retry.
 *
 * `QueryErrorResetBoundary` resets any react-query error state on retry so a
 * failed query inside the panel refetches instead of instantly re-throwing.
 */
const CardErrorBoundary = ({ children }: CardErrorBoundaryProps): ReactElement => {
	const { t } = useTranslation();

	return (
		<QueryErrorResetBoundary>
			{({ reset }) => (
				<ErrorBoundary
					onError={(error, info): void => console.error('Board card panel crashed:', error, info)}
					onReset={reset}
					fallbackRender={({ error, resetErrorBoundary }) => (
						<Callout type='danger' icon='warning' title={t('Something_went_wrong')}>
							<Box marginBlockEnd={8} fontScale='c1'>
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

export default CardErrorBoundary;
