<script lang="ts">
	import { api, ApiError } from '../lib/api';

	let { onLogin }: { onLogin: () => void } = $props();
	let secret = $state('');
	let error = $state('');
	let busy = $state(false);

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		error = '';
		try {
			await api.login(secret.trim());
			onLogin();
		} catch (err) {
			error = err instanceof ApiError && err.status === 401 ? "That secret doesn't match ZEROSTASH_SECRET." : String(err);
		} finally {
			busy = false;
		}
	}
</script>

<form onsubmit={submit} class="mx-auto grid min-h-dvh max-w-sm content-center gap-4 p-6">
	<div class="flex items-center gap-2">
		<img src="/favicon.svg" alt="" class="size-8" />
		<h1 class="text-2xl font-semibold">Zerostash</h1>
	</div>
	<label class="grid gap-1.5 text-sm font-medium">
		Secret
		<input
			type="password"
			bind:value={secret}
			required
			autocomplete="current-password"
			class="rounded-md border bg-card px-3 py-2 text-base font-normal outline-none focus:ring-2 focus:ring-accent"
		/>
	</label>
	{#if error}<p class="text-sm text-destructive">{error}</p>{/if}
	<button disabled={busy} class="rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground disabled:opacity-60">
		{busy ? 'Signing in…' : 'Sign in'}
	</button>
	<p class="text-xs text-muted-foreground">The value of ZEROSTASH_SECRET from your Cloudflare Worker.</p>
</form>
