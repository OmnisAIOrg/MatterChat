import type { IMatterSnapshot, Serialized } from '@rocket.chat/core-typings';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import MatterField from './MatterField';
import MatterSection from './MatterSection';

type LitigationSectionProps = {
	snapshot: Serialized<IMatterSnapshot>;
};

/**
 * Litigation identity — cause number, liability posture, and the matter team
 * (attorney and case manager surfaced first, then any remaining roles).
 * Read-only CasePro snapshot fields; hides entirely when none are present.
 */
const LitigationSection = ({ snapshot }: LitigationSectionProps): ReactElement | null => {
	const { t } = useTranslation();

	const team = snapshot.team ?? [];
	const findRole = (re: RegExp): string | undefined => team.find((m) => re.test(m.role))?.name;
	const attorney = findRole(/attorney|lawyer/i);
	const caseManager = findRole(/case\s*manager|paralegal|cm/i);
	const others = team.filter((m) => m.name !== attorney && m.name !== caseManager);

	if (!snapshot.causeNumber && !snapshot.liabilityStatus && team.length === 0) {
		return null;
	}

	return (
		<MatterSection title={t('Boards_Matters_Litigation', { defaultValue: 'Litigation & team' })} icon='shield'>
			<MatterField label={t('Boards_Matters_Cause_Number', { defaultValue: 'Cause #' })}>{snapshot.causeNumber}</MatterField>
			<MatterField label={t('Boards_Matters_Liability', { defaultValue: 'Liability' })}>{snapshot.liabilityStatus}</MatterField>
			<MatterField label={t('Boards_Matters_Attorney', { defaultValue: 'Attorney' })}>{attorney}</MatterField>
			<MatterField label={t('Boards_Matters_Case_Manager', { defaultValue: 'Case manager' })}>{caseManager}</MatterField>
			{others.map((m, i) => (
				<MatterField key={`${m.role}-${i}`} label={m.role}>
					{m.name}
				</MatterField>
			))}
		</MatterSection>
	);
};

export default LitigationSection;
