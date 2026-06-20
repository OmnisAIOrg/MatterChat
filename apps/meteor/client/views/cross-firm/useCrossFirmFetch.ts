import { useUser, useSetting } from '@rocket.chat/ui-contexts';
import { useCallback } from 'react';

type ReqOpts = { method?: string; body?: unknown };

/**
 * Thin REST client for the external Cross-Firm Correspondence Service (CFCS / "Omnis Counsel").
 * Not an RC-internal endpoint — talks to a separate shared service at CrossFirm_CFCS_URL, passing the
 * attorney's CentralizedAuth identity (services.omnisai.id) so CFCS can map the user to an attorney.
 */
export const useCrossFirmFetch = () => {
	const user = useUser();
	const cfcsUrl = String(useSetting('CrossFirm_CFCS_URL', '') || '').replace(/\/$/, '');
	const firmName = String(useSetting('CrossFirm_Firm_Name', '') || '');
	const omnisaiId = (user as { services?: { omnisai?: { id?: string } } } | null)?.services?.omnisai?.id;
	const userKey = omnisaiId || user?._id || '';
	const displayName = user?.name || user?.username || userKey;

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
