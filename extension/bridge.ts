// Content script on the user's Zerostash origin only. Relays the web UI's
// `zerostash:saved` message to the background so link previews are fetched right away.
// Must stay import-free: it is injected as a classic script.
window.addEventListener('message', (event) => {
	if (event.source !== window || event.origin !== location.origin) return;
	if ((event.data as { type?: string } | null)?.type === 'zerostash:saved') {
		void chrome.runtime.sendMessage({ type: 'enrich' }).catch(() => {});
	}
});
