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
}
