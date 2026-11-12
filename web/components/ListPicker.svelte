<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import ListPlus from '@lucide/svelte/icons/list-plus';
	import Plus from '@lucide/svelte/icons/plus';
	import type { Bookmark, List } from '../../shared/schemas';
	import { lists, setInList } from '../lib/store.svelte';
	import ListDialog from './ListDialog.svelte';
	import Menu from './Menu.svelte';

	// Card button: tick the manual lists this bookmark belongs to. Changes apply instantly.
	let { bookmark, buttonClass }: { bookmark: Bookmark; buttonClass: string } = $props();
	let creating = $state(false);

	const manual = $derived(lists.items); // smart lists take hand-picked bookmarks too
	const depth = (l: List): number => {
		let d = 0;
		for (let p = l.parentId; p && d < 10; p = lists.items.find((x) => x.id === p)?.parentId ?? null) d++;
		return d;
	};
	/** Parents before children, siblings by name. */
	const ordered = $derived.by(() => {
		const out: List[] = [];
		const walk = (parent: string | null) => {
			for (const l of manual.filter((x) => (x.parentId ?? null) === parent)) {
				out.push(l);
				walk(l.id);
			}
		};
		walk(null);
		// Lists whose parent is missing still need a place.
		for (const l of manual) if (!out.includes(l)) out.push(l);
		return out;
	});
	const inLists = $derived(bookmark.listIds.length > 0);
</script>

<Menu label="Add to list" buttonClass="{buttonClass} {inLists ? 'text-accent' : 'text-muted-foreground hover:text-foreground'}" panelClass="right-0 top-full mt-1" flipClass="right-0 bottom-full mb-1">
	{#snippet trigger()}<ListPlus class="size-4" />{/snippet}
	{#snippet children(close)}
		<p class="px-2.5 pt-1 pb-1.5 text-xs font-semibold text-muted-foreground">Add to list</p>
		<div class="max-h-64 overflow-y-auto">
			{#each ordered as l (l.id)}
				{@const member = bookmark.listIds.includes(l.id)}
				<button
					onclick={() => setInList(bookmark.id, l.id, !member)}
					role="menuitemcheckbox"
					aria-checked={member}
					class="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left hover:bg-muted"
					style="padding-left: {0.625 + depth(l) * 0.875}rem"
				>
					<span class="w-4 shrink-0 text-center">{l.icon || (l.kind === 'smart' ? '🔎' : '📁')}</span>
					<span class="min-w-0 flex-1 truncate">{l.name}</span>
					{#if member}<Check class="size-4 shrink-0 text-accent" />{/if}
				</button>
			{:else}
				<p class="px-2.5 py-1.5 text-sm text-muted-foreground">No lists yet.</p>
			{/each}
		</div>
		<div class="mt-1 border-t pt-1">
			<button onclick={() => (close(), (creating = true))} class="flex w-full items-center gap-2 rounded px-2.5 py-1.5 hover:bg-muted">
				<Plus class="size-4" />New list…
			</button>
		</div>
	{/snippet}
</Menu>

<ListDialog bind:open={creating} onCreated={(l) => setInList(bookmark.id, l.id, true)} />
