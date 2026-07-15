import { Box } from '@rocket.chat/fuselage';
import type { ReactElement, ReactNode } from 'react';

type MatterFieldProps = {
	label: string;
	children?: ReactNode;
};

/** A label/value row; renders nothing when the value is empty (the snapshot's fields are all optional). */
const MatterField = ({ label, children }: MatterFieldProps): ReactElement | null => {
	if (children === undefined || children === null || children === '') {
		return null;
	}
	return (
		<Box display='flex' justifyContent='space-between' alignItems='flex-start' mbe={6} style={{ gap: '12px' }}>
			<Box fontScale='c1' color='hint' style={{ flexShrink: 0 }}>
				{label}
			</Box>
			<Box fontScale='p2' color='default' style={{ textAlign: 'right' }}>
				{children}
			</Box>
		</Box>
	);
};

export default MatterField;
