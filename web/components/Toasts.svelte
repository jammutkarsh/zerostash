<script lang="ts">
	import { toasts } from '../lib/toast.svelte';
</script>

<div aria-live="polite" class="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4">
	{#each toasts as t (t.id)}
		<p class="pointer-events-auto rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground shadow-lg">{t.text}</p>
	{/each}
</div>
