import { readInt, readString, safeGetSetting } from '../omnis/config';

/**
 * Upload-link configuration.
 *
 * LitBox is the one product here whose integration ALREADY exists, so this does
 * not register the shared seven connection settings — the file browser, the
 * `/_litbox` proxy and `LITBOX_API_URL` are all in place and reused as-is.
 *
 * One thing genuinely is new. The existing proxy authenticates with **the
 * caller's own** LitBox credential, which works because every caller is a
 * logged-in MatterChat user. An upload link is used by someone with NO account,
 * so that path cannot serve it: the anonymous leg needs a service credential.
 * `Litbox_Service_Api_Key` exists for that and nothing else, and it is used
 * only on the upload-link write path — never to widen what a logged-in user can
 * reach.
 */

export type LitboxLinksConfig = {
	enabled: boolean;
	/** LitBox API base, from the same env var the proxy uses. */
	baseUrl: string;
	/** Service credential for the ANONYMOUS upload leg only. */
	serviceApiKey: string;
	defaultExpiryDays: number;
	maxFileBytes: number;
	maxFiles: number;
	/** Public origin used to build the shareable link. */
	siteUrl: string;
};

export function resolveLitboxLinksConfig(): LitboxLinksConfig {
	const maxFileMb = readInt('LITBOX_UPLOAD_LINK_MAX_FILE_MB', 'Litbox_Upload_Link_Max_File_MB', 50, 1);

	return {
		enabled: safeGetSetting<boolean>('Litbox_Upload_Links_Enabled') === true,
		baseUrl: (process.env.LITBOX_API_URL || '').trim().replace(/\/+$/, ''),
		serviceApiKey: readString('LITBOX_SERVICE_API_KEY', 'Litbox_Service_Api_Key'),
		defaultExpiryDays: readInt('LITBOX_UPLOAD_LINK_DEFAULT_EXPIRY_DAYS', 'Litbox_Upload_Link_Default_Expiry_Days', 30, 1),
		maxFileBytes: maxFileMb * 1024 * 1024,
		maxFiles: readInt('LITBOX_UPLOAD_LINK_MAX_FILES', 'Litbox_Upload_Link_Max_Files', 25, 1),
		siteUrl: (safeGetSetting<string>('Site_Url') || '').trim().replace(/\/+$/, ''),
	};
}

/** The public URL a recipient opens. */
export function uploadLinkUrl(cfg: LitboxLinksConfig, token: string): string {
	return `${cfg.siteUrl}/omnis-widgets/upload-link.html#${token}`;
}
