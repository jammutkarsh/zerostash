const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
// [unit, how many of this unit make the next one]
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
	['minute', 60],
	['hour', 24],
	['day', 7],
	['week', 5],
];

/** "just now", "3 hours ago", "yesterday"; a plain date once it's over ~a month old. */
export function relativeTime(ms: number, now = Date.now()): string {
	let value = (ms - now) / 60_000; // minutes
	if (Math.abs(value) < 1) return 'just now';
	for (const [unit, size] of UNITS) {
		if (Math.abs(value) < size) return rtf.format(Math.round(value), unit);
		value /= size;
	}
	return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Card-sized age: "now", "5m", "3h", "2d", "3w", then "12 Nov" / "12 Nov 2025". */
export function shortAge(ms: number, now = Date.now()): string {
	const minutes = Math.floor((now - ms) / 60_000);
	if (minutes < 1) return 'now';
	if (minutes < 60) return `${minutes}m`;
	if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h`;
	if (minutes < 60 * 24 * 7) return `${Math.floor(minutes / 1440)}d`;
	if (minutes < 60 * 24 * 30) return `${Math.floor(minutes / 10080)}w`;
	const d = new Date(ms);
	const sameYear = d.getFullYear() === new Date(now).getFullYear();
	return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
}
