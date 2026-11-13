<script lang="ts">
	import type { List } from '../../shared/schemas';
	import { navigate, route } from '../lib/router.svelte';
	import { createList, deleteList, lists, sync, updateList, viewItems } from '../lib/store.svelte';
	import EmojiPicker from './EmojiPicker.svelte';

	// Create or edit a list. `list` = edit mode. `onCreated` lets callers (the card's list
	// picker) act on the new list, e.g. add the bookmark to it.
	let {
		open = $bindable(false),
		list = null,
		onCreated,
	}: { open?: boolean; list?: List | null; onCreated?: (l: List) => void } = $props();

	let name = $state('');
	let icon = $state('');
	let parentId = $state('');
	let kind = $state<'manual' | 'smart'>('manual');
	let query = $state('');
	let error = $state('');
	let busy = $state(false);
	let nameEl = $state<HTMLInputElement>();

	// Reset the form each time the dialog opens.
	$effect(() => {
		if (!open) return;
		name = list?.name ?? '';
		icon = list?.icon ?? '';
		parentId = list?.parentId ?? '';
		kind = list?.type ?? 'manual';
		query = list?.query ?? '';
		error = '';
		queueMicrotask(() => nameEl?.focus());
	});

	/** Lists that can be a parent: not this list or anything inside it. */
	const parents = $derived.by(() => {
		if (!list) return lists.items;
		const blocked = new Set([list.id]);
		let grew = true;
		while (grew) {
			grew = false;
			for (const l of lists.items) if (l.parentId && blocked.has(l.parentId) && !blocked.has(l.id)) (blocked.add(l.id), (grew = true));
		}
		return lists.items.filter((l) => !blocked.has(l.id));
	});

	const smart = $derived((list?.type ?? kind) === 'smart');
	// Live preview over the local copy: the same matcher the list will use.
	const matches = $derived(smart && query.trim() && sync.complete ? viewItems({ view: 'home', q: query.trim() }).length : null);

	async function save(e: SubmitEvent) {
		e.preventDefault();
		if (smart && !query.trim()) return void (error = 'A smart list needs a search query.');
		busy = true;
		error = '';
		const finalIcon = icon || (smart ? '🔎' : '📁');
		try {
			if (list) {
				await updateList({ listId: list.id, name, icon: finalIcon, parentId: parentId || null, ...(smart ? { query: query.trim() } : {}) });
			} else {
				const created = await createList({ name, icon: finalIcon, parentId: parentId || null, type: kind, ...(smart ? { query: query.trim() } : {}) });
				onCreated?.(created);
			}
			open = false;
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			busy = false;
		}
	}

	async function remove() {
		if (!list) return;
		busy = true;
		try {
			await deleteList(list.id);
			if (route.path === `/dashboard/lists/${list.id}`) navigate('/dashboard');
			open = false;
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			busy = false;
		}
	}

	const input = 'rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent';
	const field = `w-full ${input}`;
</script>

<svelte:window onkeydown={(e) => open && e.key === 'Escape' && (open = false)} />

{#if open}
	<div class="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onclick={(e) => e.target === e.currentTarget && (open = false)} role="presentation">
		<div role="dialog" aria-modal="true" aria-label={list ? 'Edit list' : 'New list'} class="w-full max-w-md">
		<form onsubmit={save} class="grid gap-4 rounded-xl border bg-card p-5 shadow-2xl">
			<h2 class="text-lg font-semibold">{list ? 'Edit list' : 'New list'}</h2>

			<div class="flex gap-2">
				<EmojiPicker bind:value={icon} />
				<input bind:this={nameEl} bind:value={name} required maxlength="100" aria-label="Name" placeholder="List name" class={field} />
			</div>

			{#if !list}
				<div class="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 text-sm">
					{#each [['manual', 'Manual', 'You add bookmarks'], ['smart', 'Smart', 'Also fills itself from a search']] as [value, label, hint] (value)}
						<button type="button" onclick={() => (kind = value as 'manual' | 'smart')} class="rounded-md px-3 py-1.5 text-left {kind === value ? 'bg-card shadow-sm' : 'text-muted-foreground'}">
							<span class="block font-medium">{label}</span><span class="text-xs text-muted-foreground">{hint}</span>
						</button>
					{/each}
				</div>
			{/if}

			{#if smart}
				<label class="grid gap-1.5 text-sm font-medium">
					Search query
					<input bind:value={query} maxlength="1000" placeholder="e.g. postgres or #databases -is:archived" class="{field} font-mono font-normal" />
					<span class="text-xs font-normal text-muted-foreground">
						Words match anywhere (title, link, description, note, tags). Combine with <code>or</code>, <code>-</code> to exclude,
						<code>#tag</code>, <code>is:fav</code>, <code>is:archived</code>, <code>url:</code>, <code>list:"name"</code>, <code>after:2026-01-31</code>.
						Bookmarks you add by hand belong too.
						{#if matches !== null}<b class="text-foreground">{matches} {matches === 1 ? 'bookmark matches' : 'bookmarks match'} now.</b>{/if}
					</span>
				</label>
			{/if}

			<label class="grid gap-1.5 text-sm font-medium">
				Inside
				<select bind:value={parentId} class="{field} font-normal">
					<option value="">Top level</option>
					{#each parents as p (p.id)}<option value={p.id}>{p.icon} {p.name}</option>{/each}
				</select>
			</label>

			{#if error}<p class="text-sm text-destructive">{error}</p>{/if}

			<div class="flex items-center gap-2">
				{#if list}
					<button type="button" onclick={remove} disabled={busy} class="rounded-md px-3 py-2 text-sm text-destructive hover:bg-muted">Delete list</button>
				{/if}
				<button type="button" onclick={() => (open = false)} class="ml-auto rounded-md px-3 py-2 text-sm hover:bg-muted">Cancel</button>
				<button disabled={busy || !name.trim()} class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
					{list ? 'Save' : 'Create'}
				</button>
			</div>
			{#if list}<p class="-mt-2 text-xs text-muted-foreground">Deleting a list keeps its bookmarks.</p>{/if}
		</form>
		</div>
	</div>
{/if}
