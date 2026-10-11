import { decompose, shantenChiitoi, shantenKokushi, shantenStandard, type Decomp } from './analysis';
import { countsOf, isJoker, KIND_INDEX, KINDS34, type Kind, type Tile } from './tiles';
import type { Meld } from './types';

/** A set as seen by the scorers, whether it came from a meld or from the concealed hand. */
export interface ScoreGroup {
	type: 'chow' | 'pung' | 'kong';
	i: number; // 34-index (first tile for chows); -1 = all-joker pung
	open: boolean; // exposed meld, or a pung completed by someone else's discard
	concealedKong: boolean;
	jokers: number;
}

export type WaitType = 'tanki' | 'shanpon' | 'kanchan' | 'penchan' | 'ryanmen' | 'special';

export interface Interpretation {
	groups: ScoreGroup[];
	pair: number;
	wait: WaitType;
}

export function meldGroup(m: Meld): ScoreGroup {
	const natural = m.tiles.filter((t) => !isJoker(t.k));
	const kinds = natural.map((t) => KIND_INDEX[t.k]).sort((a, b) => a - b);
	return {
		type: m.type,
		i: kinds.length ? kinds[0] : -1,
		open: !m.concealed,
		concealedKong: m.type === 'kong' && m.concealed,
		jokers: m.tiles.length - natural.length
	};
}

export function handCounts(tiles: Tile[]) {
	return { counts: countsOf(tiles.map((t) => t.k)), jokers: tiles.filter((t) => isJoker(t.k)).length };
}

/** Every reading of a complete standard hand, with where the winning tile sat. */
export function interpretations(
	concealed: Tile[],
	melds: Meld[],
	sets: number,
	winKind: Kind,
	selfDraw: boolean
): Interpretation[] {
	const { counts, jokers } = handCounts(concealed);
	const need = sets - melds.length;
	const decomps = decompose(counts, need, jokers);
	const meldGroups = melds.map(meldGroup);
	const w = KIND_INDEX[winKind];
	const out: Interpretation[] = [];
	for (const d of decomps) {
		const base = d.groups.map(
			(g): ScoreGroup => ({ type: g.type, i: g.i, open: false, concealedKong: false, jokers: g.jokers ?? 0 })
		);
		const pushed = (groups: ScoreGroup[], wait: WaitType) =>
			out.push({ groups: [...meldGroups, ...groups], pair: d.pair, wait });
		let any = false;
		if (w === undefined) {
			pushed(base, 'tanki');
			continue;
		}
		if (d.pair === w) {
			pushed(base, 'tanki');
			any = true;
		}
		base.forEach((g, gi) => {
			if (g.type === 'pung' && g.i === w) {
				const groups = base.map((x, xi) => (xi === gi ? { ...x, open: !selfDraw } : x));
				pushed(groups, 'shanpon');
				any = true;
			}
			if (g.type === 'chow' && w >= g.i && w <= g.i + 2) {
				const pos = w - g.i;
				const n = (g.i % 9) + 1;
				let wait: WaitType = 'ryanmen';
				if (pos === 1) wait = 'kanchan';
				else if ((pos === 0 && n === 7) || (pos === 2 && n === 1)) wait = 'penchan';
				pushed(base, wait);
				any = true;
			}
		});
		if (!any) pushed(base, 'tanki'); // joker-completed shapes
	}
	return out;
}

export function isStandardComplete(concealed: Tile[], meldCount: number, sets: number): boolean {
	const { counts, jokers } = handCounts(concealed);
	return decompose(counts, sets - meldCount, jokers).length > 0;
}

export type SpecialShape = (counts: number[], jokers: number, meldCount: number) => string | null;

/** Kinds that would complete the hand (shape only). `tiles` is the hand without the winning tile. */
export function winningKinds(tiles: Tile[], meldCount: number, sets: number, special?: SpecialShape): Kind[] {
	const { counts, jokers } = handCounts(tiles);
	const need = sets - meldCount;
	if (shantenStandard(counts, need, jokers) > 0 && !special) return [];
	const res: Kind[] = [];
	for (let i = 0; i < 34; i++) {
		if (counts[i] >= 4) continue;
		counts[i]++;
		if (decompose(counts, need, jokers).length > 0 || (special && special(counts, jokers, meldCount))) res.push(KINDS34[i]);
		counts[i]--;
	}
	return res;
}

export interface ShantenInfo {
	shanten: number;
	kind: 'standard' | 'pairs' | 'orphans';
}

export function shantenOf(tiles: Tile[], meldCount: number, sets: number, specials: { pairs?: boolean; orphans?: boolean } = {}): ShantenInfo {
	const { counts, jokers } = handCounts(tiles);
	let best: ShantenInfo = { shanten: shantenStandard(counts, sets - meldCount, jokers), kind: 'standard' };
	if (meldCount === 0 && sets === 4) {
		if (specials.pairs) {
			const s = shantenChiitoi(counts);
			if (s < best.shanten) best = { shanten: s, kind: 'pairs' };
		}
		if (specials.orphans) {
			const s = shantenKokushi(counts);
			if (s < best.shanten) best = { shanten: s, kind: 'orphans' };
		}
	}
	return best;
}

export type { Decomp };
