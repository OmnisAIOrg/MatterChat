import type { IMatterSnapshot, Serialized } from '@rocket.chat/core-typings';
import { Box, Icon, Tag } from '@rocket.chat/fuselage';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { daysUntil, demandRiskVariant, fmtDate, riskTagVariant, solRiskVariant } from './matterFormatters';

type KeyDatesStripProps = {
	snapshot: Serialized<IMatterSnapshot>;
};

/**
 * Key-dates strip — the matter's clock, at a glance:
 *  - date of incident (neutral);
 *  - SOL chip with live client-side risk math (neutral → warning <90d → danger <30d/passed);
 *  - demand-expiration chip when a demand is outstanding (warning when near, danger when past).
 * Pure display over the snapshot; no extra endpoints.
 */
const KeyDatesStrip = ({ snapshot }: KeyDatesStripProps): ReactElement | null => {
	const { t } = useTranslation();

	const doiLabel = fmtDate(snapshot.incidentDate);

	const solDays = daysUntil(snapshot.solDate);
	const solVariant = solRiskVariant(solDays);
	const solLabel = (() => {
		const datePart = fmtDate(snapshot.solDate);
		if (!datePart) {
			return undefined;
		}
		if (solDays === undefined) {
			return datePart;
		}
		if (solDays < 0) {
			return t('Boards_Matters_SOL_Passed', { date: datePart, defaultValue: '{{date}} (passed)' });
		}
		return t('Boards_Matters_SOL_In_Days', { date: datePart, days: solDays, defaultValue: '{{date}} ({{days}}d)' });
	})();

	const demandDays = daysUntil(snapshot.demandExpiration);
	const demandVariant = demandRiskVariant(demandDays);
	const demandLabel = (() => {
		const datePart = fmtDate(snapshot.demandExpiration);
		if (!datePart) {
			return undefined;
		}
		if (demandDays !== undefined && demandDays < 0) {
			return t('Boards_Matters_SOL_Passed', { date: datePart, defaultValue: '{{date}} (passed)' });
		}
		if (demandDays !== undefined) {
			return t('Boards_Matters_SOL_In_Days', { date: datePart, days: demandDays, defaultValue: '{{date}} ({{days}}d)' });
		}
		return datePart;
	})();

	if (!doiLabel && !solLabel && !demandLabel) {
		return null;
	}

	return (
		<Box display='flex' flexWrap='wrap' alignItems='center' marginBlockEnd={4} style={{ gap: '6px' }}>
			{doiLabel && (
				<Tag variant='secondary' title={t('Boards_Matters_DOI', { defaultValue: 'Date of incident' })}>
					<Icon name='calendar' size='x12' marginInlineEnd={4} />
					{t('Boards_Matters_DOI', { defaultValue: 'Date of incident' })}: {doiLabel}
				</Tag>
			)}
			{solLabel && (
				<Tag variant={riskTagVariant(solVariant)} title={t('Boards_Matters_SOL', { defaultValue: 'SOL' })}>
					<Icon name='clock' size='x12' marginInlineEnd={4} />
					{t('Boards_Matters_SOL', { defaultValue: 'SOL' })}: {solLabel}
				</Tag>
			)}
			{demandLabel && (
				<Tag variant={riskTagVariant(demandVariant)} title={t('Boards_Matters_Demand_Outstanding', { defaultValue: 'Demand outstanding' })}>
					<Icon name='send' size='x12' marginInlineEnd={4} />
					{t('Boards_Matters_Demand', { defaultValue: 'Demand' })}: {demandLabel}
				</Tag>
			)}
		</Box>
	);
};

export default KeyDatesStrip;
