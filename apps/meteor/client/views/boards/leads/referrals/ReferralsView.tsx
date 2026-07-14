import type { IReferralOut, IReferralSource, ReferralArrangement, ReferralOutStatus, Serialized } from '@rocket.chat/core-typings';
import type { SelectOption } from '@rocket.chat/fuselage';
import {
	Box,
	Button,
	Callout,
	Field,
	FieldLabel,
	FieldRow,
	FieldError,
	Select,
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableRow,
	Tag,
	TextAreaInput,
	TextInput,
	Throbber,
} from '@rocket.chat/fuselage';
import { GenericModal, Page, PageHeader, PageScrollableContentWithShadow } from '@rocket.chat/ui-client';
import { useEndpoint, useSetModal, useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';
import { useId, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { CaseProStubBanner } from '../../casepro';

/**
 * ReferralsView — the `/boards/leads/referrals` screen (M6 client).
 *
 * Two panels over the intake board (intake-lead-management.md §8):
 *  - Referral sources directory: the inbound referrer / marketing-source registry.
 *    Rows are read from `GET /v1/boards.leads.marketing.sourceRoi` (the only read
 *    that enumerates sources with their rollups — leads referred, signed, fees);
 *    Add/Edit opens a modal that upserts via
 *    `POST /v1/boards.leads.referralSource.upsert`.
 *  - Refer a lead out: an outbound / co-counsel capture form with a fee split,
 *    posting to `POST /v1/boards.leads.referralOut.upsert`, then a status updater
 *    (`POST /v1/boards.leads.referralOut.setStatus`) for the just-created referral.
 *    A lead is identified by id (the lead card's "Refer out" deep-links here).
 *
 * Sources rows arrive over the wire as `unknown[]` (the REST type is intentionally
 * loose), so we narrow to a local `SourceRoiRow` shape mirroring the server.
 *
 * Wiring: register at route name `boards-leads-referrals`
 * (path `/boards/leads/referrals`) gated by `boards-leads-referrals-manage`.
 * See return summary.
 */

// Mirrors the server marketing.ts SourceRoiRow (REST type is `unknown[]`).
type SourceRoiRow = {
	sourceId: string;
	sourceName: string;
	kind?: IReferralSource['kind'];
	channel?: IReferralSource['channel'];
	campaignId?: string;
	campaignName?: string;
	leads: number;
	signed: number;
	conversionPct: number;
	spend: number;
	costPerLead: number;
	costPerSigned: number;
	revenue: number;
	roas: number;
	revenueResolved: boolean;
};

const SOURCE_TYPES = ['person', 'firm', 'campaign', 'internal'] as const;
const SOURCE_KINDS = ['referral', 'marketing', 'both'] as const;
const ARRANGEMENTS = ['referral-fee', 'co-counsel'] as const;
const OUT_STATUSES: ReferralOutStatus[] = ['sent', 'accepted', 'declined', 'signed', 'fee-received', 'closed'];

const fmtCurrency = (value?: number): string => {
	if (value === undefined || value === null || Number.isNaN(value)) {
		return '—';
	}
	return value.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
};

const SectionTitle = ({ children }: { children: ReactNode }): ReactElement => (
	<Box fontScale='h4' color='default' mbs={24} mbe={12}>
		{children}
	</Box>
);

// ---------------------------------------------------------------------------
// Source editor modal (referralSource.upsert)
// ---------------------------------------------------------------------------

type SourceFormValues = {
	name: string;
	type: (typeof SOURCE_TYPES)[number];
	kind: (typeof SOURCE_KINDS)[number];
	defaultFeePct: string;
	phone: string;
	email: string;
	notes: string;
};

type SourceEditorModalProps = {
	onClose: () => void;
	onSaved: () => void;
};

const SourceEditorModal = ({ onClose, onSaved }: SourceEditorModalProps): ReactElement => {
	const { t } = useTranslation();
	const dispatchToastMessage = useToastMessageDispatch();
	const upsertSource = useEndpoint('POST', '/v1/boards.leads.referralSource.upsert');

	const typeId = useId();
	const kindId = useId();

	const {
		register,
		control,
		handleSubmit,
		formState: { errors, isSubmitting },
	} = useForm<SourceFormValues>({
		defaultValues: { name: '', type: 'firm', kind: 'referral', defaultFeePct: '', phone: '', email: '', notes: '' },
	});

	const typeOptions = useMemo<SelectOption[]>(
		() => SOURCE_TYPES.map((s) => [s, t(`Boards_Leads_Source_Type_${s}` as Parameters<typeof t>[0], { defaultValue: s })]),
		[t],
	);
	const kindOptions = useMemo<SelectOption[]>(
		() => SOURCE_KINDS.map((s) => [s, t(`Boards_Leads_Source_Kind_${s}` as Parameters<typeof t>[0], { defaultValue: s })]),
		[t],
	);

	const upsertMutation = useMutation({
		mutationFn: (values: SourceFormValues) => {
			const feePct = values.defaultFeePct.trim() ? Number(values.defaultFeePct) : undefined;
			const contact =
				values.phone.trim() || values.email.trim()
					? { phone: values.phone.trim() || undefined, email: values.email.trim() || undefined }
					: undefined;
			return upsertSource({
				fields: {
					name: values.name.trim(),
					type: values.type,
					kind: values.kind,
					...(feePct !== undefined && !Number.isNaN(feePct) ? { defaultFeePct: feePct } : {}),
					...(contact ? { contact } : {}),
					...(values.notes.trim() ? { notes: values.notes.trim() } : {}),
				},
			});
		},
		onSuccess: () => {
			dispatchToastMessage({ type: 'success', message: t('Saved') });
			onSaved();
			onClose();
		},
		onError: (error) => dispatchToastMessage({ type: 'error', message: error }),
	});

	const submit = handleSubmit((values) => upsertMutation.mutateAsync(values));

	return (
		<GenericModal
			wrapperFunction={(props) => <Box is='form' onSubmit={submit} {...props} />}
			title={t('Boards_Leads_Referrals_Out', { defaultValue: 'Referral source' })}
			confirmText={t('Save')}
			onCancel={onClose}
			onClose={onClose}
			confirmDisabled={isSubmitting || upsertMutation.isPending}
		>
			<Field>
				<FieldLabel>{t('Name')}</FieldLabel>
				<FieldRow>
					<TextInput {...register('name', { required: t('Required_field', { field: t('Name') }) })} />
				</FieldRow>
				{errors.name && <FieldError>{errors.name.message}</FieldError>}
			</Field>

			<Box display='flex' mbs={12} mi='neg-x4'>
				<Field mi={4}>
					<FieldLabel htmlFor={typeId}>{t('Type')}</FieldLabel>
					<FieldRow>
						<Controller
							control={control}
							name='type'
							render={({ field: { onChange, value } }) => (
								<Select id={typeId} value={value} onChange={(next) => onChange(next)} options={typeOptions} />
							)}
						/>
					</FieldRow>
				</Field>
				<Field mi={4}>
					<FieldLabel htmlFor={kindId}>{t('Kind', { defaultValue: 'Kind' })}</FieldLabel>
					<FieldRow>
						<Controller
							control={control}
							name='kind'
							render={({ field: { onChange, value } }) => (
								<Select id={kindId} value={value} onChange={(next) => onChange(next)} options={kindOptions} />
							)}
						/>
					</FieldRow>
				</Field>
			</Box>

			<Field mbs={12}>
				<FieldLabel>{t('Boards_Leads_Referral_Out_Fee', { defaultValue: 'Referral fee' })} (%)</FieldLabel>
				<FieldRow>
					<TextInput {...register('defaultFeePct')} placeholder='33.3' />
				</FieldRow>
			</Field>

			<Box display='flex' mbs={12} mi='neg-x4'>
				<Field mi={4}>
					<FieldLabel>{t('Phone')}</FieldLabel>
					<FieldRow>
						<TextInput {...register('phone')} />
					</FieldRow>
				</Field>
				<Field mi={4}>
					<FieldLabel>{t('Email')}</FieldLabel>
					<FieldRow>
						<TextInput {...register('email')} />
					</FieldRow>
				</Field>
			</Box>

			<Field mbs={12}>
				<FieldLabel>{t('Notes', { defaultValue: 'Notes' })}</FieldLabel>
				<FieldRow>
					<TextAreaInput rows={2} {...register('notes')} />
				</FieldRow>
			</Field>
		</GenericModal>
	);
};

// ---------------------------------------------------------------------------
// Refer-out modal (referralOut.upsert + setStatus)
// ---------------------------------------------------------------------------

type ReferOutFormValues = {
	leadId: string;
	toFirmName: string;
	arrangement: ReferralArrangement;
	agreedFeePct: string;
	expectedFee: string;
	contactName: string;
	notes: string;
};

type ReferOutModalProps = {
	onClose: () => void;
	onSaved: () => void;
};

const ReferOutModal = ({ onClose, onSaved }: ReferOutModalProps): ReactElement => {
	const { t } = useTranslation();
	const dispatchToastMessage = useToastMessageDispatch();
	const upsertReferralOut = useEndpoint('POST', '/v1/boards.leads.referralOut.upsert');
	const setStatus = useEndpoint('POST', '/v1/boards.leads.referralOut.setStatus');
	const listReferralsOut = useEndpoint('GET', '/v1/boards.leads.referralsOut.list');
	const queryClient = useQueryClient();

	const arrangementId = useId();
	const statusId = useId();

	// once created (or selected for edit), we keep the id so the upsert UPDATES that
	// referral in place (no dup) and the status updater can act on it.
	const [created, setCreated] = useState<Serialized<IReferralOut> | null>(null);
	const [status, setStatusValue] = useState<ReferralOutStatus>('sent');

	const {
		register,
		control,
		handleSubmit,
		watch,
		reset,
		formState: { errors, isSubmitting },
	} = useForm<ReferOutFormValues>({
		defaultValues: { leadId: '', toFirmName: '', arrangement: 'referral-fee', agreedFeePct: '', expectedFee: '', contactName: '', notes: '' },
	});

	// the lead the form is scoped to — drives the "existing outbound referrals" read.
	const leadId = watch('leadId').trim();

	const existingQueryKey = ['boards', 'leads', 'referralsOut', leadId];
	const { data: existingData, isLoading: existingLoading } = useQuery({
		queryKey: existingQueryKey,
		queryFn: () => listReferralsOut({ leadId }),
		enabled: leadId.length > 0,
	});
	const existing: Serialized<IReferralOut>[] = existingData?.referralsOut ?? [];

	const refetchExisting = (): void => {
		void queryClient.invalidateQueries({ queryKey: existingQueryKey });
	};

	const arrangementOptions = useMemo<SelectOption[]>(
		() => ARRANGEMENTS.map((a) => [a, t(`Boards_Leads_Arrangement_${a}` as Parameters<typeof t>[0], { defaultValue: a })]),
		[t],
	);
	const statusOptions = useMemo<SelectOption[]>(
		() => OUT_STATUSES.map((s) => [s, t(`Boards_Leads_ReferralOut_Status_${s}` as Parameters<typeof t>[0], { defaultValue: s })]),
		[t],
	);

	// Load an existing referral back into the form to EDIT it (re-save updates in place).
	const editExisting = (referral: Serialized<IReferralOut>): void => {
		setCreated(referral);
		setStatusValue(referral.status);
		reset({
			leadId: referral.leadId,
			toFirmName: referral.toFirmName,
			arrangement: referral.arrangement,
			agreedFeePct: referral.agreedFeePct !== undefined ? String(referral.agreedFeePct) : '',
			expectedFee: referral.expectedFee !== undefined ? String(referral.expectedFee) : '',
			contactName: referral.contact?.name ?? '',
			notes: referral.notes ?? '',
		});
	};

	const upsertMutation = useMutation({
		mutationFn: (values: ReferOutFormValues) => {
			const agreedFeePct = values.agreedFeePct.trim() ? Number(values.agreedFeePct) : undefined;
			const expectedFee = values.expectedFee.trim() ? Number(values.expectedFee) : undefined;
			return upsertReferralOut({
				// when editing an existing referral, target it so we UPDATE (no duplicate).
				...(created ? { referralOutId: created._id } : {}),
				leadId: values.leadId.trim(),
				toFirmName: values.toFirmName.trim(),
				arrangement: values.arrangement,
				...(agreedFeePct !== undefined && !Number.isNaN(agreedFeePct) ? { agreedFeePct } : {}),
				...(expectedFee !== undefined && !Number.isNaN(expectedFee) ? { expectedFee } : {}),
				...(values.contactName.trim() ? { contact: { name: values.contactName.trim() } } : {}),
				...(values.notes.trim() ? { notes: values.notes.trim() } : {}),
			});
		},
		onSuccess: (result) => {
			dispatchToastMessage({ type: 'success', message: t('Saved') });
			setCreated(result.referralOut);
			setStatusValue(result.referralOut.status);
			refetchExisting();
			onSaved();
		},
		onError: (error) => dispatchToastMessage({ type: 'error', message: error }),
	});

	const statusMutation = useMutation({
		mutationFn: () => {
			if (!created) {
				throw new Error('No referral');
			}
			return setStatus({ referralOutId: created._id, status });
		},
		onSuccess: (result) => {
			dispatchToastMessage({ type: 'success', message: t('Saved') });
			setCreated(result.referralOut);
			refetchExisting();
			onSaved();
		},
		onError: (error) => dispatchToastMessage({ type: 'error', message: error }),
	});

	const submit = handleSubmit((values) => upsertMutation.mutateAsync(values));

	return (
		<GenericModal
			wrapperFunction={(props) => <Box is='form' onSubmit={submit} {...props} />}
			title={t('Boards_Leads_Referral_Out_New', { defaultValue: 'Refer out' })}
			confirmText={t('Save')}
			cancelText={created ? t('Done', { defaultValue: 'Done' }) : t('Cancel')}
			onCancel={onClose}
			onClose={onClose}
			confirmDisabled={isSubmitting || upsertMutation.isPending || Boolean(created)}
		>
			<Field>
				<FieldLabel>{t('Boards_Lead', { defaultValue: 'Lead' })} ID</FieldLabel>
				<FieldRow>
					{/* lead is locked once editing an existing referral so the row isn't re-homed */}
					<TextInput {...register('leadId', { required: t('Required_field', { field: 'Lead ID' }) })} disabled={Boolean(created)} />
				</FieldRow>
				{errors.leadId && <FieldError>{errors.leadId.message}</FieldError>}
			</Field>

			{/* Existing outbound referrals for this lead (load on reopen — no silent dup on edit) */}
			{leadId.length > 0 && (
				<Box mbs={12}>
					<Box fontScale='c1' color='hint' mbe={4}>
						{t('Boards_Leads_Referrals_Out_Existing', { defaultValue: 'Existing outbound referrals' })}
					</Box>
					{existingLoading && (
						<Box display='flex' justifyContent='center' p={8}>
							<Throbber />
						</Box>
					)}
					{!existingLoading && existing.length === 0 && (
						<Box fontScale='c1' color='hint'>
							{t('No_results_found')}
						</Box>
					)}
					{existing.length > 0 && (
						<Table fixed>
							<TableHead>
								<TableRow>
									<TableCell>{t('Boards_Leads_Referral_Out_Firm', { defaultValue: 'Firm' })}</TableCell>
									<TableCell>{t('Boards_Leads_Referral_Out_Status', { defaultValue: 'Arrangement' })}</TableCell>
									<TableCell align='end'>{t('Boards_Leads_Referral_Out_Fee', { defaultValue: 'Fee' })}</TableCell>
									<TableCell>{t('Status')}</TableCell>
									<TableCell align='end' />
								</TableRow>
							</TableHead>
							<TableBody>
								{existing.map((r) => (
									<TableRow key={r._id} action onClick={() => editExisting(r)}>
										<TableCell>
											<Box withTruncatedText>{r.toFirmName}</Box>
										</TableCell>
										<TableCell>
											{t(`Boards_Leads_Arrangement_${r.arrangement}` as Parameters<typeof t>[0], { defaultValue: r.arrangement })}
										</TableCell>
										<TableCell align='end'>
											{r.agreedFeePct !== undefined ? `${r.agreedFeePct}%` : fmtCurrency(r.expectedFee)}
											{r.receivedFee !== undefined ? ` · ${fmtCurrency(r.receivedFee)}` : ''}
										</TableCell>
										<TableCell>
											<Tag variant={r.status === 'fee-received' ? 'primary' : r.status === 'declined' ? 'danger' : 'secondary'}>
												{t(`Boards_Leads_ReferralOut_Status_${r.status}` as Parameters<typeof t>[0], { defaultValue: r.status })}
											</Tag>
										</TableCell>
										<TableCell align='end'>
											<Button tiny onClick={() => editExisting(r)}>
												{t('Edit', { defaultValue: 'Edit' })}
											</Button>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
					{created && (
						<Button
							tiny
							mbs={8}
							onClick={() => {
								setCreated(null);
								reset({ leadId, toFirmName: '', arrangement: 'referral-fee', agreedFeePct: '', expectedFee: '', contactName: '', notes: '' });
							}}
						>
							{t('Boards_Leads_Referral_Out_New', { defaultValue: 'Refer out' })}
						</Button>
					)}
				</Box>
			)}

			<Field mbs={12}>
				<FieldLabel>{t('Boards_Leads_Referral_Out_Firm', { defaultValue: 'Refer to firm' })}</FieldLabel>
				<FieldRow>
					<TextInput {...register('toFirmName', { required: t('Required_field', { field: t('Name') }) })} />
				</FieldRow>
				{errors.toFirmName && <FieldError>{errors.toFirmName.message}</FieldError>}
			</Field>

			<Field mbs={12}>
				<FieldLabel htmlFor={arrangementId}>{t('Boards_Leads_Referral_Out_Status', { defaultValue: 'Arrangement' })}</FieldLabel>
				<FieldRow>
					<Controller
						control={control}
						name='arrangement'
						render={({ field: { onChange, value } }) => (
							<Select id={arrangementId} value={value} onChange={(next) => onChange(next as ReferralArrangement)} options={arrangementOptions} />
						)}
					/>
				</FieldRow>
			</Field>

			<Box display='flex' mbs={12} mi='neg-x4'>
				<Field mi={4}>
					<FieldLabel>{t('Boards_Leads_Referral_Out_Fee', { defaultValue: 'Referral fee' })} (%)</FieldLabel>
					<FieldRow>
						<TextInput {...register('agreedFeePct')} placeholder='33.3' />
					</FieldRow>
				</Field>
				<Field mi={4}>
					<FieldLabel>{t('Boards_Leads_Referral_Out_Expected_Fee', { defaultValue: 'Expected fee' })} ($)</FieldLabel>
					<FieldRow>
						<TextInput {...register('expectedFee')} placeholder='0' />
					</FieldRow>
				</Field>
			</Box>

			<Field mbs={12}>
				<FieldLabel>{t('Contact')}</FieldLabel>
				<FieldRow>
					<TextInput {...register('contactName')} />
				</FieldRow>
			</Field>

			<Field mbs={12}>
				<FieldLabel>{t('Notes', { defaultValue: 'Notes' })}</FieldLabel>
				<FieldRow>
					<TextAreaInput rows={2} {...register('notes')} />
				</FieldRow>
			</Field>

			{created && (
				<Box mbs={16}>
					<Callout type='success' icon='check' title={t('Saved')} mbe={12}>
						{t('Boards_Leads_Referrals_Out', { defaultValue: 'Referred out' })} — {created.toFirmName}
					</Callout>
					<Field>
						<FieldLabel htmlFor={statusId}>{t('Boards_Leads_Referral_Out_Status', { defaultValue: 'Referral status' })}</FieldLabel>
						<FieldRow>
							<Select
								id={statusId}
								value={status}
								onChange={(next) => setStatusValue(next as ReferralOutStatus)}
								options={statusOptions}
							/>
						</FieldRow>
					</Field>
					<Button small mbs={8} onClick={() => statusMutation.mutate()} disabled={statusMutation.isPending}>
						{t('Boards_Leads_Referral_Out_Status', { defaultValue: 'Update status' })}
					</Button>
				</Box>
			)}
		</GenericModal>
	);
};

// ---------------------------------------------------------------------------
// Sources directory panel
// ---------------------------------------------------------------------------

const SourcesPanel = (): ReactElement => {
	const { t } = useTranslation();
	const setModal = useSetModal();
	const queryClient = useQueryClient();
	const getRoi = useEndpoint('GET', '/v1/boards.leads.marketing.sourceRoi');

	const queryKey = ['boards', 'leads', 'marketing', 'sourceRoi', 'referrals'];

	const { data, isLoading, isError, refetch } = useQuery({
		queryKey,
		queryFn: () => getRoi({}),
	});

	const invalidate = (): void => {
		void queryClient.invalidateQueries({ queryKey });
	};

	const openSourceEditor = (): void => {
		const close = (): void => setModal(null);
		setModal(<SourceEditorModal onClose={close} onSaved={invalidate} />);
	};

	const openReferOut = (): void => {
		const close = (): void => setModal(null);
		setModal(<ReferOutModal onClose={close} onSaved={invalidate} />);
	};

	if (isLoading) {
		return (
			<Box display='flex' justifyContent='center' p={16}>
				<Throbber />
			</Box>
		);
	}

	if (isError || !data) {
		return (
			<Callout type='danger' icon='warning' title={t('Something_went_wrong')}>
				<Button small mbs={8} onClick={() => refetch()}>
					{t('Reload_page')}
				</Button>
			</Callout>
		);
	}

	// directory = source-level rows only (drop embedded campaign rows)
	// `rows` is typed `unknown[]` on the endpoint and serializes to `null[]`, so cast via unknown.
	const rows = (data.rows as unknown as SourceRoiRow[]).filter((r) => !r.campaignId);

	return (
		<Box>
			<Box display='flex' justifyContent='flex-end' mbe={8}>
				<Button small mie={8} onClick={openReferOut}>
					{t('Boards_Leads_Referral_Out_New', { defaultValue: 'Refer out' })}
				</Button>
				<Button small primary onClick={openSourceEditor}>
					{t('Add', { defaultValue: 'Add' })}
				</Button>
			</Box>
			<Table fixed>
				<TableHead>
					<TableRow>
						<TableCell>{t('Name')}</TableCell>
						<TableCell>{t('Kind', { defaultValue: 'Kind' })}</TableCell>
						<TableCell align='end'>{t('Boards_Leads_Funnel_New', { defaultValue: 'Leads' })}</TableCell>
						<TableCell align='end'>{t('Boards_Leads_Funnel_Signed', { defaultValue: 'Signed' })}</TableCell>
						<TableCell align='end'>{t('Boards_Leads_Referral_Out_Fee', { defaultValue: 'Referral fee' })}</TableCell>
					</TableRow>
				</TableHead>
				<TableBody>
					{rows.map((row) => (
						<TableRow key={row.sourceId}>
							<TableCell>
								<Box withTruncatedText>{row.sourceName}</Box>
							</TableCell>
							<TableCell>
								{row.kind ? (
									<Tag variant='secondary'>{t(`Boards_Leads_Source_Kind_${row.kind}` as Parameters<typeof t>[0], { defaultValue: row.kind })}</Tag>
								) : (
									<Box color='hint'>—</Box>
								)}
							</TableCell>
							<TableCell align='end'>{row.leads}</TableCell>
							<TableCell align='end'>{row.signed}</TableCell>
							<TableCell align='end'>{fmtCurrency(row.revenue)}</TableCell>
						</TableRow>
					))}
					{rows.length === 0 && (
						<TableRow>
							<TableCell colSpan={5}>
								<Box fontScale='c1' color='hint'>
									{t('No_results_found')}
								</Box>
							</TableCell>
						</TableRow>
					)}
				</TableBody>
			</Table>
		</Box>
	);
};

const ReferralsView = (): ReactElement => {
	const { t } = useTranslation();

	return (
		<Page>
			<PageHeader
				title={
					<Box display='flex' alignItems='center'>
						<Box withTruncatedText>{t('Boards_Leads_Referrals_Out', { defaultValue: 'Referrals' })}</Box>
					</Box>
				}
			/>
			<PageScrollableContentWithShadow>
				<CaseProStubBanner mbe={16} />

				<SectionTitle>{t('Boards_Leads_Referrals_Out', { defaultValue: 'Referral sources' })}</SectionTitle>
				<SourcesPanel />
			</PageScrollableContentWithShadow>
		</Page>
	);
};

export default ReferralsView;
