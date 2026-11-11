import type { Bookmark } from '../../shared/schemas';
import { api } from './api';

/**
 * After a web-UI save the extension (or, minutes later, the server) fills in the preview.
 * Poll briefly so the card updates without a reload; stop after ~30 s either way.
 */
export function watchPreview(id: string, onUpdate: (b: Bookmark) => void, tries = 10) {
	setTimeout(async () => {
		const b = await api.get(id).catch(() => null);
		if (!b) return;
		if (b.ogStatus !== 'pending') onUpdate(b);
		else if (tries > 1) watchPreview(id, onUpdate, tries - 1);
	}, 3000);
}
