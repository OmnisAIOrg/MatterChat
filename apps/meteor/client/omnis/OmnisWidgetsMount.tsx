import { usePermission, useSetting } from '@rocket.chat/ui-contexts';
import type { ReactElement } from 'react';
import { Suspense, lazy } from 'react';

import OmnisWidgetDock from './shell/OmnisWidgetDock';

/**
 * The single mount point for every Omnis product widget.
 *
 * Each widget renders **nothing at all** unless its product is enabled AND the
 * user holds its view permission. Those gates live here rather than inside the
 * widgets so the widget bundles are never even fetched for a user who cannot
 * see them — the queues are firm-wide feeds, so this is a privacy boundary, not
 * just a performance one.
 *
 * Lazy imports keep four product widgets out of the initial bundle; a workspace
 * with every product off pays for one `useSetting` per product and nothing else.
 */

const AutoDocQueueWidget = lazy(() => import('./autodoc/AutoDocQueueWidget'));
const LitboxFilesWidget = lazy(() => import('./litbox/LitboxFilesWidget'));
const SignaturesWidget = lazy(() => import('./omnisproof/SignaturesWidget'));
const MeetingsWidget = lazy(() => import('./casenotes/MeetingsWidget'));

export const OmnisWidgetsMount = (): ReactElement | null => {
	const autoDocEnabled = useSetting('AutoDoc_Enabled', false);
	const litboxLinksEnabled = useSetting('Litbox_Upload_Links_Enabled', false);
	const omnisProofEnabled = useSetting('OmnisProof_Enabled', false);
	const caseNotesEnabled = useSetting('CaseNotes_Enabled', false);

	const canViewQueue = usePermission('view-document-queue');
	const canViewFiles = usePermission('litbox-view-matter-files');
	const canViewSignatures = usePermission('omnisproof-view-queue');
	const canViewMeetings = usePermission('casenotes-view-queue');

	const showAutoDoc = autoDocEnabled && canViewQueue;
	const showLitbox = litboxLinksEnabled && canViewFiles;
	const showProof = omnisProofEnabled && canViewSignatures;
	const showMeetings = caseNotesEnabled && canViewMeetings;

	if (!showAutoDoc && !showLitbox && !showProof && !showMeetings) {
		return null;
	}

	return (
		<OmnisWidgetDock>
			<Suspense fallback={null}>
				{showAutoDoc && <AutoDocQueueWidget />}
				{showLitbox && <LitboxFilesWidget />}
				{showProof && <SignaturesWidget />}
				{showMeetings && <MeetingsWidget />}
			</Suspense>
		</OmnisWidgetDock>
	);
};

export default OmnisWidgetsMount;
