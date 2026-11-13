// API contracts shared by the Worker (tRPC + REST) and the web app. Shapes and field names
// follow Karakeep's API so Karakeep's own clients work unchanged; the definitions are our own.
import { z } from 'zod';
import { isHttpUrl } from './og';

// Field limits protect D1's 2 MB row cap and keep rows small enough that
// ~200k bookmarks fit in the 500 MB per-database Free limit.
export const LIMITS = {
	url: 2048,
	title: 500,
	description: 2000,
	note: 10_000,
	text: 20_000,
	summary: 5_000,
	tagName: 64,
	tagsPerCall: 30, // 30 new names x 3 params stays under D1's 100 bound parameters
	listName: 100,
	listIcon: 16,
	listDescription: 500,
	query: 1000,
	pageSize: 100,
} as const;

export const OWNER_ID = 'owner';

export const BookmarkType = z.enum(['link', 'text', 'asset']);
export const BookmarkSource = z.enum(['api', 'web', 'cli', 'mobile', 'extension', 'singlefile', 'rss', 'import']);
export type BookmarkSource = z.infer<typeof BookmarkSource>;
export const Status = z.enum(['pending', 'success', 'failure']);
export type Status = z.infer<typeof Status>;
export const AttachedBy = z.enum(['ai', 'human']);
export type AttachedBy = z.infer<typeof AttachedBy>;

// ---- outputs ----

export interface BookmarkTag {
	id: string;
	name: string;
	attachedBy: AttachedBy;
}

export interface BookmarkAsset {
	id: string;
	assetType: string;
	fileName: string | null;
}

export type BookmarkContent =
	| {
			type: 'link';
			url: string;
			title: string | null;
			description: string | null;
			imageUrl: string | null;
			favicon: string | null;
			publisher: string | null;
			author: string | null;
			crawlStatus: Status | null;
			crawledAt: Date | null;
	  }
	| { type: 'text'; text: string; sourceUrl: string | null }
	| { type: 'asset'; assetType: 'image' | 'pdf'; assetId: string; fileName: string | null; sourceUrl: string | null };

export interface Bookmark {
	id: string;
	createdAt: Date;
	modifiedAt: Date;
	title: string | null;
	archived: boolean;
	favourited: boolean;
	taggingStatus: Status | null;
	summarizationStatus: Status | null;
	embeddingStatus: null;
	note: string | null;
	summary: string | null;
	source: BookmarkSource | null;
	userId: string;
	tags: BookmarkTag[];
	content: BookmarkContent;
	assets: BookmarkAsset[];
	// Zerostash additions (Karakeep clients ignore them): let the web app answer
	// list:/feed: queries from its offline copy.
	listIds: string[];
	feedId: string | null;
}

export interface BookmarkPage {
	bookmarks: Bookmark[];
	nextCursor: string | null;
}

export interface List {
	id: string;
	name: string;
	description: string | null;
	icon: string;
	parentId: string | null;
	type: 'manual' | 'smart';
	query: string | null;
	public: boolean;
	hasCollaborators: boolean;
	userRole: 'owner';
}

export interface Tag {
	id: string;
	name: string;
	numBookmarks: number;
	numBookmarksByAttachedType: Record<AttachedBy, number>;
}

/** zerostash.changes: what changed since the client's last sync. */
export interface Changes {
	bookmarks: Bookmark[]; // created or changed since `since`
	deleted: string[]; // ids deleted since `since`
	lists: List[]; // all lists (tiny table)
	tags: Tag[]; // all tags (tiny table)
	cursor: number; // pass as `since` next time
	reset: boolean; // first sync, `since` too old, or too much changed: reload instead
}

// ---- inputs ----

export const HttpUrl = z.string().trim().max(LIMITS.url).refine(isHttpUrl, 'Must be an http(s) URL');
const title = z.string().trim().max(LIMITS.title);
const id = z.string().min(1).max(64);
const cursor = z.string().max(200).nullish();
const limit = z.number().int().min(1).max(LIMITS.pageSize).optional();

export const NewBookmark = z
	.object({
		type: BookmarkType.default('link'),
		url: HttpUrl.optional(),
		text: z.string().trim().min(1).max(LIMITS.text).optional(),
		sourceUrl: HttpUrl.optional(),
		assetId: id.optional(),
		assetType: z.enum(['image', 'pdf']).optional(),
		fileName: z.string().trim().max(LIMITS.title).optional(),
		title: title.nullish(),
		note: z.string().max(LIMITS.note).optional(),
		summary: z.string().max(LIMITS.summary).optional(),
		archived: z.boolean().optional(),
		favourited: z.boolean().optional(),
		createdAt: z.coerce.date().optional(),
		source: BookmarkSource.optional(),
	})
	.refine((b) => (b.type === 'link' ? !!b.url : b.type === 'text' ? !!b.text : !!b.assetId && !!b.assetType), {
		message: 'link bookmarks need `url`, text bookmarks need `text`, asset bookmarks need `assetId` and `assetType`',
	});
export type NewBookmark = z.input<typeof NewBookmark>;
export type NewBookmarkInput = z.output<typeof NewBookmark>;

export const UpdateBookmark = z.object({
	bookmarkId: id,
	title: title.nullish(),
	note: z.string().max(LIMITS.note).optional(),
	summary: z.string().max(LIMITS.summary).nullish(),
	archived: z.boolean().optional(),
	favourited: z.boolean().optional(),
	createdAt: z.coerce.date().optional(),
	url: HttpUrl.optional(),
	description: z.string().max(LIMITS.description).nullish(),
	author: z.string().max(200).nullish(),
	publisher: z.string().max(200).nullish(),
	text: z.string().trim().min(1).max(LIMITS.text).nullish(),
});
export type UpdateBookmark = z.infer<typeof UpdateBookmark>;

export const SortOrder = z.enum(['asc', 'desc']);

export const GetBookmarks = z.object({
	archived: z.boolean().optional(),
	favourited: z.boolean().optional(),
	tagId: id.optional(),
	listId: id.optional(),
	rssFeedId: id.optional(),
	limit,
	cursor,
	sortOrder: SortOrder.optional(),
});
export type GetBookmarks = z.infer<typeof GetBookmarks>;

export const SearchBookmarks = z.object({
	text: z.string().max(LIMITS.query),
	limit,
	cursor,
	// Karakeep's default "relevance" has no meaning without FTS; newest first instead.
	sortOrder: z.enum(['relevance', 'asc', 'desc']).optional(),
});

export const NewList = z
	.object({
		name: z.string().trim().min(1).max(LIMITS.listName),
		description: z.string().trim().max(LIMITS.listDescription).nullish(),
		icon: z.string().trim().min(1).max(LIMITS.listIcon),
		type: z.enum(['manual', 'smart']).default('manual'),
		query: z.string().trim().min(1).max(LIMITS.query).optional(),
		parentId: id.nullish(),
	})
	.refine((l) => l.type === 'manual' || !!l.query, { message: 'smart lists need a query', path: ['query'] });
export type NewList = z.input<typeof NewList>;
export type NewListInput = z.output<typeof NewList>;

export const EditList = z.object({
	listId: id,
	name: z.string().trim().min(1).max(LIMITS.listName).optional(),
	description: z.string().trim().max(LIMITS.listDescription).nullish(),
	icon: z.string().trim().min(1).max(LIMITS.listIcon).optional(),
	parentId: id.nullish(),
	query: z.string().trim().min(1).max(LIMITS.query).optional(),
});
export type EditList = z.infer<typeof EditList>;

export const TagRef = z
	.object({
		tagId: id.optional(),
		tagName: z.string().trim().min(1).max(LIMITS.tagName).optional(),
		attachedBy: AttachedBy.default('human'),
	})
	.refine((t) => !!t.tagId || !!t.tagName, { message: 'You must provide either a tagId or a tagName' });
export type TagRef = z.input<typeof TagRef>;

export const UpdateTags = z.object({
	bookmarkId: id,
	attach: z.array(TagRef).max(LIMITS.tagsPerCall),
	detach: z.array(TagRef).max(LIMITS.tagsPerCall),
});

export const TagName = z.string().trim().min(1).max(LIMITS.tagName);

export const ListTags = z
	.object({
		nameContains: z.string().max(LIMITS.tagName).optional(),
		ids: z.array(id).max(90).optional(),
		attachedBy: z.enum(['ai', 'human', 'none']).optional(),
		sortBy: z.enum(['name', 'usage', 'relevance']).optional(),
		cursor: z.unknown().optional(),
		limit: z.number().int().min(1).optional(),
	})
	.optional();

// ---- RSS feeds ----

export interface Feed {
	id: string;
	name: string;
	url: string;
	enabled: boolean;
	importTags: boolean;
	lastFetchedStatus: Status | null;
	lastFetchedAt: Date | null;
	lastSuccessfulFetchAt: Date | null;
}

export const NewFeed = z.object({
	name: z.string().trim().min(1).max(100),
	url: HttpUrl,
	enabled: z.boolean().default(true),
	importTags: z.boolean().default(false),
});
export const UpdateFeed = z.object({
	feedId: id,
	name: z.string().trim().min(1).max(100).optional(),
	url: HttpUrl.optional(),
	enabled: z.boolean().optional(),
	importTags: z.boolean().optional(),
});

// ---- webhooks ----

export const WebhookEvent = z.enum(['created', 'edited', 'crawled', 'ai tagged', 'deleted']);
export type WebhookEvent = z.infer<typeof WebhookEvent>;
export interface Webhook {
	id: string;
	url: string;
	events: WebhookEvent[];
	hasToken: boolean;
	createdAt: Date;
}
export const NewWebhook = z.object({ url: HttpUrl, events: z.array(WebhookEvent).min(1), token: z.string().max(500).optional() });
export const UpdateWebhook = z.object({
	webhookId: id,
	url: HttpUrl.optional(),
	events: z.array(WebhookEvent).min(1).optional(),
	token: z.string().max(500).nullish(),
});

// ---- rules (Karakeep's rule engine shape) ----

export const RuleEvent = z.discriminatedUnion('type', [
	z.object({ type: z.literal('bookmarkAdded') }),
	z.object({ type: z.literal('tagAdded'), tagId: id }),
	z.object({ type: z.literal('tagRemoved'), tagId: id }),
	z.object({ type: z.literal('addedToList'), listId: id }),
	z.object({ type: z.literal('removedFromList'), listId: id }),
	z.object({ type: z.literal('favourited') }),
	z.object({ type: z.literal('archived') }),
]);
export type RuleEvent = z.infer<typeof RuleEvent>;

export type RuleCondition =
	| { type: 'alwaysTrue' | 'isFavourited' | 'isArchived' }
	| { type: 'urlContains' | 'urlDoesNotContain' | 'titleContains' | 'titleDoesNotContain'; str: string }
	| { type: 'importedFromFeed'; feedId: string }
	| { type: 'bookmarkTypeIs'; bookmarkType: 'link' | 'text' | 'asset' }
	| { type: 'bookmarkSourceIs'; source: BookmarkSource }
	| { type: 'hasTag'; tagId: string }
	| { type: 'and' | 'or'; conditions: RuleCondition[] };
const str = z.string().min(1).max(500);
export const RuleCondition: z.ZodType<RuleCondition> = z.lazy(() =>
	z.discriminatedUnion('type', [
		z.object({ type: z.enum(['alwaysTrue', 'isFavourited', 'isArchived']) }),
		z.object({ type: z.enum(['urlContains', 'urlDoesNotContain', 'titleContains', 'titleDoesNotContain']), str }),
		z.object({ type: z.literal('importedFromFeed'), feedId: id }),
		z.object({ type: z.literal('bookmarkTypeIs'), bookmarkType: BookmarkType }),
		z.object({ type: z.literal('bookmarkSourceIs'), source: BookmarkSource }),
		z.object({ type: z.literal('hasTag'), tagId: id }),
		z.object({ type: z.enum(['and', 'or']), conditions: z.array(RuleCondition).max(20) }),
	]),
);

export const RuleAction = z.discriminatedUnion('type', [
	z.object({ type: z.literal('addTag'), tagId: id }),
	z.object({ type: z.literal('removeTag'), tagId: id }),
	z.object({ type: z.literal('addToList'), listId: id }),
	z.object({ type: z.literal('removeFromList'), listId: id }),
	z.object({ type: z.literal('downloadFullPageArchive') }), // accepted, does nothing (no archives here)
	z.object({ type: z.literal('favouriteBookmark') }),
	z.object({ type: z.literal('archiveBookmark') }),
]);
export type RuleAction = z.infer<typeof RuleAction>;

export const NewRule = z.object({
	name: z.string().trim().min(1).max(100),
	description: z.string().max(500).nullish(),
	enabled: z.boolean().default(true),
	event: RuleEvent,
	condition: RuleCondition,
	actions: z.array(RuleAction).min(1).max(10),
});
export const UpdateRule = NewRule.extend({ id });
export type Rule = z.output<typeof NewRule> & { id: string; description: string | null };
