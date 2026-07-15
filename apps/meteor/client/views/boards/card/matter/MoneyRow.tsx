import { Box } from '@rocket.chat/fuselage';
import type { ReactElement } from 'react';

type MoneyRowProps = {
	label: string;
	value?: string;
	/** Bold + success color — used for the settlement line. */
	emphasis?: boolean;
};

/** A currency row for the financial summary card: label left, tabular-numeral amount right. Empty values render nothing. */
const MoneyRow = ({ label, value, emphasis }: MoneyRowProps): ReactElement | null => {
	if (!value) {
		return null;
	}
	return (
		<Box display='flex' justifyContent='space-between' alignItems='baseline' mbe={4} style={{ gap: '12px' }}>
			<Box fontScale='c1' color='hint' style={{ flexShrink: 0 }}>
				{label}
			</Box>
			<Box
				fontScale={emphasis ? 'p2b' : 'p2'}
				color={emphasis ? 'status-font-on-success' : 'default'}
				style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
			>
				{value}
			</Box>
		</Box>
	);
};

export default MoneyRow;
