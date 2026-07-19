/**
 * SMS Channel Browser — UI component to display and create SMS channel rooms
 * from CasePro SMS threads.
 *
 * This component is shown in the channel browser when a matter is selected
 * and CasePro SMS is available. It pulls SMS threads for the matter and
 * displays them as available rooms to join/create.
 *
 * Design: uses premium tokens from docs/design/premium-refresh/README.md
 * - Radius: 14px for cards/dialogs, 9px for buttons
 * - Colors: primary green #17804D, surface #FFFFFF, border #E7E6E0
 * - Typography: Geist, 13.5px body, 12.5px secondary, 10px mono uppercase labels
 * - Shadows: shadow1 (resting), shadow2 (hover), shadow3 (dialogs)
 */

import React, { useEffect, useState } from 'react';
import { useAsync } from '@rocket.chat/fuselage-hooks';
import { Box, Button, Loader, TextInput, Icon, Margins, Skeleton } from '@rocket.chat/fuselage';

import type { CaseProSMSThread } from '../../../lib/boards/casepro/sms-bridge';

interface SMSChannelBrowserProps {
	matterId: string;
	onSelect: (thread: CaseProSMSThread) => void;
}

const styles = {
	container: {
		display: 'flex',
		flexDirection: 'column' as const,
		width: '100%',
		height: '100%',
		gap: '16px',
		padding: '24px',
		backgroundColor: 'var(--surface)',
		borderRadius: '14px',
	},
	header: {
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'space-between',
		paddingBottom: '12px',
		borderBottom: '1px solid var(--border)',
	},
	title: {
		fontSize: '14px',
		fontWeight: '600',
		color: 'var(--ink)',
		fontFamily: 'Geist, sans-serif',
		textTransform: 'uppercase',
		letterSpacing: '0.12em',
	} as React.CSSProperties,
	searchBox: {
		marginBottom: '16px',
	},
	threadList: {
		display: 'flex',
		flexDirection: 'column' as const,
		gap: '8px',
		overflowY: 'auto' as const,
		maxHeight: '400px',
	},
	threadItem: {
		display: 'flex',
		alignItems: 'center',
		padding: '12px 14px',
		backgroundColor: 'var(--surface2)',
		border: '1px solid var(--border)',
		borderRadius: '9px',
		cursor: 'pointer',
		transition: 'all 120ms cubic-bezier(.2,.8,.3,1)',
		':hover': {
			backgroundColor: 'var(--surface2)',
			borderColor: 'var(--border2)',
			boxShadow: '0 1px 2px rgba(23,29,25,.05), 0 8px 24px -8px rgba(23,29,25,.14)',
		},
	} as React.CSSProperties,
	threadInfo: {
		flex: '1',
		minWidth: '0',
	},
	threadName: {
		fontSize: '13.5px',
		fontWeight: '500',
		color: 'var(--ink)',
		fontFamily: 'Geist, sans-serif',
		marginBottom: '4px',
	} as React.CSSProperties,
	threadMeta: {
		fontSize: '12.5px',
		color: 'var(--ink2)',
		fontFamily: 'Geist, sans-serif',
	} as React.CSSProperties,
	emptyState: {
		display: 'flex',
		flexDirection: 'column' as const,
		alignItems: 'center',
		justifyContent: 'center',
		padding: '40px 24px',
		color: 'var(--ink3)',
		textAlign: 'center' as const,
	},
	emptyIcon: {
		fontSize: '48px',
		marginBottom: '16px',
		color: 'var(--ink3)',
	},
	emptyTitle: {
		fontSize: '14px',
		fontWeight: '600',
		marginBottom: '8px',
		color: 'var(--ink)',
		fontFamily: 'Geist, sans-serif',
	} as React.CSSProperties,
	emptyMessage: {
		fontSize: '12.5px',
		color: 'var(--ink2)',
		fontFamily: 'Geist, sans-serif',
	} as React.CSSProperties,
};

export const SMSChannelBrowser: React.FC<SMSChannelBrowserProps> = ({ matterId, onSelect }) => {
	const [search, setSearch] = useState('');
	const [threads, setThreads] = useState<CaseProSMSThread[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		const fetchThreads = async () => {
			try {
				setLoading(true);
				const response = await fetch(`/api/v1/sms/threads?matterId=${encodeURIComponent(matterId)}`, {
					method: 'GET',
					headers: { 'Content-Type': 'application/json' },
				});

				if (!response.ok) {
					throw new Error(`Failed to fetch SMS threads: ${response.statusText}`);
				}

				const { threads: fetchedThreads } = await response.json();
				setThreads(fetchedThreads || []);
				setError(null);
			} catch (err) {
				setError(err instanceof Error ? err.message : 'Unknown error');
				setThreads([]);
			} finally {
				setLoading(false);
			}
		};

		if (matterId) {
			fetchThreads();
		}
	}, [matterId]);

	const filtered = threads.filter((thread) => {
		if (!search) return true;
		const subject = String(thread.subject || thread.id || '').toLowerCase();
		return subject.includes(search.toLowerCase());
	});

	if (loading) {
		return (
			<Box style={styles.container}>
				<Box style={styles.header}>
					<span style={styles.title}>SMS Threads</span>
				</Box>
				<Skeleton width="100%" height="60px" />
				<Skeleton width="100%" height="60px" />
				<Skeleton width="100%" height="60px" />
			</Box>
		);
	}

	if (error) {
		return (
			<Box style={styles.container}>
				<Box style={styles.header}>
					<span style={styles.title}>SMS Threads</span>
				</Box>
				<Box style={styles.emptyState}>
					<span style={styles.emptyTitle}>Error loading SMS threads</span>
					<span style={styles.emptyMessage}>{error}</span>
				</Box>
			</Box>
		);
	}

	if (threads.length === 0) {
		return (
			<Box style={styles.container}>
				<Box style={styles.header}>
					<span style={styles.title}>SMS Threads</span>
				</Box>
				<Box style={styles.emptyState}>
					<span style={styles.emptyIcon}>💬</span>
					<span style={styles.emptyTitle}>No SMS threads</span>
					<span style={styles.emptyMessage}>Incoming SMS messages will appear here</span>
				</Box>
			</Box>
		);
	}

	return (
		<Box style={styles.container}>
			<Box style={styles.header}>
				<span style={styles.title}>SMS Threads</span>
			</Box>
			<Box style={styles.searchBox}>
				<TextInput
					placeholder="Search SMS threads..."
					value={search}
					onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
					style={{
						padding: '10px 14px',
						borderRadius: '9px',
						border: '1px solid var(--border)',
						fontSize: '13.5px',
						fontFamily: 'Geist, sans-serif',
					}}
				/>
			</Box>
			<Box style={styles.threadList}>
				{filtered.length === 0 ? (
					<Box style={styles.emptyState}>
						<span style={styles.emptyMessage}>No matching SMS threads</span>
					</Box>
				) : (
					filtered.map((thread) => {
						const lastMessageTime = thread.last_message_at
							? new Date(String(thread.last_message_at)).toLocaleDateString()
							: 'No messages';
						return (
							<Box
								key={String(thread.id)}
								style={styles.threadItem}
								onClick={() => onSelect(thread)}
								role="button"
								tabIndex={0}
								onKeyPress={(e: React.KeyboardEvent) => {
									if (e.key === 'Enter' || e.key === ' ') {
										onSelect(thread);
									}
								}}
							>
								<Box style={styles.threadInfo}>
									<Box style={styles.threadName}>
										{thread.subject || thread.id || 'Unknown SMS Thread'}
									</Box>
									<Box style={styles.threadMeta}>
										Status: {thread.status || 'active'} • {lastMessageTime}
									</Box>
								</Box>
								<Icon name="chevron-right" size="20" style={{ color: 'var(--ink2)' }} />
							</Box>
						);
					})
				)}
			</Box>
		</Box>
	);
};
