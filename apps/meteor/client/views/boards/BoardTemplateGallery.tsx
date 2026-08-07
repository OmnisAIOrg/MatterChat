import type { IBoardTemplate } from '@rocket.chat/core-typings';
import { Box, Button, Callout, Icon, Tag, Throbber } from '@rocket.chat/fuselage';
import type { Keys as IconName } from '@rocket.chat/icons';
import { useEndpoint } from '@rocket.chat/ui-contexts';
import { useQuery } from '@tanstack/react-query';
import { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

type BoardTemplateGalleryProps = {
	pipelineType?: string;
	onSelectTemplate: (template: Partial<IBoardTemplate>) => void;
	isLoading?: boolean;
};

export const BoardTemplateGallery = ({ pipelineType, onSelectTemplate, isLoading = false }: BoardTemplateGalleryProps): ReactElement => {
	const { t } = useTranslation();
	const listTemplates = useEndpoint('GET', '/v1/boards.templates.list');

	const {
		data,
		isLoading: queryLoading,
		isError,
	} = useQuery({
		queryKey: ['boards', 'templates', { pipelineType }],
		queryFn: () => listTemplates({ pipelineType }),
	});

	const templates = (data?.templates as Partial<IBoardTemplate>[] | undefined) ?? [];

	if (queryLoading || isLoading) {
		return (
			<Box display='flex' justifyContent='center' padding={16}>
				<Throbber />
			</Box>
		);
	}

	if (isError) {
		return (
			<Callout type='danger' title={t('Error')}>
				{t('Error_loading_templates')}
			</Callout>
		);
	}

	if (templates.length === 0) {
		return (
			<Box fontScale='c1' color='hint' padding={8}>
				{t('No_board_templates_available')}
			</Box>
		);
	}

	return (
		<Box>
			<Box fontScale='c1' color='hint' marginBlockEnd={8}>
				{t('Boards_Select_Template_Hint', {
					defaultValue: 'Start with a pre-built template to save time.',
				})}
			</Box>
			<Box display='grid' gridTemplateColumns='repeat(auto-fill, minmax(300px, 1fr))' gap={12}>
				{templates.map((template) => (
					<Box
						key={template._id}
						display='flex'
						flexDirection='column'
						padding={12}
						backgroundColor='tint'
						borderRadius='x4'
						style={{
							cursor: 'pointer',
							transition: 'all 120ms',
							border: '1px solid transparent',
						}}
						onMouseEnter={(e) => {
							e.currentTarget.style.borderColor = 'var(--rcx-color-info-500)';
						}}
						onMouseLeave={(e) => {
							e.currentTarget.style.borderColor = 'transparent';
						}}
					>
						<Box display='flex' alignItems='center' marginBlockEnd={4}>
							<Box fontScale='p2b' color='default' withTruncatedText flexGrow={1}>
								{template.name}
							</Box>
						</Box>

						{template.description && (
							<Box fontScale='c1' color='hint' marginBlockEnd={8}>
								{template.description}
							</Box>
						)}

						<Box fontScale='c2' color='hint' marginBlockEnd={8}>
							{t('Boards_Lists_Count', { count: template.lists?.length ?? 0 })}
						</Box>

						{template.usageCount ? (
							<Box fontScale='c2' color='hint' marginBlockEnd={12}>
								{t('Boards_Template_Used_Count', { defaultValue: 'Used {count} times', count: template.usageCount })}
							</Box>
						) : null}

						<Button primary small onClick={() => onSelectTemplate(template)}>
							<Icon name='plus' size='x16' marginInlineEnd={4} />
							{t('Use_Template')}
						</Button>
					</Box>
				))}
			</Box>
		</Box>
	);
};

export default BoardTemplateGallery;
