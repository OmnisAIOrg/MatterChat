import type { ICommunication, ILead, Serialized } from '@rocket.chat/core-typings';
import { Box, Button, ButtonGroup, Divider, Icon, Tag, Throbber } from '@rocket.chat/fuselage';
import { useEndpoint, useMethod, useRouter, useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * LEAD PANEL — the Intake face of a `cardType:'lead'` card. The integrator wires
 * CardDetail so that when `card.cardType === 'lead'` and `card.link.kind === 'lead'`
 * this renders instead of (or above) the generic detail body, passing the leadId.
 *
 * Reads the lead + its communications via GET /v1/boards.leads.get and renders
 * contact, status/sub-status, a qualification chip, source/referral, SLA + SOL,
 * a communications timeline, and Qualify / Assign / Convert-to-Matter actions.
 */

type LeadPanelProps = {
	leadId: string;
	boardId: string;
	cardId: string;
};

const fmtDate = (d?: string | Date): string => (d ? new Date(d).toLocaleDateString() : '—');
const fmtDateTime = (d?: string | Date): string => (d ? new Date(d).toLocaleString() : '—');

const Row = ({ label, children }: { label: string; children: React.ReactNode }): ReactElement => (
	<Box display='flex' justifyContent='space-between' alignItems='flex-start' mbe={6}>
		<Box fontScale='c1' color='hint' mie={8} flexShrink={0}>
			{label}
		</Box>
		<Box fontScale='p2' color='default' textAlign='end' withTruncatedText>
			{children}
		</Box>
	</Box>
);

const SectionTitle = ({ children }: { children: React.ReactNode }): ReactElement => (
	<Box fontScale='p2b' color='default' mbs={16} mbe={8}>
		{children}
	</Box>
);

const commIcon = (kind: ICommunication['kind']): 'phone' | 'message' | 'mail' | 'edit' | 'cog' => {
	switch (kind) {
		case 'call':
			return 'phone';
		case 'sms':
			return 'message';
		case 'email':
			return 'mail';
		case 'system':
			return 'cog';
		default:
			return 'edit';
	}
};

const LeadPanel = ({ leadId, boardId, cardId }: LeadPanelProps): ReactElement => {
	const { t } = useTranslation();
	const router = useRouter();
	const dispatchToastMessage = useToastMessageDispatch();
	const queryClient = useQueryClient();

	const getLead = useEndpoint('GET', '/v1/boards.leads.get');
	const qualifyLead = useMethod('boards.leadQualify');
	const assignLead = useMethod('boards.leadAssign');
	// Convert-to-Matter (M3 sync service): creates a CasePro matter from the intake at
	// "POA Received", binds a matter card, and marks the lead converted. The server is
	// the conversion gate (requires caseproIntakeId, POA-Received column, not-already-
	// converted) and throws a descriptive error otherwise, which we surface on failure.
	const convertToMatter = useMethod('boards.leadConvertToMatter');

	const leadQueryKey = ['boards', 'leads', 'get', leadId];

	const { data, isLoading, isError } = useQuery({
		queryKey: leadQueryKey,
		queryFn: () => getLead({ leadId }),
	});

	const invalidate = (): void => {
		void queryClient.invalidateQueries({ queryKey: leadQueryKey });
		void queryClient.invalidateQueries({ queryKey: ['boards', 'card', cardId] });
		void queryClient.invalidateQueries({ queryKey: ['boards', 'cards', boardId] });
	};

	const qualifyMutation = useMutation({
		mutationFn: (qualified: boolean) => qualifyLead({ leadId, qualification: { qualified } }),
		onSuccess: () => {
			dispatchToastMessage({ type: 'success', message: t('Saved') });
			invalidate();
		},
		onError: (error) => dispatchToastMessage({ type: 'error', message: error }),
	});

	const assignMutation = useMutation({
		// round-robin assign: no ownerId lets the server pick from the board member pool
		mutationFn: () => assignLead({ leadId }),
		onSuccess: () => {
			dispatchToastMessage({ type: 'success', message: t('Boards_Lead_Assigned', { defaultValue: 'Lead assigned' }) });
			invalidate();
		},
		onError: (error) => dispatchToastMessage({ type: 'error', message: error }),
	});

	const convertMutation = useMutation({
		mutationFn: () => convertToMatter({ leadId }),
		onSuccess: (result) => {
			dispatchToastMessage({ type: 'success', message: t('Boards_Lead_Converted', { defaultValue: 'Converted to matter' }) });
			invalidate();
			// Jump the user to the freshly created matter's card on the Matters board.
			if (result?.matterCard?._id) {
				router.navigate({ name: 'boards-matters', params: { cardId: result.matterCard._id } });
			}
		},
		onError: (error) => dispatchToastMessage({ type: 'error', message: error }),
	});

	if (isLoading) {
		return (
			<Box display='flex' justifyContent='center' p={24}>
				<Throbber />
			</Box>
		);
	}

	if (isError || !data?.lead) {
		return (
			<Box fontScale='c1' color='hint' p={8}>
				{t('Something_went_wrong')}
			</Box>
		);
	}

	const lead: Serialized<ILead> = data.lead;
	const communications: Serialized<ICommunication>[] = data.communications ?? [];

	const { contact } = lead;
	const fullName = contact.fullName || [contact.firstName, contact.lastName].filter(Boolean).join(' ') || t('Unnamed');
	const qualified = lead.qualification?.qualified;
	const score = lead.qualification?.score;
	const converted = Boolean(lead.convertedMatterId);
	// Convert needs a synced CasePro intake; a local-only lead (no caseproIntakeId)
	// cannot become a CasePro matter until it is synced. The POA-Received column gate
	// is enforced server-side and reported via the onError toast.
	const canConvert = Boolean(lead.caseproIntakeId) && !converted;

	return (
		<Box pi={4}>
			{/* Header: ref + name + qualification chip */}
			<Box display='flex' alignItems='center' mbe={8}>
				<Box fontScale='h4' color='default' mie={8} withTruncatedText>
					{fullName}
				</Box>
				{typeof qualified === 'boolean' && (
					<Tag variant={qualified ? 'primary' : 'danger'} medium>
						{qualified ? t('Boards_Lead_Qualified', { defaultValue: 'Qualified' }) : t('Boards_Lead_Disqualified', { defaultValue: 'Disqualified' })}
						{typeof score === 'number' ? ` · ${score}` : ''}
					</Tag>
				)}
			</Box>
			<Box fontScale='c1' color='hint' mbe={8}>
				#{lead.refNo} · {lead.practiceArea ?? t('Boards_PracticeArea', { defaultValue: 'Practice area' })}
			</Box>

			{lead.solAtRisk && (
				<Box display='flex' alignItems='center' mbe={8} color='danger'>
					<Icon name='warning' size='x16' mie={4} />
					<Box fontScale='c1'>{t('Boards_Lead_SOLAtRisk', { defaultValue: 'SOL at risk' })}</Box>
				</Box>
			)}

			<Divider />

			<SectionTitle>{t('Contact')}</SectionTitle>
			<Row label={t('Phone')}>{contact.phone || contact.mobile || '—'}</Row>
			<Row label={t('Email')}>{contact.email || '—'}</Row>
			{lead.preferredContact && <Row label={t('Boards_PreferredContact', { defaultValue: 'Preferred' })}>{lead.preferredContact}</Row>}

			<SectionTitle>{t('Status')}</SectionTitle>
			<Row label={t('Status')}>{lead.statusId}</Row>
			{lead.subStatus && <Row label={t('Boards_SubStatus', { defaultValue: 'Sub-status' })}>{lead.subStatus}</Row>}

			<SectionTitle>{t('Boards_Incident', { defaultValue: 'Incident' })}</SectionTitle>
			<Row label={t('Boards_IncidentType', { defaultValue: 'Type' })}>{lead.incident?.incidentType || '—'}</Row>
			<Row label={t('Boards_IncidentDate', { defaultValue: 'Date (DOI)' })}>{fmtDate(lead.incident?.incidentDate)}</Row>
			<Row label={t('Boards_JurisdictionState', { defaultValue: 'State' })}>{lead.incident?.jurisdictionState || '—'}</Row>

			<SectionTitle>{t('Boards_SourceReferral', { defaultValue: 'Source & referral' })}</SectionTitle>
			<Row label={t('Boards_Source', { defaultValue: 'Source' })}>{lead.attribution?.source || '—'}</Row>
			{lead.attribution?.referredByName && (
				<Row label={t('Boards_ReferredBy', { defaultValue: 'Referred by' })}>{lead.attribution.referredByName}</Row>
			)}

			<SectionTitle>{t('Boards_SLA_SOL', { defaultValue: 'SLA & SOL' })}</SectionTitle>
			<Row label={t('Boards_SLA_Due', { defaultValue: 'SLA due' })}>
				{lead.ownership?.slaDueAt ? fmtDateTime(lead.ownership.slaDueAt) : '—'}
				{lead.ownership?.slaBreached ? (
					<Tag variant='danger' medium>
						{t('Boards_SLA_Breached', { defaultValue: 'Breached' })}
					</Tag>
				) : null}
			</Row>
			<Row label={t('Boards_SOL_Date', { defaultValue: 'SOL date' })}>{fmtDate(lead.solDate)}</Row>
			<Row label={t('Owner')}>{lead.ownership?.ownerId || t('Unassigned', { defaultValue: 'Unassigned' })}</Row>

			{lead.tags && lead.tags.length > 0 && (
				<>
					<SectionTitle>{t('Tags')}</SectionTitle>
					<Box display='flex' flexWrap='wrap'>
						{lead.tags.map((tag) => (
							<Tag key={tag} mie={4} mbe={4}>
								{tag}
							</Tag>
						))}
					</Box>
				</>
			)}

			<SectionTitle>{t('Boards_Communications', { defaultValue: 'Communications' })}</SectionTitle>
			{communications.length === 0 && (
				<Box fontScale='c1' color='hint'>
					{t('No_results_found')}
				</Box>
			)}
			{communications.map((comm) => (
				<Box key={comm._id} display='flex' alignItems='flex-start' mbe={10}>
					<Icon name={commIcon(comm.kind)} size='x16' mie={8} mbs={2} color='hint' />
					<Box minWidth={0} flexGrow={1}>
						<Box display='flex' alignItems='center'>
							<Box fontScale='p2b' color='default' mie={4}>
								{comm.subject || t(`Boards_Comm_${comm.kind}` as Parameters<typeof t>[0], { defaultValue: comm.kind })}
							</Box>
							<Tag medium>{comm.direction}</Tag>
						</Box>
						{comm.body && (
							<Box fontScale='p2' color='default' withRichContent>
								{comm.body}
							</Box>
						)}
						<Box fontScale='micro' color='hint'>
							{fmtDateTime(comm.ts)}
							{comm.callDisposition ? ` · ${comm.callDisposition}` : ''}
							{comm.deliveryStatus ? ` · ${comm.deliveryStatus}` : ''}
						</Box>
					</Box>
				</Box>
			))}

			<Divider mbs={16} />

			<ButtonGroup stretch>
				<Button
					small
					success={qualified !== true}
					disabled={qualifyMutation.isPending || converted}
					onClick={() => qualifyMutation.mutate(true)}
				>
					{t('Boards_Lead_Qualify', { defaultValue: 'Qualify' })}
				</Button>
				<Button small disabled={assignMutation.isPending || converted} onClick={() => assignMutation.mutate()}>
					{t('Boards_Lead_Assign', { defaultValue: 'Assign' })}
				</Button>
			</ButtonGroup>
			<Box mbs={8}>
				<Button
					small
					primary
					width='100%'
					disabled={convertMutation.isPending || !canConvert}
					onClick={() => convertMutation.mutate()}
				>
					{convertMutation.isPending ? (
						<Throbber inheritColor size='x12' mie={4} />
					) : (
						<Icon name='arrow-forward' size='x16' mie={4} />
					)}
					{converted
						? t('Boards_Lead_AlreadyConverted', { defaultValue: 'Converted to matter' })
						: t('Boards_Lead_ConvertToMatter', { defaultValue: 'Convert to matter' })}
				</Button>
				{!converted && !lead.caseproIntakeId && (
					<Box fontScale='micro' color='hint' mbs={4} textAlign='center'>
						{t('Boards_Lead_ConvertNeedsSync', {
							defaultValue: 'Sync this lead to CasePro before converting to a matter.',
						})}
					</Box>
				)}
			</Box>
		</Box>
	);
};

export default LeadPanel;
