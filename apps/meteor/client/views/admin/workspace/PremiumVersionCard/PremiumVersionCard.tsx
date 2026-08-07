import type { IWorkspaceInfo } from '@rocket.chat/core-typings';
import { Box, Button } from '@rocket.chat/fuselage';
import type { SupportedVersions } from '@rocket.chat/server-cloud-communication';
import { useLicense, useLicenseName } from '@rocket.chat/ui-client';
import { useSetModal } from '@rocket.chat/ui-contexts';
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { getVersionStatus } from '../VersionCard/getVersionStatus';
import RegisterWorkspaceModal from '../VersionCard/modals/RegisterWorkspaceModal';
import { useFormatDate } from '../../../../hooks/useFormatDate';
import { useRegistrationStatus } from '../../../../hooks/useRegistrationStatus';
import { links } from '../../../../lib/links';
import { isOverLicenseLimits } from '../../../../lib/utils/isOverLicenseLimits';

const SUPPORT_EXTERNAL_LINK = links.go.versionSupport;
const RELEASES_EXTERNAL_LINK = links.go.updateProduct;

type PremiumVersionCardProps = {
	serverInfo: IWorkspaceInfo;
};

type StatusItem = {
	icon: 'check' | 'warning';
	danger?: boolean;
	label: ReactNode;
};

const PremiumVersionCard = ({ serverInfo }: PremiumVersionCardProps) => {
	const { t } = useTranslation();
	const setModal = useSetModal();
	const formatDate = useFormatDate();

	const { data: licenseData, refetch: refetchLicense } = useLicense({ loadValues: true });
	const { isRegistered, canViewRegistrationStatus } = useRegistrationStatus();
	const licenseName = useLicenseName();

	const { license, limits } = licenseData || {};
	const isAirgapped = license?.information?.offline;
	const serverVersion = serverInfo.version;

	const { versionStatus, versions } = useMemo(() => {
		const supportedVersions = serverInfo?.supportedVersions?.signed ? decodeBase64(serverInfo?.supportedVersions?.signed) : undefined;

		if (!supportedVersions) {
			return {};
		}

		const versionStatus = getVersionStatus(serverVersion, supportedVersions?.versions);

		return {
			versionStatus,
			versions: supportedVersions?.versions,
		};
	}, [serverInfo?.supportedVersions?.signed, serverVersion]);

	const isOverLimits = limits && isOverLicenseLimits(limits);

	const handleRegister = (): void => {
		const handleModalClose = (): void => {
			setModal(null);
			refetchLicense();
		};
		setModal(<RegisterWorkspaceModal onClose={handleModalClose} onStatusChange={refetchLicense} />);
	};

	const statusItems: StatusItem[] = useMemo(() => {
		return (
			[
				isOverLimits
					? {
							danger: true,
							icon: 'warning' as const,
							label: t('Plan_limits_reached'),
						}
					: {
							icon: 'check' as const,
							label: t('Operating_withing_plan_limits'),
						},
				(isAirgapped || !versions) && {
					icon: 'warning' as const,
					label: (
						<Trans i18nKey='Check_support_availability'>
							Check
							<a href={SUPPORT_EXTERNAL_LINK} target='_blank' rel='noreferrer' style={{ textDecoration: 'underline' }}>
								support
							</a>
							availability
						</Trans>
					),
				},
				versionStatus?.label !== 'outdated' &&
					versionStatus?.expiration && {
						icon: 'check' as const,
						label: (
							<Trans i18nKey='Version_supported_until' values={{ date: formatDate(versionStatus?.expiration) }}>
								Version
								<a href={SUPPORT_EXTERNAL_LINK} target='_blank' rel='noreferrer' style={{ textDecoration: 'underline' }}>
									supported
								</a>
								until {formatDate(versionStatus?.expiration)}
							</Trans>
						),
					},
				versionStatus?.label === 'outdated' && {
					danger: true,
					icon: 'warning' as const,
					label: (
						<Trans i18nKey='Version_not_supported'>
							Version
							<a href={SUPPORT_EXTERNAL_LINK} target='_blank' rel='noreferrer' style={{ textDecoration: 'underline' }}>
								not supported
							</a>
						</Trans>
					),
				},
				canViewRegistrationStatus &&
					(!isRegistered
						? {
								danger: true,
								icon: 'warning' as const,
								label: t('Workspace_not_registered'),
							}
						: {
								icon: 'check' as const,
								label: t('Workspace_registered'),
							}),
			].filter(Boolean) as StatusItem[]
		).sort((a) => (a.danger ? -1 : 1));
	}, [
		isOverLimits,
		t,
		isAirgapped,
		versions,
		versionStatus?.label,
		versionStatus?.expiration,
		formatDate,
		canViewRegistrationStatus,
		isRegistered,
	]);

	return (
		<Box
			backgroundColor='var(--surface)'
			borderRadius='14px'
			border='1px solid var(--border)'
			padding='24px 26px'
			position='relative'
			overflow='hidden'
			marginBlockEnd='16px'
		>
			{/* Radial gradient decoration top-right */}
			<Box
				position='absolute'
				right='-60px'
				top='-60px'
				width='280px'
				height='280px'
				borderRadius='9999px'
				backgroundColor='linear-gradient(135deg, var(--greenSoft) 0%, transparent 100%)'
				opacity='0.8'
				pointerEvents='none'
				style={{ zIndex: 0 }}
			/>

			{/* Content wrapper */}
			<Box position='relative' style={{ zIndex: 1 }}>
				{/* Version header */}
				<Box display='flex' alignItems='center' gap='12px' marginBlockEnd='4px'>
					<Box fontSize='22px' fontWeight='650' letterSpacing='-0.02em' color='var(--ink)'>
						Version {serverVersion}
					</Box>
					{!isAirgapped && versions && versionStatus?.label === 'supported' && (
						<Box
							fontSize='10.5px'
							fontWeight='600'
							padding='3px 10px'
							borderRadius='9999px'
							backgroundColor='var(--amberSoft)'
							border='1px solid var(--amberLine)'
							color='var(--amber)'
						>
							New version available
						</Box>
					)}
				</Box>

				{/* License name */}
				<Box fontFamily="'Geist Mono',monospace" fontSize='10.5px' letterSpacing='0.12em' color='var(--ink3)' marginBlockEnd='16px'>
					{licenseName.data}
				</Box>

				{/* Status checklist */}
				<Box display='flex' flexDirection='column' gap='10px'>
					{statusItems.map((item, idx) => (
						<Box key={idx} display='flex' alignItems='center' gap='10px'>
							<Box
								width='24px'
								height='24px'
								borderRadius='9999px'
								backgroundColor={item.danger ? 'var(--redSoft)' : 'var(--greenSoft)'}
								border={`1px solid ${item.danger ? 'var(--redLine)' : 'var(--greenLine)'}`}
								display='grid'
								placeItems='center'
								color={item.danger ? 'var(--red)' : 'var(--greenInk)'}
							>
								{item.icon === 'check' ? (
									<svg
										width='14'
										height='14'
										viewBox='0 0 24 24'
										fill='none'
										stroke='currentColor'
										strokeWidth='2.2'
										strokeLinecap='round'
										strokeLinejoin='round'
									>
										<path d='m5 12.5 4.5 4.5L19 7.5' />
									</svg>
								) : (
									<svg width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round'>
										<path d='M12 8v4.5M12 15.8v.2' />
										<path d='M12 4 2.5 20h19z' strokeLinejoin='round' />
									</svg>
								)}
							</Box>
							<Box fontSize='13px' color={item.danger ? 'var(--red)' : 'var(--ink2)'} fontWeight={item.danger ? '600' : '400'}>
								{item.label}
							</Box>
						</Box>
					))}
				</Box>

				{/* Register button */}
				{canViewRegistrationStatus && !isRegistered && (
					<Button
						marginBlockStart='20px'
						height='34px'
						padding='0 16px'
						borderRadius='9px'
						border='0'
						backgroundColor='var(--green)'
						color='var(--onGreen)'
						fontFamily='inherit'
						fontSize='13px'
						fontWeight='600'
						cursor='pointer'
						onClick={handleRegister}
						style={{
							boxShadow: 'var(--shadow1)',
							transition: 'all 0.15s',
						}}
						onMouseEnter={(e) => {
							e.currentTarget.style.background = 'var(--green2)';
							e.currentTarget.style.transform = 'translateY(-1px)';
						}}
						onMouseLeave={(e) => {
							e.currentTarget.style.background = 'var(--green)';
							e.currentTarget.style.transform = 'none';
						}}
						onMouseDown={(e) => {
							e.currentTarget.style.transform = 'translateY(0)';
						}}
					>
						{t('RegisterWorkspace_Button')}
					</Button>
				)}
			</Box>
		</Box>
	);
};

export default PremiumVersionCard;

const decodeBase64 = (b64: string): SupportedVersions | undefined => {
	const [, bodyEncoded] = b64.split('.');
	if (!bodyEncoded) {
		return;
	}

	return JSON.parse(atob(bodyEncoded));
};
