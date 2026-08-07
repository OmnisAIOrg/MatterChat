import { Box, Button, Icon, Tag } from '@rocket.chat/fuselage';
import type { Keys as IconName } from '@rocket.chat/icons';
import type { ReactElement } from 'react';

/**
 * One row of a widget feed. Identical anatomy in all four products, so a user
 * reads the second widget they meet without being taught:
 *
 *   icon · primary line (filename / document / meeting)
 *          secondary line (matter, size, who, when)
 *          status chip · one action button
 *
 * Exactly ONE action per row. A row is a glance-and-act surface; anything that
 * needs a choice belongs in the product's panel, not here.
 */

export type OmnisRowStatus = {
	label: string;
	variant?: 'primary' | 'secondary' | 'danger' | 'featured';
};

export type OmnisWidgetRowProps = {
	icon: IconName;
	primary: string;
	secondary: string;
	status: OmnisRowStatus;
	action?: { label: string; onClick(): void; disabled?: boolean };
	onClick?(): void;
};

const OmnisWidgetRow = ({ icon, primary, secondary, status, action, onClick }: OmnisWidgetRowProps): ReactElement => (
	<Box
		display='flex'
		alignItems='center'
		paddingInline={16}
		paddingBlock={10}
		style={{
			gap: 10,
			borderBottom: '1px solid var(--rcx-color-stroke-extra-light, #eee)',
			cursor: onClick ? 'pointer' : 'default',
		}}
		onClick={onClick}
	>
		<Icon name={icon} size={20} color='annotation' />

		<Box flexGrow={1} style={{ minWidth: 0 }}>
			<Box fontScale='p2' withTruncatedText>
				{primary}
			</Box>
			<Box fontScale='micro' color='annotation' withTruncatedText>
				{secondary}
			</Box>
		</Box>

		<Box display='flex' alignItems='center' style={{ gap: 6, flexShrink: 0 }}>
			<Tag {...(status.variant ? { variant: status.variant } : {})}>{status.label}</Tag>
			{action && (
				<Button
					tiny
					disabled={action.disabled}
					onClick={(event) => {
						event.stopPropagation();
						action.onClick();
					}}
				>
					{action.label}
				</Button>
			)}
		</Box>
	</Box>
);

export default OmnisWidgetRow;
