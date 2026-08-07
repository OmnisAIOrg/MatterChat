import { Box, Field, FieldLabel, FieldRow, FieldError, TextInput, Select, Throbber } from '@rocket.chat/fuselage';
import { GenericModal } from '@rocket.chat/ui-client';
import { useEndpoint, useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import { useMutation } from '@tanstack/react-query';
import { useId, useMemo } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

type SaveAsTemplateModalProps = {
	boardId: string;
	onClose: () => void;
};

export const SaveAsTemplateModal = ({ boardId, onClose }: SaveAsTemplateModalProps) => {
	const { t } = useTranslation();
	const dispatchToastMessage = useToastMessageDispatch();
	const saveTemplate = useEndpoint('POST', '/v1/boards.templates.save');

	const {
		register,
		control,
		handleSubmit,
		formState: { errors, isSubmitting },
	} = useForm<{
		name: string;
		description: string;
		visibility: 'private' | 'team' | 'firm';
	}>({
		defaultValues: {
			name: '',
			description: '',
			visibility: 'firm',
		},
	});

	const nameId = useId();
	const descriptionId = useId();
	const visibilityId = useId();

	const visibilityOptions = useMemo<Array<[string, string]>>(
		() => [
			['private', t('Boards_Template_Visibility_Private')],
			['team', t('Boards_Template_Visibility_Team')],
			['firm', t('Boards_Template_Visibility_Firm')],
		],
		[t],
	);

	const mutation = useMutation({
		mutationFn: async (data: { name: string; description: string; visibility: string }) =>
			saveTemplate({
				boardId,
				name: data.name,
				description: data.description,
				visibility: data.visibility,
			}),
		onSuccess: () => {
			dispatchToastMessage({
				type: 'success',
				message: t('Boards_Template_Saved', { defaultValue: 'Template saved successfully' }),
			});
			onClose();
		},
		onError: (error: any) => {
			dispatchToastMessage({
				type: 'error',
				message: error.message || t('Error'),
			});
		},
	});

	return (
		<GenericModal
			wrapperFunction={(props) => <Box is='form' onSubmit={handleSubmit((data) => mutation.mutate(data))} {...props} />}
			title={t('Boards_Save_As_Template')}
			confirmText={t('Save')}
			onCancel={onClose}
			onClose={onClose}
			confirmDisabled={isSubmitting || mutation.isPending}
		>
			<Field>
				<FieldLabel htmlFor={nameId}>{t('Name')}</FieldLabel>
				<FieldRow>
					<TextInput
						id={nameId}
						{...register('name', { required: t('Required_field', { field: t('Name') }) })}
						aria-required='true'
						aria-invalid={errors.name ? 'true' : 'false'}
						aria-describedby={`${nameId}-error`}
						placeholder={t('Template_name')}
					/>
				</FieldRow>
				{errors.name && <FieldError id={`${nameId}-error`}>{errors.name.message}</FieldError>}
			</Field>

			<Field marginBlockStart={12}>
				<FieldLabel htmlFor={descriptionId}>
					{t('Description')} ({t('Optional')})
				</FieldLabel>
				<FieldRow>
					<TextInput
						id={descriptionId}
						{...register('description')}
						placeholder={t('Template_description_placeholder')}
						aria-describedby={`${descriptionId}-hint`}
					/>
				</FieldRow>
			</Field>

			<Field marginBlockStart={12}>
				<FieldLabel htmlFor={visibilityId}>{t('Visibility')}</FieldLabel>
				<FieldRow>
					<Controller
						control={control}
						name='visibility'
						render={({ field: { onChange, value } }) => (
							<Select id={visibilityId} value={value} onChange={(next) => onChange(next)} options={visibilityOptions} />
						)}
					/>
				</FieldRow>
			</Field>

			{mutation.isPending && (
				<Box display='flex' justifyContent='center' marginBlockStart={16}>
					<Throbber />
				</Box>
			)}
		</GenericModal>
	);
};

export default SaveAsTemplateModal;
