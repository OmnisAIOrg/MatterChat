import type { IStats } from '@rocket.chat/core-typings';
import { Box } from '@rocket.chat/fuselage';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

type PremiumUsersCardProps = {
	statistics: IStats;
};

const getUserDotColor = (status: string): string => {
	switch (status) {
		case 'online':
			return '#3FBC7C';
		case 'busy':
			return 'var(--red)';
		case 'away':
			return 'var(--amber)';
		case 'offline':
		default:
			return 'var(--border2)';
	}
};

const PremiumUsersCard = ({ statistics }: PremiumUsersCardProps) => {
	const { t } = useTranslation();

	const userRows = [
		[t('Online'), statistics.onlineUsers, 'online'],
		[t('Busy'), statistics.busyUsers, 'busy'],
		[t('Away'), statistics.awayUsers, 'away'],
		[t('Offline'), statistics.offlineUsers, 'offline'],
	] as const;

	return (
		<Box
			backgroundColor='var(--surface)'
			borderRadius='14px'
			border='1px solid var(--border)'
			boxShadow='var(--shadow1)'
			padding='18px 20px'
			display='flex'
			flexDirection='column'
			gap='0'
		>
			<Box fontSize='14px' fontWeight='650' color='var(--ink)' marginBlockEnd='10px'>
				{t('Users')}
			</Box>

			<Box display='flex' flexDirection='column' gap='0'>
				{userRows.map(([label, value, status], idx) => (
					<Box
						key={idx}
						display='flex'
						alignItems='center'
						gap='9px'
						padding='7px 0'
						borderBottomWidth={idx < userRows.length - 1 ? '1px' : '0'}
						borderBottomColor='var(--border)'
					>
						<Box width='8px' height='8px' borderRadius='9999px' backgroundColor={getUserDotColor(status as string)} />
						<Box flex='1' fontSize='12.5px' color='var(--ink2)'>
							{label}
						</Box>
						<Box fontSize='12.5px' fontWeight='600' color='var(--ink)' fontVariantNumeric='tabular-nums'>
							{value}
						</Box>
					</Box>
				))}
				<Box display='flex' alignItems='center' gap='9px' padding='9px 0 0'>
					<Box flex='1' fontSize='12.5px' fontWeight='650' color='var(--ink)'>
						{t('Total')}
					</Box>
					<Box fontSize='13px' fontWeight='650' color='var(--ink)' fontVariantNumeric='tabular-nums'>
						{statistics.totalUsers}
					</Box>
				</Box>
			</Box>
		</Box>
	);
};

export default memo(PremiumUsersCard);
