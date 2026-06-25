import type { ReactElement, ReactNode } from 'react';
import { useMemo, useState } from 'react';

import OrgSwitcherContext from './OrgSwitcherContext';

/**
 * Holds the selected-workspace state shared between the OrgSwitcherRail (writer) and the sidebar
 * room-list (reader). Mounted once in LayoutWithSidebar, wrapping the rail + the sidebar(s).
 */
const OrgSwitcherProvider = ({ children }: { children: ReactNode }): ReactElement => {
	const [selectedOrgId, setSelectedOrgId] = useState('current');

	const value = useMemo(() => ({ selectedOrgId, setSelectedOrgId }), [selectedOrgId]);

	return <OrgSwitcherContext.Provider value={value}>{children}</OrgSwitcherContext.Provider>;
};

export default OrgSwitcherProvider;
