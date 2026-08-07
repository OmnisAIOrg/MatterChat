/**
 * DocsPanel — Main workspace knowledge base UI
 */

import React, { useState, useEffect } from 'react';
import { Box, Button, Callout, Icon, Margins, Skeleton, Tag, TextInput, Scrollable, IconButton } from '@rocket.chat/fuselage';
import { useToastMessageDispatch, useTranslation } from '@rocket.chat/ui-contexts';
import styles from './DocsPanel.module.css';

interface IDoc {
	_id: string;
	title: string;
	slug: string;
	content: string;
	description?: string;
	createdBy: string;
	createdAt: Date;
	updatedAt: Date;
	visibility: 'private' | 'team' | 'public';
	tags?: string[];
	children?: string[];
	parentDocId?: string;
	published: boolean;
}

interface DocsPanelProps {
	workspaceId: string;
}

export const DocsPanel: React.FC<DocsPanelProps> = ({ workspaceId }) => {
	const t = useTranslation();
	const dispatchToastMessage = useToastMessageDispatch();

	const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
	const [searchQuery, setSearchQuery] = useState('');
	const [docs, setDocs] = useState<IDoc[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [showEditor, setShowEditor] = useState(false);
	const [editingDoc, setEditingDoc] = useState<Partial<IDoc> | null>(null);

	const loadDocs = async () => {
		setIsLoading(true);
		try {
			const response = await fetch(`/api/v1/docs.list?workspaceId=${workspaceId}`, {
				headers: {
					'X-Auth-Token': localStorage.getItem('Meteor.loginToken') || '',
					'X-User-Id': localStorage.getItem('Meteor.userId') || '',
				},
			});

			if (response.ok) {
				const data = await response.json();
				setDocs(data.docs || []);
			} else {
				dispatchToastMessage({ type: 'error', message: t('error-loading-docs') });
			}
		} catch (error) {
			dispatchToastMessage({ type: 'error', message: String(error) });
		} finally {
			setIsLoading(false);
		}
	};

	const searchDocs = async (query: string) => {
		if (!query.trim()) {
			loadDocs();
			return;
		}

		setIsLoading(true);
		try {
			const response = await fetch(`/api/v1/docs.search?workspaceId=${workspaceId}&q=${encodeURIComponent(query)}`, {
				headers: {
					'X-Auth-Token': localStorage.getItem('Meteor.loginToken') || '',
					'X-User-Id': localStorage.getItem('Meteor.userId') || '',
				},
			});

			if (response.ok) {
				const data = await response.json();
				setDocs(data.results || []);
			}
		} catch (error) {
			dispatchToastMessage({ type: 'error', message: String(error) });
		} finally {
			setIsLoading(false);
		}
	};

	useEffect(() => {
		loadDocs();
	}, [workspaceId]);

	const handleCreateDoc = async () => {
		setEditingDoc({
			title: 'Untitled',
			content: '',
			visibility: 'team',
		});
		setShowEditor(true);
	};

	const handleSaveDoc = async () => {
		if (!editingDoc?.title) {
			dispatchToastMessage({ type: 'error', message: t('error-doc-title-required') });
			return;
		}

		try {
			const url = editingDoc._id ? `/api/v1/docs.update` : `/api/v1/docs.create`;

			const response = await fetch(url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Auth-Token': localStorage.getItem('Meteor.loginToken') || '',
					'X-User-Id': localStorage.getItem('Meteor.userId') || '',
				},
				body: JSON.stringify({
					...editingDoc,
					workspaceId,
				}),
			});

			if (response.ok) {
				dispatchToastMessage({ type: 'success', message: t('docs-saved') });
				setShowEditor(false);
				setEditingDoc(null);
				loadDocs();
			} else {
				dispatchToastMessage({ type: 'error', message: t('error-saving-doc') });
			}
		} catch (error) {
			dispatchToastMessage({ type: 'error', message: String(error) });
		}
	};

	const handleDeleteDoc = async (docId: string) => {
		if (!confirm(t('Are-you-sure'))) return;

		try {
			const response = await fetch(`/api/v1/docs.delete`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Auth-Token': localStorage.getItem('Meteor.loginToken') || '',
					'X-User-Id': localStorage.getItem('Meteor.userId') || '',
				},
				body: JSON.stringify({ docId }),
			});

			if (response.ok) {
				dispatchToastMessage({ type: 'success', message: t('docs-deleted') });
				loadDocs();
				setSelectedDocId(null);
			} else {
				dispatchToastMessage({ type: 'error', message: t('error-deleting-doc') });
			}
		} catch (error) {
			dispatchToastMessage({ type: 'error', message: String(error) });
		}
	};

	if (isLoading && docs.length === 0) {
		return <Skeleton />;
	}

	return (
		<Box style={{ padding: '24px', maxHeight: '100vh', overflow: 'auto' }}>
			<Box display='flex' justifyContent='space-between' alignItems='center' marginBlock='x16'>
				<h2 style={{ fontSize: '19px', fontWeight: 650, fontFamily: 'Geist' }}>{t('Documentation')}</h2>
				<Button onClick={handleCreateDoc} primary icon='pencil'>
					{t('New-Page')}
				</Button>
			</Box>

			<Box marginBlock='x16'>
				<TextInput
					placeholder={t('Search-docs')}
					value={searchQuery}
					onChange={(e) => {
						setSearchQuery(e.currentTarget.value);
						searchDocs(e.currentTarget.value);
					}}
					icon='magnifier'
				/>
			</Box>

			{docs.length === 0 ? (
				<Callout type='info'>{t('No-docs-yet')}</Callout>
			) : (
				<Box>
					{docs.map((doc) => (
						<Box
							key={doc._id}
							onClick={() => setSelectedDocId(doc._id)}
							padding='x12'
							marginBlock='x8'
							borderRadius='x9'
							style={{
								cursor: 'pointer',
								backgroundColor: selectedDocId === doc._id ? 'var(--rcx-color-surface-tint)' : 'var(--rcx-color-surface-2)',
								border: '1px solid var(--rcx-color-border)',
								transition: 'all 150ms ease',
							}}
						>
							<Box display='flex' justifyContent='space-between' alignItems='flex-start'>
								<Box flex={1}>
									<h4 style={{ fontSize: '14px', fontWeight: 600, margin: '0 0 4px 0', fontFamily: 'Geist' }}>{doc.title}</h4>
									{doc.description && (
										<p style={{ fontSize: '12.5px', color: 'var(--rcx-color-text-secondary)', margin: '4px 0' }}>{doc.description}</p>
									)}
									{doc.tags && doc.tags.length > 0 && (
										<Box display='flex' gap='x4' mt='x4' flexWrap='wrap'>
											{doc.tags.map((tag) => (
												<Tag key={tag}>{tag}</Tag>
											))}
										</Box>
									)}
								</Box>
								<Box display='flex' gap='x4'>
									<IconButton
										icon='pencil'
										small
										onClick={(e: any) => {
											e.stopPropagation();
											setEditingDoc(doc);
											setShowEditor(true);
										}}
										title={t('Edit')}
									/>
									<IconButton
										icon='trash'
										small
										onClick={(e: any) => {
											e.stopPropagation();
											handleDeleteDoc(doc._id);
										}}
										title={t('Delete')}
									/>
								</Box>
							</Box>
							<Box mt='x4' display='flex' alignItems='center' gap='x4' fontSize='x10'>
								<span style={{ color: 'var(--rcx-color-text-tertiary)' }}>
									{t('Created')} {new Date(doc.createdAt).toLocaleDateString()}
								</span>
								<Tag small>{doc.visibility}</Tag>
							</Box>
						</Box>
					))}
				</Box>
			)}

			{showEditor && editingDoc && (
				<Box
					style={{
						position: 'fixed',
						top: '50%',
						left: '50%',
						transform: 'translate(-50%, -50%)',
						backgroundColor: 'var(--rcx-color-surface)',
						borderRadius: '14px',
						padding: '24px',
						boxShadow: '0 24px 60px -12px rgba(23, 29, 25, 0.25)',
						zIndex: 1000,
						width: '90%',
						maxWidth: '600px',
						maxHeight: '90vh',
						overflow: 'auto',
					}}
				>
					<Box display='flex' justifyContent='space-between' alignItems='center' marginBlock='x16'>
						<h3 style={{ fontSize: '16px', fontWeight: 600, fontFamily: 'Geist' }}>{t('Edit-Page')}</h3>
						<IconButton icon='cross' onClick={() => setShowEditor(false)} style={{ cursor: 'pointer' }} />
					</Box>

					<Box marginBlock='x16'>
						<label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '8px' }}>{t('Title')}</label>
						<TextInput
							value={editingDoc.title || ''}
							onChange={(e) => setEditingDoc({ ...editingDoc, title: e.currentTarget.value })}
							placeholder={t('Page-title')}
							style={{ width: '100%' }}
						/>
					</Box>

					<Box marginBlock='x16'>
						<label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '8px' }}>{t('Description')}</label>
						<textarea
							value={editingDoc.description || ''}
							onChange={(e) => setEditingDoc({ ...editingDoc, description: e.currentTarget.value })}
							placeholder={t('Page-description')}
							style={{
								width: '100%',
								minHeight: '60px',
								padding: '12px',
								borderRadius: '9px',
								border: '1px solid var(--rcx-color-border)',
								fontFamily: 'Geist',
								fontSize: '13px',
								boxSizing: 'border-box',
							}}
						/>
					</Box>

					<Box marginBlock='x16'>
						<label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '8px' }}>{t('Visibility')}</label>
						<select
							value={editingDoc.visibility || 'team'}
							onChange={(e) => setEditingDoc({ ...editingDoc, visibility: e.currentTarget.value as any })}
							style={{
								width: '100%',
								padding: '10px',
								borderRadius: '9px',
								border: '1px solid var(--rcx-color-border)',
								fontFamily: 'Geist',
								fontSize: '13px',
								boxSizing: 'border-box',
							}}
						>
							<option value='private'>{t('Private')}</option>
							<option value='team'>{t('Team')}</option>
							<option value='public'>{t('Public')}</option>
						</select>
					</Box>

					<Box marginBlock='x16'>
						<label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '8px' }}>{t('Content')}</label>
						<textarea
							value={editingDoc.content || ''}
							onChange={(e) => setEditingDoc({ ...editingDoc, content: e.currentTarget.value })}
							placeholder={t('Enter-page-content')}
							style={{
								width: '100%',
								minHeight: '200px',
								padding: '12px',
								borderRadius: '9px',
								border: '1px solid var(--rcx-color-border)',
								fontFamily: 'monospace',
								fontSize: '13px',
								boxSizing: 'border-box',
							}}
						/>
					</Box>

					<Box display='flex' justifyContent='flex-end' gap='x8'>
						<Button onClick={() => setShowEditor(false)}>{t('Cancel')}</Button>
						<Button onClick={handleSaveDoc} primary>
							{t('Save')}
						</Button>
					</Box>
				</Box>
			)}

			{showEditor && (
				<Box
					style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(8, 12, 10, 0.45)', zIndex: 999 }}
					onClick={() => setShowEditor(false)}
				/>
			)}
		</Box>
	);
};
