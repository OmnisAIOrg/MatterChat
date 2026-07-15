import { Box, Icon } from '@rocket.chat/fuselage';
import type { ComponentProps, ReactElement, ReactNode } from 'react';

type MatterSectionProps = {
	title: string;
	icon?: ComponentProps<typeof Icon>['name'];
	/** Optional right-aligned action (e.g. an "Add" button) rendered on the title row. */
	action?: ReactNode;
	children: ReactNode;
};

/** Uniform section shell for the Matter Workspace: icon + title row (+ optional action) above the body. */
const MatterSection = ({ title, icon, action, children }: MatterSectionProps): ReactElement => (
	<Box mbs={20}>
		<Box display='flex' alignItems='center' justifyContent='space-between' mbe={8}>
			<Box display='flex' alignItems='center'>
				{icon && <Icon name={icon} size='x16' mie={6} color='hint' />}
				<Box fontScale='p2b' color='default'>
					{title}
				</Box>
			</Box>
			{action}
		</Box>
		{children}
	</Box>
);

export default MatterSection;
