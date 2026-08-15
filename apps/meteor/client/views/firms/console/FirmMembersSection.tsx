import { Box, Callout, Skeleton, Tag } from '@rocket.chat/fuselage';
import type { FirmInfoDTO } from '@rocket.chat/rest-typings';
import { useEndpoint } from '@rocket.chat/ui-contexts';
import { useQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { firmMembersQueryKey } from './firmConsole';

type FirmMembersSectionProps = {
	firm: FirmInfoDTO;
};

/**
 * MATTERCHAT: the firm roster.
 *
 * ## Where the data comes from, and why
 *
 * There is no `firms.members` endpoint, and this slice is client-only, so one
 * was not invented. It is not needed: a firm IS a private team (`createFirm`
 * builds one and stores its `_id` as the firm id), and `teams.members` is
 * already reachable by any team member — `Team.members()` returns an empty set
 * to a caller who is neither a member nor holder of `view-all-teams`, rather
 * than throwing. So the roster is a `teams.members` read keyed on the firm id,
 * and it works for owners and ordinary members alike.
 *
 * The roles shown are TEAM roles (owner / member) as recorded on the team
 * membership — not workspace roles. That is the right unit here: the question
 * this screen answers is "who is in my firm and who can administer it", not
 * "who is a workspace admin".
 *
 * ## Honest limits
 *
 * - The roster shows the endpoint's first page (the server's default, 50
 *   people) and says so when there are more. Paging a roster is a directory
 *   problem and the directory already solves it; a second half-paginator here
 *   would be the worse of the two. `teams.members` also takes no page-size
 *   argument in its typed params, so the default is what the client can ask
 *   for without a server change.
 * - Pending invitees do not appear — they are not members until they redeem a
 *   link. The invite section above shows how many uses each link has left,
 *   which is the closest honest answer to "who is on the way in".
 */
const FirmMembersSection = ({ firm }: FirmMembersSectionProps): ReactElement => {
	const { t } = useTranslation();

	const getMembers = useEndpoint('GET', '/v1/teams.members');

	const { data, isLoading, isError, error } = useQuery({
		queryKey: firmMembersQueryKey(firm.firmId),
		queryFn: () => getMembers({ teamId: firm.firmId }),
	});

	if (isLoading) {
		return (
			<Box display='flex' flexDirection='column'>
				<Skeleton width='full' />
				<Skeleton width='full' />
				<Skeleton width='full' />
			</Box>
		);
	}

	if (isError) {
		return (
			<Callout type='danger' icon='warning' title={t('Firm_Members_Load_Failed')}>
				{error instanceof Error ? error.message : String(error)}
			</Callout>
		);
	}

	const members = data?.members ?? [];

	if (members.length === 0) {
		return (
			<Box fontScale='p2' color='hint'>
				{t('Firm_Members_Empty')}
			</Box>
		);
	}

	return (
		<>
			<Box is='ul' role='list' display='flex' flexDirection='column' style={{ listStyle: 'none', margin: 0, padding: 0 }}>
				{members.map((member) => {
					const isOwner = member.roles?.includes('owner');
					return (
						<Box key={member.user._id} is='li' display='flex' alignItems='center' justifyContent='space-between' paddingBlock={8}>
							<Box display='flex' flexDirection='column' minWidth={0}>
								<Box fontScale='p2m' color='default' withTruncatedText>
									{member.user.name || member.user.username}
								</Box>
								{member.user.name && member.user.username && (
									<Box fontScale='c1' color='hint' withTruncatedText>
										{`@${member.user.username}`}
									</Box>
								)}
							</Box>
							<Box flexShrink={0} marginInlineStart={8}>
								<Tag variant={isOwner ? 'primary' : 'secondary'}>{isOwner ? t('Owner') : t('Firm_Member_Role_member')}</Tag>
							</Box>
						</Box>
					);
				})}
			</Box>
			{(data?.total ?? 0) > members.length && (
				<Box fontScale='c1' color='hint' marginBlockStart={8}>
					{t('Firm_Members_Truncated', { shown: members.length, total: data?.total ?? members.length })}
				</Box>
			)}
		</>
	);
};

export default FirmMembersSection;
