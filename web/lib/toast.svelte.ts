export type ToastAction = { label: string; run: () => void };

export const toasts = $state<{ id: number; text: string; action?: ToastAction }[]>([]);
let next = 0;

function dismiss(id: number) {
	const i = toasts.findIndex((t) => t.id === id);
	if (i !== -1) toasts.splice(i, 1);
}

export function toast(text: string, ms = 3500, action?: ToastAction) {
	const id = next++;
	toasts.push({ id, text, action: action && { label: action.label, run: () => (dismiss(id), action.run()) } });
	setTimeout(() => dismiss(id), ms);
	return id;
}

// Undo lives exactly as long as its toast: the button and ⌘Z / Ctrl+Z run the same thing, once.
const undoStack: { id: number; run: () => void }[] = [];

function take(id: number) {
	const i = undoStack.findIndex((u) => u.id === id);
	return i === -1 ? undefined : undoStack.splice(i, 1)[0];
}

export function undoToast(text: string, run: () => void, ms = 5000) {
	const id = toast(text, ms, { label: 'Undo', run: () => take(id)?.run() });
	undoStack.push({ id, run });
	setTimeout(() => take(id), ms);
}

/** Undo the most recent action that is still undoable. Returns false when there is none. */
export function undoLast(): boolean {
	const u = undoStack.pop();
	if (!u) return false;
	dismiss(u.id);
	u.run();
	return true;
}
