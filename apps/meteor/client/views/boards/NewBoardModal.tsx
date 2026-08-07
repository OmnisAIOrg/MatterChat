import type { BoardsPipelineType, IBoardTemplate } from '@rocket.chat/core-typings';
import type { SelectOption } from '@rocket.chat/fuselage';
import { Field, FieldLabel, FieldRow, FieldError, Select, TextInput, Box, Button } from '@rocket.chat/fuselage';
import { GenericModal } from '@rocket.chat/ui-client';
import { useState, useId, useMemo } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import BoardTemplateGallery from './BoardTemplateGallery';

export type NewBoardFormValues = {
	title: string;
	pipelineType: BoardsPipelineType;
	templateId?: string;
};

type NewBoardModalProps = {
	onConfirm: (values: NewBoardFormValues) => Promise<void> | void;
	onClose: () => void;
};

const NewBoardModal = ({ onConfirm, onClose }: NewBoardModalProps) => {
	const { t } = useTranslation();
	const [showTemplates, setShowTemplates] = useState(false);
	const [selectedTemplate, setSelectedTemplate] = useState<Partial<IBoardTemplate> | null>(null);

	const {
		register,
		control,
		handleSubmit,
		formState: { errors, isSubmitting },
		watch,
		setValue,
	} = useForm<NewBoardFormValues>({
		defaultValues: { title: '', pipelineType: 'general', templateId: undefined },
	});

	const pipelineType = watch('pipelineType');

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

	const handleSelectTemplate = (template: Partial<IBoardTemplate>) => {
		setSelectedTemplate(template);
		setValue('templateId', template._id);
		setValue('pipelineType', template.pipelineType || 'general');
		setShowTemplates(false);
	};

	if (showTemplates) {
		return (
			<GenericModal
				title={t('Boards_Select_Template')}
				confirmText={t('Cancel')}
				onCancel={onClose}
				onClose={onClose}
				confirmDisabled={false}
				onConfirm={() => setShowTemplates(false)}
			>
				<BoardTemplateGallery pipelineType={pipelineType} onSelectTemplate={handleSelectTemplate} />
			</GenericModal>
		);
	}

	return (
		<GenericModal
			wrapperFunction={(props) => <Box is='form' onSubmit={handleSubmit((values) => onConfirm(values))} {...props} />}
			title={t('Boards_New_Board')}
			confirmText={t('Create')}
			onCancel={onClose}
			onClose={onClose}
			confirmDisabled={isSubmitting}
		>
			{selectedTemplate && (
				<Box marginBlockEnd={16} padding={12} backgroundColor='tint' borderRadius='x4'>
					<Box fontScale='p2b' marginBlockEnd={4}>
						{t('Template_Selected')}: {selectedTemplate.name}
					</Box>
					<Button
						small
						secondary
						onClick={() => {
							setSelectedTemplate(null);
							setValue('templateId', undefined);
							setShowTemplates(false);
						}}
					>
						{t('Change_Template')}
					</Button>
				</Box>
			)}

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
			<Field marginBlockStart={12}>
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

			<Box marginBlockStart={12} display='flex' gap={8}>
				<Button secondary onClick={() => setShowTemplates(true)}>
					{t('Browse_Templates')}
				</Button>
			</Box>
		</GenericModal>
	);
};

export default NewBoardModal;
