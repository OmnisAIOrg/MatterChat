import type { ITimeEntry, Serialized } from '@rocket.chat/core-typings';
import { Box, Button, IconButton, TextInput, Throbber } from '@rocket.chat/fuselage';
import { useEndpoint, useMethod, useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { KeyboardEvent, ReactElement } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { LedgerProgress, ledgerHead, ledgerRule, tabularFigures, useLedgerTone } from './ledgerStyles';

/**
 * TimePanel — time tracking on the card detail view: a per-card estimate plus
 * logged-time entries with a rollup. Estimate rides the generic
 * `boards.cardUpdate` method (`patch.timeEstimateMinutes`); entries use the
 * dedicated `boards.card.log-time` / `boards.card.delete-time-entry` routes.
 *
 * Inputs are entered in HOURS (decimal) and stored as minutes. Generic /
 * standalone-safe — applies to any card type, no CasePro dependency. Mirrors
 * ChecklistPanel's useEndpoint + useMutation + query-invalidation idiom.
 */

type TimePanelProps = {
	boardId: string;
	cardId: string;
	estimateMinutes?: number;
	entries: Serialized<ITimeEntry>[];
};

const fmtMinutes = (min: number): string => {
	if (min <= 0) {
		return '0m';
	}
	const h = Math.floor(min / 60);
	const m = min % 60;
	return [h ? `${h}h` : '', m ? `${m}m` : ''].filter(Boolean).join(' ') || '0m';
};

const hoursToMinutes = (str: string): number => {
	const h = parseFloat(str);
	return Number.isFinite(h) && h > 0 ? Math.round(h * 60) : 0;
};

const TimePanel = ({ boardId, cardId, estimateMinutes, entries }: TimePanelProps): ReactElement => {
	const { t } = useTranslation();
	const tone = useLedgerTone();
	const dispatchToastMessage = useToastMessageDispatch();
	const queryClient = useQueryClient();

	const cardUpdate = useMethod('boards.cardUpdate');
	const logTime = useEndpoint('POST', '/v1/boards.card.log-time');
	const deleteTimeEntry = useEndpoint('POST', '/v1/boards.card.delete-time-entry');

	const [estimateInput, setEstimateInput] = useState(estimateMinutes ? String(estimateMinutes / 60) : '');
	const [logHours, setLogHours] = useState('');
	const [logNote, setLogNote] = useState('');
	// Last estimate we actually committed — guards against a double-commit (Enter then blur
	// both fire before the prop round-trips) without relying on the async-lagging prop.
	const lastCommittedRef = useRef(estimateMinutes ?? 0);

	// Keep the estimate field in sync when the card refetches (e.g. edited elsewhere).
	useEffect(() => {
		setEstimateInput(estimateMinutes ? String(estimateMinutes / 60) : '');
		lastCommittedRef.current = estimateMinutes ?? 0;
	}, [estimateMinutes]);

	const invalidate = (): void => {
		void queryClient.invalidateQueries({ queryKey: ['boards', 'card', cardId] });
		void queryClient.invalidateQueries({ queryKey: ['boards', 'cards', boardId] });
		void queryClient.invalidateQueries({ queryKey: ['boards', 'activities', cardId] });
	};
	const onError = (error: unknown): void => dispatchToastMessage({ type: 'error', message: error });

	const estimateMutation = useMutation({
		mutationFn: (minutes: number) => cardUpdate({ cardId, patch: { timeEstimateMinutes: minutes } }),
		onSuccess: invalidate,
		onError,
	});

	const logMutation = useMutation({
		mutationFn: (vars: { minutes: number; note?: string }) => logTime({ cardId, ...vars }),
		onSuccess: () => {
			setLogHours('');
			setLogNote('');
			invalidate();
		},
		onError,
	});

	const deleteMutation = useMutation({
		mutationFn: (entryId: string) => deleteTimeEntry({ cardId, entryId }),
		onSuccess: invalidate,
		onError,
	});

	const busy = estimateMutation.isPending || logMutation.isPending || deleteMutation.isPending;

	const logged = entries.reduce((sum, e) => sum + e.minutes, 0);
	const estimate = estimateMinutes ?? 0;
	const percent = estimate > 0 ? Math.min(100, Math.round((logged / estimate) * 100)) : 0;

	const commitEstimate = (): void => {
		const minutes = hoursToMinutes(estimateInput);
		if (minutes === lastCommittedRef.current) {
			return;
		}
		lastCommittedRef.current = minutes;
		estimateMutation.mutate(minutes);
	};

	const handleLog = (): void => {
		const minutes = hoursToMinutes(logHours);
		if (minutes <= 0 || logMutation.isPending) {
			return;
		}
		const note = logNote.trim();
		logMutation.mutate({ minutes, ...(note ? { note } : {}) });
	};

	const handleLogKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
		if (e.key === 'Enter') {
			e.preventDefault();
			handleLog();
		}
	};

	return (
		<Box marginBlockStart={12}>
			{/* Compact small-caps section head + tabular rollup figures over a khaki rule. */}
			<Box
				display='flex'
				alignItems='center'
				justifyContent='space-between'
				marginBlockEnd={6}
				paddingBlockEnd={2}
				style={ledgerRule(tone)}
			>
				<Box style={ledgerHead(tone)}>{t('Boards_Time', { defaultValue: 'Time' })}</Box>
				<Box fontScale='c1' color='hint' style={tabularFigures}>
					{t('Boards_Time_Rollup', {
						logged: fmtMinutes(logged),
						estimate: estimate > 0 ? fmtMinutes(estimate) : '—',
						defaultValue: '{{logged}} logged / {{estimate}} estimated',
					})}
				</Box>
			</Box>

			{estimate > 0 && (
				<Box marginBlockEnd={6}>
					<LedgerProgress percent={percent} tone={tone} />
				</Box>
			)}

			{/* Estimate */}
			<Box display='flex' alignItems='center' marginBlockEnd={8} style={{ gap: '8px' }}>
				<Box fontScale='c1' color='hint' style={{ minWidth: 72 }}>
					{t('Boards_Time_Estimate', { defaultValue: 'Estimate' })}
				</Box>
				<TextInput
					value={estimateInput}
					placeholder={t('Boards_Time_Hours', { defaultValue: 'Hours' })}
					disabled={estimateMutation.isPending}
					onChange={(e) => setEstimateInput((e.target as HTMLInputElement).value)}
					onBlur={commitEstimate}
					onKeyDown={(e) => {
						if (e.key === 'Enter') {
							e.preventDefault();
							commitEstimate();
						}
					}}
				/>
			</Box>

			{/* Logged entries — tabular time figures aligned in a column, khaki-ruled rows */}
			{entries.map((entry) => (
				<Box
					key={entry.id}
					display='flex'
					alignItems='center'
					marginBlockEnd={2}
					paddingBlockEnd={2}
					style={{ gap: '8px', ...ledgerRule(tone) }}
				>
					<Box fontScale='p2' color='default' style={{ minWidth: 64, ...tabularFigures }}>
						{fmtMinutes(entry.minutes)}
					</Box>
					<Box fontScale='c1' color='hint' flexGrow={1} withTruncatedText style={tabularFigures}>
						{entry.note ? `${entry.note} · ` : ''}
						{new Date(entry.spentAt).toLocaleDateString()}
					</Box>
					<IconButton tiny icon='trash' disabled={busy} aria-label={t('Remove')} onClick={() => deleteMutation.mutate(entry.id)} />
				</Box>
			))}

			{/* Log time */}
			<Box display='flex' alignItems='center' marginBlockStart={8} style={{ gap: '8px' }}>
				<TextInput
					value={logHours}
					placeholder={t('Boards_Time_Hours', { defaultValue: 'Hours' })}
					disabled={logMutation.isPending}
					onChange={(e) => setLogHours((e.target as HTMLInputElement).value)}
					onKeyDown={handleLogKeyDown}
					style={{ maxWidth: 96 }}
				/>
				<TextInput
					value={logNote}
					placeholder={t('Boards_Time_Note', { defaultValue: 'Note (optional)' })}
					disabled={logMutation.isPending}
					onChange={(e) => setLogNote((e.target as HTMLInputElement).value)}
					onKeyDown={handleLogKeyDown}
				/>
				<Button small primary disabled={hoursToMinutes(logHours) <= 0 || logMutation.isPending} onClick={handleLog}>
					{logMutation.isPending ? <Throbber inheritColor size='x12' /> : t('Boards_Time_Log', { defaultValue: 'Log' })}
				</Button>
			</Box>
		</Box>
	);
};

export default TimePanel;
