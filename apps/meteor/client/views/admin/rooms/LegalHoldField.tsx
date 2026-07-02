import type { IRoom, RoomAdminFieldsType } from '@rocket.chat/core-typings';
import { Field, FieldHint, FieldLabel, FieldRow, ToggleSwitch } from '@rocket.chat/fuselage';
import { GenericModal } from '@rocket.chat/ui-client';
import { useEndpoint, usePermission, useSetModal, useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { useFormatDateAndTime } from '../../../hooks/useFormatDateAndTime';

type LegalHoldFieldProps = {
	room: Pick<IRoom, RoomAdminFieldsType>;
	onChange?: () => void;
};

/**
 * Admin control surface for the LEGAL HOLD (litigation hold) on a room — rendered in the admin
 * room panel (EditRoom). Shows the current hold state and toggles it via a confirmation modal.
 * Visible only with the `manage-legal-hold` permission (admin by default); the endpoints enforce
 * the same permission server-side and write every set/clear to the audit trail. While a hold is
 * on, retention pruning, manual purge ("Prune Messages") and room deletion all refuse.
 */
const LegalHoldField = ({ room, onChange }: LegalHoldFieldProps) => {
	const { t } = useTranslation();
	const setModal = useSetModal();
	const dispatchToastMessage = useToastMessageDispatch();
	const formatDateAndTime = useFormatDateAndTime();
	const queryClient = useQueryClient();
	const fieldId = useId();

	const canManageLegalHold = usePermission('manage-legal-hold');

	const getLegalHold = useEndpoint('GET', '/v1/rooms.legalHold');
	const setLegalHold = useEndpoint('POST', '/v1/rooms.setLegalHold');
	const clearLegalHold = useEndpoint('POST', '/v1/rooms.clearLegalHold');

	const queryKey = ['admin', 'rooms', room._id, 'legal-hold'] as const;

	const { data, isLoading } = useQuery({
		queryKey,
		queryFn: () => getLegalHold({ roomId: room._id }),
		enabled: canManageLegalHold,
	});

	const legalHold = data?.legalHold;
	const enabled = legalHold?.enabled === true;

	const mutation = useMutation({
		mutationFn: (operation: 'set' | 'clear') =>
			operation === 'set' ? setLegalHold({ roomId: room._id }) : clearLegalHold({ roomId: room._id }),
		onSuccess: (_data, operation) => {
			dispatchToastMessage({
				type: 'success',
				message: operation === 'set' ? t('Legal_hold_set_success') : t('Legal_hold_cleared_success'),
			});
			onChange?.();
		},
		onError: (error) => {
			dispatchToastMessage({ type: 'error', message: error });
		},
		onSettled: () => {
			setModal(null);
			queryClient.invalidateQueries({ queryKey });
		},
	});

	if (!canManageLegalHold) {
		return null;
	}

	const handleToggle = () => {
		if (enabled) {
			setModal(
				<GenericModal
					title={t('Legal_hold_clear_confirm_title')}
					variant='danger'
					onConfirm={() => mutation.mutate('clear')}
					onCancel={() => setModal(null)}
					confirmText={t('Legal_hold_clear_confirm_action')}
				>
					{t('Legal_hold_clear_confirm_description')}
				</GenericModal>,
			);
			return;
		}

		setModal(
			<GenericModal
				title={t('Legal_hold_set_confirm_title')}
				variant='warning'
				onConfirm={() => mutation.mutate('set')}
				onCancel={() => setModal(null)}
				confirmText={t('Legal_hold_set_confirm_action')}
			>
				{t('Legal_hold_set_confirm_description')}
			</GenericModal>,
		);
	};

	return (
		<Field>
			<FieldRow>
				<FieldLabel htmlFor={fieldId}>{t('Legal_hold')}</FieldLabel>
				<ToggleSwitch
					id={fieldId}
					checked={enabled}
					disabled={isLoading || mutation.isPending}
					onChange={handleToggle}
					aria-describedby={`${fieldId}-hint`}
				/>
			</FieldRow>
			<FieldHint id={`${fieldId}-hint`}>
				{enabled
					? t('Legal_hold_enabled_hint', {
							date: legalHold?.setAt ? formatDateAndTime(legalHold.setAt) : '',
							username: legalHold?.setBy?.username ?? '',
						})
					: t('Legal_hold_disabled_hint')}
			</FieldHint>
		</Field>
	);
};

export default LegalHoldField;
