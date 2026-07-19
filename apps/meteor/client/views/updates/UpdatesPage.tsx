/**
 * UpdatesPage — Full page view for Updates/Changelog
 * Mounted at /updates route
 */

import React from 'react';
import { Box, Margins, Skeleton } from '@rocket.chat/fuselage';
import { useUser } from '@rocket.chat/ui-contexts';
import { UpdatesPanel } from './UpdatesPanel';

export const UpdatesPage: React.FC = () => {
	const user = useUser();

	if (!user) {
		return <Skeleton />;
	}

	// Extract workspaceId from user's current workspace
	const workspaceId = user.teamMain || user._id;

	return (
		<Box display="flex" flexDirection="column" height="100%">
			<Margins all="x24">
				<UpdatesPanel workspaceId={workspaceId} />
			</Margins>
		</Box>
	);
};

export default UpdatesPage;
