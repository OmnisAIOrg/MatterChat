/**
 * Workspace Docs / Knowledge Base Service
 *
 * Manages creation, retrieval, updating, and deletion of workspace documentation pages.
 * Supports hierarchical nesting, role-based visibility, full-text search, and backlink tracking.
 *
 * Data model:
 * - IWorkspaceDoc: main page document (title, content, hierarchy, permissions)
 * - IDocBacklink: reverse index for fast backlink queries (from which cards/docs link TO this page)
 *
 * Permissions enforced:
 * - Create: team member+ (workspace access)
 * - View: role-based (default team visibility; allowedRoles restricts)
 * - Edit: doc owner + editors
 * - Delete: doc owner + workspace admin
 */

import { MongoInternals } from 'meteor/mongo';

// Types
export interface IWorkspaceDoc {
	_id: string;
	workspaceId: string;
	title: string;
	slug: string;
	content: string;
	parentDocId?: string;
	children?: string[];
	order: number;
	description?: string;
	tags?: string[];
	visibility: 'private' | 'team' | 'public';
	allowedRoles?: string[];
	createdBy: string;
	createdAt: Date;
	updatedAt: Date;
	updatedBy: string;
	collaborators?: Array<{
		userId: string;
		role: 'owner' | 'editor' | 'viewer';
	}>;
	linkedMatters?: Array<{
		matterId: string;
		linkedAt: Date;
	}>;
	linkedCards?: Array<{
		cardId: string;
		linkedAt: Date;
	}>;
	published: boolean;
	publishedAt?: Date;
	schemaVersion: number;
}

export interface IDocBacklink {
	_id: string;
	targetDocId: string;
	sourceDocId?: string;
	sourceCardId?: string;
	sourceMatterId?: string;
	linkedAt: Date;
}

// MongoDB collections
const db = MongoInternals.defaultMongoConnection.db;
const WorkspaceDocs = db.collection('workspace_docs');
const DocBacklinks = db.collection('doc_backlinks');

// Initialize indexes
function initializeIndexes() {
	try {
		WorkspaceDocs.createIndex({ workspaceId: 1 });
		WorkspaceDocs.createIndex({ slug: 1, workspaceId: 1 }, { unique: true });
		WorkspaceDocs.createIndex({ parentDocId: 1 });
		WorkspaceDocs.createIndex({ createdBy: 1 });
		WorkspaceDocs.createIndex({ title: 'text', content: 'text' });
		WorkspaceDocs.createIndex({ published: 1, workspaceId: 1 });

		DocBacklinks.createIndex({ targetDocId: 1 });
		DocBacklinks.createIndex({ sourceCardId: 1 });
		DocBacklinks.createIndex({ sourceMatterId: 1 });
	} catch (e) {
		// Indexes may already exist
	}
}

initializeIndexes();

function generateSlug(title: string): string {
	return title
		.toLowerCase()
		.replace(/[^\w\s-]/g, '')
		.replace(/\s+/g, '-')
		.replace(/-+/g, '-')
		.trim();
}

async function getUniqueSlug(workspaceId: string, baseSlug: string, excludeDocId?: string): Promise<string> {
	let slug = baseSlug;
	let counter = 1;

	while (true) {
		const query: any = { workspaceId, slug };
		if (excludeDocId) {
			query._id = { $ne: excludeDocId };
		}
		const existing = await WorkspaceDocs.findOne(query);
		if (!existing) {
			break;
		}
		slug = `${baseSlug}-${counter}`;
		counter++;
	}

	return slug;
}

export async function createDoc(
	userId: string,
	workspaceId: string,
	data: {
		title: string;
		content?: string;
		parentDocId?: string;
		visibility?: 'private' | 'team' | 'public';
		allowedRoles?: string[];
		description?: string;
		tags?: string[];
	},
): Promise<IWorkspaceDoc> {
	if (!data.title) throw new Error('error-doc-title-required');

	const baseSlug = generateSlug(data.title);
	const slug = await getUniqueSlug(workspaceId, baseSlug);

	const now = new Date();
	const ObjectId = require('mongodb').ObjectId;
	const doc: IWorkspaceDoc = {
		_id: new ObjectId().toString(),
		workspaceId,
		title: data.title,
		slug,
		content: data.content || '',
		parentDocId: data.parentDocId,
		children: [],
		order: 0,
		description: data.description,
		tags: data.tags || [],
		visibility: data.visibility || 'team',
		allowedRoles: data.allowedRoles,
		createdBy: userId,
		createdAt: now,
		updatedAt: now,
		updatedBy: userId,
		collaborators: [{ userId, role: 'owner' }],
		linkedMatters: [],
		linkedCards: [],
		published: false,
		schemaVersion: 1,
	};

	await WorkspaceDocs.insertOne(doc);

	if (data.parentDocId) {
		await WorkspaceDocs.updateOne({ _id: data.parentDocId }, { $push: { children: doc._id } });
	}

	return doc;
}

export async function getDoc(
	workspaceId: string,
	idOrSlug: string,
): Promise<(IWorkspaceDoc & { backlinks: IDocBacklink[] }) | null> {
	const doc = await WorkspaceDocs.findOne({
		workspaceId,
		$or: [{ _id: idOrSlug }, { slug: idOrSlug }],
	});

	if (!doc) return null;

	const backlinks = await DocBacklinks.find({ targetDocId: doc._id }).toArray();

	return { ...(doc as any), backlinks: backlinks as IDocBacklink[] };
}

export async function updateDoc(
	userId: string,
	docId: string,
	data: Partial<{
		title: string;
		content: string;
		description: string;
		visibility: 'private' | 'team' | 'public';
		allowedRoles: string[];
		tags: string[];
		published: boolean;
		parentDocId: string | null;
	}>,
): Promise<IWorkspaceDoc> {
	const doc = await WorkspaceDocs.findOne({ _id: docId });
	if (!doc) throw new Error('error-doc-not-found');

	const updateData: any = {
		updatedAt: new Date(),
		updatedBy: userId,
	};

	if (data.title) {
		updateData.title = data.title;
		updateData.slug = await getUniqueSlug((doc as any).workspaceId, generateSlug(data.title), docId);
	}

	if (data.content !== undefined) updateData.content = data.content;
	if (data.description !== undefined) updateData.description = data.description;
	if (data.visibility !== undefined) updateData.visibility = data.visibility;
	if (data.allowedRoles !== undefined) updateData.allowedRoles = data.allowedRoles;
	if (data.tags !== undefined) updateData.tags = data.tags;
	if (data.published !== undefined) {
		updateData.published = data.published;
		if (data.published) updateData.publishedAt = new Date();
	}

	if (data.parentDocId !== undefined) {
		if ((doc as any).parentDocId && (doc as any).parentDocId !== data.parentDocId) {
			await WorkspaceDocs.updateOne({ _id: (doc as any).parentDocId }, { $pull: { children: docId } });
		}

		if (data.parentDocId) {
			await WorkspaceDocs.updateOne({ _id: data.parentDocId }, { $push: { children: docId } });
			updateData.parentDocId = data.parentDocId;
		} else {
			updateData.parentDocId = null;
		}
	}

	const result = await WorkspaceDocs.findOneAndUpdate({ _id: docId }, { $set: updateData }, { returnDocument: 'after' });

	return result.value as IWorkspaceDoc;
}

export async function deleteDoc(docId: string): Promise<void> {
	const doc = await WorkspaceDocs.findOne({ _id: docId });
	if (!doc) throw new Error('error-doc-not-found');

	if ((doc as any).parentDocId) {
		await WorkspaceDocs.updateOne({ _id: (doc as any).parentDocId }, { $pull: { children: docId } });
	}

	await DocBacklinks.deleteMany({ targetDocId: docId });
	await DocBacklinks.deleteMany({ sourceDocId: docId });

	await WorkspaceDocs.deleteOne({ _id: docId });
}

export async function listDocs(
	workspaceId: string,
	options?: {
		parentDocId?: string;
		search?: string;
		tags?: string[];
		offset?: number;
		count?: number;
	},
): Promise<{ docs: IWorkspaceDoc[]; total: number }> {
	const query: any = { workspaceId };

	if (options?.parentDocId) {
		query.parentDocId = options.parentDocId;
	} else {
		query.parentDocId = { $exists: false };
	}

	if (options?.search) {
		query.$text = { $search: options.search };
	}

	if (options?.tags && options.tags.length > 0) {
		query.tags = { $in: options.tags };
	}

	const offset = options?.offset || 0;
	const count = options?.count || 50;

	const total = await WorkspaceDocs.countDocuments(query);
	const docs = await WorkspaceDocs.find(query)
		.skip(offset)
		.limit(count)
		.sort({ order: 1, createdAt: -1 })
		.toArray();

	return { docs: docs as IWorkspaceDoc[], total };
}

export async function searchDocs(
	workspaceId: string,
	query: string,
	options?: { offset?: number; count?: number },
): Promise<{ results: IWorkspaceDoc[]; total: number }> {
	const searchQuery: any = {
		workspaceId,
		$text: { $search: query },
	};

	const offset = options?.offset || 0;
	const count = options?.count || 50;

	const total = await WorkspaceDocs.countDocuments(searchQuery);
	const results = await WorkspaceDocs.find(searchQuery)
		.skip(offset)
		.limit(count)
		.sort({ score: { $meta: 'textScore' } })
		.toArray();

	return { results: results as IWorkspaceDoc[], total };
}

export async function linkDocToEntity(
	targetDocId: string,
	options: {
		sourceDocId?: string;
		sourceCardId?: string;
		sourceMatterId?: string;
	},
): Promise<IDocBacklink> {
	const query: any = { targetDocId };

	if (options.sourceDocId) query.sourceDocId = options.sourceDocId;
	if (options.sourceCardId) query.sourceCardId = options.sourceCardId;
	if (options.sourceMatterId) query.sourceMatterId = options.sourceMatterId;

	const existing = await DocBacklinks.findOne(query);
	if (existing) {
		return existing as IDocBacklink;
	}

	const ObjectId = require('mongodb').ObjectId;
	const backlink: IDocBacklink = {
		_id: new ObjectId().toString(),
		targetDocId,
		...options,
		linkedAt: new Date(),
	};

	await DocBacklinks.insertOne(backlink);

	if (options.sourceMatterId) {
		await WorkspaceDocs.updateOne(
			{ _id: targetDocId },
			{
				$push: {
					linkedMatters: {
						matterId: options.sourceMatterId,
						linkedAt: new Date(),
					},
				},
			},
		);
	}

	if (options.sourceCardId) {
		await WorkspaceDocs.updateOne(
			{ _id: targetDocId },
			{
				$push: {
					linkedCards: {
						cardId: options.sourceCardId,
						linkedAt: new Date(),
					},
				},
			},
		);
	}

	return backlink;
}

export async function unlinkDocFromEntity(targetDocId: string, sourceType: 'doc' | 'card' | 'matter', sourceId: string): Promise<void> {
	const query: any = { targetDocId };

	if (sourceType === 'doc') query.sourceDocId = sourceId;
	if (sourceType === 'card') query.sourceCardId = sourceId;
	if (sourceType === 'matter') query.sourceMatterId = sourceId;

	const backlink = await DocBacklinks.findOne(query);
	if (!backlink) throw new Error('error-backlink-not-found');

	await DocBacklinks.deleteOne({ _id: backlink._id });

	if (sourceType === 'matter') {
		await WorkspaceDocs.updateOne({ _id: targetDocId }, { $pull: { linkedMatters: { matterId: sourceId } } });
	}

	if (sourceType === 'card') {
		await WorkspaceDocs.updateOne({ _id: targetDocId }, { $pull: { linkedCards: { cardId: sourceId } } });
	}
}

export async function getDocBacklinks(docId: string): Promise<IDocBacklink[]> {
	return (await DocBacklinks.find({ targetDocId: docId }).toArray()) as IDocBacklink[];
}

export async function canViewDoc(userId: string, doc: IWorkspaceDoc, userRoles?: string[]): Promise<boolean> {
	if (doc.createdBy === userId) return true;

	if (doc.collaborators?.some((c) => c.userId === userId)) return true;

	if (doc.allowedRoles && doc.allowedRoles.length > 0) {
		if (!userRoles || userRoles.length === 0) return false;
		return userRoles.some((role) => doc.allowedRoles?.includes(role));
	}

	return doc.visibility !== 'private';
}

export async function canEditDoc(userId: string, doc: IWorkspaceDoc): Promise<boolean> {
	if (doc.createdBy === userId) return true;

	if (doc.collaborators?.some((c) => c.userId === userId && (c.role === 'owner' || c.role === 'editor'))) return true;

	return false;
}
