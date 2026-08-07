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
import type { ChangeEvent, ReactElement } from 'react';
import { useId, useState } from 'react';

/**
 * MATTERCHAT: firm setup for a brand-new account.
 *
 * ## Required, not optional
 *
 * "Continue on my own" is gone. It read as a third way to use the product, but
 * there is no such mode: a user with no firm has no colleagues, no matter
 * channels and no directory cohort, and skipping actually dropped them into the
 * shared workspace beside other firms' default channels. The only two real
 * answers are "I am starting a firm here" and "I was invited to one", so those
 * are the only two the screen offers.
 *
 * The invited case needs no form — redeeming the invite link joins the firm and
 * clears the setup flag server-side — so it is explained rather than asked for.
 * Sign out stays reachable, because someone who landed on the wrong account
 * must be able to leave.
 *
 * ## What creating a firm actually produces
 *
 * A private team named with the firm's REAL name (not its slug) plus three
 * starter channels. The old flow created a slug-named team room and nothing
 * else, which is why it read as "it just made me a channel". The copy below
 * states what will be created, so the result is not a surprise.
 */
const FirmOnboardingPage = (): ReactElement => {
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

	/**
	 * Setup is complete once the firm exists — the server has already cleared
	 * `needsFirmSetup`, so refetching users.info is what actually dismisses this
	 * screen. There is no local "dismissed" state to get out of sync with.
	 */
	const finish = async (): Promise<void> => {
		await queryClient.invalidateQueries({ queryKey: ['users.info'] });
	};

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
			await finish();
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
			await finish();
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
											onChange={(e: ChangeEvent<HTMLInputElement>) => setFirmName(e.currentTarget.value)}
											placeholder={t('Firm_name_placeholder')}
											disabled={busy}
										/>
									</FieldRow>
									<FieldHint>{t('Firm_name_hint')}</FieldHint>
									{error && <FieldError>{error}</FieldError>}
								</Field>
							</FieldGroup>

							{/* Say what pressing the button produces, so the result is not a surprise. */}
							<Callout type='info' marginBlockStart={16} title={t('Firm_onboarding_what_you_get_title')}>
								<Box>{t('Firm_onboarding_what_you_get_body')}</Box>
							</Callout>

							{/* The invited path needs no form — the link does the work. */}
							<Box marginBlockStart={16} fontScale='c1' color='hint'>
								{t('Firm_onboarding_invited_hint')}
							</Box>
						</FormContainer>
						<FormFooter>
							<ButtonGroup stretch vertical>
								<Button primary loading={busy} onClick={() => void handleCreate()}>
									{t('Firm_create_action')}
								</Button>
								{/* No "continue without a firm": there is no such mode. Sign out
								    stays, so a wrong-account landing is not a trap. */}
								<Button secondary disabled={busy} onClick={() => logout()}>
									{t('Firm_onboarding_wrong_account')}
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
							<Callout type='success' title={t('Firm_created_callout', { firmName: createdFirmName })}>
								{t('Firm_created_callout_body')}
							</Callout>
							<FieldGroup marginBlockStart={16}>
								<Field>
									<FieldLabel htmlFor={emailsFieldId}>{t('Firm_invite_emails')}</FieldLabel>
									<FieldRow>
										<TextAreaInput
											id={emailsFieldId}
											rows={4}
											value={emailsRaw}
											onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setEmailsRaw(e.currentTarget.value)}
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
								{/* Skipping INVITES is fine — the firm already exists. */}
								<Button secondary disabled={busy} onClick={() => void finish()}>
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
