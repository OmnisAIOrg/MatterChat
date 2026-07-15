import type { IMatterSnapshot, Serialized } from '@rocket.chat/core-typings';
import { Box, Icon } from '@rocket.chat/fuselage';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import MatterSection from './MatterSection';
import MoneyRow from './MoneyRow';
import { fmtCurrency } from './matterFormatters';

type FinancialSummaryCardProps = {
	snapshot: Serialized<IMatterSnapshot>;
};

/**
 * Financial summary — the money picture of the matter in one tinted card:
 * medicals (billed/balance + provider count) and the negotiation ladder
 * (demand → top offer → settlement). All values are read-only CasePro
 * snapshot fields; empty fields render nothing, and the whole card hides
 * when there is no financial data at all.
 */
const FinancialSummaryCard = ({ snapshot }: FinancialSummaryCardProps): ReactElement | null => {
	const { t } = useTranslation();

	const billed = fmtCurrency(snapshot.totalBilled);
	const balance = fmtCurrency(snapshot.totalBalance);
	const demand = fmtCurrency(snapshot.lastDemandAmount);
	const offer = fmtCurrency(snapshot.lastOfferAmount);
	const settlement = fmtCurrency(snapshot.settlementAmount);
	const providers = typeof snapshot.providerCount === 'number' ? snapshot.providerCount : undefined;

	if (!billed && !balance && !demand && !offer && !settlement && providers === undefined) {
		return null;
	}

	return (
		<MatterSection title={t('Boards_Matters_Report_Financial', { defaultValue: 'Financial' })} icon='card'>
			<Box bg='tint' p={12} borderRadius='x4'>
				<MoneyRow label={t('Boards_Matters_Total_Billed', { defaultValue: 'Total billed' })} value={billed} />
				<MoneyRow label={t('Boards_Matters_Total_Balance', { defaultValue: 'Total balance' })} value={balance} />
				<MoneyRow label={t('Boards_Matters_Demand', { defaultValue: 'Demand' })} value={demand} />
				<MoneyRow label={t('Boards_Matters_Top_Offer', { defaultValue: 'Top offer' })} value={offer} />
				<MoneyRow label={t('Boards_Matters_Settlement', { defaultValue: 'Settlement' })} value={settlement} emphasis />
				{providers !== undefined && (
					<Box display='flex' alignItems='center' fontScale='micro' color='hint' mbs={6}>
						<Icon name='team' size='x12' mie={4} />
						{providers} {t('Boards_Matters_Providers', { defaultValue: 'Providers' }).toLowerCase()}
					</Box>
				)}
			</Box>
		</MatterSection>
	);
};

export default FinancialSummaryCard;
