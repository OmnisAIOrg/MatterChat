import {
	Box,
	Button,
	ButtonGroup,
	Callout,
	Field,
	FieldError,
	FieldGroup,
	FieldHint,
	FieldLabel,
	FieldRow,
	TextAreaInput,
	TextInput,
} from '@rocket.chat/fuselage';
import { Form, VerticalWizardLayout } from '@rocket.chat/layout';
import { useEndpoint, useLogout, useToastMessageDispatch, useTranslation } from '@rocket.chat/ui-contexts';
import { useQueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { useId, useState } from 'react';

/**
 * MATTERCHAT: self-serve firm onboarding. Shown (by FirmSetupCheck) to a
 * freshly registered user who has no firm and no rooms yet. Two steps:
 *   1. name the firm  → POST /v1/firms.create (private team + firm stamp)
 *   2. invite teammates by email → POST /v1/firms.invite (optional)
 * "Continue on my own" / "Skip" fall through to the normal workspace.
 */
const FirmOnboardingPage = ({ onDone }: { onDone: () => void }): ReactElement => {
	const t = useTranslation();
	const logout = useLogout();
	const dispatchToastMessage = useToastMessageDispatch();
	const queryClient = useQueryClient();
	const nameFieldId = useId();
	const emailsFieldId = useId();

	const createFirm = useEndpoint('POST', '/v1/firms.create');
	const inviteToFirm = useEndpoint('POST', '/v1/firms.invite');

	const [step, setStep] = useState<'name' | 'invite'>('name');
	const [firmName, setFirmName] = useState('');
	const [emailsRaw, setEmailsRaw] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [createdFirmName, setCreatedFirmName] = useState('');
	// Set when the workspace has no mail transport: nothing was emailed, so the
	// owner has to distribute this link themselves (2026-07-30 smoke defect — the
	// UI used to report "invitations sent" for mail that never left the box).
	const [manualInviteUrl, setManualInviteUrl] = useState<string | null>(null);

	const handleCreate = async (): Promise<void> => {
		const name = firmName.trim();
		if (name.length < 2) {
			setError(t('Firm_name_too_short'));
			return;
		}
		setBusy(true);
		setError(null);
		try {
			const { firm } = await createFirm({ name });
			setCreatedFirmName(firm.name);
			await queryClient.invalidateQueries({ queryKey: ['users.info'] });
			setStep('invite');
		} catch (e: unknown) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	};

	const handleInvite = async (): Promise<void> => {
		const emails = emailsRaw
			.split(/[\s,;]+/)
			.map((e) => e.trim())
			.filter(Boolean);
		if (emails.length === 0) {
			onDone();
			return;
		}
		setBusy(true);
		setError(null);
		try {
			const { queued, invalid, undelivered, emailDelivery, inviteUrl } = await inviteToFirm({ emails });
			if (queued.length > 0) {
				dispatchToastMessage({ type: 'success', message: t('Firm_invites_queued', { count: queued.length }) });
			}
			if (invalid.length > 0) {
				dispatchToastMessage({ type: 'warning', message: t('Firm_invites_failed', { emails: invalid.join(', ') }) });
			}
			if (emailDelivery === 'unavailable') {
				// keep the user on this step — the link is the only way their team gets in
				setManualInviteUrl(inviteUrl);
				return;
			}
			if (undelivered.length > 0) {
				dispatchToastMessage({ type: 'warning', message: t('Firm_invites_undelivered', { emails: undelivered.join(', ') }) });
			}
			onDone();
		} catch (e: unknown) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	};

	return (
		<VerticalWizardLayout>
			<Form>
				{step === 'name' ? (
					<>
						<Form.Header>
							<Form.Title>{t('Firm_onboarding_title')}</Form.Title>
							<Form.Subtitle>{t('Firm_onboarding_subtitle')}</Form.Subtitle>
						</Form.Header>
						<Form.Container>
							<FieldGroup>
								<Field>
									<FieldLabel htmlFor={nameFieldId}>{t('Firm_name')}</FieldLabel>
									<FieldRow>
										<TextInput
											id={nameFieldId}
											value={firmName}
											onChange={(e) => setFirmName((e.target as HTMLInputElement).value)}
											placeholder={t('Firm_name_placeholder')}
											disabled={busy}
										/>
									</FieldRow>
									<FieldHint>{t('Firm_name_hint')}</FieldHint>
									{error && <FieldError>{error}</FieldError>}
								</Field>
							</FieldGroup>
							<Box mbs={16} fontScale='c1' color='hint'>
								{t('Firm_onboarding_invited_hint')}
							</Box>
						</Form.Container>
						<Form.Footer>
							<ButtonGroup stretch vertical>
								<Button primary loading={busy} onClick={() => void handleCreate()}>
									{t('Firm_create_action')}
								</Button>
								<Button secondary disabled={busy} onClick={onDone}>
									{t('Firm_skip_action')}
								</Button>
								<Button secondary disabled={busy} onClick={() => logout()}>
									{t('Logout')}
								</Button>
							</ButtonGroup>
						</Form.Footer>
					</>
				) : (
					<>
						<Form.Header>
							<Form.Title>{t('Firm_invite_title', { firmName: createdFirmName })}</Form.Title>
							<Form.Subtitle>{t('Firm_invite_subtitle')}</Form.Subtitle>
						</Form.Header>
						<Form.Container>
							<Callout type='success' title={t('Firm_created_callout', { firmName: createdFirmName })} />
							{manualInviteUrl && (
								<Callout mbs={16} type='warning' title={t('Firm_invites_email_unavailable')}>
									<Box fontScale='p2' style={{ wordBreak: 'break-all' }}>
										{manualInviteUrl}
									</Box>
								</Callout>
							)}
							<FieldGroup mbs={16}>
								<Field>
									<FieldLabel htmlFor={emailsFieldId}>{t('Firm_invite_emails')}</FieldLabel>
									<FieldRow>
										<TextAreaInput
											id={emailsFieldId}
											rows={4}
											value={emailsRaw}
											onChange={(e) => setEmailsRaw((e.target as HTMLTextAreaElement).value)}
											placeholder={t('Firm_invite_emails_placeholder')}
											disabled={busy}
										/>
									</FieldRow>
									<FieldHint>{t('Firm_invite_emails_hint')}</FieldHint>
									{error && <FieldError>{error}</FieldError>}
								</Field>
							</FieldGroup>
						</Form.Container>
						<Form.Footer>
							<ButtonGroup stretch vertical>
								<Button primary loading={busy} onClick={() => void handleInvite()}>
									{t('Firm_invite_send_action')}
								</Button>
								<Button secondary disabled={busy} onClick={onDone}>
									{t('Firm_invite_skip_action')}
								</Button>
							</ButtonGroup>
						</Form.Footer>
					</>
				)}
			</Form>
		</VerticalWizardLayout>
	);
};

export default FirmOnboardingPage;
