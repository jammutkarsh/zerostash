<script lang="ts">
	import type { List } from '../../shared/schemas';
	import { navigate, route } from '../lib/router.svelte';
	import { createList, deleteList, lists, updateList } from '../lib/store.svelte';

	// Create or edit a list. `list` = edit mode. `onCreated` lets callers (the card's list
	// picker) act on the new list, e.g. add the bookmark to it.
	let {
		open = $bindable(false),
		list = null,
		onCreated,
	}: { open?: boolean; list?: List | null; onCreated?: (l: List) => void } = $props();

	const EMOJI = ['📚', '📌', '⭐', '💡', '🧠', '🛠️', '💻', '🎨', '🎵', '🎬', '📖', '📰', '🍳', '✈️', '🏠', '💼', '🧪', '🎮', '❤️', '🔥'];

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
		kind = list?.kind ?? 'manual';
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

	async function save(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		error = '';
		try {
			if (list) {
				await updateList(list.id, { name, icon: icon || null, parentId: parentId || null, ...(list.kind === 'smart' ? { query } : {}) });
			} else {
				const created = await createList({ name, icon: icon || undefined, parentId: parentId || null, kind, ...(kind === 'smart' ? { query } : {}) });
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

	const input = 'rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent/60';
	const field = `w-full ${input}`;
</script>

<svelte:window onkeydown={(e) => open && e.key === 'Escape' && (open = false)} />

{#if open}
	<div class="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onclick={(e) => e.target === e.currentTarget && (open = false)} role="presentation">
		<div role="dialog" aria-modal="true" aria-label={list ? 'Edit list' : 'New list'} class="w-full max-w-md">
		<form onsubmit={save} class="grid gap-4 rounded-xl border bg-card p-5 shadow-2xl">
			<h2 class="text-lg font-semibold">{list ? 'Edit list' : 'New list'}</h2>

			<div class="flex gap-2">
				<input bind:value={icon} maxlength="16" aria-label="Icon" placeholder="🙂" class="{input} w-14 shrink-0 px-0 text-center text-lg" />
				<input bind:this={nameEl} bind:value={name} required maxlength="100" aria-label="Name" placeholder="List name" class={field} />
			</div>
			<div class="flex flex-wrap gap-1">
				{#each EMOJI as e (e)}
					<button type="button" onclick={() => (icon = e)} class="grid size-8 place-items-center rounded-md text-lg hover:bg-muted {icon === e ? 'bg-muted ring-1 ring-accent' : ''}">{e}</button>
				{/each}
			</div>

			{#if !list}
				<div class="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 text-sm">
					{#each [['manual', 'Manual', 'You add bookmarks'], ['smart', 'Smart', 'Fills itself from a search']] as [value, label, hint] (value)}
						<button type="button" onclick={() => (kind = value as 'manual' | 'smart')} class="rounded-md px-3 py-1.5 text-left {kind === value ? 'bg-card shadow-sm' : 'text-muted-foreground'}">
							<span class="block font-medium">{label}</span><span class="text-xs text-muted-foreground">{hint}</span>
						</button>
					{/each}
				</div>
			{/if}

			{#if (list?.kind ?? kind) === 'smart'}
				<label class="grid gap-1.5 text-sm font-medium">
					Search
					<input bind:value={query} required maxlength="200" placeholder="e.g. cloudflare" class="{field} font-normal" />
					<span class="text-xs font-normal text-muted-foreground">Bookmarks whose title, link, description or note contain this.</span>
				</label>
			{/if}

			<label class="grid gap-1.5 text-sm font-medium">
				Inside
				<select bind:value={parentId} class="{field} font-normal">
					<option value="">Top level</option>
					{#each parents as p (p.id)}<option value={p.id}>{p.icon ? `${p.icon} ` : ''}{p.name}</option>{/each}
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
