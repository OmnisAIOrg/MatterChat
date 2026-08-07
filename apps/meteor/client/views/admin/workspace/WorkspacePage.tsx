import type { IWorkspaceInfo, IStats } from '@rocket.chat/core-typings';
import { Box, Button, ButtonGroup } from '@rocket.chat/fuselage';
import type { IInstance } from '@rocket.chat/rest-typings';
import { Page, PageHeader, PageScrollableContentWithShadow } from '@rocket.chat/ui-client';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import PremiumDeploymentCard from './DeploymentCard/PremiumDeploymentCard';
import PremiumRoomsCard from './MessagesRoomsCard/PremiumRoomsCard';
import PremiumUsersCard from './UsersUploadsCard/PremiumUsersCard';
import PremiumVersionCard from './PremiumVersionCard/PremiumVersionCard';

type WorkspaceStatusPageProps = {
	canViewStatistics: boolean;
	serverInfo: IWorkspaceInfo;
	statistics: IStats;
	statisticsIsLoading: boolean;
	instances: IInstance[];
	onClickRefreshButton: () => void;
	onClickDownloadInfo: () => void;
};

const WorkspacePage = ({
	canViewStatistics,
	serverInfo,
	statistics,
	statisticsIsLoading,
	instances,
	onClickRefreshButton,
	onClickDownloadInfo,
}: WorkspaceStatusPageProps) => {
	const { t } = useTranslation();

	return (
		<Page background='tint'>
			<PageHeader title={t('Workspace')}>
				{canViewStatistics && (
					<ButtonGroup>
						<Button onClick={onClickDownloadInfo}>{t('Download_Info')}</Button>
						<Button onClick={onClickRefreshButton} loading={statisticsIsLoading}>
							{t('Refresh')}
						</Button>
					</ButtonGroup>
				)}
			</PageHeader>

			<PageScrollableContentWithShadow padding={16}>
				<Box marginBlock='none' marginInline='auto' width='full' maxWidth='1000px' color='default'>
					{/* Premium Version Card - Hero */}
					<PremiumVersionCard serverInfo={serverInfo} />

					{/* Three-card grid */}
					<Box
						display='grid'
						gridTemplateColumns='1.2fr 1fr 1fr'
						gap='16px'
					>
						<PremiumDeploymentCard serverInfo={serverInfo} statistics={statistics} instances={instances} />
						<PremiumUsersCard statistics={statistics} />
						<PremiumRoomsCard statistics={statistics} />
					</Box>
				</Box>
			</PageScrollableContentWithShadow>
		</Page>
	);
};

export default memo(WorkspacePage);
