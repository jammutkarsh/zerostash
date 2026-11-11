import { enrich } from './src/lib/enrich';
import { saveLink, saveSelection, saveTab } from './src/lib/save';
import { getSettings } from './src/lib/settings';

const ALARM = 'zerostash-og';
const BRIDGE_ID = 'zerostash-bridge';

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
	chrome.contextMenus.removeAll(() => {
		chrome.contextMenus.create({ id: 'save-page', title: 'Save page to Zerostash', contexts: ['page'] });
		chrome.contextMenus.create({ id: 'save-link', title: 'Save link to Zerostash', contexts: ['link'] });
		chrome.contextMenus.create({ id: 'save-selection', title: 'Save selection to Zerostash as a note', contexts: ['selection'] });
	});
	await setup();
	if (reason === 'install') await chrome.runtime.openOptionsPage();
});

chrome.runtime.onStartup.addListener(setup);

async function setup() {
	await chrome.alarms.create(ALARM, { periodInMinutes: 5 });
	await syncBridge();
}

/**
 * The web UI posts `zerostash:saved` after a save; this content script on the server's
 * origin relays it so previews are fetched within seconds instead of at the next alarm.
 * Needs host permission for the server (covered by the optional <all_urls> grant).
 */
async function syncBridge() {
	await chrome.scripting.unregisterContentScripts({ ids: [BRIDGE_ID] }).catch(() => {});
	const { serverUrl } = await getSettings();
	if (!serverUrl) return;
	const { protocol, hostname } = new URL(serverUrl);
	const matches = [`${protocol}//${hostname}/*`]; // match patterns can't carry a port
	if (!(await chrome.permissions.contains({ origins: matches }))) return;
	await chrome.scripting.registerContentScripts([{ id: BRIDGE_ID, matches, js: ['bridge.js'], runAt: 'document_idle' }]);
}

chrome.alarms.onAlarm.addListener((alarm) => {
	if (alarm.name === ALARM) void enrich().catch(() => {});
});

chrome.runtime.onMessage.addListener((message: { type?: string }, _sender, sendResponse) => {
	if (message?.type === 'enrich') {
		enrich().then((filled) => sendResponse({ filled }), (e) => sendResponse({ error: String(e) }));
		return true; // async response
	}
	if (message?.type === 'settings-changed') {
		syncBridge().then(() => sendResponse({ ok: true }), (e) => sendResponse({ error: String(e) }));
		return true;
	}
});

async function flash(text: string, color: string) {
	await chrome.action.setBadgeBackgroundColor({ color });
	await chrome.action.setBadgeText({ text });
	setTimeout(() => void chrome.action.setBadgeText({ text: '' }), 2500);
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
	try {
		if (info.menuItemId === 'save-page' && tab) await saveTab(tab);
		else if (info.menuItemId === 'save-link' && info.linkUrl) await saveLink(info.linkUrl);
		else if (info.menuItemId === 'save-selection' && info.selectionText) await saveSelection(info.selectionText, tab);
		await flash('✓', '#16a34a');
		void enrich().catch(() => {});
	} catch (e) {
		console.warn('Zerostash save failed', e);
		await flash('!', '#dc2626');
	}
});
