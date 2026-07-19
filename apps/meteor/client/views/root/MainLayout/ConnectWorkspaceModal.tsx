import type { ExternalProvider } from '@rocket.chat/core-typings';
import { Box, Button, Icon, Tag, Throbber } from '@rocket.chat/fuselage';
import { GenericModal } from '@rocket.chat/ui-client';
import { useRole, useRouter } from '@rocket.chat/ui-contexts';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { useConnectorAvailability } from './useConnectorAvailability';
import { useExternalWorkspaces } from './useExternalWorkspaces';

/**
 * ConnectWorkspaceModal — the "Add a workspace" surface (founder ask: adding Slack /
 * Teams / Google Chat must be seamless and self-evident).
 *
 * Replaces the old bare 2-item dropdown with provider CARDS:
 *  - every provider is ALWAYS listed (discoverability) — disabled ones explain themselves
 *    instead of being invisible;
 *  - each card carries the brand mark, a one-line description, and its live state:
 *    Connect → / Connected ✓ (+ add another) / Needs setup (admin deep-link) / Ask your admin;
 *  - a footer note sets OAuth expectations ("you'll be sent to the provider and brought
 *    back") — the #1 reported OAuth confusion.
 *
 * Modal (not dropdown) deliberately: the old GenericMenu never opened on phones (the rail
 * lives inside the drawer there); a modal renders in the portal and works on every layout.
 * Availability comes from the server (env fallbacks included) via useConnectorAvailability.
 */

type ProviderCardSpec = {
	provider: ExternalProvider;
	name: string;
	description: string;
	settingsGroup: 'Slack' | 'Teams' | 'GoogleChat';
	mark: ReactElement;
};

// Brand marks as minimal inline SVGs (brand assets, not theme colors — exempt from the
// no-hardcoded-hex rule the same way logo files are). Sized by the parent box.
const SlackMark = (
	<svg viewBox='0 0 24 24' width='28' height='28' aria-hidden='true'>
		<path fill='#E01E5A' d='M5.1 14.9a2 2 0 1 1-2-2h2v2zm1 0a2 2 0 0 1 4 0v5a2 2 0 1 1-4 0v-5z' />
		<path fill='#36C5F0' d='M9.1 5.1a2 2 0 1 1 2-2v2h-2zm0 1a2 2 0 0 1 0 4h-5a2 2 0 1 1 0-4h5z' />
		<path fill='#2EB67D' d='M18.9 9.1a2 2 0 1 1 2 2h-2v-2zm-1 0a2 2 0 0 1-4 0v-5a2 2 0 1 1 4 0v5z' />
		<path fill='#ECB22E' d='M14.9 18.9a2 2 0 1 1-2 2v-2h2zm0-1a2 2 0 0 1 0-4h5a2 2 0 1 1 0 4h-5z' />
	</svg>
);

const TeamsMark = (
	<svg viewBox='0 0 24 24' width='28' height='28' aria-hidden='true'>
		<rect x='2' y='5' width='13' height='14' rx='2' fill='#4B53BC' />
		<path fill='#fff' d='M5.5 9h6v1.8H9.4V15H7.6v-4.2H5.5V9z' />
		<circle cx='18.5' cy='8' r='2.4' fill='#7B83EB' />
		<path fill='#7B83EB' d='M15.8 11.4h5.1c.6 0 1.1.5 1.1 1.1v3.9a3.4 3.4 0 0 1-3.4 3.4c-1.2 0-2.2-.6-2.8-1.5v-6.9z' />
	</svg>
);

const GoogleChatMark = (
	<svg viewBox='0 0 24 24' width='28' height='28' aria-hidden='true'>
		<path fill='#00AC47' d='M4 2h12a2 2 0 0 1 2 2v3h-4V6H6v8h2v4l-4 4a1.2 1.2 0 0 1-2-.9V4a2 2 0 0 1 2-2z' opacity='.35' />
		<path fill='#00AC47' d='M8 7h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-9l-3.6 3.1A.8.8 0 0 1 6 22.5V9a2 2 0 0 1 2-2z' />
		<rect x='10.5' y='12' width='7' height='1.8' rx='.9' fill='#fff' />
	</svg>
);

type ConnectWorkspaceModalProps = {
	onClose: () => void;
	onConnect: (provider: ExternalProvider) => void;
};

const ConnectWorkspaceModal = ({ onClose, onConnect }: ConnectWorkspaceModalProps): ReactElement => {
	const { t } = useTranslation();
	const router = useRouter();
	const isAdmin = useRole('admin');
	const { availability, isLoading } = useConnectorAvailability();
	const { connections } = useExternalWorkspaces();

	const cards: ProviderCardSpec[] = [
		{
			provider: 'slack',
			name: 'Slack',
			description: t('Connector_Slack_Description', { defaultValue: 'Bring your Slack channels and DMs into MatterChat.' }),
			settingsGroup: 'Slack',
			mark: SlackMark,
		},
		{
			provider: 'teams',
			name: 'Microsoft Teams',
			description: t('Connector_Teams_Description', { defaultValue: 'Chat with your Teams contacts without leaving MatterChat.' }),
			settingsGroup: 'Teams',
			mark: TeamsMark,
		},
		{
			provider: 'google',
			name: 'Google Chat',
			description: t('Connector_Google_Description', { defaultValue: 'Browse and reply to your Google Chat spaces from here.' }),
			settingsGroup: 'GoogleChat',
			mark: GoogleChatMark,
		},
	];

	const connectedCount = (provider: ExternalProvider): number => connections.filter((c) => c.provider === provider).length;

	const renderAction = (spec: ProviderCardSpec): ReactElement => {
		const state = availability[spec.provider];
		const count = connectedCount(spec.provider);

		if (isLoading) {
			return <Throbber size='x12' />;
		}

		if (state.enabled && state.configured) {
			return (
				<Box display='flex' alignItems='center'>
					{count > 0 && (
						<Tag variant='primary' mie={8}>
							{t('Connector_Connected', { defaultValue: 'Connected' })}
						</Tag>
					)}
					<Button small primary={count === 0} secondary={count > 0} onClick={(): void => onConnect(spec.provider)}>
						{count > 0
							? t('Connector_Add_Another', { defaultValue: 'Add another' })
							: t('Connector_Connect', { defaultValue: 'Connect' })}
					</Button>
				</Box>
			);
		}

		// Enabled but missing credentials, or fully disabled: keep the card visible and explain.
		if (isAdmin) {
			return (
				<Button
					small
					secondary
					onClick={(): void => {
						// Close FIRST: navigating behind an open modal looks like a dead button.
						onClose();
						router.navigate(`/admin/settings/${spec.settingsGroup}`);
					}}
				>
					<Icon name='cog' size='x16' mie={4} />
					{state.enabled
						? t('Connector_Finish_Setup', { defaultValue: 'Finish setup' })
						: t('Connector_Enable', { defaultValue: 'Enable' })}
				</Button>
			);
		}

		return <Tag>{t('Connector_Ask_Admin', { defaultValue: 'Ask your admin to enable this' })}</Tag>;
	};

	return (
		<GenericModal
			icon={null}
			title={t('Connect_A_Workspace', { defaultValue: 'Connect a workspace' })}
			onClose={onClose}
			onCancel={onClose}
			cancelText={t('Close')}
		>
				<Box fontScale='p2' color='hint' mbe={16}>
					{t('Connect_A_Workspace_Subtitle', { defaultValue: 'Bring the places your contacts already chat into one inbox.' })}
				</Box>
				{cards.map((spec) => (
					<Box
						key={spec.provider}
						display='flex'
						alignItems='center'
						pb={12}
						pi={12}
						mbe={8}
						borderWidth='default'
						borderColor='extra-light'
						borderRadius='x8'
						opacity={!isLoading && !availability[spec.provider].enabled && !isAdmin ? 0.6 : 1}
					>
						<Box mie={12} display='flex' alignItems='center'>
							{spec.mark}
						</Box>
						<Box flexGrow={1} minWidth={0}>
							<Box fontScale='p2b'>{spec.name}</Box>
							<Box fontScale='c1' color='hint' withTruncatedText>
								{spec.description}
							</Box>
						</Box>
						<Box mis={12} flexShrink={0}>
							{renderAction(spec)}
						</Box>
					</Box>
				))}
				<Box fontScale='c1' color='hint' mbs={12} display='flex' alignItems='center'>
					<Icon name='info' size='x16' mie={4} />
					{t('Connector_OAuth_Note', {
						defaultValue: "You'll be sent to the provider to approve access, then brought right back here.",
					})}
				</Box>
		</GenericModal>
	);
};

export default ConnectWorkspaceModal;
