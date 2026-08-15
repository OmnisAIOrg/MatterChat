import { Box } from '@rocket.chat/fuselage';
import type { ReactElement, ReactNode } from 'react';

import FirmConsoleErrorBoundary from './FirmConsoleErrorBoundary';

type FirmConsoleSectionProps = {
	title: string;
	description?: string;
	children: ReactNode;
};

/**
 * MATTERCHAT: one titled block of the Firm Console.
 *
 * Deliberately a plain heading + description + body rather than an Accordion.
 * The whole point of this screen is that an office manager can SEE what their
 * firm is set up with in one scroll; collapsing every section behind a chevron
 * would reproduce the thing that makes the admin area intimidating — settings
 * you have to go hunting for.
 *
 * Every section carries its own error boundary, so one broken list is a broken
 * list and not a broken screen.
 */
const FirmConsoleSection = ({ title, description, children }: FirmConsoleSectionProps): ReactElement => (
	<Box is='section' marginBlockEnd={32}>
		<Box is='h2' fontScale='h4' color='default' marginBlockEnd={description ? 4 : 12}>
			{title}
		</Box>
		{description && (
			<Box fontScale='c1' color='hint' marginBlockEnd={12}>
				{description}
			</Box>
		)}
		<FirmConsoleErrorBoundary>{children}</FirmConsoleErrorBoundary>
	</Box>
);

export default FirmConsoleSection;
