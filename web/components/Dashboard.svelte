<script lang="ts">
	import { onMount } from 'svelte';
	import { api, errorCode } from '../lib/api';
	import Setup from './Setup.svelte';
	import Shell from './Shell.svelte';

	// Render straight away from cache; the session check runs in the background.
	// A 401 anywhere sends the API client to /login, so only "setup required" is handled here.
	let setup = $state(false);

	onMount(() => {
		api.users.whoami.query().catch((e) => {
			if (errorCode(e) === 'PRECONDITION_FAILED') setup = true;
		});
	});
</script>

{#if setup}<Setup />{:else}<Shell />{/if}
