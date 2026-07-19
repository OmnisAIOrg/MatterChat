/**
 * REST API surface for Workspace Docs (Knowledge Base)
 *
 * Authenticated endpoints require workspace membership.
 * Public endpoints use role-based access control.
 */

import { createDoc, getDoc, updateDoc, deleteDoc, listDocs, searchDocs, linkDocToEntity, unlinkDocFromEntity, getDocBacklinks } from '../../../../server/lib/docs/service';
import { API } from '../api';

API.v1.post(
	'docs.create',
	{
		authRequired: true,
	},
	async function action() {
		const userId = this.userId;
		const { workspaceId, title, content, parentDocId, visibility, allowedRoles, description, tags } = this.bodyParams;

		if (!workspaceId || !title) {
			return API.v1.failure('Missing required fields: workspaceId, title');
		}

		try {
			const doc = await createDoc(userId, workspaceId, {
				title,
				content,
				parentDocId,
				visibility,
				allowedRoles,
				description,
				tags,
			});

			return API.v1.success({ doc });
		} catch (e: any) {
			return API.v1.failure(e.message);
		}
	},
);

API.v1.get(
	'docs.get',
	{
		authRequired: true,
	},
	async function action() {
		const { workspaceId, docId, slug } = this.queryParams;

		if (!workspaceId || (!docId && !slug)) {
			return API.v1.failure('Missing required fields: workspaceId and (docId or slug)');
		}

		try {
			const idOrSlug = docId || slug;
			const doc = await getDoc(workspaceId, idOrSlug);

			if (!doc) {
				return API.v1.notFound();
			}

			return API.v1.success({ doc });
		} catch (e: any) {
			return API.v1.failure(e.message);
		}
	},
);

API.v1.post(
	'docs.update',
	{
		authRequired: true,
	},
	async function action() {
		const userId = this.userId;
		const { docId, title, content, description, visibility, allowedRoles, tags, published, parentDocId } = this.bodyParams;

		if (!docId) {
			return API.v1.failure('Missing required field: docId');
		}

		try {
			const doc = await updateDoc(userId, docId, {
				title,
				content,
				description,
				visibility,
				allowedRoles,
				tags,
				published,
				parentDocId,
			});

			return API.v1.success({ doc });
		} catch (e: any) {
			return API.v1.failure(e.message);
		}
	},
);

API.v1.post(
	'docs.delete',
	{
		authRequired: true,
	},
	async function action() {
		const { docId } = this.bodyParams;

		if (!docId) {
			return API.v1.failure('Missing required field: docId');
		}

		try {
			await deleteDoc(docId);
			return API.v1.success({ success: true });
		} catch (e: any) {
			return API.v1.failure(e.message);
		}
	},
);

API.v1.get(
	'docs.list',
	{
		authRequired: true,
	},
	async function action() {
		const { workspaceId, parentDocId, search, tags, offset, count } = this.queryParams;

		if (!workspaceId) {
			return API.v1.failure('Missing required field: workspaceId');
		}

		try {
			const result = await listDocs(workspaceId, {
				parentDocId,
				search,
				tags: tags ? (typeof tags === 'string' ? [tags] : tags) : undefined,
				offset: offset ? parseInt(offset) : 0,
				count: count ? parseInt(count) : 50,
			});

			return API.v1.success(result);
		} catch (e: any) {
			return API.v1.failure(e.message);
		}
	},
);

API.v1.get(
	'docs.search',
	{
		authRequired: true,
	},
	async function action() {
		const { workspaceId, q, offset, count } = this.queryParams;

		if (!workspaceId || !q) {
			return API.v1.failure('Missing required fields: workspaceId, q');
		}

		try {
			const result = await searchDocs(workspaceId, q, {
				offset: offset ? parseInt(offset) : 0,
				count: count ? parseInt(count) : 50,
			});

			return API.v1.success(result);
		} catch (e: any) {
			return API.v1.failure(e.message);
		}
	},
);

API.v1.post(
	'docs.link',
	{
		authRequired: true,
	},
	async function action() {
		const { docId, matterId, cardId } = this.bodyParams;

		if (!docId || (!matterId && !cardId)) {
			return API.v1.failure('Missing required fields: docId and (matterId or cardId)');
		}

		try {
			const backlink = await linkDocToEntity(docId, {
				sourceMatterId: matterId,
				sourceCardId: cardId,
			});

			return API.v1.success({ backlink });
		} catch (e: any) {
			return API.v1.failure(e.message);
		}
	},
);

API.v1.post(
	'docs.unlink',
	{
		authRequired: true,
	},
	async function action() {
		const { docId, matterId, cardId } = this.bodyParams;

		if (!docId || (!matterId && !cardId)) {
			return API.v1.failure('Missing required fields: docId and (matterId or cardId)');
		}

		try {
			const sourceType = matterId ? 'matter' : 'card';
			const sourceId = matterId || cardId;
			await unlinkDocFromEntity(docId, sourceType, sourceId);

			return API.v1.success({ success: true });
		} catch (e: any) {
			return API.v1.failure(e.message);
		}
	},
);

API.v1.get(
	'docs.backlinks',
	{
		authRequired: true,
	},
	async function action() {
		const { docId } = this.queryParams;

		if (!docId) {
			return API.v1.failure('Missing required field: docId');
		}

		try {
			const backlinks = await getDocBacklinks(docId);
			return API.v1.success({ backlinks });
		} catch (e: any) {
			return API.v1.failure(e.message);
		}
	},
);
