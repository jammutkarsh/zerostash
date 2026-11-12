// API contracts shared by the Worker, the web UI and the extension.
// Plain zod (no openapi extension) so the extension bundle stays small.
import { z } from 'zod';
import { isHttpUrl } from './og';

export const API_VERSION = 1;

// Field limits protect D1's 2 MB row cap and keep rows small enough that
// ~200k bookmarks fit in the 500 MB per-database Free limit.
export const LIMITS = {
	url: 2048,
	title: 500,
	description: 2000,
	note: 10_000,
	text: 20_000,
	siteName: 200,
	tagsPerBookmark: 50,
	tagName: 64,
	listName: 100,
	listIcon: 16,
	listTerms: 10, // smart-list terms; 10 terms × 7 searched columns stays under D1's 100 bound params
	listTerm: 100,
	pageSize: 100,
	ogBatch: 20,
} as const;

const httpUrl = z.string().trim().max(LIMITS.url).refine(isHttpUrl, 'Must be an http(s) URL');

export const OgFields = z.object({
	url: httpUrl.optional(), // canonical URL declared by the page
	title: z.string().max(LIMITS.title).optional(),
	description: z.string().max(LIMITS.description).optional(),
	imageUrl: httpUrl.optional(),
	siteName: z.string().max(LIMITS.siteName).optional(),
	faviconUrl: httpUrl.optional(),
});
export type OgFields = z.infer<typeof OgFields>;

export const BookmarkSource = z.enum(['extension', 'web', 'bookmarklet', 'import', 'rss', 'api']);

export const CreateBookmark = z
	.object({
		type: z.enum(['link', 'text']).default('link'),
		url: httpUrl.optional(),
		text: z.string().trim().min(1).max(LIMITS.text).optional(),
		title: z.string().trim().max(LIMITS.title).optional(),
		note: z.string().max(LIMITS.note).optional(),
		source: BookmarkSource.default('api'),
		// OG read by the client. `tab` = the extension read the open page itself.
		og: OgFields.extend({ source: z.enum(['tab', 'bookmarklet']) }).optional(),
	})
	.refine((b) => (b.type === 'link' ? !!b.url : !!b.text), {
		message: 'link bookmarks need `url`, text bookmarks need `text`',
	});
export type CreateBookmark = z.input<typeof CreateBookmark>;

export const PatchBookmark = z.object({
	title: z.string().trim().max(LIMITS.title).nullable().optional(),
	note: z.string().max(LIMITS.note).nullable().optional(),
	text: z.string().trim().min(1).max(LIMITS.text).optional(),
	favourited: z.boolean().optional(),
	archived: z.boolean().optional(),
});
export type PatchBookmark = z.infer<typeof PatchBookmark>;

// OG written back by the extension's background worker after fetching the page.
export const OgPatch = z.union([
	OgFields.extend({ source: z.literal('extension'), failed: z.literal(false).optional() }),
	z.object({ source: z.literal('extension'), failed: z.literal(true) }),
]);
export type OgPatch = z.infer<typeof OgPatch>;

export const ListQuery = z.object({
	cursor: z.string().max(200).optional(),
	limit: z.coerce.number().int().min(1).max(LIMITS.pageSize).default(30),
	view: z.enum(['home', 'archive', 'favourites']).default('home'),
	// Free-text search across all bookmarks (any view). ponytail: LIKE scan; FTS5 later.
	q: z.string().trim().max(200).optional(),
	// Bookmarks in one list (overrides `view`; a smart list runs its saved search).
	list: z.string().max(64).optional(),
});

export const Bookmark = z.object({
	id: z.string(),
	type: z.enum(['link', 'text']),
	url: z.string().nullable(),
	title: z.string().nullable(),
	description: z.string().nullable(),
	imageUrl: z.string().nullable(),
	siteName: z.string().nullable(),
	faviconUrl: z.string().nullable(),
	text: z.string().nullable(),
	note: z.string().nullable(),
	summary: z.string().nullable(),
	favourited: z.boolean(),
	archived: z.boolean(),
	source: BookmarkSource,
	aiStatus: z.enum(['none', 'pending', 'done', 'failed', 'skipped']),
	ogStatus: z.enum(['pending', 'done', 'server_failed', 'failed']),
	ogSource: z.enum(['tab', 'bookmarklet', 'extension', 'feed', 'server']).nullable(),
	listIds: z.array(z.string()),
	createdAt: z.number(),
	updatedAt: z.number(),
});
export type Bookmark = z.infer<typeof Bookmark>;

export const ListKind = z.enum(['manual', 'smart']);

export const List = z.object({
	id: z.string(),
	name: z.string(),
	icon: z.string().nullable(),
	parentId: z.string().nullable(),
	kind: ListKind,
	terms: z.array(z.string()), // smart lists: bookmarks matching any of these; [] for manual lists
	itemCount: z.number(), // manual lists only; 0 for smart lists
	createdAt: z.number(),
});
export type List = z.infer<typeof List>;

const listName = z.string().trim().min(1).max(LIMITS.listName);
const listIcon = z.string().trim().max(LIMITS.listIcon);
const listTerms = z
	.array(z.string().trim().min(1).max(LIMITS.listTerm))
	.max(LIMITS.listTerms)
	.transform((terms) => [...new Set(terms)]);

export const CreateList = z
	.object({
		name: listName,
		icon: listIcon.optional(),
		parentId: z.string().max(64).nullable().optional(),
		kind: ListKind.default('manual'),
		terms: listTerms.optional(),
	})
	.refine((l) => l.kind === 'manual' || !!l.terms?.length, { message: 'smart lists need at least one search term' });
export type CreateList = z.input<typeof CreateList>;

export const PatchList = z.object({
	name: listName.optional(),
	icon: listIcon.nullable().optional(),
	parentId: z.string().max(64).nullable().optional(),
	terms: listTerms.refine((t) => t.length > 0, 'a smart list needs at least one search term').optional(),
});
export type PatchList = z.infer<typeof PatchList>;

export const BookmarkPage = z.object({ items: z.array(Bookmark), nextCursor: z.string().nullable() });
export type BookmarkPage = z.infer<typeof BookmarkPage>;

export const Health = z.object({
	name: z.literal('zerostash'),
	version: z.string(),
	apiVersion: z.number(),
	setupRequired: z.boolean(),
});
export type Health = z.infer<typeof Health>;

export const ApiError = z.object({ error: z.string(), message: z.string().optional() });
