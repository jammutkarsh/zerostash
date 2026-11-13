import type { Bookmark } from '../../shared/schemas';
import { api } from './api';

/**
 * After a save the server fetches the link preview within seconds. Poll briefly so the card
 * updates without a reload; stop after ~30 s either way.
 */
export function watchPreview(id: string, onUpdate: (b: Bookmark) => void, tries = 10) {
	setTimeout(async () => {
		const b = await api.bookmarks.getBookmark.query({ bookmarkId: id }).catch(() => null);
		if (!b) return;
		if (b.content.type !== 'link' || b.content.crawlStatus !== 'pending') onUpdate(b);
		else if (tries > 1) watchPreview(id, onUpdate, tries - 1);
	}, 3000);
}
