import type { IBoardDeadline, Serialized } from '@rocket.chat/core-typings';
import { Box } from '@rocket.chat/fuselage';
import type { CSSProperties, ReactElement } from 'react';

import { daysUntil } from '../../boards/card/matter/matterFormatters';

// Theme-neutral track/fill (grey reads on light + dark); fixed saturated status hues for the ticks.
const TRACK = 'rgba(127, 127, 127, 0.22)';
const FILL = 'rgba(127, 127, 127, 0.5)';
const DONE = '#12b76a'; // satisfied / waived
const UPCOMING = '#f79009'; // open & still ahead
const DANGER = '#f04438'; // missed, SOL, or already passed

const toTime = (value?: string | Date): number | undefined => {
	if (!value) {
		return undefined;
	}
	const t = new Date(value).getTime();
	return Number.isNaN(t) ? undefined : t;
};

const tickColor = (deadline: Serialized<IBoardDeadline>): string => {
	if (deadline.status === 'satisfied' || deadline.status === 'waived') {
		return DONE;
	}
	if (deadline.status === 'missed') {
		return DANGER;
	}
	const days = daysUntil(deadline.dueDate);
	if (deadline.kind === 'SOL' || (days !== undefined && days < 0)) {
		return DANGER;
	}
	return UPCOMING;
};

type MatterDocketRibbonProps = {
	deadlines: Serialized<IBoardDeadline>[];
	/** Timeline anchors — the matter's incident date (start) and SOL date (end). */
	incidentDate?: string;
	solDate?: string;
};

/**
 * MatterDocketRibbon — a 2px "docket" line under the header strip: the matter's
 * deadline calendar compressed onto one timeline (incident → SOL). A neutral fill
 * marks elapsed time to today; each deadline is a small tick, coloured green
 * (done) → amber (upcoming) → red (SOL / missed / passed).
 *
 * Purely presentational over data the strip already has (the deadlines query +
 * the snapshot's incident/SOL dates). Renders nothing when there is no usable
 * timeline or no deadlines — never throws, never blocks the row.
 */
const MatterDocketRibbon = ({ deadlines, incidentDate, solDate }: MatterDocketRibbonProps): ReactElement | null => {
	const dues = deadlines.map((d) => toTime(d.dueDate)).filter((t): t is number => t !== undefined);

	// Anchor the timeline on incident→SOL, widening to cover any deadline that falls outside.
	const start = Math.min(...[toTime(incidentDate), ...dues].filter((t): t is number => t !== undefined));
	const end = Math.max(...[toTime(solDate), ...dues].filter((t): t is number => t !== undefined));

	if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || deadlines.length === 0) {
		return null;
	}

	const span = end - start;
	const pct = (t: number): number => Math.max(0, Math.min(100, ((t - start) / span) * 100));
	const nowPct = pct(Date.now());

	return (
		<Box position='relative' style={{ height: '3px', width: '100%' }} aria-hidden>
			{/* Base track */}
			<Box position='absolute' style={{ insetInline: 0, insetBlockEnd: 0, height: '2px', background: TRACK }} />
			{/* Elapsed fill (incident → today) */}
			<Box position='absolute' style={{ insetInlineStart: 0, insetBlockEnd: 0, height: '2px', width: `${nowPct}%`, background: FILL }} />
			{/* One tick per deadline */}
			{deadlines.map((deadline) => {
				const t = toTime(deadline.dueDate);
				if (t === undefined) {
					return null;
				}
				const style: CSSProperties = {
					insetInlineStart: `${pct(t)}%`,
					insetBlockEnd: 0,
					width: '2px',
					height: '3px',
					background: tickColor(deadline),
					transform: 'translateX(-50%)',
					borderRadius: '1px',
				};
				return <Box key={deadline._id} position='absolute' style={style} />;
			})}
		</Box>
	);
};

export default MatterDocketRibbon;
