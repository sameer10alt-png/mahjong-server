import { idxTermOrHonor, sameSuit } from './tiles';

export interface Group {
	type: 'pung' | 'chow';
	/** first tile index (34-array); -1 for a pung made only of jokers */
	i: number;
	jokers?: number;
}

export interface Decomp {
	pair: number;
	groups: Group[];
}

const seqStart = (i: number) => i < 27 && i % 9 <= 6;

/**
 * All ways to split `counts` (+ `jokers` wild tiles) into exactly `sets` groups and one pair.
 * Jokers may stand in for pung/kong tiles only (never in pairs or chows).
 */
export function decompose(counts: number[], sets: number, jokers = 0): Decomp[] {
	const out: Decomp[] = [];
	const c = counts.slice();
	const groups: Group[] = [];
	let pair = -1;

	function rec(start: number, j: number) {
		let i = start;
		while (i < 34 && c[i] === 0) i++;
		if (i >= 34) {
			if (pair < 0) return;
			const left = sets - groups.length;
			if (left * 3 === j) {
				for (let n = 0; n < left; n++) groups.push({ type: 'pung', i: -1, jokers: 3 });
				out.push({ pair, groups: groups.map((g) => ({ ...g })) });
				groups.length -= left;
			}
			return;
		}
		if (groups.length > sets) return;
		// pair
		if (pair < 0 && c[i] >= 2) {
			pair = i;
			c[i] -= 2;
			rec(i, j);
			c[i] += 2;
			pair = -1;
		}
		// pung, possibly with jokers
		for (let used = 0; used <= Math.min(2, j); used++) {
			const nat = 3 - used;
			if (c[i] >= nat && groups.length < sets) {
				c[i] -= nat;
				groups.push(used ? { type: 'pung', i, jokers: used } : { type: 'pung', i });
				rec(i, j - used);
				groups.pop();
				c[i] += nat;
			}
		}
		// chow
		if (seqStart(i) && c[i + 1] > 0 && c[i + 2] > 0 && groups.length < sets) {
			c[i]--;
			c[i + 1]--;
			c[i + 2]--;
			groups.push({ type: 'chow', i });
			rec(i, j);
			groups.pop();
			c[i]++;
			c[i + 1]++;
			c[i + 2]++;
		}
	}
	rec(0, jokers);
	return out;
}

// ---------------- shanten ----------------
// Each part of the hand (three suits + honours) is solved independently and cached,
// then the (sets, partials, pair) options are combined. Shanten = 2N - 2m - min(t, N-m) - p.

type Opt = number; // packed m*100 + t*10 + p
const suitCache = new Map<string, Opt[]>();

function partOptions(c: number[], allowSeq: boolean): Opt[] {
	const key = (allowSeq ? 's' : 'h') + c.join('');
	const cached = suitCache.get(key);
	if (cached) return cached;
	const found = new Set<Opt>();
	const cc = c.slice();
	const L = cc.length;
	function rec(i: number, m: number, t: number, p: number) {
		while (i < L && cc[i] === 0) i++;
		if (i >= L) {
			found.add(m * 100 + Math.min(t, 9) * 10 + p);
			return;
		}
		if (cc[i] >= 3) {
			cc[i] -= 3;
			rec(i, m + 1, t, p);
			cc[i] += 3;
		}
		if (allowSeq && i + 2 < L && cc[i + 1] > 0 && cc[i + 2] > 0) {
			cc[i]--, cc[i + 1]--, cc[i + 2]--;
			rec(i, m + 1, t, p);
			cc[i]++, cc[i + 1]++, cc[i + 2]++;
		}
		if (cc[i] >= 2) {
			cc[i] -= 2;
			if (p === 0) rec(i, m, t, 1);
			rec(i, m, t + 1, p);
			cc[i] += 2;
		}
		if (allowSeq && i + 1 < L && cc[i + 1] > 0) {
			cc[i]--, cc[i + 1]--;
			rec(i, m, t + 1, p);
			cc[i]++, cc[i + 1]++;
		}
		if (allowSeq && i + 2 < L && cc[i + 2] > 0) {
			cc[i]--, cc[i + 2]--;
			rec(i, m, t + 1, p);
			cc[i]++, cc[i + 2]++;
		}
		cc[i]--;
		rec(i + (cc[i] === 0 ? 1 : 0), m, t, p);
		cc[i]++;
	}
	rec(0, 0, 0, 0);
	// drop dominated options
	const arr = [...found];
	const res = arr.filter((o) => {
		const [m, t, p] = [Math.floor(o / 100), Math.floor(o / 10) % 10, o % 10];
		return !arr.some((q) => {
			if (q === o) return false;
			const [m2, t2, p2] = [Math.floor(q / 100), Math.floor(q / 10) % 10, q % 10];
			return m2 >= m && m2 + t2 >= m + t && p2 >= p;
		});
	});
	if (suitCache.size > 200000) suitCache.clear();
	suitCache.set(key, res);
	return res;
}

/** Standard-shape shanten: `sets` groups + pair needed from the concealed counts. -1 = complete. */
export function shantenStandard(counts: number[], sets: number, jokers = 0): number {
	let states = new Set<Opt>([0]);
	const parts: number[][] = [counts.slice(0, 9), counts.slice(9, 18), counts.slice(18, 27)];
	const honors = counts.slice(27, 34);
	const all = [...parts.map((p) => partOptions(p, true)), partOptions(honors, false)];
	for (const opts of all) {
		const next = new Set<Opt>();
		for (const s of states) {
			const [m, t, p] = [Math.floor(s / 100), Math.floor(s / 10) % 10, s % 10];
			for (const o of opts) {
				const [m2, t2, p2] = [Math.floor(o / 100), Math.floor(o / 10) % 10, o % 10];
				if (p + p2 > 1) {
					// second pair counts as a partial set instead
					next.add((m + m2) * 100 + Math.min(9, t + t2 + 1) * 10 + 1);
				} else next.add((m + m2) * 100 + Math.min(9, t + t2) * 10 + (p + p2));
			}
		}
		states = next;
	}
	let best = 99;
	for (const s of states) {
		const [m, t, p] = [Math.floor(s / 100), Math.floor(s / 10) % 10, s % 10];
		const mm = Math.min(m, sets);
		const tt = Math.min(t + (m - mm), sets - mm);
		best = Math.min(best, 2 * sets - 2 * mm - tt - p);
	}
	return Math.max(-1, best - jokers);
}

export function shantenChiitoi(counts: number[]): number {
	let pairs = 0;
	let kinds = 0;
	for (const n of counts) {
		if (n > 0) kinds++;
		if (n >= 2) pairs++;
	}
	return 6 - pairs + Math.max(0, 7 - kinds);
}

export function shantenKokushi(counts: number[]): number {
	let kinds = 0;
	let pair = 0;
	for (let i = 0; i < 34; i++) {
		if (!idxTermOrHonor(i)) continue;
		if (counts[i] > 0) kinds++;
		if (counts[i] >= 2) pair = 1;
	}
	return 13 - kinds - pair;
}

export const sum = (c: number[]) => c.reduce((a, b) => a + b, 0);

export { sameSuit };
