import { Box, Skeleton, Tag } from '@rocket.chat/fuselage';
import type { FirmInfoDTO } from '@rocket.chat/rest-typings';
import { useEndpoint } from '@rocket.chat/ui-contexts';
import { useQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { firmRoomQueryKey, firmTemplatesQueryKey } from './firmConsole';

type FirmProfileSectionProps = {
	firm: FirmInfoDTO;
};

/**
 * MATTERCHAT: the "what is this firm" block — its name and the practice areas
 * it was set up with.
 *
 * ## Why this is read-only
 *
 * There is no `firms.update` endpoint. Practice areas are recorded at creation
 * on the firm team's main room (`customFields.firmPracticeAreas`, written by
 * `createFirm`) and used once, to decide which starter channels to seed —
 * changing them later would not retroactively create or delete those channels,
 * so a writable control here would promise something it cannot deliver.
 * Renaming the firm is a team rename, which already has a home in the team's
 * own admin panel.
 *
 * So this block answers "what am I looking at" and stops there. Inventing a
 * server endpoint was out of scope for a client-only slice.
 *
 * ## Why two queries
 *
 * `firms.mine` returns the name but not the practice areas, and the areas are
 * stored as ids. `rooms.info` on the firm's own room yields those ids (any firm
 * member can read their own team's room) and `firms.templates` turns them into
 * the labels the owner actually picked. If the labels fail to load we render
 * the raw ids rather than nothing — an id still tells you the area is set.
 */
const FirmProfileSection = ({ firm }: FirmProfileSectionProps): ReactElement => {
	const { t } = useTranslation();

	const getRoomInfo = useEndpoint('GET', '/v1/rooms.info');
	const getTemplates = useEndpoint('GET', '/v1/firms.templates');

	const roomQuery = useQuery({
		queryKey: firmRoomQueryKey(firm.roomId),
		queryFn: () => getRoomInfo({ roomId: firm.roomId }),
		staleTime: 60_000,
	});

	const templatesQuery = useQuery({
		queryKey: firmTemplatesQueryKey,
		queryFn: () => getTemplates(),
		staleTime: 60_000,
	});

	const rawAreas = roomQuery.data?.room?.customFields?.firmPracticeAreas;
	const areaIds: string[] = Array.isArray(rawAreas) ? rawAreas.filter((id): id is string => typeof id === 'string') : [];

	const labelFor = (id: string): string => templatesQuery.data?.practiceAreas.find((area) => area.id === id)?.label ?? id;

	return (
		<>
			<Box display='flex' flexDirection='column' marginBlockEnd={16}>
				<Box fontScale='c1' color='hint'>
					{t('Firm_name')}
				</Box>
				<Box fontScale='p2m' color='default'>
					{firm.name}
				</Box>
			</Box>

			<Box display='flex' flexDirection='column'>
				<Box fontScale='c1' color='hint' marginBlockEnd={4}>
					{t('Firm_Practice_Areas')}
				</Box>
				{roomQuery.isLoading && <Skeleton width='x180' />}
				{roomQuery.isError && (
					<Box fontScale='p2' color='hint'>
						{t('Firm_Practice_Areas_Unavailable')}
					</Box>
				)}
				{roomQuery.isSuccess && areaIds.length === 0 && (
					<Box fontScale='p2' color='hint'>
						{t('Firm_Practice_Areas_None')}
					</Box>
				)}
				{areaIds.length > 0 && (
					<Box display='flex' flexWrap='wrap' role='list'>
						{areaIds.map((id) => (
							<Box key={id} role='listitem' marginInlineEnd={4} marginBlockEnd={4}>
								<Tag>{labelFor(id)}</Tag>
							</Box>
						))}
					</Box>
				)}
				<Box fontScale='c1' color='hint' marginBlockStart={8}>
					{t('Firm_Practice_Areas_Hint')}
				</Box>
			</Box>
		</>
	);
};

export default FirmProfileSection;
