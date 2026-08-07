import type { IBoardCard, IMatterSnapshot, Serialized } from '@rocket.chat/core-typings';
import { Box, Button, Chip, Icon, Tag, Throbber } from '@rocket.chat/fuselage';
import { useSetting } from '@rocket.chat/ui-contexts';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { fmtDate } from './matterFormatters';
import { useMatterChannel } from './useMatterChannel';
import { CaseProStatusChip } from '../../casepro';
import { LEDGER_CAPTION_STYLE, LEDGER_LABEL_STYLE } from '../../lib/ledger';

// "Open in CasePro" resolves against the admin-configured CasePro_Web_URL (the human web app,
// not the MCP gateway). Kept at module scope so its branching stays out of the component's
// cyclomatic complexity. Returns undefined when the setting is unset → the button is hidden.
const buildCaseProHref = (caseProWebUrl: unknown, matterId: string): string | undefined => {
	const base = (typeof caseProWebUrl === 'string' ? caseProWebUrl : '').trim().replace(/\/+$/, '');
	return base ? `${base}/matters/${matterId}` : undefined;
};

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
 *  - "Updated …" freshness caption;
 *  - the read-only CasePro incident narrative (matters.description), shown as a
 *    labeled "Incident" block — distinct from the editable board-card
 *    Description in CardDetail; omitted when the snapshot carries none.
 */
const MatterHeader = ({ matterId, cardTitle, snapshot, link, showStale, isRefreshing, onRefresh }: MatterHeaderProps): ReactElement => {
	const { t } = useTranslation();
	const caseProWebUrl = useSetting('CasePro_Web_URL', '');

	const caseProHref = buildCaseProHref(caseProWebUrl, matterId);

	const { roomId, canJump, jumpToChannel } = useMatterChannel(link);

	const displayName = snapshot?.matterName || cardTitle;
	const subtitleParts = [snapshot?.matterNumber ? `#${snapshot.matterNumber}` : undefined, snapshot?.clientName].filter(Boolean);
	const updatedLabel = fmtDate(snapshot?.fetchedAt);

	return (
		<Box>
			{/* Eyebrow: panel label + CasePro connection + Refresh */}
			<Box display='flex' alignItems='center' justifyContent='space-between' marginBlockEnd={8}>
				<Box display='flex' alignItems='center'>
					<Icon name='bag' size='x16' marginInlineEnd={6} color='hint' />
					{/* Small-caps eyebrow — the ledger section-label voice. */}
					<Box fontScale='c1' color='hint' style={LEDGER_LABEL_STYLE}>
						{t('Boards_Matters_Linked_Matter', { defaultValue: 'Linked Matter' })}
					</Box>
					<CaseProStatusChip marginInlineStart={8} />
				</Box>
				<Button small square title={t('Refresh')} disabled={isRefreshing} onClick={onRefresh}>
					{isRefreshing ? <Throbber inheritColor size='x12' /> : <Icon name='reload' size='x16' />}
				</Button>
			</Box>

			{/* Identity — serif "case caption" matter name (the ledger heading voice). */}
			{displayName && (
				<Box fontScale='h4' color='default' withTruncatedText marginBlockEnd={2} style={LEDGER_CAPTION_STYLE}>
					{displayName}
				</Box>
			)}
			{subtitleParts.length > 0 && (
				<Box fontScale='c1' color='hint' marginBlockEnd={8} withTruncatedText>
					{subtitleParts.join(' · ')}
				</Box>
			)}

			{/* Stage / practice / freshness chips */}
			{(snapshot?.stageName || snapshot?.subStageName || snapshot?.practiceArea || showStale) && (
				<Box display='flex' flexWrap='wrap' alignItems='center' marginBlockEnd={8} style={{ gap: '6px' }}>
					{snapshot?.stageName && <Chip>{snapshot.stageName}</Chip>}
					{snapshot?.subStageName && <Chip>{snapshot.subStageName}</Chip>}
					{snapshot?.practiceArea && <Tag variant='secondary-info'>{snapshot.practiceArea}</Tag>}
					{showStale && (
						<Tag
							variant='secondary-warning'
							medium
							title={t('Boards_Matters_Stale_Hint', { defaultValue: 'This CasePro snapshot may be out of date — refresh to re-read it.' })}
						>
							<Icon name='warning' size='x12' marginInlineEnd={2} />
							{t('Boards_Matters_Stale', { defaultValue: 'Stale' })}
						</Tag>
					)}
				</Box>
			)}

			{/* Actions */}
			{(caseProHref || roomId) && (
				<Box display='flex' flexWrap='wrap' marginBlockEnd={4} style={{ gap: '8px' }}>
					{caseProHref && (
						<Button small is='a' href={caseProHref} target='_blank' rel='noopener noreferrer'>
							<Icon name='new-window' size='x16' marginInlineEnd={4} />
							{t('Boards_Matters_Open_In_CasePro', { defaultValue: 'Open in CasePro' })}
						</Button>
					)}
					{roomId && (
						<Button small onClick={jumpToChannel} disabled={!canJump}>
							<Icon name='arrow-jump' size='x16' marginInlineEnd={4} />
							{t('Boards_Matters_Jump_To_Channel', { defaultValue: 'Jump to channel' })}
						</Button>
					)}
				</Box>
			)}

			{/* Freshness caption */}
			{updatedLabel && (
				<Box fontScale='micro' color='hint' marginBlockEnd={4}>
					{t('Boards_Matters_Fetched_At', { date: updatedLabel, defaultValue: 'Updated {{date}}' })}
				</Box>
			)}

			{/* Incident narrative — read-only CasePro matters.description (NOT the editable card Description). */}
			{snapshot?.incidentDescription && (
				<Box marginBlockStart={8}>
					<Box fontScale='c1' color='hint' marginBlockEnd={4}>
						{t('Boards_Matters_Incident', { defaultValue: 'Incident' })}
					</Box>
					<Box fontScale='p2' color='default' backgroundColor='tint' padding={8} borderRadius='x4' style={{ whiteSpace: 'pre-wrap' }}>
						{snapshot.incidentDescription}
					</Box>
				</Box>
			)}
		</Box>
	);
};

export default MatterHeader;
