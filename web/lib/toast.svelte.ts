export const toasts = $state<{ id: number; text: string }[]>([]);
let next = 0;

export function toast(text: string, ms = 3500) {
	const id = next++;
	toasts.push({ id, text });
	setTimeout(() => {
		const i = toasts.findIndex((t) => t.id === id);
		if (i !== -1) toasts.splice(i, 1);
	}, ms);
}
