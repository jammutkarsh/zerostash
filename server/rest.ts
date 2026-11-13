// Karakeep's REST API at /api/v1 (what Karakeep's CLI, MCP server, Raycast and other
// integrations call). Same paths, parameters and shapes as Karakeep; thin over domain/*.
// The OpenAPI document is generated from these routes at build time (scripts/openapi.ts).
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { parseQuery } from '../shared/query';
import { EditList, HttpUrl, LIMITS, NewBookmark, NewFeed, NewList, OWNER_ID, TagName, TagRef, UpdateBookmark, UpdateFeed } from '../shared/schemas';
import { checkUrl, listBookmarks, mustGetBookmark } from './domain/bookmarks';
import { allLists, createList, deleteList, editList, getList, listFilter } from './domain/lists';
import { allFeeds, createFeed, deleteFeed, getFeed, updateFeed } from './domain/feeds';
import { userStats } from './domain/stats';
import { createTag, deleteTag, getTag, listTags, renameTag } from './domain/tags';
import { DomainError } from './domain/util';
import { aiProvider } from './ai';
import { summarizeNow } from './jobs';
import { addBookmark, attachFile, changeTags, detachFile, editBookmark, listAdd, listRemove, removeBookmark, replaceFile, serveAsset, storeUpload } from './service';

type AppEnv = { Bindings: Env };

export const rest = new OpenAPIHono<AppEnv>({
	defaultHook: (result, c) => {
		if (!result.success) {
			const message = result.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
			return c.json({ code: 'BadRequest', message }, 400);
		}
	},
});

const STATUS = { NOT_FOUND: 404, BAD_REQUEST: 400, CONFLICT: 409 } as const;
rest.onError((err, c) => {
	if (err instanceof DomainError) return c.json({ code: err.code, message: err.message }, STATUS[err.code]);
	console.error(JSON.stringify({ msg: 'unhandled', path: c.req.path, error: String(err) }));
	return c.json({ code: 'InternalServerError', message: 'Something went wrong.' }, 500);
});

const ctx = (c: { env: Env; executionCtx: { waitUntil(p: Promise<unknown>): void } }) => ({ env: c.env, waitUntil: (p: Promise<unknown>) => c.executionCtx.waitUntil(p) });

// ---- documentation schemas (responses aren't validated; dates go out as ISO strings) ----

const date = z.string().openapi({ format: 'date-time' });
const Err = z.object({ code: z.string(), message: z.string() }).openapi('Error');
const BookmarkTag = z.object({ id: z.string(), name: z.string(), attachedBy: z.enum(['ai', 'human']) });
const Bookmark = z
	.object({
		id: z.string(),
		createdAt: date,
		modifiedAt: date,
		title: z.string().nullable(),
		archived: z.boolean(),
		favourited: z.boolean(),
		taggingStatus: z.enum(['pending', 'success', 'failure']).nullable(),
		summarizationStatus: z.enum(['pending', 'success', 'failure']).nullable(),
		note: z.string().nullable(),
		summary: z.string().nullable(),
		source: z.string().nullable(),
		userId: z.string(),
		tags: z.array(BookmarkTag),
		content: z
			.object({ type: z.enum(['link', 'text', 'asset']) })
			.passthrough()
			.openapi({ description: 'link: url, title, description, imageUrl, favicon, publisher, author, crawlStatus, crawledAt. text: text, sourceUrl. asset: assetType, assetId, fileName.' }),
		assets: z.array(z.object({ id: z.string(), assetType: z.string(), fileName: z.string().nullable() })),
		listIds: z.array(z.string()).openapi({ description: 'Zerostash addition: lists the bookmark belongs to.' }),
		feedId: z.string().nullable().openapi({ description: 'Zerostash addition: the RSS feed it came from.' }),
	})
	.openapi('Bookmark');
const Page = z.object({ bookmarks: z.array(Bookmark), nextCursor: z.string().nullable() }).openapi('PaginatedBookmarks');
const List = z
	.object({
		id: z.string(),
		name: z.string(),
		description: z.string().nullable(),
		icon: z.string(),
		parentId: z.string().nullable(),
		type: z.enum(['manual', 'smart']),
		query: z.string().nullable(),
		public: z.boolean(),
		hasCollaborators: z.boolean(),
		userRole: z.literal('owner'),
	})
	.openapi('List');
const Tag = z
	.object({ id: z.string(), name: z.string(), numBookmarks: z.number(), numBookmarksByAttachedType: z.object({ ai: z.number(), human: z.number() }) })
	.openapi('Tag');

// ---- route helpers ----

const qbool = z.enum(['true', 'false']).transform((v) => v === 'true');
const paging = {
	sortOrder: z.enum(['asc', 'desc']).optional(),
	limit: z.coerce.number().int().min(1).max(LIMITS.pageSize).optional(),
	cursor: z.string().max(200).optional(),
	includeContent: qbool.optional(),
};
const id = (name: string) => z.object({ [name]: z.string().min(1).max(64) });
const ok = <S extends z.ZodType>(schema: S, description = 'OK') => ({ content: { 'application/json': { schema } }, description });
const errors = {
	400: ok(Err, 'Invalid request'),
	401: ok(Err, 'Missing or wrong API key'),
	404: ok(Err, 'Not found'),
};
const noContent = { 204: { description: 'Done' } };
const body = <S extends z.ZodType>(schema: S) => ({ body: { content: { 'application/json': { schema } }, required: true } });
const route = <const M extends 'get' | 'post' | 'put' | 'patch' | 'delete', const P extends string, R extends object, Q extends object>(
	method: M,
	path: P,
	tag: string,
	summary: string,
	request: Q,
	responses: R,
) => createRoute({ method, path, tags: [tag], summary, request, responses: { ...responses, ...errors }, security: [{ bearer: [] }] });

// ---- bookmarks ----

rest.openapi(
	route('get', '/bookmarks', 'Bookmarks', 'List bookmarks', { query: z.object({ archived: qbool.optional(), favourited: qbool.optional(), ...paging }) }, { 200: ok(Page) }),
	async (c) => {
		const q = c.req.valid('query');
		return c.json(await listBookmarks(c.env.DB, { archived: q.archived, favourited: q.favourited }, { cursor: q.cursor, limit: q.limit, order: q.sortOrder }), 200);
	},
);

rest.openapi(
	route('post', '/bookmarks', 'Bookmarks', 'Create a bookmark (200 with the existing one if the URL is already saved)', body(NewBookmark), { 200: ok(Bookmark), 201: ok(Bookmark) }),
	async (c) => {
		const { bookmark, alreadyExists } = await addBookmark(ctx(c), c.req.valid('json'));
		return alreadyExists ? c.json(bookmark, 200) : c.json(bookmark, 201);
	},
);

rest.openapi(
	route(
		'get',
		'/bookmarks/search',
		'Bookmarks',
		'Search bookmarks (Karakeep query syntax: words, #tag, is:fav, list:name, url:, after:YYYY-MM-DD, -negation, or)',
		{ query: z.object({ q: z.string().max(LIMITS.query), ...paging }) },
		{ 200: ok(Page) },
	),
	async (c) => {
		const q = c.req.valid('query');
		return c.json(await listBookmarks(c.env.DB, { query: parseQuery(q.q) }, { cursor: q.cursor, limit: q.limit, order: q.sortOrder }), 200);
	},
);

rest.openapi(
	route('get', '/bookmarks/check-url', 'Bookmarks', 'Find the bookmark saved for a URL', { query: z.object({ url: HttpUrl }) }, { 200: ok(z.object({ bookmarkId: z.string().nullable() })) }),
	async (c) => c.json({ bookmarkId: await checkUrl(c.env.DB, c.req.valid('query').url) }, 200),
);

rest.openapi(route('get', '/bookmarks/{bookmarkId}', 'Bookmarks', 'Get a bookmark', { params: id('bookmarkId') }, { 200: ok(Bookmark) }), async (c) =>
	c.json(await mustGetBookmark(c.env.DB, c.req.valid('param').bookmarkId), 200),
);

rest.openapi(
	route('patch', '/bookmarks/{bookmarkId}', 'Bookmarks', 'Update a bookmark', { params: id('bookmarkId'), ...body(UpdateBookmark.omit({ bookmarkId: true })) }, { 200: ok(Bookmark) }),
	async (c) => c.json(await editBookmark(ctx(c), { ...c.req.valid('json'), bookmarkId: c.req.valid('param').bookmarkId }), 200),
);

rest.openapi(route('delete', '/bookmarks/{bookmarkId}', 'Bookmarks', 'Delete a bookmark', { params: id('bookmarkId') }, noContent), async (c) => {
	await removeBookmark(ctx(c), c.req.valid('param').bookmarkId);
	return c.body(null, 204);
});

rest.openapi(route('post', '/bookmarks/{bookmarkId}/summarize', 'Bookmarks', 'Summarize a bookmark with AI now', { params: id('bookmarkId') }, { 200: ok(Bookmark) }), async (c) => {
	if (!aiProvider(c.env)) throw new DomainError('BAD_REQUEST', 'AI is turned off on this server (ZEROSTASH_AI=off).');
	const b = await summarizeNow(c.env, c.req.valid('param').bookmarkId);
	if (!b) throw new DomainError('NOT_FOUND', 'Bookmark not found.');
	return c.json(b, 200);
});

const TagsBody = z.object({ tags: z.array(TagRef).max(LIMITS.tagsPerCall) });
rest.openapi(
	route('post', '/bookmarks/{bookmarkId}/tags', 'Bookmarks', 'Attach tags (by id, or by name: created if new)', { params: id('bookmarkId'), ...body(TagsBody) }, { 200: ok(z.object({ attached: z.array(z.string()) })) }),
	async (c) => {
		const res = await changeTags(ctx(c), c.req.valid('param').bookmarkId, c.req.valid('json').tags, []);
		return c.json({ attached: res.attached }, 200);
	},
);

rest.openapi(
	route('delete', '/bookmarks/{bookmarkId}/tags', 'Bookmarks', 'Detach tags', { params: id('bookmarkId'), ...body(TagsBody) }, { 200: ok(z.object({ detached: z.array(z.string()) })) }),
	async (c) => {
		const res = await changeTags(ctx(c), c.req.valid('param').bookmarkId, [], c.req.valid('json').tags);
		return c.json({ detached: res.detached }, 200);
	},
);

rest.openapi(route('get', '/bookmarks/{bookmarkId}/lists', 'Bookmarks', 'Lists a bookmark is in', { params: id('bookmarkId') }, { 200: ok(z.object({ lists: z.array(List) })) }), async (c) => {
	const [bookmark, lists] = await Promise.all([mustGetBookmark(c.env.DB, c.req.valid('param').bookmarkId), allLists(c.env.DB)]);
	return c.json({ lists: lists.filter((l) => bookmark.listIds.includes(l.id)) }, 200);
});

rest.openapi(
	route('get', '/bookmarks/{bookmarkId}/highlights', 'Bookmarks', 'Highlights (not supported yet: always empty)', { params: id('bookmarkId') }, { 200: ok(z.object({ highlights: z.array(z.object({})) })) }),
	async (c) => {
		await mustGetBookmark(c.env.DB, c.req.valid('param').bookmarkId);
		return c.json({ highlights: [] }, 200);
	},
);

// ---- lists ----

rest.openapi(route('get', '/lists', 'Lists', 'All lists', {}, { 200: ok(z.object({ lists: z.array(List) })) }), async (c) => c.json({ lists: await allLists(c.env.DB) }, 200));

rest.openapi(route('post', '/lists', 'Lists', 'Create a list (smart lists take a search query)', body(NewList), { 201: ok(List) }), async (c) =>
	c.json(await createList(c.env.DB, c.req.valid('json')), 201),
);

rest.openapi(route('get', '/lists/{listId}', 'Lists', 'Get a list', { params: id('listId') }, { 200: ok(List) }), async (c) =>
	c.json(await getList(c.env.DB, c.req.valid('param').listId), 200),
);

rest.openapi(
	route('patch', '/lists/{listId}', 'Lists', 'Update a list', { params: id('listId'), ...body(EditList.omit({ listId: true })) }, { 200: ok(List) }),
	async (c) => c.json(await editList(c.env.DB, { ...c.req.valid('json'), listId: c.req.valid('param').listId }), 200),
);

rest.openapi(route('delete', '/lists/{listId}', 'Lists', 'Delete a list (its bookmarks stay)', { params: id('listId') }, noContent), async (c) => {
	await deleteList(c.env.DB, c.req.valid('param').listId);
	return c.body(null, 204);
});

rest.openapi(
	route('get', '/lists/{listId}/bookmarks', 'Lists', "A list's bookmarks", { params: id('listId'), query: z.object(paging) }, { 200: ok(Page) }),
	async (c) => {
		const q = c.req.valid('query');
		const list = listFilter(await getList(c.env.DB, c.req.valid('param').listId));
		return c.json(await listBookmarks(c.env.DB, { list }, { cursor: q.cursor, limit: q.limit, order: q.sortOrder }), 200);
	},
);

const member = z.object({ listId: z.string().min(1).max(64), bookmarkId: z.string().min(1).max(64) });
rest.openapi(route('put', '/lists/{listId}/bookmarks/{bookmarkId}', 'Lists', 'Add a bookmark to a list', { params: member }, noContent), async (c) => {
	const p = c.req.valid('param');
	await listAdd(ctx(c), p.listId, p.bookmarkId);
	return c.body(null, 204);
});

rest.openapi(route('delete', '/lists/{listId}/bookmarks/{bookmarkId}', 'Lists', 'Remove a bookmark from a list', { params: member }, noContent), async (c) => {
	const p = c.req.valid('param');
	await listRemove(ctx(c), p.listId, p.bookmarkId);
	return c.body(null, 204);
});

// ---- tags ----

rest.openapi(
	route(
		'get',
		'/tags',
		'Tags',
		'All tags, most used first',
		{ query: z.object({ nameContains: z.string().max(LIMITS.tagName).optional(), sort: z.enum(['name', 'usage', 'relevance']).optional(), attachedBy: z.enum(['ai', 'human', 'none']).optional(), limit: z.coerce.number().int().min(1).optional(), cursor: z.string().optional() }) },
		{ 200: ok(z.object({ tags: z.array(Tag), nextCursor: z.string().nullable() })) },
	),
	async (c) => {
		const q = c.req.valid('query');
		return c.json({ tags: await listTags(c.env.DB, { nameContains: q.nameContains, attachedBy: q.attachedBy, sortBy: q.sort, limit: q.limit }), nextCursor: null }, 200);
	},
);

const TagBasic = z.object({ id: z.string(), name: z.string() });
rest.openapi(route('post', '/tags', 'Tags', 'Create a tag', body(z.object({ name: TagName })), { 201: ok(TagBasic), 409: ok(Err, 'Name taken') }), async (c) => {
	const tag = await createTag(c.env.DB, c.req.valid('json').name);
	return c.json({ id: tag.id, name: tag.name }, 201);
});

rest.openapi(route('get', '/tags/{tagId}', 'Tags', 'Get a tag', { params: id('tagId') }, { 200: ok(Tag) }), async (c) => c.json(await getTag(c.env.DB, c.req.valid('param').tagId), 200));

rest.openapi(
	route('patch', '/tags/{tagId}', 'Tags', 'Rename a tag', { params: id('tagId'), ...body(z.object({ name: TagName.optional() })) }, { 200: ok(TagBasic), 409: ok(Err, 'Name taken') }),
	async (c) => {
		const tag = await renameTag(c.env.DB, c.req.valid('param').tagId, c.req.valid('json').name);
		return c.json({ id: tag.id, name: tag.name }, 200);
	},
);

rest.openapi(route('delete', '/tags/{tagId}', 'Tags', 'Delete a tag (detaches it everywhere)', { params: id('tagId') }, noContent), async (c) => {
	await deleteTag(c.env.DB, c.req.valid('param').tagId);
	return c.body(null, 204);
});

rest.openapi(
	route('get', '/tags/{tagId}/bookmarks', 'Tags', "A tag's bookmarks", { params: id('tagId'), query: z.object(paging) }, { 200: ok(Page) }),
	async (c) => {
		const q = c.req.valid('query');
		const tag = await getTag(c.env.DB, c.req.valid('param').tagId);
		return c.json(await listBookmarks(c.env.DB, { tagId: tag.id }, { cursor: q.cursor, limit: q.limit, order: q.sortOrder }), 200);
	},
);

// ---- highlights (not supported yet) ----

rest.openapi(
	route('get', '/highlights', 'Highlights', 'Highlights (not supported yet: always empty)', {}, { 200: ok(z.object({ highlights: z.array(z.object({})), nextCursor: z.null() })) }),
	(c) => c.json({ highlights: [], nextCursor: null }, 200),
);

// ---- users ----

rest.openapi(
	route('get', '/users/me', 'Users', 'The owner', {}, { 200: ok(z.object({ id: z.string(), name: z.string(), email: z.string(), image: z.null(), localUser: z.boolean() })) }),
	(c) => c.json({ id: OWNER_ID, name: 'Zerostash', email: `owner@${new URL(c.req.url).host}`, image: null, localUser: true }, 200),
);

rest.openapi(route('get', '/users/me/stats', 'Users', 'Usage stats', {}, { 200: ok(z.object({}).passthrough()) }), async (c) => c.json(await userStats(c.env.DB), 200));

// ---- assets ----

const Uploaded = z.object({ assetId: z.string(), contentType: z.string(), size: z.number(), fileName: z.string() }).openapi('UploadedAsset');
rest.openapi(
	createRoute({
		method: 'post',
		path: '/assets',
		tags: ['Assets'],
		summary: 'Upload an image (JPEG, PNG, GIF, WebP, AVIF) or PDF, up to 20 MB; then create an asset bookmark with its id',
		request: { body: { content: { 'multipart/form-data': { schema: z.object({ file: z.any().openapi({ type: 'string', format: 'binary' }) }) } }, required: true } },
		responses: { 200: ok(Uploaded), ...errors },
		security: [{ bearer: [] }],
	}),
	async (c) => c.json(await storeUpload(ctx(c), c.req.valid('form').file), 200),
);

rest.openapi(
	createRoute({
		method: 'get',
		path: '/assets/{assetId}',
		tags: ['Assets'],
		summary: 'Download a file',
		request: { params: id('assetId') },
		responses: { 200: { description: 'The file' }, ...errors },
		security: [{ bearer: [] }],
	}),
	async (c) => serveAsset(c.env, c.req.valid('param').assetId),
);

const AssetRef = z.object({ id: z.string(), assetType: z.string(), fileName: z.string().nullable() });
rest.openapi(
	route('post', '/bookmarks/{bookmarkId}/assets', 'Bookmarks', 'Attach an uploaded file to a bookmark', { params: id('bookmarkId'), ...body(z.object({ id: z.string().min(1).max(64), assetType: z.string().min(1).max(32) })) }, { 201: ok(AssetRef) }),
	async (c) => {
		const b = c.req.valid('json');
		return c.json(await attachFile(ctx(c), c.req.valid('param').bookmarkId, b.id, b.assetType), 201);
	},
);

const bookmarkAsset = z.object({ bookmarkId: z.string().min(1).max(64), assetId: z.string().min(1).max(64) });
rest.openapi(
	route('put', '/bookmarks/{bookmarkId}/assets/{assetId}', 'Bookmarks', "Replace one of a bookmark's files with another upload", { params: bookmarkAsset, ...body(z.object({ assetId: z.string().min(1).max(64) })) }, noContent),
	async (c) => {
		const p = c.req.valid('param');
		await replaceFile(ctx(c), p.bookmarkId, p.assetId, c.req.valid('json').assetId);
		return c.body(null, 204);
	},
);

rest.openapi(route('delete', '/bookmarks/{bookmarkId}/assets/{assetId}', 'Bookmarks', 'Remove a file from a bookmark', { params: bookmarkAsset }, noContent), async (c) => {
	const p = c.req.valid('param');
	await detachFile(ctx(c), p.bookmarkId, p.assetId);
	return c.body(null, 204);
});

// ---- RSS feeds ----

const Feed = z
	.object({
		id: z.string(),
		name: z.string(),
		url: z.string(),
		enabled: z.boolean(),
		importTags: z.boolean(),
		lastFetchedStatus: z.enum(['pending', 'success', 'failure']).nullable(),
		lastFetchedAt: date.nullable(),
		lastSuccessfulFetchAt: date.nullable(),
	})
	.openapi('Feed');

rest.openapi(route('get', '/feeds', 'Feeds', 'RSS/Atom subscriptions', {}, { 200: ok(z.object({ feeds: z.array(Feed) })) }), async (c) => c.json({ feeds: await allFeeds(c.env.DB) }, 200));

rest.openapi(route('post', '/feeds', 'Feeds', 'Subscribe (fetched hourly; new items become bookmarks)', body(NewFeed), { 201: ok(Feed), 409: ok(Err, 'Already subscribed') }), async (c) =>
	c.json(await createFeed(c.env.DB, c.req.valid('json')), 201),
);

rest.openapi(route('get', '/feeds/{feedId}', 'Feeds', 'Get a feed', { params: id('feedId') }, { 200: ok(Feed) }), async (c) => c.json(await getFeed(c.env.DB, c.req.valid('param').feedId), 200));

rest.openapi(
	route('patch', '/feeds/{feedId}', 'Feeds', 'Update a feed', { params: id('feedId'), ...body(UpdateFeed.omit({ feedId: true })) }, { 200: ok(Feed), 409: ok(Err, 'Already subscribed') }),
	async (c) => c.json(await updateFeed(c.env.DB, { ...c.req.valid('json'), feedId: c.req.valid('param').feedId }), 200),
);

rest.openapi(route('delete', '/feeds/{feedId}', 'Feeds', 'Unsubscribe (its bookmarks stay)', { params: id('feedId') }, noContent), async (c) => {
	await deleteFeed(c.env.DB, c.req.valid('param').feedId);
	return c.body(null, 204);
});

rest.openapi(route('post', '/feeds/{feedId}/fetch', 'Feeds', 'Fetch a feed now', { params: id('feedId') }, noContent), async (c) => {
	const feed = await getFeed(c.env.DB, c.req.valid('param').feedId);
	await c.env.JOBS.send({ kind: 'feed', feedId: feed.id });
	return c.body(null, 204);
});
