import { Box, Icon } from '@rocket.chat/fuselage';
import type { ComponentProps, ReactElement, ReactNode } from 'react';

import { LEDGER_LABEL_STYLE } from '../../lib/ledger';

type MatterSectionProps = {
	title: string;
	icon?: ComponentProps<typeof Icon>['name'];
	/** Optional right-aligned action (e.g. an "Add" button) rendered on the title row. */
	action?: ReactNode;
	children: ReactNode;
};

/**
 * Uniform section shell for the Matter Workspace: icon + title row (+ optional action)
 * above the body. Ledger-dense: compact small-caps section heads + tighter spacing.
 */
const MatterSection = ({ title, icon, action, children }: MatterSectionProps): ReactElement => (
	<Box marginBlockStart={14}>
		<Box display='flex' alignItems='center' justifyContent='space-between' marginBlockEnd={6}>
			<Box display='flex' alignItems='center'>
				{icon && <Icon name={icon} size='x16' marginInlineEnd={6} color='hint' />}
				<Box fontScale='p2b' color='default' style={LEDGER_LABEL_STYLE}>
					{title}
				</Box>
			</Box>
			{action}
		</Box>
		{children}
	</Box>
);

export default MatterSection;
