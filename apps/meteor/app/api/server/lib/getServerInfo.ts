import { createHash } from 'crypto';

import type { IWorkspaceInfo } from '@rocket.chat/core-typings';

import { getTrimmedServerVersion } from './getTrimmedServerVersion';
import { hasPermissionAsync } from '../../../authorization/server/functions/hasPermission';
import {
	getCachedSupportedVersionsToken,
	wrapPromise,
} from '../../../cloud/server/functions/supportedVersionsToken/supportedVersionsToken';
import { settings } from '../../../settings/server';
import { Info, minimumClientVersions } from '../../../utils/rocketchat.info';

export async function getServerInfo(userId?: string): Promise<IWorkspaceInfo> {
	const hasPermissionToViewStatistics = userId && (await hasPermissionAsync(userId, 'view-statistics'));
	const supportedVersionsToken = await wrapPromise(getCachedSupportedVersionsToken());
	const cloudWorkspaceId = settings.get<string | undefined>('Cloud_Workspace_Id');

	// MATTERCHAT: the EE license service used to supply these from cloud-registration data.
	// Pure-MIT fork: derive them from the workspace's own Site_Url so /api/info keeps
	// identifying the workspace for mobile/desktop clients.
	const siteUrl = settings.get<string>('Site_Url') || '';

	return {
		workspaceUrl: siteUrl,
		hashedWorkspaceUrl: siteUrl ? createHash('sha256').update(siteUrl).digest('hex') : '',
		version: getTrimmedServerVersion(),
		...(hasPermissionToViewStatistics && {
			info: {
				...Info,
			},
			version: Info.version,
		}),

		minimumClientVersions,
		...(supportedVersionsToken.success &&
			supportedVersionsToken.result && {
				supportedVersions: { signed: supportedVersionsToken.result },
			}),

		cloudWorkspaceId,
	};
}
