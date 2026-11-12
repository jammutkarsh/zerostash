<script lang="ts">
	let { open = $bindable(false) }: { open?: boolean } = $props();
	const mod = navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl';

	const sections: { title: string; keys: [string[], string][] }[] = [
		{
			title: 'Navigation',
			keys: [
				[['j', '↓'], 'Next row'],
				[['k', '↑'], 'Previous row'],
				[['h', '←'], 'Previous column'],
				[['l', '→'], 'Next column'],
				[['o', 'Enter'], 'Open bookmark'],
				[['Esc'], 'Clear selection'],
			],
		},
		{
			title: 'Actions',
			keys: [
				[['f'], 'Favourite'],
				[['a'], 'Archive'],
				[['c'], 'Copy link'],
				[['#', 'Delete'], 'Delete'],
				[[`${mod} Z`], 'Undo delete or archive'],
				[['n'], 'New item'],
			],
		},
		{
			title: 'Other',
			keys: [
				[[`${mod} K`, '/'], 'Search'],
				[['?'], 'Show this help'],
			],
		},
	];
</script>

<svelte:window onkeydown={(e) => open && e.key === 'Escape' && (open = false)} />

{#if open}
	<div class="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onclick={(e) => e.target === e.currentTarget && (open = false)} role="presentation">
		<div role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" class="w-full max-w-md rounded-xl border bg-card p-5 shadow-2xl">
			<h2 class="mb-4 text-lg font-semibold">Keyboard shortcuts</h2>
			<div class="grid gap-5">
				{#each sections as section (section.title)}
					<div>
						<h3 class="mb-1 text-sm font-semibold">{section.title}</h3>
						<div class="divide-y">
							{#each section.keys as [keys, description] (description)}
								<div class="flex items-center justify-between gap-4 py-1.5 text-sm">
									<span class="text-muted-foreground">{description}</span>
									<span class="flex items-center gap-1">
										{#each keys as key, i (key)}
											{#if i}<span class="text-xs text-muted-foreground">/</span>{/if}
											<kbd class="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">{key}</kbd>
										{/each}
									</span>
								</div>
							{/each}
						</div>
					</div>
				{/each}
			</div>
		</div>
	</div>
{/if}
