import { useSetting } from '@rocket.chat/ui-contexts';

import CustomHomePage from './CustomHomePage';
import MyDayHomePage from './MyDayHomePage';

const HomePage = () => {
	const customOnly = useSetting('Layout_Custom_Body_Only');

	if (customOnly) {
		return <CustomHomePage />;
	}

	// MatterChat's home is the "My Day" command center (replaces RC's getting-started cards).
	return <MyDayHomePage />;
};

export default HomePage;
