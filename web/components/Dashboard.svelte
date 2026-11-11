<script lang="ts">
	import { onMount } from 'svelte';
	import { api, ApiError } from '../lib/api';
	import { setSessionHint } from '../lib/session';
	import Setup from './Setup.svelte';
	import Shell from './Shell.svelte';

	// The API client already redirects to /login on 401; this only tells the
	// other states apart.
	let status = $state<'loading' | 'setup' | 'ready' | 'error'>('loading');
	let message = $state('');

	onMount(async () => {
		try {
			await api.me();
			setSessionHint(true);
			status = 'ready';
		} catch (e) {
			if (e instanceof ApiError && e.status === 401) return;
			status = e instanceof ApiError && e.code === 'setup_required' ? 'setup' : 'error';
			message = String(e);
		}
	});
</script>

{#if status === 'loading'}
	<div class="grid min-h-dvh place-items-center text-sm text-muted-foreground">Loading…</div>
{:else if status === 'setup'}
	<Setup />
{:else if status === 'error'}
	<div class="grid min-h-dvh place-items-center p-6 text-sm text-destructive">{message}</div>
{:else}
	<Shell />
{/if}
