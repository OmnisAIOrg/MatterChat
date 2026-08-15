import { Box, CheckBox, Field, FieldLabel, FieldRow, Skeleton } from '@rocket.chat/fuselage';
import { useEndpoint, useTranslation } from '@rocket.chat/ui-contexts';
import { useQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { useId } from 'react';

/**
 * MATTERCHAT: practice-area selection for the firm setup concierge.
 *
 * The list comes from the server (`firms.templates`) rather than being hardcoded
 * here, so adding a practice area is a one-line change in one place instead of a
 * change the client and server have to agree on.
 *
 * Selecting nothing is a legitimate answer — a firm that skips this still gets
 * the base channels — so there is no validation and no required state. The step
 * exists to make a better workspace, not to interrogate the user.
 */

type PracticeAreaPickerProps = {
	selected: string[];
	onChange: (next: string[]) => void;
	disabled?: boolean;
};

const PracticeAreaPicker = ({ selected, onChange, disabled }: PracticeAreaPickerProps): ReactElement => {
	const t = useTranslation();
	const groupId = useId();
	const getTemplates = useEndpoint('GET', '/v1/firms.templates');

	const { data, isLoading, isError } = useQuery({
		queryKey: ['firms.templates'],
		queryFn: () => getTemplates(),
		// Static server-side data for the life of a session.
		staleTime: Infinity,
	});

	const toggle = (id: string): void => {
		onChange(selected.includes(id) ? selected.filter((existing) => existing !== id) : [...selected, id]);
	};

	if (isLoading) {
		return (
			<Box>
				<Skeleton width='100%' />
				<Skeleton width='100%' />
				<Skeleton width='60%' />
			</Box>
		);
	}

	// A failed template fetch must not block signup: the firm can still be created
	// with its base channels, so say so plainly and let the user carry on.
	if (isError || !data?.practiceAreas?.length) {
		return (
			<Box fontScale='c1' color='hint'>
				{t('Firm_areas_unavailable')}
			</Box>
		);
	}

	return (
		<Field>
			<FieldLabel id={groupId}>{t('Firm_areas_label')}</FieldLabel>
			<Box role='group' aria-labelledby={groupId} display='flex' flexDirection='column'>
				{data.practiceAreas.map((area) => (
					<FieldRow key={area.id} justifyContent='start' marginBlock={4}>
						<CheckBox
							id={`${groupId}-${area.id}`}
							checked={selected.includes(area.id)}
							disabled={disabled}
							onChange={() => toggle(area.id)}
						/>
						<Box is='label' htmlFor={`${groupId}-${area.id}`} marginInlineStart={8} withTruncatedText>
							{area.label}
						</Box>
					</FieldRow>
				))}
			</Box>
		</Field>
	);
};

export default PracticeAreaPicker;
