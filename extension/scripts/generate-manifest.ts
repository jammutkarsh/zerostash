// Writes manifest.json for one browser target (PR Pulse unified-build pattern).
// Usage: bun scripts/generate-manifest.ts <chrome|firefox> <output-path>
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const [target, outputPath] = process.argv.slice(2);
if ((target !== 'chrome' && target !== 'firefox') || !outputPath) {
	throw new Error('Usage: bun scripts/generate-manifest.ts <chrome|firefox> <output-path>');
}

const root = resolve(import.meta.dirname, '..');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const icons = { '16': 'icons/icon16.png', '32': 'icons/icon32.png', '48': 'icons/icon48.png', '128': 'icons/icon128.png' };

const base = {
	manifest_version: 3,
	name: 'Zerostash – free bookmarks in your own Cloudflare',
	short_name: 'Zerostash',
	version,
	description: 'Free bookmarks in your own Cloudflare account. Save any page in one keystroke; right-click saves links and text.',
	// Only `activeTab` touches pages by default. `<all_urls>` is optional: requested at
	// onboarding to fetch link previews for bookmarks saved outside an open tab.
	permissions: ['storage', 'activeTab', 'scripting', 'contextMenus', 'alarms'],
	optional_host_permissions: ['<all_urls>'],
	action: { default_popup: 'popup/index.html', default_icon: icons, default_title: 'Save to Zerostash' },
	options_ui: { page: 'options/index.html', open_in_tab: true },
	commands: {
		// Mac: Cmd+Shift+E is free in Chrome and Firefox. Elsewhere Ctrl+Shift+E opens
		// Firefox's Network Monitor, so use Alt+Shift+E.
		_execute_action: { suggested_key: { default: 'Alt+Shift+E', mac: 'Command+Shift+E' }, description: 'Save the current page' },
	},
	icons,
};

const manifest =
	target === 'firefox'
		? {
				...base,
				background: { scripts: ['service-worker.js'], type: 'module' },
				browser_specific_settings: {
					gecko: {
						id: 'zerostash@utkarshchourasia.in',
						strict_min_version: '140.0',
						// The extension sends page URLs/titles and page metadata to the user's own server.
						data_collection_permissions: { required: ['browsingActivity', 'websiteContent'], optional: [] },
					},
				},
			}
		: { ...base, background: { service_worker: 'service-worker.js', type: 'module' } };

const out = resolve(root, outputPath);
mkdirSync(join(dirname(out), 'icons'), { recursive: true });
for (const file of readdirSync(join(root, 'icons'))) copyFileSync(join(root, 'icons', file), join(dirname(out), 'icons', file));
writeFileSync(out, `${JSON.stringify(manifest, null, '\t')}\n`);
console.log(`manifest (${target}) → ${outputPath}`);
