import type { ReactElement } from 'react';
import { useState } from 'react';

import PwaMobileBoard from './PwaMobileBoard';
import PwaMobileChat from './PwaMobileChat';
import PwaMobileDeadlines from './PwaMobileDeadlines';
import PwaMobileHome from './PwaMobileHome';

/**
 * PwaMobileContainer — Main navigation container for mobile PWA screens.
 * Manages active screen state and provides navigation between Home, Board, Chat, Deadlines.
 */
const PwaMobileContainer = (): ReactElement => {
	const [activeScreen, setActiveScreen] = useState<'home' | 'board' | 'chat' | 'deadlines'>('home');

	const handleNavigate = (screen: string) => {
		const normalizedScreen = screen.toLowerCase();
		if (normalizedScreen === 'chats' || normalizedScreen === 'chat') {
			setActiveScreen('chat');
		} else if (normalizedScreen === 'boards' || normalizedScreen === 'board') {
			setActiveScreen('board');
		} else if (normalizedScreen === 'deadlines' || normalizedScreen === 'activity') {
			setActiveScreen('deadlines');
		} else {
			setActiveScreen('home');
		}
	};

	return (
		<div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
			{activeScreen === 'home' && <PwaMobileHome onNavigate={handleNavigate} />}
			{activeScreen === 'board' && <PwaMobileBoard onNavigate={handleNavigate} />}
			{activeScreen === 'chat' && <PwaMobileChat onNavigate={handleNavigate} />}
			{activeScreen === 'deadlines' && <PwaMobileDeadlines onNavigate={handleNavigate} />}
		</div>
	);
};

export default PwaMobileContainer;
