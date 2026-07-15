import { QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';

import OutermostErrorBoundary from './OutermostErrorBoundary';
import PageLoading from './PageLoading';
import { queryClient } from '../../lib/queryClient';

const MeteorProvider = lazy(() => import('../../providers/MeteorProvider'));
const AppLayout = lazy(() => import('./AppLayout'));

const AppRoot = () => (
	<OutermostErrorBoundary>
		{createPortal(
			<>
				<meta charSet='utf-8' />
				<meta httpEquiv='content-type' content='text/html; charset=utf-8' />
				<meta httpEquiv='expires' content='-1' />
				<meta httpEquiv='X-UA-Compatible' content='IE=edge' />
				<meta name='fragment' content='!' />
				<meta name='distribution' content='global' />
				<meta name='viewport' content='width=device-width, initial-scale=1, interactive-widget=resizes-content' />
				<meta name='rating' content='general' />
				<meta name='mobile-web-app-capable' content='yes' />
				<meta name='apple-mobile-web-app-capable' content='yes' />
				{/* MatterChat PWA: iOS standalone status bar — translucent so the dark navy theme shows through.
				    NB: `theme-color` + `apple-mobile-web-app-title` are injected server-side by
				    app/ui-master/server (from the `theme-color-sidebar-background` and `Site_Name` settings);
				    do NOT add a second `theme-color` here or the two tags conflict. The manifest carries the
				    brand navy (#0b1220) for the install splash; set the admin setting to match for the browser chrome. */}
				<meta name='apple-mobile-web-app-status-bar-style' content='black-translucent' />
				<meta name='msapplication-TileImage' content='assets/tile_144.png' />
				<meta name='msapplication-config' content='images/browserconfig.xml' />
				<meta property='og:image' content='assets/favicon_512.png' />
				<meta property='twitter:image' content='assets/favicon_512.png' />
				<link rel='manifest' href='images/manifest.json' />
				<link rel='chrome-webstore-item' href='https://chrome.google.com/webstore/detail/nocfbnnmjnndkbipkabodnheejiegccf' />
				<link rel='mask-icon' href='assets/safari_pinned.svg' color='#1B7A2E' />
				{/* MatterChat-branded iOS home-screen icon (navy-tiled brand mark, served from public/images/pwa). */}
				<link rel='apple-touch-icon' sizes='180x180' href='images/pwa/apple-touch-icon.png' />
				<link rel='apple-touch-icon-precomposed' href='assets/touchicon_180_pre.png' />
			</>,
			document.head,
		)}
		<Suspense fallback={<PageLoading />}>
			<QueryClientProvider client={queryClient}>
				<MeteorProvider>
					<AppLayout />
				</MeteorProvider>
			</QueryClientProvider>
		</Suspense>
	</OutermostErrorBoundary>
);

export default AppRoot;
