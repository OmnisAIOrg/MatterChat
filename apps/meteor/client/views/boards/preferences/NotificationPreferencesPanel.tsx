import type { IBoardUserNotificationPrefs, BoardNotificationAction, BoardNotificationPreset } from '@rocket.chat/core-typings';
import { Box, Button, Switch, ToggleGroup, ToggleGroupOption, Margins, Callout } from '@rocket.chat/fuselage';
import { useEndpoint, useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import React, { useCallback, useMemo, useState } from 'react';

type NotificationAction = BoardNotificationAction;
type NotificationPreset = BoardNotificationPreset;

const ACTIONS: NotificationAction[] = ['assigned', 'mentioned', 'due_soon', 'approval_requested', 'stage_changed'];
const PRESETS: NotificationPreset[] = ['all', 'urgent_only', 'digest_only', 'silent'];

const ACTION_LABELS: Record<NotificationAction, string> = {
	assigned: 'Assigned to me',
	mentioned: 'Mentioned in comment',
	due_soon: 'Due date approaching',
	approval_requested: 'Approval requested',
	stage_changed: 'Card stage changed',
};

const PRESET_LABELS: Record<NotificationPreset, string> = {
	all: 'All notifications',
	urgent_only: 'Urgent only',
	digest_only: 'Daily digest',
	silent: 'Silent',
};

interface NotificationPreferencesPanelProps {
	onClose?: () => void;
}

export const NotificationPreferencesPanel: React.FC<NotificationPreferencesPanelProps> = ({ onClose }) => {
	const getPreferences = useEndpoint('GET', '/api/v1/boards.user.notification-preferences');
	const updatePreferences = useEndpoint('PUT', '/api/v1/boards.user.notification-preferences');
	const setPreset = useEndpoint('PUT', '/api/v1/boards.user.notification-preferences');
	const dispatchToast = useToastMessageDispatch();

	const [preferences, setPreferences] = useState<IBoardUserNotificationPrefs | null>(null);
	const [selectedPreset, setSelectedPreset] = useState<NotificationPreset>('all');
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);

	// Load preferences on mount
	React.useEffect(() => {
		(async () => {
			try {
				setLoading(true);
				const response = await getPreferences();
				setPreferences(response.preferences);
				setSelectedPreset(response.preferences.preset);
			} catch (error) {
				dispatchToast({ type: 'error', message: 'Failed to load preferences' });
			} finally {
				setLoading(false);
			}
		})();
	}, [getPreferences, dispatchToast]);

	const handlePresetChange = useCallback(
		async (preset: NotificationPreset) => {
			try {
				setSaving(true);
				const response = await setPreset({ preset });
				if (response.success) {
					setPreferences(response.updated);
					setSelectedPreset(preset);
					dispatchToast({ type: 'success', message: 'Preferences updated' });
				}
			} catch (error) {
				dispatchToast({ type: 'error', message: 'Failed to update preferences' });
			} finally {
				setSaving(false);
			}
		},
		[setPreset, dispatchToast],
	);

	const handleToggle = useCallback(
		async (action: NotificationAction, channel: 'inApp' | 'email' | 'push') => {
			if (!preferences) return;

			try {
				setSaving(true);
				const newPrefs = { ...preferences };
				newPrefs.preferences[action][channel] = !newPrefs.preferences[action][channel];

				const response = await updatePreferences({ preferences: newPrefs.preferences });
				if (response.success) {
					setPreferences(response.updated);
					dispatchToast({ type: 'success', message: 'Preference updated' });
				}
			} catch (error) {
				dispatchToast({ type: 'error', message: 'Failed to update preference' });
			} finally {
				setSaving(false);
			}
		},
		[preferences, updatePreferences, dispatchToast],
	);

	if (loading) {
		return <Box marginBlockEnd={16}>Loading preferences...</Box>;
	}

	if (!preferences) {
		return <Box marginBlockEnd={16}>Unable to load preferences</Box>;
	}

	return (
		<Box marginBlockEnd={24}>
			<Callout type='info' title='Notification Settings'>
				Choose when you want to be notified about board activity across different channels.
			</Callout>

			<Margins block={16}>
				{/* Preset selector */}
				<Box marginBlockEnd={24}>
					<Box marginBlockEnd={12} fontScale='p2' fontWeight={600}>
						Quick Presets
					</Box>
					<ToggleGroup value={selectedPreset} onChange={(value) => handlePresetChange(value as NotificationPreset)}>
						{PRESETS.map((preset) => (
							<ToggleGroupOption key={preset} value={preset} label={PRESET_LABELS[preset]} disabled={saving} />
						))}
					</ToggleGroup>
				</Box>

				{/* Custom preference matrix */}
				<Box marginBlockEnd={24}>
					<Box marginBlockEnd={12} fontScale='p2' fontWeight={600}>
						Customize by Event Type
					</Box>

					{/* Table header */}
					<Box display='grid' gridTemplateColumns='2fr 1fr 1fr 1fr' gap={8} marginBlockEnd={8}>
						<Box fontScale='p1' fontWeight={600} color='font-secondary'>
							Event Type
						</Box>
						<Box fontScale='p1' fontWeight={600} color='font-secondary' textAlign='center'>
							In-App
						</Box>
						<Box fontScale='p1' fontWeight={600} color='font-secondary' textAlign='center'>
							Email
						</Box>
						<Box fontScale='p1' fontWeight={600} color='font-secondary' textAlign='center'>
							Push
						</Box>
					</Box>

					{/* Preference rows */}
					{ACTIONS.map((action) => (
						<Box
							key={action}
							display='grid'
							gridTemplateColumns='2fr 1fr 1fr 1fr'
							gap={8}
							paddingBlockStart={8}
							paddingBlockEnd={8}
							borderBlockEnd='default'
						>
							<Box fontScale='p2'>{ACTION_LABELS[action]}</Box>
							<Box display='flex' justifyContent='center'>
								<Switch checked={preferences.preferences[action].inApp} onChange={() => handleToggle(action, 'inApp')} disabled={saving} />
							</Box>
							<Box display='flex' justifyContent='center'>
								<Switch checked={preferences.preferences[action].email} onChange={() => handleToggle(action, 'email')} disabled={saving} />
							</Box>
							<Box display='flex' justifyContent='center'>
								<Switch checked={preferences.preferences[action].push} onChange={() => handleToggle(action, 'push')} disabled={saving} />
							</Box>
						</Box>
					))}
				</Box>

				{/* Digest settings */}
				<Box marginBlockEnd={24}>
					<Box marginBlockEnd={12} fontScale='p2' fontWeight={600}>
						Digest Email Settings
					</Box>
					<Box display='flex' gap={16}>
						<Box flex={1}>
							<Box marginBlockEnd={4} fontScale='p1'>
								Frequency
							</Box>
							<ToggleGroup
								value={preferences.digestFrequency || 'daily'}
								onChange={async (freq) => {
									try {
										setSaving(true);
										const response = await updatePreferences({ digestFrequency: freq as 'daily' | 'weekly' });
										if (response.success) {
											setPreferences(response.updated);
											dispatchToast({ type: 'success', message: 'Digest frequency updated' });
										}
									} catch (error) {
										dispatchToast({ type: 'error', message: 'Failed to update digest frequency' });
									} finally {
										setSaving(false);
									}
								}}
							>
								<ToggleGroupOption value='daily' label='Daily' disabled={saving} />
								<ToggleGroupOption value='weekly' label='Weekly' disabled={saving} />
							</ToggleGroup>
						</Box>

						<Box flex={1}>
							<Box marginBlockEnd={4} fontScale='p1'>
								Send at (HH:MM)
							</Box>
							<input
								type='time'
								value={preferences.digestTime || '08:00'}
								onChange={async (e) => {
									const time = e.currentTarget.value;
									try {
										setSaving(true);
										const response = await updatePreferences({ digestTime: time });
										if (response.success) {
											setPreferences(response.updated);
											dispatchToast({ type: 'success', message: 'Digest time updated' });
										}
									} catch (error) {
										dispatchToast({ type: 'error', message: 'Failed to update digest time' });
									} finally {
										setSaving(false);
									}
								}}
								disabled={saving}
								style={{
									padding: '8px 12px',
									borderRadius: '4px',
									border: '1px solid #e0e0e0',
									fontFamily: 'inherit',
								}}
							/>
						</Box>
					</Box>
				</Box>

				{/* Close button */}
				{onClose && (
					<Box mbt={16}>
						<Button onClick={onClose} disabled={saving}>
							Done
						</Button>
					</Box>
				)}
			</Margins>
		</Box>
	);
};
