import type { IBoardCard, IMatterSnapshot, Serialized } from '@rocket.chat/core-typings';
import { Box, Button, Chip, Icon, Tag, Throbber } from '@rocket.chat/fuselage';
import { useSetting } from '@rocket.chat/ui-contexts';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { fmtDate } from './matterFormatters';
import { useMatterChannel } from './useMatterChannel';
import { CaseProStatusChip } from '../../casepro';

type MatterHeaderProps = {
	matterId: string;
	/** Falls back as the display name when the snapshot has no matterName. */
	cardTitle?: string;
	snapshot?: Serialized<IMatterSnapshot>;
	link: Serialized<IBoardCard>['link'];
	/** snapshot.stale, an old fetchedAt, or a cached-fallback render. */
	showStale: boolean;
	isRefreshing: boolean;
	onRefresh: () => void;
};

/**
 * Matter header — who/where/how-fresh in one block:
 *  - "Linked Matter" eyebrow with the CasePro connection chip and a Refresh
 *    action (re-reads the CasePro snapshot; holders of `boards-casepro-sync`
 *    also rewrite the card's cached copy — wired by the panel);
 *  - matter name + `#matter-number · client` subtitle;
 *  - stage/sub-stage chips, practice-area tag, and a stale-snapshot warning tag;
 *  - action row: "Open in CasePro" (admin-configured CasePro_Web_URL; hidden
 *    when unset rather than rendered as a dead link) and "Jump to channel"
 *    (only when a channel is linked — linking itself lives in ChannelSection);
 *  - "Updated …" freshness caption.
 */
const MatterHeader = ({ matterId, cardTitle, snapshot, link, showStale, isRefreshing, onRefresh }: MatterHeaderProps): ReactElement => {
	const { t } = useTranslation();
	const caseProWebUrl = useSetting('CasePro_Web_URL', '');

	// "Open in CasePro" resolves against the admin-configured CasePro_Web_URL
	// (the human web app, not the MCP gateway) — when it is not configured the
	// button is HIDDEN rather than rendered as a dead href.
	const caseProWebBase = (typeof caseProWebUrl === 'string' ? caseProWebUrl : '').trim().replace(/\/+$/, '');
	const caseProHref = caseProWebBase ? `${caseProWebBase}/matters/${matterId}` : undefined;

	const { roomId, canJump, jumpToChannel } = useMatterChannel(link);

	const displayName = snapshot?.matterName || cardTitle;
	const subtitleParts = [snapshot?.matterNumber ? `#${snapshot.matterNumber}` : undefined, snapshot?.clientName].filter(Boolean);
	const updatedLabel = fmtDate(snapshot?.fetchedAt);

	return (
		<Box>
			{/* Eyebrow: panel label + CasePro connection + Refresh */}
			<Box display='flex' alignItems='center' justifyContent='space-between' mbe={8}>
				<Box display='flex' alignItems='center'>
					<Icon name='bag' size='x16' mie={6} color='hint' />
					<Box fontScale='c1' color='hint'>
						{t('Boards_Matters_Linked_Matter', { defaultValue: 'Linked Matter' })}
					</Box>
					<CaseProStatusChip mis={8} />
				</Box>
				<Button small square title={t('Refresh')} disabled={isRefreshing} onClick={onRefresh}>
					{isRefreshing ? <Throbber inheritColor size='x12' /> : <Icon name='reload' size='x16' />}
				</Button>
			</Box>

			{/* Identity */}
			{displayName && (
				<Box fontScale='h4' color='default' withTruncatedText mbe={2}>
					{displayName}
				</Box>
			)}
			{subtitleParts.length > 0 && (
				<Box fontScale='c1' color='hint' mbe={8} withTruncatedText>
					{subtitleParts.join(' · ')}
				</Box>
			)}

			{/* Stage / practice / freshness chips */}
			{(snapshot?.stageName || snapshot?.subStageName || snapshot?.practiceArea || showStale) && (
				<Box display='flex' flexWrap='wrap' alignItems='center' mbe={8} style={{ gap: '6px' }}>
					{snapshot?.stageName && <Chip>{snapshot.stageName}</Chip>}
					{snapshot?.subStageName && <Chip>{snapshot.subStageName}</Chip>}
					{snapshot?.practiceArea && <Tag variant='secondary-info'>{snapshot.practiceArea}</Tag>}
					{showStale && (
						<Tag
							variant='secondary-warning'
							medium
							title={t('Boards_Matters_Stale_Hint', { defaultValue: 'This CasePro snapshot may be out of date — refresh to re-read it.' })}
						>
							<Icon name='warning' size='x12' mie={2} />
							{t('Boards_Matters_Stale', { defaultValue: 'Stale' })}
						</Tag>
					)}
				</Box>
			)}

			{/* Actions */}
			{(caseProHref || roomId) && (
				<Box display='flex' flexWrap='wrap' mbe={4} style={{ gap: '8px' }}>
					{caseProHref && (
						<Button small is='a' href={caseProHref} target='_blank' rel='noopener noreferrer'>
							<Icon name='new-window' size='x16' mie={4} />
							{t('Boards_Matters_Open_In_CasePro', { defaultValue: 'Open in CasePro' })}
						</Button>
					)}
					{roomId && (
						<Button small onClick={jumpToChannel} disabled={!canJump}>
							<Icon name='arrow-jump' size='x16' mie={4} />
							{t('Boards_Matters_Jump_To_Channel', { defaultValue: 'Jump to channel' })}
						</Button>
					)}
				</Box>
			)}

			{/* Freshness caption */}
			{updatedLabel && (
				<Box fontScale='micro' color='hint' mbe={4}>
					{t('Boards_Matters_Fetched_At', { date: updatedLabel, defaultValue: 'Updated {{date}}' })}
				</Box>
			)}
		</Box>
	);
};

export default MatterHeader;
