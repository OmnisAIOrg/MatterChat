import { css } from '@rocket.chat/css-in-js';
import { Box } from '@rocket.chat/fuselage';
import { useStableCallback } from '@rocket.chat/fuselage-hooks';
import type { DragEvent, ReactNode } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useFormatDateAndTime } from '../../../hooks/useFormatDateAndTime';

export type DropTargetOverlayProps = {
	enabled: boolean;
	reason?: ReactNode;
	onFileDrop?: (files: File[]) => void;
	visible?: boolean;
	onDismiss?: () => void;
	// MATTERCHAT: optional copy override so a matter channel can say what the drop
	// will actually DO ("Drop to process with AutoDoc" / "Files are read and filed
	// to Alvarez v. Diaz") instead of the generic upload line. Both optional; when
	// absent the overlay is byte-for-byte the upstream one.
	title?: ReactNode;
	subtitle?: ReactNode;
};

function DropTargetOverlay({ enabled, reason, onFileDrop, visible = true, onDismiss, title, subtitle }: DropTargetOverlayProps) {
	const { t } = useTranslation();

	const handleDragLeave = useStableCallback((event: DragEvent) => {
		event.stopPropagation();
		onDismiss?.();
	});

	const handleDragOver = useStableCallback((event: DragEvent) => {
		event.stopPropagation();

		event.preventDefault();
		event.dataTransfer.dropEffect = ['move', 'linkMove'].includes(event.dataTransfer.effectAllowed) ? 'move' : 'copy';
	});

	const formatDateAndTime = useFormatDateAndTime();

	const handleDrop = useStableCallback(async (event: DragEvent) => {
		event.stopPropagation();
		onDismiss?.();

		event.preventDefault();

		const files = Array.from(event.dataTransfer.files);

		if (event.dataTransfer.types.includes('text/uri-list') && event.dataTransfer.types.includes('text/html')) {
			const fragment = document.createRange().createContextualFragment(event.dataTransfer.getData('text/html'));
			for await (const { src } of Array.from(fragment.querySelectorAll('img'))) {
				try {
					const response = await fetch(src);
					const data = await response.blob();
					const extension = (await import('../../../../app/utils/lib/mimeTypes')).mime.extension(data.type);
					const filename = `File - ${formatDateAndTime(new Date())}.${extension}`;
					const file = new File([data], filename, { type: data.type });
					files.push(file);
				} catch (error) {
					console.warn(error);
				}
			}
		}

		onFileDrop?.(files);
	});

	if (!visible) {
		return null;
	}

	return (
		<Box
			role='dialog'
			data-qa='DropTargetOverlay'
			position='absolute'
			zIndex={1_000_000}
			inset={0}
			display='flex'
			// MATTERCHAT: column so the optional subtitle sits under the title.
			flexDirection='column'
			alignItems='center'
			justifyContent='center'
			fontScale='hero'
			textAlign='center'
			backgroundColor='surface-overlay'
			borderWidth={4}
			borderStyle='dashed'
			borderColor='currentColor'
			color={enabled ? 'default' : 'danger'}
			className={css`
				animation-name: zoom-in;
				animation-duration: 0.1s;
			`}
			onDragLeave={handleDragLeave}
			onDragOver={handleDragOver}
			onDrop={handleDrop}
		>
			{/* MATTERCHAT: `title`/`subtitle` override the generic line when a product
			    claims the drop (see client/omnis/autodoc/useAutoDocChannelDrop.ts). */}
			{enabled ? (title ?? t('Drop_to_upload_file')) : reason}
			{enabled && subtitle && (
				<Box fontScale='p2' marginBlockStart={8}>
					{subtitle}
				</Box>
			)}
		</Box>
	);
}

export default memo(DropTargetOverlay);
