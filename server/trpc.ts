// The tRPC API at /api/trpc: Karakeep's procedure names and shapes (Karakeep's extension and
// mobile app speak this, not Karakeep's REST API), plus a `zerostash` namespace for what the
// web app needs beyond Karakeep (delta sync). Thin: validation here, logic in domain/*.
// Reimplemented from the wire contract; no Karakeep code (AGPL) is copied.
// Procedures Zerostash doesn't serve get tRPC's standard NOT_FOUND.
import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import { z } from 'zod';
import { parseQuery } from '../shared/query';
import {
	EditList,
	GetBookmarks,
	LIMITS,
	ListTags,
	NewBookmark,
	NewFeed,
	NewList,
	NewRule,
	NewWebhook,
	OWNER_ID,
	SearchBookmarks,
	TagName,
	UpdateBookmark,
	UpdateFeed,
	UpdateRule,
	UpdateTags,
	UpdateWebhook,
} from '../shared/schemas';
import { changesSince, checkUrl, listBookmarks, mustGetBookmark, recrawl } from './domain/bookmarks';
import { allLists, createList, deleteList, editList, getList, listFilter, listSizes } from './domain/lists';
import { getSettings, UpdateUserSettings, updateSettings } from './domain/settings';
import { userStats } from './domain/stats';
import { createTag, deleteTag, deleteUnusedTags, getTag, listTags, mergeTags, renameTag } from './domain/tags';
import { DomainError } from './domain/util';
import { aiModel, aiProvider } from './ai';
import { summarizeNow } from './jobs';
import { addBookmark, attachFile, changeTags, type Ctx, detachFile, editBookmark, listAdd, listRemove, removeBookmark, replaceFile } from './service';
import { allFeeds, createFeed, deleteFeed, getFeed, updateFeed } from './domain/feeds';
import { allRules, createRule, deleteRule, updateRule } from './domain/rules';
import { allWebhooks, createWebhook, deleteWebhook, updateWebhook } from './domain/webhooks';
import pkg from '../package.json';

export interface TrpcContext extends Ctx {
	origin: string;
	/** No ZEROSTASH_SECRET set yet. */
	setupRequired: boolean;
	/** Bearer secret or web session cookie checked (see app.ts). */
	authed: boolean;
	/** Constant-time check of a presented secret (Karakeep's API-key / password login). */
	checkSecret: (given: string) => Promise<boolean>;
}

const t = initTRPC.context<TrpcContext>().create({ transformer: superjson });

const authed = t.procedure.use(async ({ ctx, next }) => {
	if (ctx.setupRequired) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Set the ZEROSTASH_SECRET secret first.' });
	if (!ctx.authed) throw new TRPCError({ code: 'UNAUTHORIZED' });
	const res = await next();
	const cause = res.ok ? undefined : res.error.cause;
	if (cause instanceof DomainError) throw new TRPCError({ code: cause.code, message: cause.message });
	return res;
});

async function mustMatch(ctx: TrpcContext, given: string): Promise<void> {
	if (ctx.setupRequired || !(await ctx.checkSecret(given))) throw new TRPCError({ code: 'UNAUTHORIZED' });
}

const bookmarkId = z.object({ bookmarkId: z.string() });
const pageSize = (limit: number | undefined) => Math.min(limit ?? 20, LIMITS.pageSize);

export const appRouter = t.router({
	apiKeys: t.router({
		// Single owner, single secret: the "API key" a client receives is ZEROSTASH_SECRET.
		exchange: t.procedure
			.input(z.object({ keyName: z.string(), email: z.string(), password: z.string() }))
			.mutation(async ({ ctx, input }) => {
				await mustMatch(ctx, input.password);
				return { id: 'zerostash', name: input.keyName, key: input.password, createdAt: new Date(), scopes: [] };
			}),
		validate: t.procedure.input(z.object({ apiKey: z.string() })).mutation(async ({ ctx, input }) => {
			await mustMatch(ctx, input.apiKey);
			return { success: true };
		}),
		// Nothing per-device to revoke; rotating ZEROSTASH_SECRET signs every client out.
		revoke: authed.input(z.object({ id: z.string() })).mutation(() => ({})),
	}),

	config: t.router({
		clientConfig: t.procedure.query(({ ctx }) => ({
			publicUrl: ctx.origin,
			publicApiUrl: `${ctx.origin}/api`,
			auth: { disableSignups: true, disablePasswordAuth: false, oauthAutoRedirect: false },
			turnstile: null,
			inference: { isConfigured: !!aiProvider(ctx.env), inferredTagLang: 'english', enableAutoTagging: !!aiProvider(ctx.env), enableAutoSummarization: !!aiProvider(ctx.env) },
			chat: { enabled: false },
			search: { semanticSearchEnabled: false },
			stripe: { isConfigured: false },
			crawler: { videoDownloadOnDemand: false },
			revenueCat: { isConfigured: false, purchasePlatforms: [] },
			legal: {},
			problemReports: { enabled: false },
			disableNewReleaseCheck: true,
		})),
	}),

	users: t.router({
		whoami: authed.query(({ ctx }) => ({ id: OWNER_ID, name: 'Zerostash', email: `owner@${new URL(ctx.origin).host}`, image: null, localUser: true })),
		settings: authed.query(({ ctx }) => getSettings(ctx.env.DB)),
		stats: authed.query(({ ctx }) => userStats(ctx.env.DB)),
		updateSettings: authed.input(UpdateUserSettings).mutation(async ({ ctx, input }) => {
			await updateSettings(ctx.env.DB, input);
		}),
	}),

	bookmarks: t.router({
		createBookmark: authed.input(NewBookmark).mutation(async ({ ctx, input }) => {
			const { bookmark, alreadyExists } = await addBookmark(ctx, input);
			return { ...bookmark, alreadyExists };
		}),
		getBookmark: authed
			.input(bookmarkId.extend({ includeContent: z.boolean().optional() }))
			.query(({ ctx, input }) => mustGetBookmark(ctx.env.DB, input.bookmarkId)),
		getBookmarks: authed.input(GetBookmarks).query(async ({ ctx, input }) => {
			const list = input.listId ? listFilter(await getList(ctx.env.DB, input.listId)) : undefined;
			return listBookmarks(
				ctx.env.DB,
				{ archived: input.archived, favourited: input.favourited, tagId: input.tagId, feedId: input.rssFeedId, list },
				{ cursor: input.cursor, limit: pageSize(input.limit), order: input.sortOrder },
			);
		}),
		searchBookmarks: authed.input(SearchBookmarks).query(({ ctx, input }) =>
			listBookmarks(
				ctx.env.DB,
				{ query: parseQuery(input.text) },
				{ cursor: input.cursor, limit: pageSize(input.limit), order: input.sortOrder === 'asc' ? 'asc' : 'desc' },
			),
		),
		checkUrl: authed.input(z.object({ url: z.string() })).query(async ({ ctx, input }) => ({ bookmarkId: await checkUrl(ctx.env.DB, input.url) })),
		updateBookmark: authed.input(UpdateBookmark).mutation(({ ctx, input }) => editBookmark(ctx, input)),
		updateBookmarkText: authed
			.input(bookmarkId.extend({ text: z.string().trim().min(1).max(LIMITS.text) }))
			.mutation(async ({ ctx, input }) => {
				await editBookmark(ctx, input);
			}),
		updateTags: authed.input(UpdateTags).mutation(async ({ ctx, input }) => ({
			bookmarkId: input.bookmarkId,
			...(await changeTags(ctx, input.bookmarkId, input.attach, input.detach)),
		})),
		recrawlBookmark: authed.input(bookmarkId).mutation(async ({ ctx, input }) => {
			await recrawl(ctx.env.DB, input.bookmarkId);
		}),
		deleteBookmark: authed.input(bookmarkId).mutation(({ ctx, input }) => removeBookmark(ctx, input.bookmarkId)),
		summarizeBookmark: authed.input(bookmarkId).mutation(async ({ ctx, input }) => {
			if (!aiProvider(ctx.env)) throw new TRPCError({ code: 'BAD_REQUEST', message: 'AI is turned off on this server (ZEROSTASH_AI=off).' });
			const b = await summarizeNow(ctx.env, input.bookmarkId);
			if (!b) throw new TRPCError({ code: 'NOT_FOUND', message: 'Bookmark not found.' });
			return b;
		}),
	}),

	lists: t.router({
		list: authed.query(async ({ ctx }) => ({ lists: await allLists(ctx.env.DB) })),
		get: authed.input(z.object({ listId: z.string() })).query(({ ctx, input }) => getList(ctx.env.DB, input.listId)),
		create: authed.input(NewList).mutation(({ ctx, input }) => createList(ctx.env.DB, input)),
		edit: authed.input(EditList).mutation(({ ctx, input }) => editList(ctx.env.DB, input)),
		delete: authed.input(z.object({ listId: z.string(), deleteChildren: z.boolean().optional() })).mutation(async ({ ctx, input }) => {
			await deleteList(ctx.env.DB, input.listId, input.deleteChildren);
		}),
		addToList: authed.input(z.object({ listId: z.string(), bookmarkId: z.string() })).mutation(async ({ ctx, input }) => {
			await listAdd(ctx, input.listId, input.bookmarkId);
		}),
		removeFromList: authed.input(z.object({ listId: z.string(), bookmarkId: z.string() })).mutation(async ({ ctx, input }) => {
			await listRemove(ctx, input.listId, input.bookmarkId);
		}),
		getListsOfBookmark: authed.input(bookmarkId).query(async ({ ctx, input }) => {
			const [bookmark, lists] = await Promise.all([mustGetBookmark(ctx.env.DB, input.bookmarkId), allLists(ctx.env.DB)]);
			return { lists: lists.filter((l) => bookmark.listIds.includes(l.id)) };
		}),
		stats: authed.query(async ({ ctx }) => ({ stats: await listSizes(ctx.env.DB) })),
		// Single owner: no sharing, so never any invitations.
		getPendingInvitations: authed.query(() => []),
	}),

	tags: t.router({
		list: authed.input(ListTags).query(async ({ ctx, input }) => ({ tags: await listTags(ctx.env.DB, input ?? {}), nextCursor: null })),
		get: authed.input(z.object({ tagId: z.string() })).query(({ ctx, input }) => getTag(ctx.env.DB, input.tagId)),
		create: authed.input(z.object({ name: TagName })).mutation(async ({ ctx, input }) => {
			const tag = await createTag(ctx.env.DB, input.name);
			return { id: tag.id, name: tag.name };
		}),
		update: authed.input(z.object({ tagId: z.string(), name: TagName.optional() })).mutation(async ({ ctx, input }) => {
			const tag = await renameTag(ctx.env.DB, input.tagId, input.name);
			return { id: tag.id, name: tag.name };
		}),
		delete: authed.input(z.object({ tagId: z.string() })).mutation(async ({ ctx, input }) => {
			await deleteTag(ctx.env.DB, input.tagId);
		}),
		deleteUnused: authed.mutation(async ({ ctx }) => ({ deletedTags: await deleteUnusedTags(ctx.env.DB) })),
		merge: authed
			.input(z.object({ intoTagId: z.string(), fromTagIds: z.array(z.string()).max(LIMITS.tagsPerCall) }))
			.mutation(({ ctx, input }) => mergeTags(ctx.env.DB, input.intoTagId, input.fromTagIds)),
	}),

	assets: t.router({
		attachAsset: authed
			.input(bookmarkId.extend({ asset: z.object({ id: z.string(), assetType: z.string().max(32) }) }))
			.mutation(({ ctx, input }) => attachFile(ctx, input.bookmarkId, input.asset.id, input.asset.assetType)),
		replaceAsset: authed
			.input(bookmarkId.extend({ oldAssetId: z.string(), newAssetId: z.string() }))
			.mutation(({ ctx, input }) => replaceFile(ctx, input.bookmarkId, input.oldAssetId, input.newAssetId)),
		detachAsset: authed.input(bookmarkId.extend({ assetId: z.string() })).mutation(({ ctx, input }) => detachFile(ctx, input.bookmarkId, input.assetId)),
	}),

	feeds: t.router({
		list: authed.query(async ({ ctx }) => ({ feeds: await allFeeds(ctx.env.DB) })),
		get: authed.input(z.object({ feedId: z.string() })).query(({ ctx, input }) => getFeed(ctx.env.DB, input.feedId)),
		create: authed.input(NewFeed).mutation(({ ctx, input }) => createFeed(ctx.env.DB, input)),
		update: authed.input(UpdateFeed).mutation(({ ctx, input }) => updateFeed(ctx.env.DB, input)),
		delete: authed.input(z.object({ feedId: z.string() })).mutation(async ({ ctx, input }) => {
			await deleteFeed(ctx.env.DB, input.feedId);
		}),
		fetchNow: authed.input(z.object({ feedId: z.string() })).mutation(async ({ ctx, input }) => {
			await getFeed(ctx.env.DB, input.feedId);
			await ctx.env.JOBS.send({ kind: 'feed', feedId: input.feedId });
		}),
	}),

	rules: t.router({
		list: authed.query(async ({ ctx }) => ({ rules: await allRules(ctx.env.DB) })),
		create: authed.input(NewRule).mutation(({ ctx, input }) => createRule(ctx.env.DB, input)),
		update: authed.input(UpdateRule).mutation(({ ctx, input }) => updateRule(ctx.env.DB, input)),
		delete: authed.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
			await deleteRule(ctx.env.DB, input.id);
		}),
	}),

	webhooks: t.router({
		list: authed.query(async ({ ctx }) => ({ webhooks: await allWebhooks(ctx.env.DB) })),
		create: authed.input(NewWebhook).mutation(({ ctx, input }) => createWebhook(ctx.env.DB, input)),
		update: authed.input(UpdateWebhook).mutation(({ ctx, input }) => updateWebhook(ctx.env.DB, input)),
		delete: authed.input(z.object({ webhookId: z.string() })).mutation(async ({ ctx, input }) => {
			await deleteWebhook(ctx.env.DB, input.webhookId);
		}),
	}),

	// Highlights aren't supported yet; empty answers keep Karakeep's mobile app screens working.
	highlights: t.router({
		getAll: authed.input(z.unknown()).query(() => ({ highlights: [], nextCursor: null })),
		getForBookmark: authed.input(bookmarkId).query(() => ({ highlights: [] })),
	}),

	zerostash: t.router({
		/** What this server can do, for the web app's settings page. */
		status: authed.query(({ ctx }) => {
			const ai = aiProvider(ctx.env);
			return { version: pkg.version, ai, model: ai ? aiModel(ctx.env, ai) : null };
		}),
		/** Delta sync: what changed since `since` (the previous call's `cursor`). */
		changes: authed.input(z.object({ since: z.number().int().min(0).optional() })).query(async ({ ctx, input }) => {
			const [delta, lists, tags] = await Promise.all([changesSince(ctx.env.DB, input.since), allLists(ctx.env.DB), listTags(ctx.env.DB)]);
			return { ...delta, lists, tags };
		}),
	}),
});

export type AppRouter = typeof appRouter;
