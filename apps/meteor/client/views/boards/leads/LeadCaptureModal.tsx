import type { ILead, Serialized } from '@rocket.chat/core-typings';
import type { SelectOption } from '@rocket.chat/fuselage';
import {
	Box,
	Field,
	FieldLabel,
	FieldRow,
	FieldError,
	FieldHint,
	Select,
	TextInput,
	TextAreaInput,
	Callout,
	Throbber,
} from '@rocket.chat/fuselage';
import { GenericModal } from '@rocket.chat/ui-client';
import { useEndpoint, useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import { useMutation } from '@tanstack/react-query';
import { useId, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

// The 12 CasePro `case_types` (practice areas). Kept verbatim so the denormalized
// `practiceArea` name the lead carries matches CasePro on a later convert.
const PRACTICE_AREAS = [
	'Personal Injury',
	'Motor Vehicle Accident',
	'Medical Malpractice',
	"Workers' Compensation",
	'Product Liability',
	'Wrongful Death',
	'Insurance Dispute',
	'Social Security Disability',
	'Class Action',
	'Premises Liability',
	'Slip and Fall',
	'Commercial',
] as const;

type PracticeArea = (typeof PRACTICE_AREAS)[number];

const PREFERRED_CONTACT = ['phone', 'email', 'sms', 'any'] as const;

export type LeadCaptureFormValues = {
	practiceArea: PracticeArea | '';
	firstName: string;
	lastName: string;
	phone: string;
	email: string;
	preferredContact: 'phone' | 'email' | 'sms' | 'any';
	incidentType: string;
	incidentDate: string; // yyyy-mm-dd (coerced to ISO Date server-side)
	jurisdictionState: string;
	source: string;
	description: string;
	// conditional-by-practice-area fields (folded into incident on submit)
	numberOfVehicles: string;
	propertyType: string;
	employer: string;
	dateOfDeath: string;
};

type LeadCaptureModalProps = {
	boardId?: string;
	onClose: () => void;
	// called with the created lead so the parent can refresh the board / open the panel
	onCreated?: (lead: Serialized<ILead>) => void;
};

const defaultValues: LeadCaptureFormValues = {
	practiceArea: '',
	firstName: '',
	lastName: '',
	phone: '',
	email: '',
	preferredContact: 'phone',
	incidentType: '',
	incidentDate: '',
	jurisdictionState: '',
	source: '',
	description: '',
	numberOfVehicles: '',
	propertyType: '',
	employer: '',
	dateOfDeath: '',
};

const isMotorVehicle = (pa: string): boolean => pa === 'Motor Vehicle Accident';
const isPremises = (pa: string): boolean => pa === 'Premises Liability' || pa === 'Slip and Fall';
const isWorkersComp = (pa: string): boolean => pa === "Workers' Compensation";
const isWrongfulDeath = (pa: string): boolean => pa === 'Wrongful Death';

const LeadCaptureModal = ({ onClose, onCreated }: LeadCaptureModalProps) => {
	const { t } = useTranslation();
	const dispatchToastMessage = useToastMessageDispatch();

	const createLead = useEndpoint('POST', '/v1/boards.leads.create');

	const {
		register,
		control,
		handleSubmit,
		watch,
		formState: { errors, isSubmitting },
	} = useForm<LeadCaptureFormValues>({ defaultValues });

	// surfaced when the server returns an open dedupe match instead of creating a 2nd lead
	const [duplicateOf, setDuplicateOf] = useState<Serialized<ILead> | null>(null);

	const practiceArea = watch('practiceArea');
	const phone = watch('phone');
	const email = watch('email');

	const practiceAreaId = useId();
	const preferredId = useId();

	const practiceAreaOptions = useMemo<SelectOption[]>(() => PRACTICE_AREAS.map((pa) => [pa, pa] as [string, string]), []);
	const preferredOptions = useMemo<SelectOption[]>(
		() =>
			PREFERRED_CONTACT.map(
				(p) => [p, t(`Boards_PreferredContact_${p}` as Parameters<typeof t>[0], { defaultValue: p })] as [string, string],
			),
		[t],
	);

	const createMutation = useMutation({
		mutationFn: (values: LeadCaptureFormValues) => {
			const incident: Record<string, unknown> = {};
			if (values.incidentType.trim()) {
				incident.incidentType = values.incidentType.trim();
			}
			if (values.incidentDate) {
				incident.incidentDate = values.incidentDate; // ISO date string; route coerces -> Date
			}
			if (values.jurisdictionState.trim()) {
				incident.jurisdictionState = values.jurisdictionState.trim();
			}
			if (values.description.trim()) {
				incident.incidentDescription = values.description.trim();
			}
			// fold conditional fields into the incident description so nothing is lost
			const extras: string[] = [];
			if (isMotorVehicle(values.practiceArea) && values.numberOfVehicles.trim()) {
				extras.push(`Vehicles involved: ${values.numberOfVehicles.trim()}`);
			}
			if (isPremises(values.practiceArea) && values.propertyType.trim()) {
				extras.push(`Property type: ${values.propertyType.trim()}`);
			}
			if (isWorkersComp(values.practiceArea) && values.employer.trim()) {
				extras.push(`Employer: ${values.employer.trim()}`);
			}
			if (isWrongfulDeath(values.practiceArea) && values.dateOfDeath.trim()) {
				extras.push(`Date of death: ${values.dateOfDeath.trim()}`);
			}
			if (extras.length > 0) {
				incident.incidentDescription = [incident.incidentDescription, ...extras].filter(Boolean).join('\n');
			}

			return createLead({
				contact: {
					firstName: values.firstName.trim() || undefined,
					lastName: values.lastName.trim() || undefined,
					phone: values.phone.trim() || undefined,
					email: values.email.trim() || undefined,
				},
				practiceArea: values.practiceArea || undefined,
				preferredContact: values.preferredContact,
				...(Object.keys(incident).length > 0 ? { incident: incident as never } : {}),
				...(values.source.trim() ? { attribution: { source: values.source.trim() } } : {}),
				capturedChannel: 'manual',
			});
		},
		onSuccess: (result) => {
			if (result.duplicateOf) {
				// server found an open lead with the same phone/email — show the hint, do NOT close
				setDuplicateOf(result.duplicateOf);
				return;
			}
			dispatchToastMessage({ type: 'success', message: t('Boards_Lead_Created', { defaultValue: 'Lead created' }) });
			onCreated?.(result.lead);
			onClose();
		},
		onError: (error) => {
			dispatchToastMessage({ type: 'error', message: error });
		},
	});

	const submit = handleSubmit((values) => createMutation.mutateAsync(values));

	const dupName =
		duplicateOf &&
		(duplicateOf.contact.fullName || [duplicateOf.contact.firstName, duplicateOf.contact.lastName].filter(Boolean).join(' '));

	return (
		<GenericModal
			wrapperFunction={(props) => <Box is='form' onSubmit={submit} {...props} />}
			title={t('Boards_New_Lead', { defaultValue: 'New Lead' })}
			confirmText={duplicateOf ? t('Boards_Lead_CreateAnyway', { defaultValue: 'Create anyway' }) : t('Create')}
			onCancel={onClose}
			onClose={onClose}
			confirmDisabled={isSubmitting || createMutation.isPending}
		>
			{(isSubmitting || createMutation.isPending) && (
				<Box display='flex' justifyContent='center' marginBlockEnd={8}>
					<Throbber />
				</Box>
			)}

			{duplicateOf && (
				<Callout type='warning' title={t('Boards_Lead_PossibleDuplicate', { defaultValue: 'Possible duplicate' })} marginBlockEnd={12}>
					{t('Boards_Lead_DuplicateHint', {
						defaultValue: 'An open lead with this phone or email already exists',
					})}
					{dupName ? ` — ${dupName}` : ''}
					{duplicateOf.refNo ? ` (#${duplicateOf.refNo})` : ''}.
				</Callout>
			)}

			<Field>
				<FieldLabel htmlFor={practiceAreaId}>{t('Boards_PracticeArea', { defaultValue: 'Practice area' })}</FieldLabel>
				<FieldRow>
					<Controller
						control={control}
						name='practiceArea'
						rules={{ required: t('Required_field', { field: t('Boards_PracticeArea', { defaultValue: 'Practice area' }) }) }}
						render={({ field: { onChange, value } }) => (
							<Select
								id={practiceAreaId}
								value={value}
								onChange={(next) => onChange(next as PracticeArea)}
								options={practiceAreaOptions}
								placeholder={t('Select_an_option')}
							/>
						)}
					/>
				</FieldRow>
				{errors.practiceArea && <FieldError>{errors.practiceArea.message}</FieldError>}
			</Field>

			<Box display='flex' marginBlockStart={12} marginInline='neg-x4'>
				<Field marginInline={4}>
					<FieldLabel>{t('First_name')}</FieldLabel>
					<FieldRow>
						<TextInput {...register('firstName', { required: t('Required_field', { field: t('First_name') }) })} />
					</FieldRow>
					{errors.firstName && <FieldError>{errors.firstName.message}</FieldError>}
				</Field>
				<Field marginInline={4}>
					<FieldLabel>{t('Last_name')}</FieldLabel>
					<FieldRow>
						<TextInput {...register('lastName')} />
					</FieldRow>
				</Field>
			</Box>

			<Box display='flex' marginBlockStart={12} marginInline='neg-x4'>
				<Field marginInline={4}>
					<FieldLabel>{t('Phone')}</FieldLabel>
					<FieldRow>
						<TextInput
							{...register('phone', {
								validate: (v) =>
									Boolean(v.trim() || email.trim()) || t('Boards_Lead_PhoneOrEmail', { defaultValue: 'Phone or email is required' }),
							})}
							placeholder='(555) 555-5555'
						/>
					</FieldRow>
					{errors.phone && <FieldError>{errors.phone.message}</FieldError>}
				</Field>
				<Field marginInline={4}>
					<FieldLabel>{t('Email')}</FieldLabel>
					<FieldRow>
						<TextInput {...register('email')} placeholder='name@example.com' />
					</FieldRow>
				</Field>
			</Box>

			<Field marginBlockStart={12}>
				<FieldLabel htmlFor={preferredId}>{t('Boards_PreferredContact', { defaultValue: 'Preferred contact' })}</FieldLabel>
				<FieldRow>
					<Controller
						control={control}
						name='preferredContact'
						render={({ field: { onChange, value } }) => (
							<Select id={preferredId} value={value} onChange={(next) => onChange(next)} options={preferredOptions} />
						)}
					/>
				</FieldRow>
			</Field>

			<Box display='flex' marginBlockStart={12} marginInline='neg-x4'>
				<Field marginInline={4}>
					<FieldLabel>{t('Boards_IncidentType', { defaultValue: 'Incident type' })}</FieldLabel>
					<FieldRow>
						<TextInput {...register('incidentType')} placeholder={t('Boards_IncidentType', { defaultValue: 'Incident type' })} />
					</FieldRow>
				</Field>
				<Field marginInline={4}>
					<FieldLabel>{t('Boards_IncidentDate', { defaultValue: 'Incident date' })}</FieldLabel>
					<FieldRow>
						<TextInput {...register('incidentDate')} placeholder='YYYY-MM-DD' />
					</FieldRow>
				</Field>
			</Box>

			<Box display='flex' marginBlockStart={12} marginInline='neg-x4'>
				<Field marginInline={4}>
					<FieldLabel>{t('Boards_JurisdictionState', { defaultValue: 'State (jurisdiction)' })}</FieldLabel>
					<FieldRow>
						<TextInput {...register('jurisdictionState')} placeholder='TX' />
					</FieldRow>
					<FieldHint>{t('Boards_JurisdictionStateHint', { defaultValue: 'Drives SOL rules' })}</FieldHint>
				</Field>
				<Field marginInline={4}>
					<FieldLabel>{t('Boards_Source', { defaultValue: 'Source' })}</FieldLabel>
					<FieldRow>
						<TextInput {...register('source')} placeholder={t('Boards_Source', { defaultValue: 'Source' })} />
					</FieldRow>
				</Field>
			</Box>

			{/* Conditional-by-practice-area fields */}
			{isMotorVehicle(practiceArea) && (
				<Field marginBlockStart={12}>
					<FieldLabel>{t('Boards_NumberOfVehicles', { defaultValue: 'Number of vehicles involved' })}</FieldLabel>
					<FieldRow>
						<TextInput {...register('numberOfVehicles')} placeholder='0' />
					</FieldRow>
				</Field>
			)}
			{isPremises(practiceArea) && (
				<Field marginBlockStart={12}>
					<FieldLabel>{t('Boards_PropertyType', { defaultValue: 'Property type' })}</FieldLabel>
					<FieldRow>
						<TextInput {...register('propertyType')} placeholder={t('Boards_PropertyType', { defaultValue: 'Property type' })} />
					</FieldRow>
				</Field>
			)}
			{isWorkersComp(practiceArea) && (
				<Field marginBlockStart={12}>
					<FieldLabel>{t('Boards_Employer', { defaultValue: 'Employer' })}</FieldLabel>
					<FieldRow>
						<TextInput {...register('employer')} />
					</FieldRow>
				</Field>
			)}
			{isWrongfulDeath(practiceArea) && (
				<Field marginBlockStart={12}>
					<FieldLabel>{t('Boards_DateOfDeath', { defaultValue: 'Date of death' })}</FieldLabel>
					<FieldRow>
						<TextInput {...register('dateOfDeath')} placeholder='YYYY-MM-DD' />
					</FieldRow>
				</Field>
			)}

			<Field marginBlockStart={12}>
				<FieldLabel>{t('Description')}</FieldLabel>
				<FieldRow>
					<TextAreaInput
						rows={3}
						{...register('description')}
						placeholder={t('Boards_Lead_BriefDescription', { defaultValue: 'Brief description of the incident' })}
					/>
				</FieldRow>
			</Field>

			{/* live conflict/duplicate hint area (also populated by the server response above) */}
			{!duplicateOf && (phone.trim() || email.trim()) && (
				<Box fontScale='c1' color='hint' marginBlockStart={8}>
					{t('Boards_Lead_DedupeNote', {
						defaultValue: 'Duplicate and conflict checks run on save against open leads.',
					})}
				</Box>
			)}
		</GenericModal>
	);
};

export default LeadCaptureModal;
