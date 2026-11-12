<script lang="ts">
	import X from '@lucide/svelte/icons/x';

	// Tag-style input: type a term and press Enter or comma to add it as a chip.
	// Pasting "a, b, c" adds three. Backspace on an empty field removes the last chip.
	let { terms = $bindable([]), max = 10 }: { terms?: string[]; max?: number } = $props();
	let draft = $state('');
	let inputEl = $state<HTMLInputElement>();

	function add(raw: string) {
		for (const part of raw.split(',')) {
			const term = part.trim().slice(0, 100);
			if (term && terms.length < max && !terms.some((t) => t.toLowerCase() === term.toLowerCase())) terms = [...terms, term];
		}
		draft = '';
	}

	function onkeydown(e: KeyboardEvent) {
		if ((e.key === 'Enter' || e.key === ',') && draft.trim()) {
			e.preventDefault();
			add(draft);
		} else if (e.key === 'Enter') {
			// Empty field: let Enter submit the form.
		} else if (e.key === 'Backspace' && !draft && terms.length) {
			terms = terms.slice(0, -1);
		}
	}

	function onpaste(e: ClipboardEvent) {
		const text = e.clipboardData?.getData('text') ?? '';
		if (!text.includes(',')) return;
		e.preventDefault();
		add(draft + text);
	}
</script>

<div
	class="flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-md border bg-background px-2 py-1.5 text-sm focus-within:ring-2 focus-within:ring-accent/60"
	onclick={() => inputEl?.focus()}
	role="presentation"
>
	{#each terms as term (term)}
		<span class="flex items-center gap-1 rounded-full border bg-muted py-0.5 pr-1 pl-2.5 text-xs font-medium">
			{term}
			<button type="button" onclick={() => (terms = terms.filter((t) => t !== term))} aria-label="Remove {term}" class="rounded-full p-0.5 text-muted-foreground hover:bg-background hover:text-foreground">
				<X class="size-3" />
			</button>
		</span>
	{/each}
	{#if terms.length < max}
		<input
			bind:this={inputEl}
			bind:value={draft}
			{onkeydown}
			{onpaste}
			onblur={() => draft.trim() && add(draft)}
			aria-label="Add a search term"
			placeholder={terms.length ? 'Add another…' : 'e.g. cloudflare, workers, d1'}
			class="min-w-24 flex-1 bg-transparent py-0.5 outline-none placeholder:text-muted-foreground"
		/>
	{/if}
</div>
