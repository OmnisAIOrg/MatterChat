import { Box, Button, Chip, Icon, Option, Tag, TextInput, Throbber } from '@rocket.chat/fuselage';
import { useQuery } from '@tanstack/react-query';
import type { ChangeEvent, ReactElement } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { searchMatters } from './omnisRest';
import type { OmnisMatterRef } from './omnisRest';
import type { UseMatterContextResult } from './useMatterContext';

/**
 * The matter control every Omnis panel renders. Two shapes, chosen by the
 * active screen — never by preference:
 *
 * - **Matter channel** → a read-only chip labelled *"from this channel"*. No
 *   picker at all. The matter is inherited and the user does nothing.
 * - **Anything else** → the three-tier picker, with NOTHING pre-selected.
 *
 * ### The three tiers, in this order
 *
 * 1. **The product's best guess**, when it supplies one — explicitly labelled as
 *    a guess, with its confidence (`GUESS · 41%`). A low-confidence guess is
 *    never presented as a confirmed match; that is how documents end up filed
 *    against the wrong case by someone who trusted the UI.
 * 2. **Recent matters** for this user.
 * 3. **Live search across every matter in the firm** as they type — name,
 *    matter number, or client name.
 *
 * Every panel also offers the non-matter path (*General* / *Just me*), which
 * saves to the user's own workspace and touches no matter.
 */

export type MatterContextFieldProps = {
	context: UseMatterContextResult;
	/** The product's own guess, when it has one. Rendered as tier 1. */
	guess?: OmnisMatterRef;
	/** Label for the non-matter path, e.g. "General" or "Just me". */
	personalLabel: string;
	personalHint?: string;
};

const MatterContextField = ({ context, guess, personalLabel, personalHint }: MatterContextFieldProps): ReactElement => {
	const { t } = useTranslation();
	const [term, setTerm] = useState('');

	const { data: results, isFetching } = useQuery({
		queryKey: ['omnis', 'matter-search', term],
		queryFn: () => searchMatters(term),
		enabled: term.trim().length >= 2,
		staleTime: 15_000,
	});

	// --- Inherited: read-only chip, no picker. -------------------------------
	if (context.bound) {
		return (
			<Box>
				<Box display='flex' alignItems='center' style={{ gap: 8 }}>
					<Chip>
						<Icon name='hashtag' size={14} /> {context.bound.matterName}
					</Chip>
				</Box>
				<Box fontScale='micro' color='annotation' marginBlockStart={4}>
					{t('Omnis_Matter_from_this_channel')}
				</Box>
			</Box>
		);
	}

	// --- Confirmed by the user: chip with a *change* affordance. -------------
	if (context.selected) {
		return (
			<Box display='flex' alignItems='center' style={{ gap: 8 }}>
				<Chip>
					<Icon name='hashtag' size={14} /> {context.selected.matterName}
				</Chip>
				<Button tiny secondary onClick={context.clear}>
					{t('Omnis_Change')}
				</Button>
			</Box>
		);
	}

	if (context.destination?.kind === 'personal') {
		return (
			<Box display='flex' alignItems='center' style={{ gap: 8 }}>
				<Chip>{personalLabel}</Chip>
				<Button tiny secondary onClick={context.clear}>
					{t('Omnis_Change')}
				</Button>
			</Box>
		);
	}

	// --- Nothing resolved: the picker. Nothing is pre-selected. --------------
	const searchResults = results?.matters ?? [];
	const showEmpty = term.trim().length >= 2 && !isFetching && searchResults.length === 0;

	return (
		<Box>
			<TextInput
				value={term}
				placeholder={t('Omnis_Matter_search_placeholder')}
				onChange={(e: ChangeEvent<HTMLInputElement>) => setTerm(e.currentTarget.value)}
			/>

			<Box marginBlockStart={8} style={{ maxHeight: 220, overflowY: 'auto' }}>
				{/* Tier 1 — the product's guess, honestly labelled. */}
				{guess && !term && (
					<Option onClick={() => context.select({ ...guess, source: 'guess' })}>
						<Box display='flex' alignItems='center' justifyContent='space-between' width='100%' style={{ gap: 8 }}>
							<Box withTruncatedText>{guess.matterName}</Box>
							<Tag variant='secondary'>
								{t('Omnis_Guess')} · {Math.round((guess.confidence ?? 0) * 100)}%
							</Tag>
						</Box>
					</Option>
				)}

				{/* Tier 2 — recent matters for this user. */}
				{!term && context.recent.length > 0 && (
					<>
						<Box fontScale='micro' color='annotation' paddingInline={12} paddingBlock={6}>
							{t('Omnis_Recent_matters')}
						</Box>
						{context.recent.map((matter) => (
							<Option key={matter.matterId} onClick={() => context.select(matter)}>
								{matter.matterName}
							</Option>
						))}
					</>
				)}

				{/* Tier 3 — live search across the firm. */}
				{isFetching && (
					<Box paddingBlock={12} display='flex' justifyContent='center'>
						<Throbber size='x12' />
					</Box>
				)}
				{searchResults.map((matter) => (
					<Option key={matter.matterId} onClick={() => context.select(matter)}>
						<Box display='flex' alignItems='center' justifyContent='space-between' width='100%' style={{ gap: 8 }}>
							<Box withTruncatedText>{matter.matterName}</Box>
							{matter.matterNumber && (
								<Box fontScale='micro' color='annotation'>
									{matter.matterNumber}
								</Box>
							)}
						</Box>
					</Option>
				))}

				{showEmpty && (
					<Box paddingInline={12} paddingBlock={12} fontScale='c1' color='annotation'>
						{t('Omnis_Matter_search_empty', { term })}
					</Box>
				)}
			</Box>

			{/* The non-matter path, always available. */}
			<Box marginBlockStart={8} paddingBlockStart={8} style={{ borderTop: '1px solid var(--rcx-color-stroke-extra-light, #eee)' }}>
				<Button small secondary width='100%' onClick={context.choosePersonal}>
					{personalLabel}
				</Button>
				{personalHint && (
					<Box fontScale='micro' color='annotation' marginBlockStart={4}>
						{personalHint}
					</Box>
				)}
			</Box>
		</Box>
	);
};

export default MatterContextField;
