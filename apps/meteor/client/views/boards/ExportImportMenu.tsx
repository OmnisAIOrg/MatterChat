import type { ReactElement } from 'react';
import { useState } from 'react';
import type { Keys as IconName } from '@rocket.chat/icons';
import { GenericMenu } from '@rocket.chat/ui-client';
import type { GenericMenuItemProps } from '@rocket.chat/ui-client';
import { usePermission } from '@rocket.chat/ui-contexts';
import { useTranslation } from 'react-i18next';
import type { IBoardList, Serialized } from '@rocket.chat/core-typings';
import { ExportModal } from './export';
import { ImportModal } from './import';

type ExportImportMenuProps = {
	boardId: string;
	boardTitle: string;
	lists: Serialized<IBoardList>[];
};

const ExportImportMenu = ({
	boardId,
	boardTitle,
	lists,
}: ExportImportMenuProps): ReactElement | null => {
	const { t } = useTranslation();
	const canManageBoard = usePermission('boards-manage');
	const [exportOpen, setExportOpen] = useState(false);
	const [importOpen, setImportOpen] = useState(false);

	if (!canManageBoard) {
		return null;
	}

	const items: GenericMenuItemProps[] = [
		{
			id: 'export',
			icon: 'download' as IconName,
			content: t('Boards_Export', { defaultValue: 'Export board' }),
			onClick: () => setExportOpen(true),
		},
		{
			id: 'import',
			icon: 'upload' as IconName,
			content: t('Boards_Import', { defaultValue: 'Import board' }),
			onClick: () => setImportOpen(true),
		},
	];

	return (
		<>
			<GenericMenu
				title={t('Boards_ExportImport', { defaultValue: 'Export/Import' })}
				icon='download'
				items={items}
				placement='bottom-end'
			/>
			{exportOpen && (
				<ExportModal
					boardId={boardId}
					boardTitle={boardTitle}
					lists={lists}
					onClose={() => setExportOpen(false)}
				/>
			)}
			{importOpen && <ImportModal onClose={() => setImportOpen(false)} />}
		</>
	);
};

export default ExportImportMenu;
