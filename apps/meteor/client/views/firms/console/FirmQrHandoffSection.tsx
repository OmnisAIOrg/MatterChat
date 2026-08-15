import { Box, Callout, Select, Skeleton } from '@rocket.chat/fuselage';
import { useEndpoint } from '@rocket.chat/ui-contexts';
import { useQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import qrcode from 'yaqrcode';

import { firmInvitesQueryKey } from './firmConsole';
import TextCopy from '../../../components/TextCopy';

/**
 * Rendered size of the QR bitmap, in CSS pixels — large enough to scan from a
 * desk. Kept in step with the `x200` Fuselage size token on the <img> below;
 * the token has to be a literal, so it cannot be derived from this.
 */
const QR_SIZE = 200;

/**
 * MATTERCHAT: the phone handoff — a QR code of a live invite link.
 *
 * ## What problem this solves
 *
 * Setting up a phone against a self-hosted workspace means typing a server URL
 * and then an invite link, on a phone keyboard, correctly. That is the step
 * where a new hire gives up and the office manager ends up doing it for them.
 * A QR code of the invite URL collapses both into pointing a camera at a
 * screen: the link carries the workspace origin, so the phone lands in the
 * right place already invited.
 *
 * ## No new dependency
 *
 * `yaqrcode` is ALREADY a dependency of apps/meteor — Rocket.Chat's own TOTP
 * setup uses it to draw the authenticator QR (see
 * `views/account/security/TwoFactorTOTP.tsx`). It renders to a data URI with no
 * network access and no canvas, which is also why it works under jsdom. Nothing
 * was added to package.json for this screen.
 *
 * ## Which link gets encoded
 *
 * Whichever live invite the owner picks, defaulting to the most recent. The
 * list comes from the same query key the invites section uses, so a link
 * revoked up there disappears from this picker too, and a QR is never printed
 * from a link that no longer works.
 */
const FirmQrHandoffSection = (): ReactElement => {
	const { t } = useTranslation();

	const listInvites = useEndpoint('GET', '/v1/firms.invites.list');

	const { data, isLoading, isError } = useQuery({
		queryKey: firmInvitesQueryKey,
		queryFn: () => listInvites(),
	});

	const invites = useMemo(() => data?.invites ?? [], [data]);
	const [selectedId, setSelectedId] = useState<string | null>(null);

	// `listFirmInvites` sorts newest-first, so index 0 is the freshest link.
	const selected = invites.find((invite) => invite._id === selectedId) ?? invites[0];

	const qrDataUri = useMemo(() => {
		if (!selected) {
			return null;
		}
		try {
			return qrcode(selected.url, { size: QR_SIZE });
		} catch (error) {
			// A URL too long for the chosen QR version throws rather than
			// degrading. The link itself is still shown below, so the section
			// stays useful instead of blanking out.
			console.warn('Firm console: could not render an invite QR code', error);
			return null;
		}
	}, [selected]);

	if (isLoading) {
		return <Skeleton variant='rect' width='x200' height='x200' />;
	}

	if (isError) {
		return <Callout type='warning'>{t('Firm_QR_Unavailable')}</Callout>;
	}

	if (!selected) {
		return (
			<Box fontScale='p2' color='hint'>
				{t('Firm_QR_Empty')}
			</Box>
		);
	}

	return (
		<>
			{invites.length > 1 && (
				<Box marginBlockEnd={12} maxWidth='x360'>
					<Select
						aria-label={t('Firm_QR_Choose_Invite')}
						options={invites.map((invite) => [invite._id, invite.url] as [string, string])}
						value={selected._id}
						onChange={(value) => setSelectedId(String(value))}
					/>
				</Box>
			)}

			{qrDataUri ? (
				<Box is='img' size='x200' src={qrDataUri} alt={t('Firm_QR_Alt')} />
			) : (
				<Callout type='warning'>{t('Firm_QR_Render_Failed')}</Callout>
			)}

			<Box marginBlockStart={12}>
				<Box fontScale='c1' color='hint' marginBlockEnd={4}>
					{t('Firm_QR_Link_Hint')}
				</Box>
				<TextCopy text={selected.url} />
			</Box>
		</>
	);
};

export default FirmQrHandoffSection;
