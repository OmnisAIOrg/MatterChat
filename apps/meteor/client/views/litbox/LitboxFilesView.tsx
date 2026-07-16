import { Box, Select, Throbber } from '@rocket.chat/fuselage';
import { Page, PageHeader, PageScrollableContent } from '@rocket.chat/ui-client';
import { useEndpoint, useUserId } from '@rocket.chat/ui-contexts';
import { useQuery } from '@tanstack/react-query';
import { Suspense, lazy, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import LitboxEmbedBoundary from './LitboxEmbedBoundary';
import { LEDGER_CAPTION_STYLE, LEDGER_PAPER } from '../boards/lib/ledger';

// Lazy so the heavy LitBox package only loads when the user opens Files.
const LitboxEmbed = lazy(() => import('./LitboxEmbed'));

type LitboxScope = 'org' | 'matter';

/**
 * The "Files" screen — the user's LitBox account embedded inside MatterChat.
 * Mounts the LitBox file browser (lazy) against MatterChat's /_litbox proxy.
 *
 * A header control lets the user choose the scope:
 *  - "Whole org LitBox" (default) — the org-wide view (unchanged behavior).
 *  - "By matter" — pick a CasePro matter (via `boards.casepro.listMatters`) and
 *    scope the browser to that matter's LitBox workspace. The matter list carries
 *    no workspace id, so the chosen matter's `boards.casepro.matterSnapshot` is
 *    fetched to resolve `litboxWorkspaceId`, which is passed to the embed.
 */
const LitboxFilesView = () => {
	const { t } = useTranslation();
	const userId = useUserId();

	// The browser-side token is the caller's own MatterChat session; the /_litbox
	// proxy validates it and injects the real LitBox credential server-side.
	const authToken = userId ? (window.localStorage.getItem('Meteor.loginToken') ?? '') : '';

	const [scope, setScope] = useState<LitboxScope>('org');
	const [matterId, setMatterId] = useState<string | undefined>(undefined);

	// Matter picker options (only fetched once "By matter" is chosen).
	const listMatters = useEndpoint('GET', '/v1/boards.casepro.listMatters');
	const { data: mattersData, isLoading: mattersLoading } = useQuery({
		queryKey: ['boards', 'casepro', 'listMatters', 'litbox-picker'],
		queryFn: () => listMatters({ limit: 200 }),
		enabled: scope === 'matter',
	});

	const matterOptions = useMemo<[string, string][]>(
		() => (mattersData?.matters ?? []).map((m) => [m.matterId, m.matterName ?? m.matterNumber ?? m.matterId] as [string, string]),
		[mattersData],
	);

	// Resolve the chosen matter's LitBox workspace via its snapshot.
	const getSnapshot = useEndpoint('GET', '/v1/boards.casepro.matterSnapshot');
	const { data: snapData, isFetching: snapFetching } = useQuery({
		queryKey: ['boards', 'casepro', 'snapshot', matterId, 'litbox-picker'],
		queryFn: () => getSnapshot({ matterId: matterId as string }),
		enabled: scope === 'matter' && Boolean(matterId),
	});

	const workspaceId = scope === 'matter' ? snapData?.snapshot?.litboxWorkspaceId : undefined;

	const scopeOptions = useMemo<[string, string][]>(
		() => [
			['org', t('Boards_Litbox_Scope_Org', { defaultValue: 'Whole org LitBox' })],
			['matter', t('Boards_Litbox_Scope_Matter', { defaultValue: 'By matter' })],
		],
		[t],
	);

	const showEmbed = scope === 'org' || (scope === 'matter' && Boolean(workspaceId));

	return (
		// Ledger paper treatment on OUR chrome only (the embedded LitboxFileBrowser package
		// renders its own internals and is not restyled from here).
		<Page data-qa='litbox-files' style={{ backgroundColor: LEDGER_PAPER }}>
			<PageHeader
				title={
					// Serif "case caption" page title — the ledger heading voice.
					<Box is='span' style={LEDGER_CAPTION_STYLE}>
						{t('Files', { defaultValue: 'Files' })}
					</Box>
				}
			>
				{/* Compact single-row filter strip (org/matter scope + matter picker). */}
				<Box display='flex' alignItems='center' style={{ gap: '6px' }}>
					<Box width='x160'>
						<Select
							options={scopeOptions}
							value={scope}
							onChange={(value) => {
								setScope(value as LitboxScope);
							}}
						/>
					</Box>
					{scope === 'matter' && (
						<Box width='x220'>
							<Select
								placeholder={mattersLoading ? t('Loading') : t('Boards_Litbox_Pick_Matter', { defaultValue: 'Select a matter…' })}
								options={matterOptions}
								value={matterId ?? null}
								disabled={mattersLoading || matterOptions.length === 0}
								onChange={(value) => setMatterId(value as string)}
							/>
						</Box>
					)}
				</Box>
			</PageHeader>
			<PageScrollableContent>
				{scope === 'matter' && !matterId && (
					<Box fontScale='p2' color='hint' p={16}>
						{t('Boards_Litbox_Pick_Matter_Hint', { defaultValue: 'Choose a matter to view its CasePro LitBox files.' })}
					</Box>
				)}
				{scope === 'matter' && matterId && snapFetching && (
					<Box display='flex' justifyContent='center' p={16}>
						<Throbber />
					</Box>
				)}
				{scope === 'matter' && matterId && !snapFetching && !workspaceId && (
					<Box fontScale='p2' color='hint' p={16}>
						{t('Boards_Litbox_No_Workspace', { defaultValue: 'This matter has no linked LitBox workspace yet.' })}
					</Box>
				)}
				{showEmbed && (
					<LitboxEmbedBoundary>
						<Suspense fallback={<Throbber />}>
							<LitboxEmbed authToken={authToken} workspaceId={workspaceId} />
						</Suspense>
					</LitboxEmbedBoundary>
				)}
			</PageScrollableContent>
		</Page>
	);
};

export default LitboxFilesView;
