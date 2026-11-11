<script lang="ts">
	import { onMount } from 'svelte';
	import Login from './components/Login.svelte';
	import Setup from './components/Setup.svelte';
	import Shell from './components/Shell.svelte';
	import { api, ApiError } from './lib/api';

	let status = $state<'loading' | 'login' | 'setup' | 'ready'>('loading');

	onMount(async () => {
		try {
			await api.me();
			status = 'ready';
		} catch (e) {
			status = e instanceof ApiError && e.code === 'setup_required' ? 'setup' : 'login';
		}
	});
</script>

{#if status === 'loading'}
	<div class="grid min-h-dvh place-items-center text-sm text-muted-foreground">Loading…</div>
{:else if status === 'setup'}
	<Setup />
{:else if status === 'login'}
	<Login onLogin={() => (status = 'ready')} />
{:else}
	<Shell onLogout={() => (status = 'login')} />
{/if}
