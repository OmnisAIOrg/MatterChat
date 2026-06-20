import { useUser, useSetting, useEndpoint } from '@rocket.chat/ui-contexts';
import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';

type ReqOpts = { method?: string; body?: unknown };

/**
 * Thin REST client for the external Cross-Firm Correspondence Service (CFCS / "Omnis Counsel").
 * Resolves the attorney's STABLE identity from the server (services.omnisai.id — which RC does not
 * publish to the browser) via /api/v1/cross-firm.identity, then keys all CFCS calls on it. Falls back
 * to the Meteor user id only if there's no OmnisAI identity (e.g. a local admin login).
 */
export const useCrossFirmFetch = () => {
	const user = useUser();
	const cfcsUrl = String(useSetting('CrossFirm_CFCS_URL', '') || '').replace(/\/$/, '');
	const firmName = String(useSetting('CrossFirm_Firm_Name', '') || '');

	const getIdentity = useEndpoint('GET', '/v1/cross-firm.identity' as any);
	const { data: identity } = useQuery({
		queryKey: ['cf', 'identity', user?._id],
		queryFn: () => getIdentity(),
		enabled: Boolean(user?._id),
		staleTime: 5 * 60 * 1000,
	});

	const omnisaiId = (identity?.omnisaiId as string | undefined) || undefined;
	const userKey = omnisaiId || (identity?.userId as string | undefined) || user?._id || '';
	const displayName = (identity?.name as string | undefined) || user?.name || user?.username || userKey;

	const request = useCallback(
		async (path: string, opts: ReqOpts = {}): Promise<any> => {
			if (!cfcsUrl) {
				throw new Error('Cross-firm service URL is not configured (CrossFirm_CFCS_URL).');
			}
			const res = await fetch(`${cfcsUrl}${path}`, {
				method: opts.method || 'GET',
				headers: {
					'Content-Type': 'application/json',
					'X-User-Id': user?._id || '',
					'X-Omnisai-Id': omnisaiId || '',
				},
				body: opts.body ? JSON.stringify(opts.body) : undefined,
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				throw new Error((data as { error?: string })?.error || `Cross-firm service error ${res.status}`);
			}
			return data;
		},
		[cfcsUrl, user?._id, omnisaiId],
	);

	return { request, cfcsUrl, firmName, userKey, displayName };
};
