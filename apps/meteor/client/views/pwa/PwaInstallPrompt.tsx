import { css } from '@rocket.chat/css-in-js';
import { Box, Icon } from '@rocket.chat/fuselage';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePwaInstall } from './usePwaInstall';

/**
 * "Install MatterChat" affordance (spec B.3).
 *
 * A tasteful, one-time dismissible banner:
 *   • Chromium/Firefox: shows when a native install prompt is available; clicking
 *     fires deferredPrompt.prompt().
 *   • iOS Safari (no beforeinstallprompt): shows an "Add to Home Screen" hint.
 * Suppressed entirely when already installed (standalone) or running inside the
 * MatterChat desktop wrapper — handled in usePwaInstall via window.matterchatDesktop.
 * A dismissal is remembered in localStorage so we never nag.
 */

const DISMISS_KEY = 'mc_pwa_install_dismissed';

function isDismissed(): boolean {
	try {
		return localStorage.getItem(DISMISS_KEY) === '1';
	} catch {
		return false;
	}
}

function rememberDismiss(): void {
	try {
		localStorage.setItem(DISMISS_KEY, '1');
	} catch {
		/* ignore */
	}
}

const bannerClass = css`
	position: fixed;
	z-index: 1000;
	inset-block-end: 16px;
	inset-inline-start: 16px;
	display: flex;
	align-items: center;
	gap: 12px;
	max-width: 380px;
	padding: 12px 16px;
	border-radius: 10px;
	background: #0b1220;
	color: #e6edf6;
	box-shadow: 0 8px 28px rgba(0, 0, 0, 0.32);
	font-size: 14px;
`;

const installBtnClass = css`
	margin-inline-start: auto;
	display: inline-flex;
	align-items: center;
	gap: 6px;
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

const PwaInstallPrompt = (): ReactElement | null => {
	const { t } = useTranslation();
	const { canPromptInstall, showIosHint, promptInstall } = usePwaInstall();
	const [hidden, setHidden] = useState(() => isDismissed());

	if (hidden || (!canPromptInstall && !showIosHint)) {
		return null;
	}

	const dismiss = (): void => {
		rememberDismiss();
		setHidden(true);
	};

	const onInstall = async (): Promise<void> => {
		const outcome = await promptInstall();
		if (outcome !== 'unavailable') {
			setHidden(true);
		}
	};

	// iOS Safari: no programmatic prompt — show the Share -> Add to Home Screen hint.
	if (showIosHint && !canPromptInstall) {
		return (
			<Box className={bannerClass} role='status'>
				<Icon name='mobile' size='x20' />
				<Box is='span'>
					{t('PWA_Install_iOS_Hint', {
						defaultValue: 'To install MatterChat, tap Share then “Add to Home Screen”.',
					})}
				</Box>
				<Box
					is='button'
					type='button'
					className={dismissBtnClass}
					onClick={dismiss}
					aria-label={t('Dismiss', { defaultValue: 'Dismiss' })}
					title={t('Dismiss', { defaultValue: 'Dismiss' })}
				>
					<Icon name='cross' size='x16' />
				</Box>
			</Box>
		);
	}

	return (
		<Box className={bannerClass} role='status'>
			<Icon name='download' size='x20' />
			<Box is='span'>{t('PWA_Install_Prompt', { defaultValue: 'Install MatterChat for a faster, app-like experience.' })}</Box>
			<Box is='button' type='button' className={installBtnClass} onClick={onInstall}>
				<Icon name='download' size='x16' />
				{t('PWA_Install_MatterChat', { defaultValue: 'Install MatterChat' })}
			</Box>
			<Box
				is='button'
				type='button'
				className={dismissBtnClass}
				onClick={dismiss}
				aria-label={t('Dismiss', { defaultValue: 'Dismiss' })}
				title={t('Dismiss', { defaultValue: 'Dismiss' })}
			>
				<Icon name='cross' size='x16' />
			</Box>
		</Box>
	);
};

export default PwaInstallPrompt;
