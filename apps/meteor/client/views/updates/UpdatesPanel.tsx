/**
 * UpdatesPanel — Desktop-app-style changelog view
 *
 * Lists every shipped update/feature with title, date, tag (wave), and description.
 * Uses premium design tokens from docs/design/premium-refresh/README.md
 */

import React, { useState, useEffect } from 'react';
import { Box, Icon, Margins, Skeleton } from '@rocket.chat/fuselage';
import { css } from '@rocket.chat/css-in-js';
import { updatesFeed, UpdateEntry, getLatestUpdateDate } from '../../updates/updatesFeed';

const UPDATES_LAST_SEEN_KEY = 'matterchat:updates:lastSeen';

// Premium design tokens from docs/design/premium-refresh/README.md
const COLORS = {
	// Light theme
	light: {
		bg: '#F6F6F3',
		surface: '#FFFFFF',
		surface2: '#FAFAF7',
		border: '#E7E6E0',
		border2: '#DBDAD3',
		ink: '#171D19',
		ink2: '#57615B',
		ink3: '#8E968F',
	},
	// Dark theme
	dark: {
		bg: '#0F1512',
		surface: '#151C17',
		surface2: '#19211C',
		border: '#242D27',
		border2: '#2D372F',
		ink: '#E9EDEA',
		ink2: '#A2ACA5',
		ink3: '#707B74',
	},
	// Shared rails
	railBg: '#0D1310',
	railInk: '#AEB8B1',
	primaryGreen: '#17804D',
	primaryGreenHover: '#0F6A3D',
	greenTint: '#E8F3ED',
	greenTintBorder: '#CBE5D6',
	greenInk: '#116240',
	darkGreen: '#3FBC7C',
	darkGreenHover: '#57CD90',
	tagGreen: '#22B43F',
	warningYellow: '#A97A18',
	dangerRed: '#CF4438',
	infoBlue: '#3C6EB4',
};

const panelClass = css`
	display: flex;
	flex-direction: column;
	height: 100%;
	gap: 24px;
	padding-top: 8px;
`;

const headerClass = css`
	display: flex;
	flex-direction: column;
	gap: 8px;
	border-bottom: 1px solid ${COLORS.light.border};
	padding-bottom: 20px;

	@media (prefers-color-scheme: dark) {
		border-bottom-color: ${COLORS.dark.border};
	}
`;

const titleClass = css`
	font-size: 20px;
	font-weight: 650;
	letter-spacing: -0.015em;
	line-height: 1.3;
	color: ${COLORS.light.ink};

	@media (prefers-color-scheme: dark) {
		color: ${COLORS.dark.ink};
	}
`;

const descriptionClass = css`
	font-size: 13.5px;
	font-weight: 400;
	line-height: 1.5;
	color: ${COLORS.light.ink2};

	@media (prefers-color-scheme: dark) {
		color: ${COLORS.dark.ink2};
	}
`;

const updatesListClass = css`
	display: flex;
	flex-direction: column;
	gap: 16px;
	overflow-y: auto;
	padding-right: 8px;

	&::-webkit-scrollbar {
		width: 8px;
	}
	&::-webkit-scrollbar-track {
		background: transparent;
	}
	&::-webkit-scrollbar-thumb {
		background: ${COLORS.light.border2};
		border-radius: 4px;
	}
	&::-webkit-scrollbar-thumb:hover {
		background: ${COLORS.light.ink3};
	}

	@media (prefers-color-scheme: dark) {
		&::-webkit-scrollbar-thumb {
			background: ${COLORS.dark.border2};
		}
		&::-webkit-scrollbar-thumb:hover {
			background: ${COLORS.dark.ink3};
		}
	}
`;

const updateCardClass = css`
	display: flex;
	flex-direction: column;
	gap: 12px;
	border-radius: 14px;
	border: 1px solid ${COLORS.light.border};
	background-color: ${COLORS.light.surface};
	padding: 20px;
	transition: all 0.15s ease;

	&:hover {
		border-color: ${COLORS.light.border2};
		box-shadow: 0 1px 2px rgba(23, 29, 25, 0.05), 0 8px 24px -8px rgba(23, 29, 25, 0.14);
	}

	@media (prefers-color-scheme: dark) {
		border-color: ${COLORS.dark.border};
		background-color: ${COLORS.dark.surface};

		&:hover {
			border-color: ${COLORS.dark.border2};
			box-shadow: 0 1px 2px rgba(0, 0, 0, 0.35), 0 8px 24px -8px rgba(0, 0, 0, 0.6);
		}
	}
`;

const cardHeaderClass = css`
	display: flex;
	flex-direction: row;
	align-items: flex-start;
	justify-content: space-between;
	gap: 12px;
`;

const titleRowClass = css`
	display: flex;
	flex-direction: column;
	gap: 6px;
	flex: 1;
`;

const updateTitleClass = css`
	font-size: 15px;
	font-weight: 600;
	line-height: 1.3;
	color: ${COLORS.light.ink};

	@media (prefers-color-scheme: dark) {
		color: ${COLORS.dark.ink};
	}
`;

const tagClass = css`
	display: inline-flex;
	align-items: center;
	justify-content: center;
	padding: 4px 10px;
	border-radius: 9px;
	font-size: 11px;
	font-weight: 600;
	letter-spacing: 0.08em;
	text-transform: uppercase;
	white-space: nowrap;
	flex-shrink: 0;

	&.wave-1 {
		background-color: #e8f3ed;
		color: #116240;

		@media (prefers-color-scheme: dark) {
			background-color: rgba(63, 188, 124, 0.16);
			color: #6fd6a3;
		}
	}

	&.wave-2 {
		background-color: #e8f3ed;
		color: #116240;

		@media (prefers-color-scheme: dark) {
			background-color: rgba(63, 188, 124, 0.16);
			color: #6fd6a3;
		}
	}

	&.wave-3 {
		background-color: #e8f3ed;
		color: #116240;

		@media (prefers-color-scheme: dark) {
			background-color: rgba(63, 188, 124, 0.16);
			color: #6fd6a3;
		}
	}
`;

const metaClass = css`
	display: flex;
	flex-direction: row;
	align-items: center;
	gap: 12px;
	font-size: 12px;
	font-weight: 500;
	color: ${COLORS.light.ink3};

	@media (prefers-color-scheme: dark) {
		color: ${COLORS.dark.ink3};
	}
`;

const dateClass = css`
	display: flex;
	align-items: center;
	gap: 6px;
`;

const descClass = css`
	font-size: 13.5px;
	font-weight: 400;
	line-height: 1.5;
	color: ${COLORS.light.ink2};

	@media (prefers-color-scheme: dark) {
		color: ${COLORS.dark.ink2};
	}
`;

const featuresListClass = css`
	display: flex;
	flex-direction: column;
	gap: 8px;
	margin-top: 8px;
	padding-top: 12px;
	border-top: 1px solid ${COLORS.light.border};

	@media (prefers-color-scheme: dark) {
		border-top-color: ${COLORS.dark.border};
	}
`;

const featureItemClass = css`
	display: flex;
	align-items: flex-start;
	gap: 8px;
	font-size: 13px;
	font-weight: 400;
	line-height: 1.4;
	color: ${COLORS.light.ink2};

	@media (prefers-color-scheme: dark) {
		color: ${COLORS.dark.ink2};
	}

	&::before {
		content: '•';
		flex-shrink: 0;
		font-weight: 600;
	}
`;

const emptyStateClass = css`
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 16px;
	padding: 60px 20px;
	text-align: center;
	color: ${COLORS.light.ink3};

	@media (prefers-color-scheme: dark) {
		color: ${COLORS.dark.ink3};
	}
`;

interface UpdatesPanelProps {
	workspaceId?: string;
}

export const UpdatesPanel: React.FC<UpdatesPanelProps> = ({ workspaceId }) => {
	const [loading, setLoading] = useState(false);
	const [lastSeen, setLastSeen] = useState<string | null>(null);

	// Initialize lastSeen from localStorage
	useEffect(() => {
		const stored = localStorage.getItem(UPDATES_LAST_SEEN_KEY);
		if (stored) {
			setLastSeen(stored);
		} else {
			// First visit: mark all current updates as seen
			const latest = getLatestUpdateDate();
			localStorage.setItem(UPDATES_LAST_SEEN_KEY, latest);
			setLastSeen(latest);
		}
		setLoading(false);
	}, []);

	// Mark updates as read when viewing this page
	useEffect(() => {
		if (!loading && lastSeen) {
			const now = new Date().toISOString();
			localStorage.setItem(UPDATES_LAST_SEEN_KEY, now);
		}
	}, [loading, lastSeen]);

	if (loading) {
		return <Skeleton />;
	}

	const formatDate = (isoDate: string): string => {
		const date = new Date(isoDate);
		return date.toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric',
		});
	};

	const getTagClass = (tag: string): string => {
		const normalized = tag.toLowerCase().replace(/\s+/g, '-');
		return normalized;
	};

	return (
		<Box className={panelClass}>
			<Box className={headerClass}>
				<Box className={titleClass}>Updates</Box>
				<Box className={descriptionClass}>
					Discover what's new in MatterChat. Stay up to date with the latest features and improvements.
				</Box>
			</Box>

			{updatesFeed.length === 0 ? (
				<Box className={emptyStateClass}>
					<Icon name='inbox' size='x48' />
					<Box>
						<Box style={{ fontWeight: 600, marginBottom: '4px' }}>No updates yet</Box>
						<Box style={{ fontSize: '12px' }}>Check back soon for new features!</Box>
					</Box>
				</Box>
			) : (
				<Box className={updatesListClass}>
					{updatesFeed.map((update) => (
						<Box key={update.id} className={updateCardClass}>
							<Box className={cardHeaderClass}>
								<Box className={titleRowClass}>
									<Box className={updateTitleClass}>{update.title}</Box>
									<Box className={metaClass}>
										<Box className={dateClass}>
											<Icon name='calendar' size='x14' />
											{formatDate(update.date)}
										</Box>
										<Box
											className={tagClass}
											style={{
												className: getTagClass(update.tag),
											}}
										>
											{update.tag}
										</Box>
									</Box>
								</Box>
							</Box>

							<Box className={descClass}>{update.description}</Box>

							{update.features && update.features.length > 0 && (
								<Box className={featuresListClass}>
									{update.features.map((feature, idx) => (
										<Box key={idx} className={featureItemClass}>
											{feature}
										</Box>
									))}
								</Box>
							)}
						</Box>
					))}
				</Box>
			)}
		</Box>
	);
};

export default UpdatesPanel;
