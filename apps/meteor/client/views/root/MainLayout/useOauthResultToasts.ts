/**
 * useOauthResultToasts — display OAuth connection results from query parameters.
 *
 * After an OAuth flow (Slack / Teams / Google Chat / OmnisAI login), the OAuth callback redirects
 * to /home with result params in the query string (slack_connected, teams_connected, google_connected,
 * omnisai_error, etc.). This hook reads those params on mount, displays a toast for each, and
 * strips them from the URL so refresh doesn't re-toast.
 *
 * Mounted once in Preload or LayoutWithSidebar so it fires early in the app lifecycle.
 */
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { useToastMessageDispatch } from '@rocket.chat/ui-contexts';

interface OAuthResult {
	param: string;
	type: 'slack' | 'teams' | 'google' | 'omnisai';
	isSuccess: boolean;
}

const parseOAuthResults = (searchParams: URLSearchParams): OAuthResult[] => {
	const results: OAuthResult[] = [];

	if (searchParams.has('slack_connected')) {
		results.push({ param: 'slack_connected', type: 'slack', isSuccess: true });
	}
	if (searchParams.has('slack_error')) {
		results.push({ param: 'slack_error', type: 'slack', isSuccess: false });
	}

	if (searchParams.has('teams_connected')) {
		results.push({ param: 'teams_connected', type: 'teams', isSuccess: true });
	}
	if (searchParams.has('teams_error')) {
		results.push({ param: 'teams_error', type: 'teams', isSuccess: false });
	}

	if (searchParams.has('google_connected')) {
		results.push({ param: 'google_connected', type: 'google', isSuccess: true });
	}
	if (searchParams.has('google_error')) {
		results.push({ param: 'google_error', type: 'google', isSuccess: false });
	}

	if (searchParams.has('omnisai_error')) {
		results.push({ param: 'omnisai_error', type: 'omnisai', isSuccess: false });
	}

	return results;
};

export const useOauthResultToasts = (): void => {
	const { t } = useTranslation();
	const dispatchToast = useToastMessageDispatch();

	useEffect(() => {
		const searchParams = new URLSearchParams(window.location.search);
		const results = parseOAuthResults(searchParams);

		if (results.length === 0) {
			return;
		}

		// Display a toast for each OAuth result
		results.forEach((result) => {
			if (result.isSuccess) {
				const message =
					result.type === 'slack'
						? t('Slack_Connected', { defaultValue: 'Slack connected — your workspace is ready' })
						: result.type === 'teams'
							? t('Teams_Connected', { defaultValue: 'Teams connected — your workspace is ready' })
							: t('Google_Chat_Connected', { defaultValue: 'Google Chat connected — your workspace is ready' });

				dispatchToast({
					type: 'success',
					message,
				});
			} else {
				const errorReason = searchParams.get(result.param) || 'Unknown error';
				const message =
					result.type === 'slack'
						? t('Slack_Connection_Failed', { defaultValue: 'Slack connection failed: {reason}', reason: errorReason })
						: result.type === 'teams'
							? t('Teams_Connection_Failed', { defaultValue: 'Teams connection failed: {reason}', reason: errorReason })
							: result.type === 'google'
								? t('Google_Chat_Connection_Failed', { defaultValue: 'Google Chat connection failed: {reason}', reason: errorReason })
								: t('OmnisAI_Login_Failed', { defaultValue: 'OmnisAI login failed: {reason}', reason: errorReason });

				dispatchToast({
					type: 'error',
					message,
				});
			}
		});

		// Strip the OAuth result params from the URL to prevent re-toasting on refresh
		const paramsToRemove = results.map((r) => r.param);
		paramsToRemove.forEach((param) => {
			searchParams.delete(param);
		});

		const newSearch = searchParams.toString();
		const newUrl = newSearch ? `${window.location.pathname}?${newSearch}` : window.location.pathname;

		window.history.replaceState({}, '', newUrl);
	}, [t, dispatchToast]);
};
