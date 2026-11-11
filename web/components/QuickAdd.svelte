<script lang="ts">
	import type { Bookmark } from '../../shared/schemas';
	import { isHttpUrl } from '../../shared/og';
	import { api, notifyExtension } from '../lib/api';
	import { watchPreview } from '../lib/preview';

	let { onSaved }: { onSaved: (b: Bookmark) => void } = $props();
	let value = $state('');
	let busy = $state(false);
	let message = $state('');

	async function save() {
		const input = value.trim();
		if (!input || busy) return;
		busy = true;
		message = '';
		try {
			const { bookmark, alreadyExists } = isHttpUrl(input)
				? await api.create({ type: 'link', url: input, source: 'web' })
				: await api.create({ type: 'text', text: input, source: 'web' });
			value = '';
			onSaved(bookmark);
			if (alreadyExists) message = 'Already saved.';
			if (bookmark.ogStatus === 'pending') {
				notifyExtension();
				watchPreview(bookmark.id, onSaved);
			}
		} catch (e) {
			message = String(e);
		} finally {
			busy = false;
		}
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			void save();
		}
	}
</script>

<div class="mb-4 break-inside-avoid rounded-xl border bg-card p-3 shadow-sm">
	<textarea
		bind:value
		{onkeydown}
		rows="3"
		placeholder="Paste a link or write a note… (Enter to save, Shift+Enter for a new line)"
		class="w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground"
	></textarea>
	<div class="flex items-center justify-between gap-2">
		<span class="text-xs text-muted-foreground">{message}</span>
		<button
			onclick={save}
			disabled={busy || !value.trim()}
			class="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
		>
			{busy ? 'Saving…' : 'Save'}
		</button>
	</div>
</div>
