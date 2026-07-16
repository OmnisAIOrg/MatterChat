import type { IMatterSnapshot, Serialized } from '@rocket.chat/core-typings';
import { Box } from '@rocket.chat/fuselage';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import MatterSection from './MatterSection';
import MoneyRow from './MoneyRow';
import { fmtCurrency } from './matterFormatters';
import { LEDGER_CARD_TINT, LEDGER_RULE } from '../../lib/ledger';

type FinancialSummaryCardProps = {
	snapshot: Serialized<IMatterSnapshot>;
};

// Shared props for the emphasized label above each group inside the tinted card.
// (Kept as a props object rather than a component so the file stays one-component.)
const groupLabelProps = { fontScale: 'c1', color: 'default', mbe: 4, style: { fontWeight: 600 } } as const;

/**
 * Financial summary — the money picture of the matter in one tinted card, split
 * into four labeled groups:
 *  - 🩺 Medical treatment — the matter's medical providers (name · type), with
 *    the provider count in the header. Providers ARE the treatment
 *    representation: CasePro has no per-visit detail, so this is the finest
 *    grain available (empty state when none are on file).
 *  - 💵 Medical bills — total billed + outstanding balance.
 *  - 📄 Expenses — case costs advanced ($0 when none, hidden only when the field
 *    is absent from the snapshot entirely).
 *  - 🤝 Negotiation — the demand → top offer → settlement ladder.
 *
 * All values are read-only CasePro snapshot fields; empty groups render nothing
 * and the whole card hides when there is no financial data at all.
 */
const FinancialSummaryCard = ({ snapshot }: FinancialSummaryCardProps): ReactElement | null => {
	const { t } = useTranslation();

	const billed = fmtCurrency(snapshot.totalBilled);
	const balance = fmtCurrency(snapshot.totalBalance);
	const demand = fmtCurrency(snapshot.lastDemandAmount);
	const offer = fmtCurrency(snapshot.lastOfferAmount);
	const settlement = fmtCurrency(snapshot.settlementAmount);

	const providers = snapshot.providers ?? [];
	const providerCount = typeof snapshot.providerCount === 'number' ? snapshot.providerCount : undefined;

	// Expenses is `0 when none`, so guard on presence — a real $0 must still show.
	const hasExpenses = snapshot.expensesTotal !== undefined && snapshot.expensesTotal !== null;
	const expenses = hasExpenses ? fmtCurrency(snapshot.expensesTotal) : undefined;

	const hasMedical = providerCount !== undefined || providers.length > 0;
	const hasBills = Boolean(billed || balance);
	const hasNegotiation = Boolean(demand || offer || settlement);

	if (!hasMedical && !hasBills && !hasExpenses && !hasNegotiation) {
		return null;
	}

	return (
		<MatterSection title={t('Boards_Matters_Report_Financial', { defaultValue: 'Financial' })} icon='card'>
			{/* Warm ledger tint (the chat "own message" card color) + khaki hairline. */}
			<Box bg='tint' p={10} borderRadius='x4' borderWidth='default' style={{ backgroundColor: LEDGER_CARD_TINT, borderColor: LEDGER_RULE }}>
				{/* 🩺 Medical treatment — providers are the treatment representation. */}
				<Box {...groupLabelProps} mbs={0}>
					{`🩺 ${t('Boards_Matters_Medical_Treatment', { defaultValue: 'Medical treatment' })}`}
					{providerCount !== undefined ? ` (${providerCount})` : ''}
				</Box>
				{providers.length > 0 ? (
					// Array.from (not providers.map) so the call resolves against Array even when the
					// snapshot's `providers` field is not yet in the resolved core-typings dist.
					Array.from(providers, (provider: { name: string; type?: string }, index: number) => (
						<Box key={`${provider.name}-${index}`} fontScale='p2' color='default' mbe={4}>
							{provider.name}
							{provider.type ? (
								<Box is='span' color='hint'>
									{` · ${provider.type}`}
								</Box>
							) : null}
						</Box>
					))
				) : (
					<Box fontScale='c1' color='hint' mbe={4}>
						{t('Boards_Matters_No_Providers', { defaultValue: 'No providers on file' })}
					</Box>
				)}

				{/* 💵 Medical bills */}
				{hasBills && (
					<>
						<Box {...groupLabelProps} mbs={10}>
							{`💵 ${t('Boards_Matters_Medical_Bills', { defaultValue: 'Medical bills' })}`}
						</Box>
						<MoneyRow label={t('Boards_Matters_Billed', { defaultValue: 'Billed' })} value={billed} />
						<MoneyRow label={t('Boards_Matters_Balance', { defaultValue: 'Balance' })} value={balance} />
					</>
				)}

				{/* 📄 Expenses (case costs advanced) — $0 shown when zero. */}
				{hasExpenses && (
					<>
						<Box {...groupLabelProps} mbs={10}>
							{`📄 ${t('Boards_Matters_Expenses', { defaultValue: 'Expenses' })}`}
						</Box>
						<MoneyRow label={t('Boards_Matters_Expenses', { defaultValue: 'Expenses' })} value={expenses} />
					</>
				)}

				{/* 🤝 Negotiation ladder (demand → top offer → settlement) */}
				{hasNegotiation && (
					<>
						<Box {...groupLabelProps} mbs={10}>
							{`🤝 ${t('Boards_Matters_Negotiation', { defaultValue: 'Negotiation' })}`}
						</Box>
						<MoneyRow label={t('Boards_Matters_Demand', { defaultValue: 'Demand' })} value={demand} />
						<MoneyRow label={t('Boards_Matters_Top_Offer', { defaultValue: 'Top offer' })} value={offer} />
						<MoneyRow label={t('Boards_Matters_Settlement', { defaultValue: 'Settlement' })} value={settlement} emphasis />
					</>
				)}
			</Box>
		</MatterSection>
	);
};

export default FinancialSummaryCard;
