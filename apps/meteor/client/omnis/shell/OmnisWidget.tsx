import { Box, Button, Icon, IconButton, Tag, Throbber } from '@rocket.chat/fuselage';
import type { Keys as IconName } from '@rocket.chat/icons';
import type { DragEvent, ReactElement, ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * One shell, four products.
 *
 * A user who learns the AutoDoc queue can read the CaseNotes widget without
 * being taught, so this chrome is built once and parameterised — never forked
 * per product:
 *
 *     ┌──────────────────────────────────────────┐
 *     │ Title                    [PILL]      [—] │  name, product tag, minimize
 *     ├──────────────────────────────────────────┤
 *     │    5          2          2               │  three counters, product labels
 *     │  recent     ready     need you           │
 *     ├──────────────────────────────────────────┤
 *     │ ▸ row                                    │  scrolling rows, max-height ~250px
 *     ├──────────────────────────────────────────┤
 *     │           Primary action →               │  footer: opens the product panel
 *     └──────────────────────────────────────────┘
 *
 * ## Placement
 *
 * The widget itself is a plain block; `OmnisWidgetDock` is the single
 * `position: fixed` element that docks bottom-right and stacks its children
 * upward. That split matters: minimizing collapses a widget to a bubble, and if
 * each widget positioned itself by a computed offset, one collapse would leave
 * a hole or overlap the neighbours. Letting flexbox do it keeps the stack
 * correct for free.
 *
 * The dock's z-index is `1010`: above the in-page PDF overlay (1001) so the
 * widget is reachable while a document is open, and below react-bootstrap
 * modals (1039–1055) and MUI (1300) so it can never sit on top of a dialog the
 * user must answer.
 *
 * ## Two states that are easy to get wrong
 *
 * - **Degraded, not empty.** If the backend is unreachable, show
 *   "Can't reach <product> right now". An empty list reads as "no items", which
 *   is a different and much more dangerous claim.
 * - **Demo data is labelled.** When the transport is `stub` the header carries a
 *   `DEMO DATA` tag, so nobody mistakes fixtures for real matters.
 */

export const OMNIS_WIDGET_Z_INDEX = 1010;

export type OmnisWidgetCounter = {
	value: number;
	label: string;
	/** Draws attention — used for the "need you" column. */
	emphasis?: boolean;
};

export type OmnisWidgetProps = {
	title: string;
	/** Product pill, e.g. `AutoDoc`. */
	product: string;
	icon: IconName;
	counters: [OmnisWidgetCounter, OmnisWidgetCounter, OmnisWidgetCounter];
	/** Count shown on the minimized bubble — items needing attention, not total. */
	attentionCount: number;
	children: ReactNode;
	primaryAction: { label: string; onClick(): void };
	isLoading?: boolean;
	/** False ⇒ render the degraded line instead of the rows. */
	reachable?: boolean;
	/** True ⇒ header shows DEMO DATA. */
	isDemoData?: boolean;
	/** Drop support. Copy differs per product and per surface — see the callers. */
	dropZone?: { hint: string; subHint?: string; onDrop(files: File[]): void };
};

const OmnisWidget = ({
	title,
	product,
	icon,
	counters,
	attentionCount,
	children,
	primaryAction,
	isLoading,
	reachable = true,
	isDemoData,
	dropZone,
}: OmnisWidgetProps): ReactElement => {
	const { t } = useTranslation();
	const [minimized, setMinimized] = useState(false);
	const [dragging, setDragging] = useState(false);

	const onDragOver = useCallback(
		(event: DragEvent<HTMLElement>) => {
			if (!dropZone) {
				return;
			}
			event.preventDefault();
			setDragging(true);
		},
		[dropZone],
	);

	const onDragLeave = useCallback(() => setDragging(false), []);

	const onDrop = useCallback(
		(event: DragEvent<HTMLElement>) => {
			if (!dropZone) {
				return;
			}
			event.preventDefault();
			setDragging(false);
			const files = Array.from(event.dataTransfer?.files ?? []);
			if (files.length) {
				dropZone.onDrop(files);
			}
		},
		[dropZone],
	);

	if (minimized) {
		return (
			<Box
				position='relative'
				style={{ alignSelf: 'flex-end', pointerEvents: 'auto' }}
				aria-label={t('Omnis_Expand_widget', { product })}
			>
				<IconButton icon={icon} secondary large onClick={() => setMinimized(false)} title={title} />
				{attentionCount > 0 && (
					<Box
						position='absolute'
						backgroundColor='badge-background-level-4'
						color='pure-white'
						fontScale='micro'
						style={{
							top: -4,
							right: -4,
							minWidth: 18,
							height: 18,
							borderRadius: 9,
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							paddingInline: 5,
						}}
					>
						{attentionCount}
					</Box>
				)}
			</Box>
		);
	}

	return (
		<Box
			position='relative'
			backgroundColor='surface'
			style={{
				width: 360,
				borderRadius: 8,
				boxShadow: '0 8px 24px rgba(0,0,0,0.16)',
				overflow: 'hidden',
				pointerEvents: 'auto',
			}}
			onDragOver={onDragOver}
			onDragLeave={onDragLeave}
			onDrop={onDrop}
		>
			{/* Header */}
			<Box
				display='flex'
				alignItems='center'
				justifyContent='space-between'
				paddingInline={16}
				paddingBlock={12}
				backgroundColor='surface-tint'
			>
				<Box display='flex' alignItems='center' style={{ gap: 8, minWidth: 0 }}>
					<Icon name={icon} size={18} />
					<Box fontScale='p2b' withTruncatedText>
						{title}
					</Box>
				</Box>
				<Box display='flex' alignItems='center' style={{ gap: 6 }}>
					{isDemoData && <Tag variant='secondary'>{t('Omnis_Demo_data')}</Tag>}
					<Tag>{product}</Tag>
					<IconButton icon='chevron-down' tiny onClick={() => setMinimized(true)} title={t('Omnis_Minimize')} />
				</Box>
			</Box>

			{/* Counters */}
			<Box display='flex' paddingBlock={12} paddingInline={8}>
				{counters.map((counter) => (
					<Box key={counter.label} flexGrow={1} style={{ textAlign: 'center' }}>
						<Box fontScale='h3' color={counter.emphasis && counter.value > 0 ? 'danger' : 'default'}>
							{counter.value}
						</Box>
						<Box fontScale='micro' color='annotation'>
							{counter.label}
						</Box>
					</Box>
				))}
			</Box>

			{/* Rows */}
			<Box style={{ maxHeight: 250, overflowY: 'auto', borderTop: '1px solid var(--rcx-color-stroke-extra-light, #eee)' }}>
				{isLoading && (
					<Box paddingBlock={24} display='flex' justifyContent='center'>
						<Throbber size='x16' />
					</Box>
				)}
				{/* Degraded, NOT empty — an empty list would read as "no items". */}
				{!isLoading && !reachable && (
					<Box paddingInline={16} paddingBlock={16} fontScale='c1' color='annotation'>
						{t('Omnis_Cannot_reach_product', { product })}
					</Box>
				)}
				{!isLoading && reachable && children}
			</Box>

			{/* Footer */}
			<Box paddingInline={12} paddingBlock={10} style={{ borderTop: '1px solid var(--rcx-color-stroke-extra-light, #eee)' }}>
				<Button small primary width='100%' onClick={primaryAction.onClick}>
					{primaryAction.label}
				</Button>
			</Box>

			{/* Drop overlay */}
			{dropZone && dragging && (
				<Box
					position='absolute'
					backgroundColor='surface-overlay'
					display='flex'
					flexDirection='column'
					alignItems='center'
					justifyContent='center'
					style={{ inset: 0, textAlign: 'center', padding: 16 }}
				>
					<Icon name='upload' size={28} />
					<Box fontScale='p2b' marginBlockStart={8}>
						{dropZone.hint}
					</Box>
					{dropZone.subHint && (
						<Box fontScale='c1' color='annotation' marginBlockStart={4}>
							{dropZone.subHint}
						</Box>
					)}
				</Box>
			)}
		</Box>
	);
};

export default OmnisWidget;
