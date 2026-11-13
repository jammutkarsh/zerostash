<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { errorMessage } from '../lib/api';
	import { navigate } from '../lib/router.svelte';
	import { deleteTag, renameTag, tags } from '../lib/store.svelte';
	import { toast } from '../lib/toast.svelte';

	// All tags, most used first. Rename inline; delete takes two clicks (it detaches from every bookmark).
	let filter = $state('');
	let editing = $state('');
	let draft = $state('');
	let confirming = $state('');
	const shown = $derived(tags.items.filter((t) => t.name.toLowerCase().includes(filter.trim().toLowerCase())));

	async function rename(id: string) {
		const name = draft.trim();
		editing = '';
		if (!name || tags.items.find((t) => t.id === id)?.name === name) return;
		try {
			await renameTag(id, name);
		} catch (e) {
			toast(`Couldn't rename: ${errorMessage(e)}`);
		}
	}

	async function remove(id: string) {
		if (confirming !== id) {
			confirming = id;
			setTimeout(() => confirming === id && (confirming = ''), 4000);
			return;
		}
		confirming = '';
		try {
			await deleteTag(id);
		} catch (e) {
			toast(`Couldn't delete: ${errorMessage(e)}`);
		}
	}
	const button = 'grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground pointer-coarse:size-10';
</script>

<div class="mx-auto grid max-w-2xl gap-3">
	<input
		bind:value={filter}
		type="search"
		placeholder="Filter tags"
		aria-label="Filter tags"
		class="rounded-md border bg-card px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-accent"
	/>
	<ul class="divide-y rounded-lg border bg-card">
		{#each shown as t (t.id)}
			<li class="flex items-center gap-2 px-3 py-1.5">
				{#if editing === t.id}
					<input
						bind:value={draft}
						{@attach (el) => el.focus()}
						onkeydown={(e) => (e.key === 'Enter' ? rename(t.id) : e.key === 'Escape' && (editing = ''))}
						onblur={() => rename(t.id)}
						maxlength="64"
						aria-label="Tag name"
						class="min-w-0 flex-1 rounded border bg-background px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-accent"
					/>
					<button onclick={() => rename(t.id)} aria-label="Save" class={button}><Check class="size-4" /></button>
				{:else}
					<a href="/dashboard/tags/{t.id}" onclick={(e) => (e.preventDefault(), navigate(`/dashboard/tags/${t.id}`))} class="min-w-0 flex-1 truncate text-sm hover:underline">#{t.name}</a>
					<span class="text-xs tabular-nums text-muted-foreground" title="{t.numBookmarksByAttachedType.human} by you, {t.numBookmarksByAttachedType.ai} by AI">{t.numBookmarks}</span>
					<button onclick={() => ((editing = t.id), (draft = t.name))} aria-label="Rename {t.name}" title="Rename" class={button}><Pencil class="size-3.5" /></button>
					<button
						onclick={() => remove(t.id)}
						aria-label="Delete {t.name}"
						title={confirming === t.id ? 'Click again to delete' : 'Delete'}
						class="{button} {confirming === t.id ? 'bg-destructive/10 text-destructive' : ''}"
					>
						<Trash2 class="size-3.5" />
					</button>
				{/if}
			</li>
		{:else}
			<li class="px-3 py-6 text-center text-sm text-muted-foreground">
				{tags.items.length ? 'No tag matches.' : 'No tags yet. Use the tag button on a bookmark to add one.'}
			</li>
		{/each}
	</ul>
</div>
