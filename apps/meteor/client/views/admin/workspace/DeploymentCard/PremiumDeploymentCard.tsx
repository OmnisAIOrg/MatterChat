import type { IWorkspaceInfo, IStats } from '@rocket.chat/core-typings';
import { Box } from '@rocket.chat/fuselage';
import type { IInstance } from '@rocket.chat/rest-typings';
import { useSetModal } from '@rocket.chat/ui-contexts';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import InstancesModal from './components/InstancesModal';

type PremiumDeploymentCardProps = {
	serverInfo: IWorkspaceInfo;
	instances: IInstance[];
	statistics: IStats;
};

const PremiumDeploymentCard = ({ serverInfo: { workspaceUrl, hashedWorkspaceUrl }, statistics }: PremiumDeploymentCardProps) => {
	const { t } = useTranslation();
	const setModal = useSetModal();

	return (
		<Box
			bg='var(--surface)'
			borderRadius='14px'
			border='1px solid var(--border)'
			boxShadow='var(--shadow1)'
			padding='18px 20px'
			display='flex'
			flexDirection='column'
			gap='0'
		>
			<Box fontSize='14px' fontWeight='650' color='var(--ink)' marginBlockEnd='14px'>
				{t('Deployment')}
			</Box>

			<Box display='flex' flexDirection='column' gap='12px'>
				{/* Version */}
				<Box display='flex' flexDirection='column' gap='3px' paddingBlockEnd='8px' borderBottomWidth='1px' borderBottomColor='var(--border)'>
					<Box fontFamily="'Geist Mono',monospace" fontSize='9.5px' letterSpacing='0.12em' color='var(--ink3)'>
						VERSION
					</Box>
					<Box fontSize='13px' color='var(--ink)' fontVariantNumeric='tabular-nums'>
						{statistics.version}
					</Box>
				</Box>

				{/* Site URL */}
				{workspaceUrl && (
					<Box display='flex' flexDirection='column' gap='3px' paddingBlockEnd='8px' borderBottomWidth='1px' borderBottomColor='var(--border)'>
						<Box fontFamily="'Geist Mono',monospace" fontSize='9.5px' letterSpacing='0.12em' color='var(--ink3)'>
							SITE URL
						</Box>
						<Box fontSize='13px' color='var(--ink)' display='flex' alignItems='center' gap='7px'>
							<a href={workspaceUrl} target='_blank' rel='noreferrer' style={{ color: 'var(--green)', textDecoration: 'none' }}>
								{workspaceUrl}
							</a>
							<svg width='11' height='11' viewBox='0 0 24 24' fill='none' stroke='var(--ink3)' strokeWidth='1.8'>
								<rect x='8.5' y='8.5' width='12' height='12' rx='2' />
								<path d='M15.5 5.5v-2h-12v12h2' strokeLinecap='round' />
							</svg>
						</Box>
					</Box>
				)}

				{/* Hashed Site URL */}
				{hashedWorkspaceUrl && (
					<Box display='flex' flexDirection='column' gap='3px'>
						<Box fontFamily="'Geist Mono',monospace" fontSize='9.5px' letterSpacing='0.12em' color='var(--ink3)'>
							HASHED SITE URL
						</Box>
						<Box
							fontFamily="'Geist Mono',monospace"
							fontSize='11px'
							color='var(--ink2)'
							style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
						>
							{hashedWorkspaceUrl}
						</Box>
					</Box>
				)}
			</Box>
		</Box>
	);
};

export default memo(PremiumDeploymentCard);
