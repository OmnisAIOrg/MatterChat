import { css } from '@rocket.chat/css-in-js';
import { Box, Icon } from '@rocket.chat/fuselage';
import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PWA_UPDATE_EVENT, applyPwaUpdate, isPwaUpdateAvailable } from '../../serviceWorker';

/**
 * Non-blocking "New version available — Reload" toast (spec B.2).
 *
 * Replaces RC's old auto-reload-within-10s behavior. We let the user choose when
 * to reload so we never interrupt an in-progress message. Driven by the
 * `mc:pwa-update-available` event fired from serviceWorker.ts when an updated SW
 * finishes installing while another is still controlling the page.
 */

const toastClass = css`
	position: fixed;
	z-index: 1000;
	inset-block-end: 16px;
	inset-inline-end: 16px;
	display: flex;
	align-items: center;
	gap: 12px;
	max-width: 360px;
	padding: 12px 16px;
	border-radius: 10px;
	background: #0b1220;
	color: #e6edf6;
	box-shadow: 0 8px 28px rgba(0, 0, 0, 0.32);
	font-size: 14px;
`;

const reloadBtnClass = css`
	margin-inline-start: auto;
	border: 0;
	border-radius: 8px;
	padding: 6px 14px;
	background: #2f6fed;
	color: #ffffff;
	font-family: inherit;
	font-size: 13px;
	font-weight: 600;
	line-height: 1;
	cursor: pointer;
	white-space: nowrap;

	&:hover {
		background: #2660d8;
	}

	&:focus-visible {
		outline: 2px solid #ffffff;
		outline-offset: 1px;
	}
`;

const dismissBtnClass = css`
	border: 0;
	border-radius: 8px;
	padding: 4px;
	background: transparent;
	color: #9fb0c3;
	cursor: pointer;
	display: inline-flex;

	&:hover {
		color: #e6edf6;
	}
`;

const PwaUpdatePrompt = (): ReactElement | null => {
	const { t } = useTranslation();
	const [visible, setVisible] = useState(() => isPwaUpdateAvailable());

	useEffect(() => {
		const onUpdate = (): void => setVisible(true);
		window.addEventListener(PWA_UPDATE_EVENT, onUpdate);
		return () => window.removeEventListener(PWA_UPDATE_EVENT, onUpdate);
	}, []);

	if (!visible) {
		return null;
	}

	return (
		<Box className={toastClass} role='status' aria-live='polite'>
			<Icon name='reload' size='x20' />
			<Box is='span'>{t('PWA_Update_Available', { defaultValue: 'A new version of MatterChat is available.' })}</Box>
			<Box is='button' type='button' className={reloadBtnClass} onClick={(): void => applyPwaUpdate()}>
				{t('Reload', { defaultValue: 'Reload' })}
			</Box>
			<Box
				is='button'
				type='button'
				className={dismissBtnClass}
				onClick={(): void => setVisible(false)}
				aria-label={t('Dismiss', { defaultValue: 'Dismiss' })}
				title={t('Dismiss', { defaultValue: 'Dismiss' })}
			>
				<Icon name='cross' size='x16' />
			</Box>
		</Box>
	);
};

export default PwaUpdatePrompt;
