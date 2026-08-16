/**
 * MATTERCHAT: channel export for the Chi Firm-Admin Copilot (F7).
 *
 * ## Why this is not just a call to `dataExport.sendFile`
 *
 * Core's export builds a zip, uploads it, and then EMAILS the download link. That is the right
 * shape for the admin area, and the wrong shape here for two reasons:
 *
 *  1. **It needs working SMTP.** Staging has none, and a self-hosted firm may have none. The
 *     zip would be built and uploaded successfully and the user would simply never hear about
 *     it — the export "worked" and produced nothing they can reach.
 *  2. **Chi is a chat.** The user asked in a conversation; the answer is a link in that
 *     conversation, not an email round-trip.
 *
 * So this reuses core's own building blocks — the same `exportRoomMessagesToFile`,
 * `copyFileUpload`, `makeZipFile` and `uploadZipFile` that `sendFile` calls — and returns the
 * link instead of mailing it. Nothing in Rocket.Chat core is modified, and if upstream changes
 * how an export is produced, this changes with it.
 *
 * Every caller-facing decision (who may export what) lives in the tool that calls this; this
 * module only builds a file for a room it is handed, and does no authorization of its own.
 */
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';

import type { IUser } from '@rocket.chat/core-typings';

import { copyFileUpload } from '../../dataExport/copyFileUpload';
import { exportRoomMessagesToFile } from '../../dataExport/exportRoomMessagesToFile';
import { getPath } from '../../dataExport/getPath';
import { getRoomData } from '../../dataExport/getRoomData';
import { makeZipFile } from '../../dataExport/makeZipFile';
import { uploadZipFile } from '../../dataExport/uploadZipFile';
import { SystemLogger } from '../../logger/system';
import { getURL } from '../../utils/getURL';

export type ChannelExportFormat = 'html' | 'json';

export type ChannelExportOptions = {
	rid: string;
	format: ChannelExportFormat;
	dateFrom?: Date;
	dateTo?: Date;
};

export type ChannelExportResult = {
	/** Full URL the user can click. */
	url: string;
	fileId: string;
	fileName: string;
	format: ChannelExportFormat;
	/** Messages written into the archive. */
	messages: number;
};

/**
 * Build a zip of one room's messages (plus its uploaded files) and return a link to it.
 *
 * The temp directory is always removed, including on failure — an export is potentially the
 * entire privileged contents of a matter channel sitting on local disk, and leaving that behind
 * because something threw is not acceptable in a legal product.
 */
export async function exportChannelToFile(options: ChannelExportOptions, user: IUser): Promise<ChannelExportResult> {
	const exportType = options.format;
	const baseDir = await mkdtemp(join(tmpdir(), 'chi-channel-export-'));
	const assetsPath = path.join(baseDir, 'assets');

	try {
		await mkdir(baseDir, { recursive: true });
		await mkdir(assetsPath, { recursive: true });

		const roomData = await getRoomData(options.rid);
		roomData.targetFile = `${(exportType === 'json' && roomData.roomName) || roomData.roomId}.${exportType}`;
		const roomsToExport = [roomData];

		const filter =
			!options.dateFrom && !options.dateTo
				? {}
				: {
						ts: {
							...(options.dateFrom && { $gte: options.dateFrom }),
							...(options.dateTo && { $lte: options.dateTo }),
						},
					};

		// Core's exporter pages internally and reports `status: 'completed'` when it has read
		// everything, so the loop is how you know the export is whole rather than truncated.
		const fullFileList: { _id: string; name: string }[] = [];
		const exportMessages = async (): Promise<void> => {
			const { fileList } = await exportRoomMessagesToFile(baseDir, assetsPath, exportType, roomsToExport, user, filter, {}, false);
			fullFileList.push(...fileList);
			if (roomsToExport[0].status !== 'completed') {
				await exportMessages();
			}
		};
		await exportMessages();

		await Promise.all(fullFileList.map((attachment) => copyFileUpload(attachment, assetsPath)));

		const zipPath = `${baseDir}-export.zip`;
		try {
			await makeZipFile(baseDir, zipPath);
			const file = await uploadZipFile(zipPath, user._id, exportType);
			return {
				url: getURL(getPath(file._id), { cdn: false, full: true }),
				fileId: file._id,
				fileName: file.name,
				format: exportType,
				messages: roomsToExport[0].exportedCount ?? 0,
			};
		} finally {
			await rm(zipPath, { force: true }).catch(() => undefined);
		}
	} finally {
		await rm(baseDir, { recursive: true, force: true }).catch((err) => {
			SystemLogger.warn({ msg: 'chi: failed to clean up channel export scratch dir', dir: baseDir, err: String(err) });
		});
	}
}
