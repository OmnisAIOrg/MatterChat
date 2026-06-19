import type { BoardsPipelineType } from '@rocket.chat/core-typings';
import type { SelectOption } from '@rocket.chat/fuselage';
import { Field, FieldLabel, FieldRow, FieldError, Select, TextInput, Box } from '@rocket.chat/fuselage';
import { GenericModal } from '@rocket.chat/ui-client';
import { useId, useMemo } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

export type NewBoardFormValues = {
	title: string;
	pipelineType: BoardsPipelineType;
};

type NewBoardModalProps = {
	onConfirm: (values: NewBoardFormValues) => Promise<void> | void;
	onClose: () => void;
};

const NewBoardModal = ({ onConfirm, onClose }: NewBoardModalProps) => {
	const { t } = useTranslation();

	const {
		register,
		control,
		handleSubmit,
		formState: { errors, isSubmitting },
	} = useForm<NewBoardFormValues>({
		defaultValues: { title: '', pipelineType: 'general' },
	});

	const titleId = useId();
	const pipelineId = useId();

	const pipelineOptions = useMemo<SelectOption[]>(
		() => [
			['general', t('Boards_Pipeline_general')],
			['matters', t('Boards_Pipeline_matters')],
			['leads', t('Boards_Pipeline_leads')],
		],
		[t],
	);

	return (
		<GenericModal
			wrapperFunction={(props) => <Box is='form' onSubmit={handleSubmit((values) => onConfirm(values))} {...props} />}
			title={t('Boards_New_Board')}
			confirmText={t('Create')}
			onCancel={onClose}
			onClose={onClose}
			confirmDisabled={isSubmitting}
		>
			<Field>
				<FieldLabel htmlFor={titleId}>{t('Title')}</FieldLabel>
				<FieldRow>
					<TextInput
						id={titleId}
						{...register('title', { required: t('Required_field', { field: t('Title') }) })}
						aria-required='true'
						aria-invalid={errors.title ? 'true' : 'false'}
						aria-describedby={`${titleId}-error`}
						placeholder={t('Board')}
					/>
				</FieldRow>
				{errors.title && (
					<FieldError aria-live='assertive' id={`${titleId}-error`}>
						{errors.title.message}
					</FieldError>
				)}
			</Field>
			<Field mbs={12}>
				<FieldLabel htmlFor={pipelineId}>{t('Type')}</FieldLabel>
				<FieldRow>
					<Controller
						control={control}
						name='pipelineType'
						render={({ field: { onChange, value } }) => (
							<Select id={pipelineId} value={value} onChange={(next) => onChange(next as BoardsPipelineType)} options={pipelineOptions} />
						)}
					/>
				</FieldRow>
			</Field>
		</GenericModal>
	);
};

export default NewBoardModal;
