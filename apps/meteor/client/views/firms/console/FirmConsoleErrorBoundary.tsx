import { Box, Button, Callout } from '@rocket.chat/fuselage';
import { QueryErrorResetBoundary } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { useTranslation } from 'react-i18next';

type FirmConsoleErrorBoundaryProps = {
	children: ReactNode;
};

/**
 * MATTERCHAT: a per-section error boundary for the Firm Console.
 *
 * The console is the one screen a firm owner is told to use INSTEAD of the
 * admin area, so it is also the screen they are most likely to be sitting on
 * when something goes wrong. Each section (members, invites, domains, QR) is
 * wrapped individually: a render-time bug in the domains list must not take the
 * invite links down with it, and must never reach the app-root boundary and
 * replace the whole client with the full-screen error page.
 *
 * Modelled on `views/boards/card/CardErrorBoundary.tsx`; `QueryErrorResetBoundary`
 * clears react-query error state on retry so a failed list refetches instead of
 * instantly re-throwing.
 */
const FirmConsoleErrorBoundary = ({ children }: FirmConsoleErrorBoundaryProps): ReactElement => {
	const { t } = useTranslation();

	return (
		<QueryErrorResetBoundary>
			{({ reset }) => (
				<ErrorBoundary
					onError={(error, info): void => console.error('Firm console section crashed:', error, info)}
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

export default FirmConsoleErrorBoundary;
