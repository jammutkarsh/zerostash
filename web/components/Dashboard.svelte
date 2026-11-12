<script lang="ts">
	import { onMount } from 'svelte';
	import { api, ApiError } from '../lib/api';
	import Setup from './Setup.svelte';
	import Shell from './Shell.svelte';

	// Render straight away from cache; the session check runs in the background.
	// A 401 anywhere sends the API client to /login, so only "setup required" is handled here.
	let setup = $state(false);

	onMount(() => {
		api.me().catch((e) => {
			if (e instanceof ApiError && e.code === 'setup_required') setup = true;
		});
	});
</script>

{#if setup}<Setup />{:else}<Shell />{/if}
