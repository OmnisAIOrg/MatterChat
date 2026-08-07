import type { IAutomation, Serialized } from '@rocket.chat/core-typings';
import { Box, Button, Callout, Icon, Tag, Throbber } from '@rocket.chat/fuselage';
import type { Keys as IconName } from '@rocket.chat/icons';
import { useEndpoint, useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { KIND_LABEL } from './lib/catalog';

/**
 * TemplateGallery — the "Templates" tab of the per-board Automations manager (M7 client).
 *
 * Lists the prebuilt automation catalog via `GET /v1/boards.automations.templates.list`
 * (the seeded `isTemplate` rows the dispatcher never fires) and, per template, offers
 * "Install to this board" → `POST /v1/boards.automations.templates.install
 * { templateId, boardId }`, which clones the template into a board-scoped, enabled,
 * non-template automation. On success we refresh the rules list (the new clone shows
 * up there) and toast — surfacing the server's `alreadyInstalled` flag and any
 * unresolvable-binding `notes[]` (e.g. a referenced list/label not found on this board).
 *
 * Install is gated by `boards-manage-automations` (the parent passes `canManage`),
 * mirroring AutomationsContextualBar's create/edit gating.
 */

type TemplateGalleryProps = {
	boardId: string;
	canManage: boolean;
	/** the rules-list query key to invalidate after an install (so the clone appears) */
	rulesQueryKey: readonly unknown[];
};

const TemplateGallery = ({ boardId, canManage, rulesQueryKey }: TemplateGalleryProps): ReactElement => {
	const { t } = useTranslation();
	const dispatchToastMessage = useToastMessageDispatch();
	const queryClient = useQueryClient();

	const listTemplates = useEndpoint('GET', '/v1/boards.automations.templates.list');
	const installTemplate = useEndpoint('POST', '/v1/boards.automations.templates.install');

	const { data, isLoading, isError, refetch } = useQuery({
		queryKey: ['boards', 'automations', 'templates'],
		queryFn: () => listTemplates({}),
	});

	const installMutation = useMutation({
		mutationFn: (templateId: string) => installTemplate({ templateId, boardId }),
		onSuccess: (result) => {
			if (result.alreadyInstalled) {
				dispatchToastMessage({
					type: 'info',
					message: t('Boards_Automation_Template_AlreadyInstalled', { defaultValue: 'Already installed on this board' }),
				});
			} else {
				dispatchToastMessage({
					type: 'success',
					message: t('Boards_Automation_Template_Installed', { defaultValue: 'Template installed' }),
				});
			}
			// surface any unresolvable bindings the server reported (lists/labels not on this board).
			(result.notes ?? []).forEach((note) => dispatchToastMessage({ type: 'warning', message: note }));
			void queryClient.invalidateQueries({ queryKey: rulesQueryKey });
		},
		onError: (error) => dispatchToastMessage({ type: 'error', message: error }),
	});

	if (isLoading) {
		return (
			<Box display='flex' justifyContent='center' padding={16}>
				<Throbber />
			</Box>
		);
	}

	if (isError || !data) {
		return (
			<Callout type='danger' icon='warning' title={t('Something_went_wrong')}>
				<Button small marginBlockStart={8} onClick={() => refetch()}>
					{t('Reload_page')}
				</Button>
			</Callout>
		);
	}

	const templates = (data.templates as Serialized<IAutomation>[] | undefined) ?? [];

	if (templates.length === 0) {
		return (
			<Box fontScale='c1' color='hint' padding={8}>
				{t('No_results_found')}
			</Box>
		);
	}

	return (
		<Box>
			<Box fontScale='c1' color='hint' marginBlockEnd={8}>
				{t('Boards_Automation_Templates_Hint', { defaultValue: 'Prebuilt automations you can install onto this board.' })}
			</Box>
			{templates.map((template) => {
				const installing = installMutation.isPending && installMutation.variables === template._id;
				return (
					<Box key={template._id} marginBlockEnd={8} paddingBlock={12} paddingInline={12} backgroundColor='tint' borderRadius='x4'>
						<Box display='flex' alignItems='flex-start' justifyContent='space-between' style={{ gap: '12px' }}>
							<Box flexGrow={1} minWidth={0}>
								<Box display='flex' alignItems='center' marginBlockEnd={2}>
									{template.icon && <Icon name={template.icon as IconName} size='x16' marginInlineEnd={6} color='hint' />}
									<Box fontScale='p2b' color='default' withTruncatedText marginInlineEnd={6}>
										{template.name}
									</Box>
									<Tag variant='secondary'>{t(KIND_LABEL[template.kind] as Parameters<typeof t>[0])}</Tag>
								</Box>
								{template.description && (
									<Box fontScale='c1' color='hint'>
										{template.description}
									</Box>
								)}
							</Box>
							{canManage && (
								<Button
									small
									primary
									disabled={installMutation.isPending}
									onClick={() => installMutation.mutate(template._id)}
									style={{ flexShrink: 0 }}
								>
									{installing ? (
										<Throbber inheritColor size='x12' />
									) : (
										<>
											<Icon name='plus' size='x16' marginInlineEnd={4} />
											{t('Boards_Automation_Template_Install', { defaultValue: 'Install to this board' })}
										</>
									)}
								</Button>
							)}
						</Box>
					</Box>
				);
			})}
		</Box>
	);
};

export default TemplateGallery;
