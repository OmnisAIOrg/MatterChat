import type { IStats } from '@rocket.chat/core-typings';
import { Box } from '@rocket.chat/fuselage';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

type PremiumRoomsCardProps = {
	statistics: IStats;
};

const PremiumRoomsCard = ({ statistics }: PremiumRoomsCardProps) => {
	const { t } = useTranslation();

	const roomRows = [
		[t('Channels'), statistics.channelsCount],
		[t('Private_groups'), statistics.privateGroupsCount],
		[t('Direct_messages'), statistics.directMessagesCount],
		[t('Discussions'), statistics.discussionsCount],
		[t('Omnichannel'), statistics.omniChannelCount],
	] as const;

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
			<Box fontSize='14px' fontWeight='650' color='var(--ink)' marginBlockEnd='10px'>
				{t('Total_rooms')}
			</Box>

			<Box display='flex' flexDirection='column' gap='0'>
				{roomRows.map(([label, value], idx) => (
					<Box
						key={idx}
						display='flex'
						alignItems='center'
						gap='9px'
						padding='7px 0'
						borderBottomWidth={idx < roomRows.length - 1 ? '1px' : '0'}
						borderBottomColor='var(--border)'
					>
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
						{statistics.channelsCount + statistics.privateGroupsCount + statistics.directMessagesCount + statistics.discussionsCount + statistics.omniChannelCount}
					</Box>
				</Box>
			</Box>
		</Box>
	);
};

export default memo(PremiumRoomsCard);
