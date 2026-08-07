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
import { Form, FormContainer, FormFooter, FormHeader, FormSubtitle, FormTitle, VerticalWizardLayout } from '@rocket.chat/layout';
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
			const { sent, invalid } = await inviteToFirm({ emails });
			if (sent.length > 0) {
				dispatchToastMessage({ type: 'success', message: t('Firm_invites_sent', { count: sent.length }) });
			}
			if (invalid.length > 0) {
				dispatchToastMessage({ type: 'warning', message: t('Firm_invites_failed', { emails: invalid.join(', ') }) });
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
						<FormHeader>
							<FormTitle>{t('Firm_onboarding_title')}</FormTitle>
							<FormSubtitle>{t('Firm_onboarding_subtitle')}</FormSubtitle>
						</FormHeader>
						<FormContainer>
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
							<Box marginBlockStart={16} fontScale='c1' color='hint'>
								{t('Firm_onboarding_invited_hint')}
							</Box>
						</FormContainer>
						<FormFooter>
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
						</FormFooter>
					</>
				) : (
					<>
						<FormHeader>
							<FormTitle>{t('Firm_invite_title', { firmName: createdFirmName })}</FormTitle>
							<FormSubtitle>{t('Firm_invite_subtitle')}</FormSubtitle>
						</FormHeader>
						<FormContainer>
							<Callout type='success' title={t('Firm_created_callout', { firmName: createdFirmName })} />
							<FieldGroup marginBlockStart={16}>
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
						</FormContainer>
						<FormFooter>
							<ButtonGroup stretch vertical>
								<Button primary loading={busy} onClick={() => void handleInvite()}>
									{t('Firm_invite_send_action')}
								</Button>
								<Button secondary disabled={busy} onClick={onDone}>
									{t('Firm_invite_skip_action')}
								</Button>
							</ButtonGroup>
						</FormFooter>
					</>
				)}
			</Form>
		</VerticalWizardLayout>
	);
};

export default FirmOnboardingPage;
