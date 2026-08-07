import { useEmbeddedLayout } from '@rocket.chat/ui-client';
import type { ReactNode } from 'react';
import { Suspense } from 'react';

import AuthenticationCheck from './AuthenticationCheck';
import EmbeddedPreload from './EmbeddedPreload';
import Preload from './Preload';
import { useCustomScript } from './useCustomScript';
import { ChiOrbMount } from '../../../omnis/widgets/ChiOrbMount';

export type MainLayoutProps = {
	children?: ReactNode;
};

const MainLayout = ({ children = null }: MainLayoutProps) => {
	useCustomScript();

	const isEmbeddedLayout = useEmbeddedLayout();

	if (isEmbeddedLayout) {
		return (
			<EmbeddedPreload>
				<AuthenticationCheck>
					<Suspense fallback={null}>{children}</Suspense>
				</AuthenticationCheck>
			</EmbeddedPreload>
		);
	}

	return (
		<Preload>
			<AuthenticationCheck>
				<Suspense fallback={null}>{children}</Suspense>
				{/* Floating, draggable Chi assistant orb (wired to the @chi.bot pipeline). Authenticated,
				    non-embedded views only. position:fixed so tree placement is cosmetic. */}
				<ChiOrbMount />
			</AuthenticationCheck>
		</Preload>
	);
};

export default MainLayout;
