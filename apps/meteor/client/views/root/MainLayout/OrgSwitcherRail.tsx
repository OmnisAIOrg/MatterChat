import { css } from '@rocket.chat/css-in-js';
import { Box } from '@rocket.chat/fuselage';
import type { ReactElement } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useOrgSwitcherSelection } from './OrgSwitcherContext';
import type { SwitchableOrg } from './useOrgSwitcher';
import { useOrgSwitcher } from './useOrgSwitcher';

/**
 * OrgSwitcherRail — the multi-org workspace switcher (Wave 1, slice 1).
 *
 * A narrow folder-tab dock pinned to the FAR LEFT of the app shell, LEFT of AppLeftRail. It lists
 * the workspaces a user belongs to — native MatterChat firms AND connected external Slack
 * workspaces — as switchable tiles, plus a "+" to add one. The active org is lit (white ring); a
 * Slack-connected org renders the Slack mark + a Slack badge so it reads as external at a glance.
 *
 * Shaped as a folder tab: always-dark, square on the top + inner edge (flush to AppLeftRail),
 * rounded on the OUTER bottom corner, ending right after the +. Slice 1 is the UI on placeholder
 * data; switching/adding are stubbed (see useOrgSwitcher).
 */

const RAIL_BG = '#141619';
const BRAND_RED = '#e1140a';

const columnClass = css`
	width: 56px;
	min-width: 56px;
	height: 100%;
	flex-shrink: 0;
	z-index: 4;

	@media print {
		display: none;
	}
`;

const tabClass = css`
	width: 56px;
	background-color: ${RAIL_BG};
	border-radius: 0 0 0 18px;
	padding-block: 13px 14px;
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 9px;
`;

const tileClass = css`
	width: 40px;
	height: 40px;
	border: 0;
	border-radius: 12px;
	display: flex;
	align-items: center;
	justify-content: center;
	color: #ffffff;
	font-weight: 600;
	line-height: 1;
	position: relative;
	cursor: pointer;
	font-family: inherit;
	user-select: none;
	transition:
		opacity 0.12s ease,
		box-shadow 0.12s ease;

	&:hover {
		opacity: 1;
	}

	&:focus-visible {
		outline: 2px solid ${BRAND_RED};
		outline-offset: 2px;
	}
`;

const addClass = css`
	width: 40px;
	height: 40px;
	border: 1.5px dashed rgba(255, 255, 255, 0.3);
	border-radius: 12px;
	background: rgba(255, 255, 255, 0.06);
	color: #ffffff;
	font-size: 22px;
	line-height: 1;
	display: flex;
	align-items: center;
	justify-content: center;
	cursor: pointer;
	font-family: inherit;

	&:hover {
		background: rgba(255, 255, 255, 0.1);
	}

	&:focus-visible {
		outline: 2px solid ${BRAND_RED};
		outline-offset: 2px;
	}
`;

const dividerClass = css`
	width: 32px;
	height: 1px;
	background: rgba(255, 255, 255, 0.12);
	margin-block: 1px;
`;

// The Slack 4-colour mark (rendered, never recoloured). Used on a Slack-connected tile + its badge.
const SlackMark = ({ size }: { size: number }): ReactElement => (
	<svg width={size} height={size} viewBox='0 0 24 24' aria-hidden focusable='false'>
		<rect x='9' y='2.5' width='2.8' height='19' rx='1.4' fill='#36C5F0' />
		<rect x='12.2' y='2.5' width='2.8' height='19' rx='1.4' fill='#2EB67D' />
		<rect x='2.5' y='9' width='19' height='2.8' rx='1.4' fill='#ECB22E' />
		<rect x='2.5' y='12.2' width='19' height='2.8' rx='1.4' fill='#E01E5A' />
	</svg>
);

const OrgTile = ({ org, isSelected, onClick }: { org: SwitchableOrg; isSelected: boolean; onClick: () => void }): ReactElement => {
	const isSlack = org.type === 'slack';

	return (
		<Box
			is='button'
			type='button'
			className={tileClass}
			onClick={onClick}
			title={org.name}
			aria-label={org.name}
			aria-current={isSelected ? 'true' : undefined}
			style={{
				backgroundColor: isSlack ? '#ffffff' : org.color || '#3a3d44',
				opacity: isSelected ? 1 : org.unread ? 0.9 : 0.78,
				boxShadow: isSelected ? '0 0 0 2.5px rgba(255, 255, 255, 0.92)' : undefined,
				fontSize: org.initial.length > 1 ? '14px' : '16px',
			}}
		>
			{isSlack ? <SlackMark size={20} /> : org.initial}

			{isSlack && (
				<Box
					style={{
						position: 'absolute',
						bottom: '-3px',
						right: '-3px',
						width: '16px',
						height: '16px',
						borderRadius: '50%',
						background: '#4A154B',
						border: `2px solid ${RAIL_BG}`,
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
					}}
				>
					<SlackMark size={8} />
				</Box>
			)}

			{!!org.mentions && (
				<Box
					style={{
						position: 'absolute',
						top: '-4px',
						right: '-4px',
						minWidth: '17px',
						height: '17px',
						borderRadius: '9px',
						background: BRAND_RED,
						color: '#ffffff',
						fontSize: '10px',
						fontWeight: 600,
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						border: `2px solid ${RAIL_BG}`,
						padding: '0 4px',
					}}
				>
					{org.mentions}
				</Box>
			)}

			{!org.mentions && org.unread && (
				<Box
					style={{
						position: 'absolute',
						top: '-1px',
						right: '-1px',
						width: '9px',
						height: '9px',
						borderRadius: '50%',
						background: '#ffffff',
						border: `1.5px solid ${RAIL_BG}`,
					}}
				/>
			)}
		</Box>
	);
};

const OrgSwitcherRail = (): ReactElement | null => {
	const { t } = useTranslation();
	const { orgs, switchOrg, addWorkspace } = useOrgSwitcher();
	const { selectedOrgId, setSelectedOrgId } = useOrgSwitcherSelection();

	if (!orgs.length) {
		return null;
	}

	// In-instance workspaces (this MatterChat + its connected Slack) switch the sidebar view in
	// place; other firms (future, gated on per-firm instances) fall back to the switchOrg stub.
	const handleSelect = (org: SwitchableOrg): void => {
		if (org.type === 'slack' || org.id === 'current') {
			setSelectedOrgId(org.id);
			return;
		}
		switchOrg(org);
	};

	return (
		<Box is='nav' aria-label={t('Workspaces', { defaultValue: 'Workspaces' })} className={columnClass}>
			<Box className={tabClass}>
				{orgs.map((org) => (
					<OrgTile key={org.id} org={org} isSelected={selectedOrgId === org.id} onClick={(): void => handleSelect(org)} />
				))}
				<Box className={dividerClass} />
				<Box
					is='button'
					type='button'
					className={addClass}
					onClick={(): void => addWorkspace()}
					title={t('Add_workspace', { defaultValue: 'Add a workspace' })}
					aria-label={t('Add_workspace', { defaultValue: 'Add a workspace' })}
				>
					+
				</Box>
			</Box>
		</Box>
	);
};

export default memo(OrgSwitcherRail);
