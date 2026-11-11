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
