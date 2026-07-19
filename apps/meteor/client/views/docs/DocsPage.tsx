/**
 * DocsPage — Full page view for workspace knowledge base
 * Mounted at /docs route
 */

import React from 'react';
import { Box, Margins, Skeleton } from '@rocket.chat/fuselage';
import { useUser } from '@rocket.chat/ui-contexts';
import { DocsPanel } from './DocsPanel';

export const DocsPage: React.FC = () => {
	const user = useUser();

	if (!user) {
		return <Skeleton />;
	}

	// Extract workspaceId from user's current workspace
	const workspaceId = user.teamMain || user._id;

	return (
		<Box display="flex" flexDirection="column" height="100%">
			<Margins all="x24">
				<DocsPanel workspaceId={workspaceId} />
			</Margins>
		</Box>
	);
};

export default DocsPage;
