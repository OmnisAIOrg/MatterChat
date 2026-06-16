import type { IBoardCard, IMatterSnapshot, Serialized } from '@rocket.chat/core-typings';
import { Box, Button, Callout, Chip, Divider, Icon, Tag, Throbber } from '@rocket.chat/fuselage';
import { useEndpoint, useSetting } from '@rocket.chat/ui-contexts';
import { useQuery } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * MatterPanel — the "Linked Matter" section of a board card detail (M3a client).
 *
 * Given a card whose `link.kind === 'matter'`, it read-throughs the CasePro
 * snapshot via `GET /v1/boards.casepro.matterSnapshot` and renders the matter's
 * CasePro identity + money + deadlines. The snapshot is NEVER the source of
 * truth — it is a cached render of CasePro, so we offer a Refresh and surface a
 * stub banner when CasePro is not live (mock data).
 *
 * The integrator renders this inside card/CardDetail.tsx, conditionally, when
 * `card.cardType === 'matter'` (and the link carries a matterId). See return summary.
 *
 * NOTE: endpoint data is JSON-serialized over the wire, so `IMatterSnapshot`
 * Date fields (incidentDate/solDate/demandExpiration/fetchedAt) arrive as ISO
 * strings — hence `Serialized<IMatterSnapshot>` and string-tolerant date helpers.
 */

type MatterPanelProps = {
	// Accept either a hydrated or serialized card; we only read `link`.
	card: Pick<Serialized<IBoardCard>, 'cardType' | 'link'>;
};

const SOL_WARNING_DAYS = 90; // amber: within 90 days
const SOL_DANGER_DAYS = 30; // red: within 30 days (or already passed)

const fmtCurrency = (value?: number): string | undefined => {
	if (value === undefined || value === null || Number.isNaN(value)) {
		return undefined;
	}
	return value.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
};

const fmtDate = (value?: string | Date): string | undefined => {
	if (!value) {
		return undefined;
	}
	const d = typeof value === 'string' ? new Date(value) : value;
	if (Number.isNaN(d.getTime())) {
		return undefined;
	}
	return d.toLocaleDateString();
};

const daysUntil = (value?: string | Date): number | undefined => {
	if (!value) {
		return undefined;
	}
	const d = typeof value === 'string' ? new Date(value) : value;
	if (Number.isNaN(d.getTime())) {
		return undefined;
	}
	return Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
};

// A label/value row; renders nothing when the value is empty.
const Field = ({ label, children }: { label: string; children?: ReactNode }): ReactElement | null => {
	if (children === undefined || children === null || children === '') {
		return null;
	}
	return (
		<Box display='flex' justifyContent='space-between' alignItems='flex-start' mbe={6} style={{ gap: '12px' }}>
			<Box fontScale='c1' color='hint' style={{ flexShrink: 0 }}>
				{label}
			</Box>
			<Box fontScale='p2' color='default' style={{ textAlign: 'right' }}>
				{children}
			</Box>
		</Box>
	);
};

const SectionTitle = ({ children }: { children: ReactNode }): ReactElement => (
	<Box fontScale='p2b' color='default' mbs={16} mbe={8}>
		{children}
	</Box>
);

const MatterPanel = ({ card }: MatterPanelProps): ReactElement | null => {
	const { t } = useTranslation();
	const caseProEnabled = useSetting('CasePro_Enabled', false);

	const matterId = card.link?.kind === 'matter' ? card.link.matterId : undefined;

	const getSnapshot = useEndpoint('GET', '/v1/boards.casepro.matterSnapshot');

	const { data, isLoading, isError, refetch, isFetching } = useQuery({
		queryKey: ['boards', 'casepro', 'snapshot', matterId],
		queryFn: () => getSnapshot({ matterId: matterId as string }),
		enabled: Boolean(matterId),
	});

	// Only meaningful for matter cards.
	if (!matterId) {
		return null;
	}

	const snapshot = data?.snapshot as Serialized<IMatterSnapshot> | undefined;

	const solDays = daysUntil(snapshot?.solDate);
	const solVariant: 'danger' | 'warning' | 'secondary' =
		solDays === undefined ? 'secondary' : solDays <= SOL_DANGER_DAYS ? 'danger' : solDays <= SOL_WARNING_DAYS ? 'warning' : 'secondary';
	const solLabel = (() => {
		const datePart = fmtDate(snapshot?.solDate);
		if (!datePart) {
			return undefined;
		}
		if (solDays === undefined) {
			return datePart;
		}
		if (solDays < 0) {
			return t('Boards_Matters_SOL_Passed', { date: datePart, defaultValue: '{{date}} (passed)' });
		}
		return t('Boards_Matters_SOL_In_Days', { date: datePart, days: solDays, defaultValue: '{{date}} ({{days}}d)' });
	})();

	// "Open in" deep links. CasePro/LitBox/MedChron live behind their own apps;
	// we link by the snapshot handles. These are intentionally relative/handle
	// based so they resolve against whichever host the suite is deployed under.
	const caseProHref = `/admin/casepro/matters/${matterId}`;
	const litboxHref = snapshot?.litboxWorkspaceId ? `/admin/litbox/workspaces/${snapshot.litboxWorkspaceId}` : undefined;
	const medchronHref = snapshot?.medchronMatterId ? `/admin/medchron/matters/${snapshot.medchronMatterId}` : undefined;

	const team = snapshot?.team ?? [];
	const findRole = (re: RegExp): string | undefined => team.find((m) => re.test(m.role))?.name;
	const attorney = findRole(/attorney|lawyer/i);
	const caseManager = findRole(/case\s*manager|paralegal|cm/i);

	return (
		<Box mbs={16}>
			<Divider />
			<Box display='flex' alignItems='center' justifyContent='space-between' mbs={12} mbe={4}>
				<Box display='flex' alignItems='center'>
					<Icon name='bag' size='x20' mie={8} color='hint' />
					<Box fontScale='h4' color='default'>
						{t('Boards_Matters_Linked_Matter', { defaultValue: 'Linked Matter' })}
					</Box>
				</Box>
				<Button small square title={t('Refresh')} disabled={isFetching} onClick={() => refetch()}>
					{isFetching ? <Throbber inheritColor size='x12' /> : <Icon name='reload' size='x16' />}
				</Button>
			</Box>

			{!caseProEnabled && (
				<Box mbe={12}>
					<Callout
						type='warning'
						icon='info'
						title={t('Boards_Matters_Stub_Title', { defaultValue: 'CasePro is in stub mode' })}
					>
						{t('Boards_Matters_Stub_Description', {
							defaultValue: 'CasePro is not connected — matter details below are sample data, not live records.',
						})}
					</Callout>
				</Box>
			)}

			{isLoading && (
				<Box display='flex' justifyContent='center' p={16}>
					<Throbber />
				</Box>
			)}

			{isError && !isLoading && (
				<Callout type='danger' icon='warning' title={t('Something_went_wrong')}>
					<Button small mbs={8} onClick={() => refetch()}>
						{t('Reload_page')}
					</Button>
				</Callout>
			)}

			{!isLoading && !isError && snapshot && (
				<Box>
					{/* Identity chips */}
					<Box display='flex' flexWrap='wrap' mbe={12} style={{ gap: '6px' }}>
						{snapshot.stageName && <Chip>{snapshot.stageName}</Chip>}
						{snapshot.subStageName && <Chip>{snapshot.subStageName}</Chip>}
						{snapshot.practiceArea && <Tag variant='secondary-info'>{snapshot.practiceArea}</Tag>}
						{solLabel && (
							<Tag variant={solVariant === 'secondary' ? 'secondary' : solVariant}>
								<Icon name='clock' size='x12' mie={4} />
								{t('Boards_Matters_SOL', { defaultValue: 'SOL' })}: {solLabel}
							</Tag>
						)}
					</Box>

					{/* Matter identity */}
					<SectionTitle>{t('Boards_Matters_Matter', { defaultValue: 'Matter' })}</SectionTitle>
					<Field label={t('Client')}>{snapshot.clientName}</Field>
					<Field label={t('Boards_Matters_Matter_Number', { defaultValue: 'Matter #' })}>{snapshot.matterNumber}</Field>
					<Field label={t('Boards_Matters_Cause_Number', { defaultValue: 'Cause #' })}>{snapshot.causeNumber}</Field>
					<Field label={t('Boards_Matters_Practice_Area', { defaultValue: 'Practice area' })}>{snapshot.practiceArea}</Field>
					<Field label={t('Boards_Matters_Stage', { defaultValue: 'Stage' })}>
						{snapshot.subStageName ? `${snapshot.stageName ?? ''} · ${snapshot.subStageName}` : snapshot.stageName}
					</Field>
					<Field label={t('Boards_Matters_DOI', { defaultValue: 'Date of incident' })}>{fmtDate(snapshot.incidentDate)}</Field>
					<Field label={t('Boards_Matters_SOL', { defaultValue: 'SOL' })}>{fmtDate(snapshot.solDate)}</Field>
					<Field label={t('Boards_Matters_Liability', { defaultValue: 'Liability' })}>{snapshot.liabilityStatus}</Field>

					{/* Team */}
					{(attorney || caseManager || team.length > 0) && (
						<>
							<SectionTitle>{t('Boards_Matters_Team', { defaultValue: 'Team' })}</SectionTitle>
							<Field label={t('Boards_Matters_Attorney', { defaultValue: 'Attorney' })}>{attorney}</Field>
							<Field label={t('Boards_Matters_Case_Manager', { defaultValue: 'Case manager' })}>{caseManager}</Field>
							{team
								.filter((m) => m.name !== attorney && m.name !== caseManager)
								.map((m, i) => (
									<Field key={`${m.role}-${i}`} label={m.role}>
										{m.name}
									</Field>
								))}
						</>
					)}

					{/* Medical / damages */}
					<SectionTitle>{t('Boards_Matters_Medical', { defaultValue: 'Medical' })}</SectionTitle>
					<Field label={t('Boards_Matters_Providers', { defaultValue: 'Providers' })}>{snapshot.providerCount}</Field>
					<Field label={t('Boards_Matters_Total_Billed', { defaultValue: 'Total billed' })}>
						{fmtCurrency(snapshot.totalBilled)}
					</Field>
					<Field label={t('Boards_Matters_Total_Balance', { defaultValue: 'Total balance' })}>
						{fmtCurrency(snapshot.totalBalance)}
					</Field>

					{/* Negotiation / resolution */}
					<SectionTitle>{t('Boards_Matters_Negotiation', { defaultValue: 'Negotiation' })}</SectionTitle>
					<Field label={t('Boards_Matters_Demand', { defaultValue: 'Demand' })}>
						{fmtCurrency(snapshot.lastDemandAmount)}
						{snapshot.demandExpiration ? (
							<Box is='span' fontScale='c1' color='hint'>
								{' '}
								({t('Boards_Matters_Due', { defaultValue: 'due' })} {fmtDate(snapshot.demandExpiration)})
							</Box>
						) : null}
					</Field>
					<Field label={t('Boards_Matters_Top_Offer', { defaultValue: 'Top offer' })}>
						{fmtCurrency(snapshot.lastOfferAmount)}
					</Field>
					<Field label={t('Boards_Matters_Settlement', { defaultValue: 'Settlement' })}>
						{fmtCurrency(snapshot.settlementAmount)}
					</Field>

					{/* Freshness footer */}
					<Box fontScale='micro' color='hint' mbs={12}>
						{snapshot.stale && (
							<Tag variant='secondary-warning' medium>
								{t('Boards_Matters_Stale', { defaultValue: 'Stale' })}
							</Tag>
						)}{' '}
						{fmtDate(snapshot.fetchedAt) &&
							t('Boards_Matters_Fetched_At', { date: fmtDate(snapshot.fetchedAt), defaultValue: 'Updated {{date}}' })}
					</Box>

					{/* Open-in deep links */}
					<Box display='flex' flexWrap='wrap' mbs={16} style={{ gap: '8px' }}>
						<Button small is='a' href={caseProHref} target='_blank' rel='noopener noreferrer'>
							<Icon name='new-window' size='x16' mie={4} />
							{t('Boards_Matters_Open_In_CasePro', { defaultValue: 'Open in CasePro' })}
						</Button>
						{litboxHref && (
							<Button small is='a' href={litboxHref} target='_blank' rel='noopener noreferrer'>
								<Icon name='clip' size='x16' mie={4} />
								{t('Boards_Matters_Open_In_LitBox', { defaultValue: 'Open in LitBox' })}
							</Button>
						)}
						{medchronHref && (
							<Button small is='a' href={medchronHref} target='_blank' rel='noopener noreferrer'>
								<Icon name='file' size='x16' mie={4} />
								{t('Boards_Matters_Open_In_MedChron', { defaultValue: 'Open in MedChron' })}
							</Button>
						)}
					</Box>
				</Box>
			)}

			{!isLoading && !isError && !snapshot && (
				<Box fontScale='c1' color='hint' p={8}>
					{t('No_results_found')}
				</Box>
			)}
		</Box>
	);
};

export default MatterPanel;
