<script lang="ts">
	import Play from '@lucide/svelte/icons/play';
	import Plus from '@lucide/svelte/icons/plus';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { onMount } from 'svelte';
	import type { Feed, Rule, RuleAction, RuleCondition, RuleEvent, Webhook, WebhookEvent } from '../../shared/schemas';
	import { api, errorMessage } from '../lib/api';
	import { lists, pull, tags } from '../lib/store.svelte';
	import { toast } from '../lib/toast.svelte';

	// Server features that live outside the bookmark grid: AI, RSS feeds, rules, webhooks.
	type Settings = Awaited<ReturnType<typeof api.users.settings.query>>;
	let status = $state<{ version: string; ai: string | null; model: string | null } | null>(null);
	let settings = $state<Settings | null>(null);
	let feeds = $state<Feed[]>([]);
	let rules = $state<Rule[]>([]);
	let webhooks = $state<Webhook[]>([]);

	async function load() {
		try {
			[status, settings, { feeds }, { rules }, { webhooks }] = await Promise.all([
				api.zerostash.status.query(),
				api.users.settings.query(),
				api.feeds.list.query(),
				api.rules.list.query(),
				api.webhooks.list.query(),
			]);
		} catch (e) {
			toast(errorMessage(e));
		}
	}
	onMount(load);

	/** Run a change, report failures, reload. */
	async function run(fn: () => Promise<unknown>, done?: string) {
		try {
			await fn();
			if (done) toast(done, 2000);
		} catch (e) {
			toast(errorMessage(e));
		}
		await Promise.all([load(), pull()]); // a rule can create tags; the sidebar should know them
	}

	const AI_NAMES: Record<string, string> = { anthropic: 'Claude', openai: 'OpenAI', gemini: 'Gemini', custom: 'your OpenAI-compatible API', 'workers-ai': 'Workers AI (free quota)' };
	const TAG_STYLES = ['as-generated', 'lowercase-hyphens', 'lowercase-spaces', 'lowercase-underscores', 'titlecase-spaces', 'titlecase-hyphens', 'camelCase'] as const;

	// ---- feeds ----
	let feedName = $state('');
	let feedUrl = $state('');
	let feedTags = $state(false);
	const addFeed = (e: SubmitEvent) => (
		e.preventDefault(),
		run(async () => {
			await api.feeds.create.mutate({ name: feedName.trim() || new URL(feedUrl).hostname, url: feedUrl.trim(), enabled: true, importTags: feedTags });
			feedName = feedUrl = '';
			feedTags = false;
		}, 'Subscribed. New items arrive within the hour.')
	);

	// ---- webhooks ----
	const EVENTS: WebhookEvent[] = ['created', 'edited', 'crawled', 'ai tagged', 'deleted'];
	let hookUrl = $state('');
	let hookToken = $state('');
	let hookEvents = $state<WebhookEvent[]>(['created']);
	const addHook = (e: SubmitEvent) => (
		e.preventDefault(),
		run(async () => {
			await api.webhooks.create.mutate({ url: hookUrl.trim(), events: hookEvents, token: hookToken || undefined });
			hookUrl = hookToken = '';
			hookEvents = ['created'];
		})
	);

	// ---- rules ----
	// The builder covers one condition; the API also takes and/or trees.
	let ruleName = $state('');
	let eventType = $state<RuleEvent['type']>('bookmarkAdded');
	let eventRef = $state(''); // tag or list id
	let condType = $state<RuleCondition['type']>('alwaysTrue');
	let condValue = $state('');
	let actions = $state<{ type: RuleAction['type']; ref: string }[]>([{ type: 'addTag', ref: '' }]);

	const needsTag = (t: string) => ['tagAdded', 'tagRemoved', 'hasTag', 'addTag', 'removeTag'].includes(t);
	const needsList = (t: string) => ['addedToList', 'removedFromList', 'addToList', 'removeFromList'].includes(t);
	const needsText = (t: string) => ['urlContains', 'urlDoesNotContain', 'titleContains', 'titleDoesNotContain'].includes(t);

	/** Tags are typed by name; new names are created on save. */
	async function tagId(name: string): Promise<string> {
		const existing = tags.items.find((t) => t.name.toLowerCase() === name.trim().toLowerCase());
		return existing?.id ?? (await api.tags.create.mutate({ name: name.trim() })).id;
	}

	async function ref(type: string, value: string): Promise<Record<string, string>> {
		if (needsTag(type)) return { tagId: await tagId(value) };
		if (needsList(type)) return { listId: value };
		if (needsText(type)) return { str: value };
		if (type === 'importedFromFeed') return { feedId: value };
		if (type === 'bookmarkTypeIs') return { bookmarkType: value };
		if (type === 'bookmarkSourceIs') return { source: value };
		return {};
	}

	const addRule = (e: SubmitEvent) => (
		e.preventDefault(),
		run(async () => {
			await api.rules.create.mutate({
				name: ruleName.trim(),
				enabled: true,
				event: { type: eventType, ...(await ref(eventType, eventRef)) } as RuleEvent,
				condition: { type: condType, ...(await ref(condType, condValue)) } as RuleCondition,
				actions: (await Promise.all(actions.map(async (a) => ({ type: a.type, ...(await ref(a.type, a.ref)) })))) as RuleAction[],
			});
			ruleName = eventRef = condValue = '';
			eventType = 'bookmarkAdded';
			condType = 'alwaysTrue';
			actions = [{ type: 'addTag', ref: '' }];
		}, 'Rule saved.')
	);

	const toggleRule = (r: Rule) => run(() => api.rules.update.mutate({ ...r, enabled: !r.enabled }));

	/** Plain-English summary of a rule. */
	function describe(r: Rule): string {
		const tag = (id: string) => `#${tags.items.find((t) => t.id === id)?.name ?? '?'}`;
		const list = (id: string) => lists.items.find((l) => l.id === id)?.name ?? '?';
		const ev = r.event;
		const when =
			ev.type === 'tagAdded' ? `${tag(ev.tagId)} is added` : ev.type === 'tagRemoved' ? `${tag(ev.tagId)} is removed`
			: ev.type === 'addedToList' ? `added to ${list(ev.listId)}` : ev.type === 'removedFromList' ? `removed from ${list(ev.listId)}`
			: ev.type === 'bookmarkAdded' ? 'a bookmark is saved' : ev.type === 'favourited' ? 'favourited' : 'archived';
		const c = r.condition;
		const cond = c.type === 'alwaysTrue' ? '' : ` and ${c.type}${'str' in c ? ` "${c.str}"` : 'tagId' in c ? ` ${tag(c.tagId)}` : 'bookmarkType' in c ? ` ${c.bookmarkType}` : 'source' in c ? ` ${c.source}` : ''}`;
		const then = r.actions
			.map((a) => ('tagId' in a ? `${a.type} ${tag(a.tagId)}` : 'listId' in a ? `${a.type} ${list(a.listId)}` : a.type))
			.join(', ');
		return `When ${when}${cond}: ${then}`;
	}

	const box = 'rounded-lg border bg-card p-4';
	const input = 'rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent';
	const btn = 'rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50';
	const icon = 'grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground pointer-coarse:size-10';
</script>

{#snippet refPicker(type: string, get: () => string, set: (v: string) => void)}
	{#if needsTag(type)}
		<input value={get()} oninput={(e) => set(e.currentTarget.value)} list="all-tags" required placeholder="tag" aria-label="Tag" class="{input} w-36" />
	{:else if needsList(type)}
		<select value={get()} onchange={(e) => set(e.currentTarget.value)} required aria-label="List" class={input}>
			<option value="" disabled>list…</option>
			{#each lists.items as l (l.id)}<option value={l.id}>{l.icon} {l.name}</option>{/each}
		</select>
	{:else if needsText(type)}
		<input value={get()} oninput={(e) => set(e.currentTarget.value)} required placeholder="text" aria-label="Text" class="{input} w-36" />
	{:else if type === 'importedFromFeed'}
		<select value={get()} onchange={(e) => set(e.currentTarget.value)} required aria-label="Feed" class={input}>
			<option value="" disabled>feed…</option>
			{#each feeds as f (f.id)}<option value={f.id}>{f.name}</option>{/each}
		</select>
	{:else if type === 'bookmarkTypeIs'}
		<select value={get()} onchange={(e) => set(e.currentTarget.value)} required aria-label="Type" class={input}>
			<option value="" disabled>type…</option>
			{#each ['link', 'text', 'asset'] as t (t)}<option value={t}>{t}</option>{/each}
		</select>
	{:else if type === 'bookmarkSourceIs'}
		<select value={get()} onchange={(e) => set(e.currentTarget.value)} required aria-label="Source" class={input}>
			<option value="" disabled>source…</option>
			{#each ['web', 'extension', 'mobile', 'api', 'cli', 'rss', 'import'] as t (t)}<option value={t}>{t}</option>{/each}
		</select>
	{/if}
{/snippet}

<datalist id="all-tags">{#each tags.items as t (t.id)}<option value={t.name}></option>{/each}</datalist>

<div class="mx-auto grid max-w-3xl gap-6 pb-16">
	<section class="{box} grid gap-3">
		<h2 class="font-semibold">AI tags & summaries</h2>
		{#if status}
			<p class="text-sm text-muted-foreground">
				{#if status.ai}Using <b class="text-foreground">{AI_NAMES[status.ai]}</b> (<code>{status.model}</code>). Add <code>ANTHROPIC_API_KEY</code>, <code>OPENAI_API_KEY</code> or <code>GEMINI_API_KEY</code> as a Worker secret to use your own model; <code>AI_MODEL</code> picks a different one.
				{:else}Off on this server (<code>ZEROSTASH_AI=off</code>).{/if}
			</p>
		{/if}
		{#if settings}
			{@const s = settings}
			<label class="flex items-center gap-2 text-sm"><input type="checkbox" checked={s.autoTaggingEnabled !== false} onchange={(e) => run(() => api.users.updateSettings.mutate({ autoTaggingEnabled: e.currentTarget.checked }))} /> Tag new bookmarks automatically</label>
			<label class="flex items-center gap-2 text-sm"><input type="checkbox" checked={s.autoSummarizationEnabled !== false} onchange={(e) => run(() => api.users.updateSettings.mutate({ autoSummarizationEnabled: e.currentTarget.checked }))} /> Summarize new bookmarks automatically</label>
			<label class="flex items-center gap-2 text-sm">
				Tag style
				<select value={s.tagStyle} onchange={(e) => run(() => api.users.updateSettings.mutate({ tagStyle: e.currentTarget.value as Settings['tagStyle'] }))} class={input}>
					{#each TAG_STYLES as t (t)}<option value={t}>{t}</option>{/each}
				</select>
			</label>
		{/if}
	</section>

	<section class="{box} grid gap-3">
		<h2 class="font-semibold">RSS feeds</h2>
		<p class="text-sm text-muted-foreground">Checked about hourly. New posts are saved as bookmarks.</p>
		{#each feeds as f (f.id)}
			<div class="flex items-center gap-2 text-sm">
				<input type="checkbox" checked={f.enabled} onchange={() => run(() => api.feeds.update.mutate({ feedId: f.id, enabled: !f.enabled }))} aria-label="Enabled" />
				<div class="min-w-0 flex-1">
					<p class="truncate font-medium">{f.name}</p>
					<p class="truncate text-xs text-muted-foreground">{f.url} · {f.lastFetchedStatus ?? 'not fetched yet'}{f.lastFetchedAt ? ` ${f.lastFetchedAt.toLocaleString()}` : ''}</p>
				</div>
				<button onclick={() => run(() => api.feeds.fetchNow.mutate({ feedId: f.id }), 'Fetching…')} aria-label="Fetch now" title="Fetch now" class={icon}><RefreshCw class="size-4" /></button>
				<button onclick={() => run(() => api.feeds.delete.mutate({ feedId: f.id }))} aria-label="Unsubscribe" title="Unsubscribe (its bookmarks stay)" class={icon}><Trash2 class="size-4" /></button>
			</div>
		{/each}
		<form onsubmit={addFeed} class="flex flex-wrap items-center gap-2">
			<input bind:value={feedUrl} type="url" required placeholder="https://example.com/feed.xml" aria-label="Feed URL" class="{input} min-w-60 flex-1" />
			<input bind:value={feedName} placeholder="Name (optional)" aria-label="Feed name" class="{input} w-40" />
			<label class="flex items-center gap-1.5 text-sm"><input type="checkbox" bind:checked={feedTags} /> Import categories as tags</label>
			<button class={btn}>Subscribe</button>
		</form>
	</section>

	<section class="{box} grid gap-3">
		<h2 class="font-semibold">Rules</h2>
		{#each rules as r (r.id)}
			<div class="flex items-center gap-2 text-sm">
				<input type="checkbox" checked={r.enabled} onchange={() => toggleRule(r)} aria-label="Enabled" />
				<div class="min-w-0 flex-1">
					<p class="truncate font-medium">{r.name}</p>
					<p class="text-xs text-muted-foreground">{describe(r)}</p>
				</div>
				<button onclick={() => run(() => api.rules.delete.mutate({ id: r.id }))} aria-label="Delete rule" class={icon}><Trash2 class="size-4" /></button>
			</div>
		{/each}
		<form onsubmit={addRule} class="grid gap-2 rounded-md border border-dashed p-3 text-sm">
			<input bind:value={ruleName} required placeholder="Rule name" aria-label="Rule name" class={input} />
			<div class="flex flex-wrap items-center gap-2">
				<span class="w-12 text-muted-foreground">When</span>
				<select bind:value={eventType} onchange={() => (eventRef = '')} aria-label="Event" class={input}>
					<option value="bookmarkAdded">a bookmark is saved</option>
					<option value="favourited">it's favourited</option>
					<option value="archived">it's archived</option>
					<option value="tagAdded">a tag is added</option>
					<option value="tagRemoved">a tag is removed</option>
					<option value="addedToList">it's added to a list</option>
					<option value="removedFromList">it's removed from a list</option>
				</select>
				{@render refPicker(eventType, () => eventRef, (v) => (eventRef = v))}
			</div>
			<div class="flex flex-wrap items-center gap-2">
				<span class="w-12 text-muted-foreground">If</span>
				<select bind:value={condType} onchange={() => (condValue = '')} aria-label="Condition" class={input}>
					<option value="alwaysTrue">always</option>
					<option value="urlContains">URL contains</option>
					<option value="urlDoesNotContain">URL doesn't contain</option>
					<option value="titleContains">title contains</option>
					<option value="titleDoesNotContain">title doesn't contain</option>
					<option value="hasTag">it has tag</option>
					<option value="importedFromFeed">it came from feed</option>
					<option value="bookmarkTypeIs">its type is</option>
					<option value="bookmarkSourceIs">it was saved from</option>
					<option value="isFavourited">it's a favourite</option>
					<option value="isArchived">it's archived</option>
				</select>
				{@render refPicker(condType, () => condValue, (v) => (condValue = v))}
			</div>
			{#each actions as a, i (i)}
				<div class="flex flex-wrap items-center gap-2">
					<span class="w-12 text-muted-foreground">{i ? 'and' : 'Then'}</span>
					<select bind:value={a.type} onchange={() => (a.ref = '')} aria-label="Action" class={input}>
						<option value="addTag">add tag</option>
						<option value="removeTag">remove tag</option>
						<option value="addToList">add to list</option>
						<option value="removeFromList">remove from list</option>
						<option value="favouriteBookmark">favourite it</option>
						<option value="archiveBookmark">archive it</option>
					</select>
					{@render refPicker(a.type, () => a.ref, (v) => (a.ref = v))}
					{#if actions.length > 1}<button type="button" onclick={() => actions.splice(i, 1)} aria-label="Remove action" class={icon}><Trash2 class="size-4" /></button>{/if}
				</div>
			{/each}
			<div class="flex gap-2">
				<button type="button" onclick={() => actions.push({ type: 'addTag', ref: '' })} class="flex items-center gap-1 rounded-md px-2 py-1.5 text-muted-foreground hover:bg-muted"><Plus class="size-4" />Action</button>
				<button class="{btn} ml-auto"><Play class="mr-1 inline size-3.5" />Save rule</button>
			</div>
		</form>
	</section>

	<section class="{box} grid gap-3">
		<h2 class="font-semibold">Webhooks</h2>
		<p class="text-sm text-muted-foreground">
			POSTs <code>{'{ bookmarkId, url, type, operation }'}</code> to your URL, with <code>Authorization: Bearer &lt;token&gt;</code> if you set one.
		</p>
		{#each webhooks as w (w.id)}
			<div class="flex items-center gap-2 text-sm">
				<div class="min-w-0 flex-1">
					<p class="truncate font-medium">{w.url}</p>
					<p class="text-xs text-muted-foreground">{w.events.join(', ')}{w.hasToken ? ' · with token' : ''}</p>
				</div>
				<button onclick={() => run(() => api.webhooks.delete.mutate({ webhookId: w.id }))} aria-label="Delete webhook" class={icon}><Trash2 class="size-4" /></button>
			</div>
		{/each}
		<form onsubmit={addHook} class="grid gap-2 text-sm">
			<div class="flex flex-wrap gap-2">
				<input bind:value={hookUrl} type="url" required placeholder="https://example.com/hook" aria-label="Webhook URL" class="{input} min-w-60 flex-1" />
				<input bind:value={hookToken} placeholder="Token (optional)" aria-label="Token" class="{input} w-44" />
			</div>
			<div class="flex flex-wrap items-center gap-3">
				{#each EVENTS as ev (ev)}
					<label class="flex items-center gap-1.5"><input type="checkbox" bind:group={hookEvents} value={ev} />{ev}</label>
				{/each}
				<button disabled={!hookEvents.length} class="{btn} ml-auto">Add webhook</button>
			</div>
		</form>
	</section>
	{#if status}<p class="text-center text-xs text-muted-foreground">Zerostash v{status.version}</p>{/if}
</div>
