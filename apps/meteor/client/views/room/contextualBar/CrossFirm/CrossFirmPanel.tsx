import {
	ContextualbarDialog,
	ContextualbarHeader,
	ContextualbarIcon,
	ContextualbarTitle,
	ContextualbarClose,
	ContextualbarContent,
} from '@rocket.chat/ui-client';
import type { ComponentProps } from 'react';

import CrossFirmSection from '../../../cross-firm/CrossFirmSection';

type CrossFirmPanelProps = { rid: string; onClose: () => void };

const CrossFirmPanel = ({ rid, onClose }: CrossFirmPanelProps) => (
	<ContextualbarDialog>
		<ContextualbarHeader>
			<ContextualbarIcon name={'balance' as ComponentProps<typeof ContextualbarIcon>['name']} />
			<ContextualbarTitle>Cross-firm · Opposing counsel</ContextualbarTitle>
			<ContextualbarClose onClick={onClose} />
		</ContextualbarHeader>
		<ContextualbarContent padding={0}>
			<CrossFirmSection rid={rid} />
		</ContextualbarContent>
	</ContextualbarDialog>
);

export default CrossFirmPanel;
