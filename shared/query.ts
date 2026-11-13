// Search query language (Karakeep's syntax), used by search and by smart lists.
//   free text, "quoted phrase"          anywhere in title, URL, description, note, text, tags, ...
//   is:fav|archived|tagged|inlist|link|text|media|broken   has:notes|highlights
//   url:  title:  #tag / tag:  list:  feed:  source:   values may be "quoted"
//   after:YYYY-MM-DD  before:YYYY-MM-DD  age:<7d / age:>1y   (d, w, m, y)
//   -term negates; terms side by side mean AND; `and`, `or` and (parentheses) group.
// Parsing never fails: anything unrecognised is searched as text. Evaluated as SQL on the
// server (server/domain/search.ts) and as a predicate in the web app (web/lib/match.ts);
// server/domain/search.test.ts runs the same cases through both.

export type IsValue = 'fav' | 'archived' | 'tagged' | 'inlist' | 'link' | 'text' | 'media' | 'broken';
export type FieldKey = 'url' | 'title' | 'tag' | 'list' | 'feed' | 'source';

export type Query =
	| { k: 'all' }
	| { k: 'and' | 'or'; of: Query[] }
	| { k: 'not'; of: Query }
	| { k: 'text'; v: string }
	| { k: 'is'; v: IsValue }
	| { k: 'has'; v: 'notes' | 'highlights' }
	| { k: FieldKey; v: string }
	| { k: 'after' | 'before'; v: number } // created_at >= v / created_at < v (ms)
	| { k: 'age'; op: '<' | '>'; ms: number }; // younger / older than `ms`

const IS: Record<string, IsValue> = {
	fav: 'fav',
	favourited: 'fav',
	favorited: 'fav',
	archived: 'archived',
	tagged: 'tagged',
	inlist: 'inlist',
	link: 'link',
	text: 'text',
	media: 'media',
	broken: 'broken',
};
const FIELDS = new Set<string>(['url', 'title', 'tag', 'list', 'feed', 'source']);
const DAY = 86_400_000;
const AGE_UNIT: Record<string, number> = { d: DAY, w: 7 * DAY, m: 30 * DAY, y: 365 * DAY };

type Token = { t: '(' | ')'; neg: boolean } | { t: 'term'; neg: boolean; raw: string; quoted: boolean };

function tokenize(input: string): Token[] {
	const out: Token[] = [];
	let i = 0;
	while (i < input.length) {
		const c = input[i];
		if (/\s/.test(c)) {
			i++;
			continue;
		}
		if (c === ')') {
			out.push({ t: ')', neg: false });
			i++;
			continue;
		}
		const neg = c === '-' && i + 1 < input.length && !/\s/.test(input[i + 1]);
		if (neg) i++;
		if (input[i] === '(') {
			out.push({ t: '(', neg });
			i++;
			continue;
		}
		let raw = '';
		const quoted = input[i] === '"';
		while (i < input.length && !/[\s()]/.test(input[i])) {
			if (input[i] === '"') {
				const end = input.indexOf('"', i + 1);
				raw += end === -1 ? input.slice(i + 1) : input.slice(i + 1, end);
				i = end === -1 ? input.length : end + 1;
			} else raw += input[i++];
		}
		if (raw) out.push({ t: 'term', neg, raw, quoted });
	}
	return out;
}

function dateOf(v: string): number | undefined {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
	const ms = Date.parse(`${v}T00:00:00Z`); // ponytail: dates are UTC days, not the user's timezone
	return Number.isNaN(ms) ? undefined : ms;
}

function termNode(raw: string, quoted: boolean): Query {
	if (!quoted && raw.length > 1 && raw[0] === '#') return { k: 'tag', v: raw.slice(1) };
	const colon = quoted ? -1 : raw.indexOf(':');
	if (colon > 0 && colon < raw.length - 1) {
		const key = raw.slice(0, colon).toLowerCase();
		const value = raw.slice(colon + 1);
		const lower = value.toLowerCase();
		if (key === 'is' && IS[lower]) return { k: 'is', v: IS[lower] };
		if (key === 'has' && (lower === 'notes' || lower === 'highlights')) return { k: 'has', v: lower };
		if (FIELDS.has(key)) return { k: key as FieldKey, v: value };
		if (key === 'after' || key === 'before') {
			const day = dateOf(value);
			if (day !== undefined) return key === 'after' ? { k: 'after', v: day } : { k: 'before', v: day + DAY };
		}
		const age = key === 'age' ? /^([<>])(\d{1,5})([dwmy])$/.exec(lower) : null;
		if (age) return { k: 'age', op: age[1] as '<' | '>', ms: Number(age[2]) * AGE_UNIT[age[3]] };
	}
	return { k: 'text', v: raw };
}

const all = (of: Query[]): Query => (of.length === 0 ? { k: 'all' } : of.length === 1 ? of[0] : { k: 'and', of });
const any = (of: Query[]): Query => (of.length === 1 ? of[0] : { k: 'or', of });
const isOp = (tok: Token | undefined, op: 'and' | 'or') => tok?.t === 'term' && !tok.neg && !tok.quoted && tok.raw.toLowerCase() === op;

export function parseQuery(input: string): Query {
	const toks = tokenize(input);
	let pos = 0;

	function or(): Query {
		const parts = [and()];
		while (isOp(toks[pos], 'or')) {
			pos++;
			parts.push(and());
		}
		return any(parts);
	}
	function and(): Query {
		const parts: Query[] = [];
		while (pos < toks.length && toks[pos].t !== ')' && !isOp(toks[pos], 'or')) {
			if (isOp(toks[pos], 'and')) {
				pos++;
				continue;
			}
			parts.push(unary());
		}
		return all(parts);
	}
	function unary(): Query {
		const tok = toks[pos++];
		let node: Query;
		if (tok.t === '(') {
			node = or();
			if (toks[pos]?.t === ')') pos++;
		} else node = termNode((tok as Extract<Token, { t: 'term' }>).raw, (tok as Extract<Token, { t: 'term' }>).quoted);
		return tok.neg ? { k: 'not', of: node } : node;
	}

	const parts: Query[] = [];
	while (pos < toks.length) {
		if (toks[pos].t === ')') {
			pos++; // stray closing parenthesis
			continue;
		}
		parts.push(or());
	}
	return all(parts);
}

/** ASCII-only lowercase: matches SQLite's LIKE and NOCASE, which fold ASCII letters only. */
export const fold = (s: string) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());
