import { legal, variantOf, winContext } from './game';
import { shantenOf, winningKinds } from './hand';
import { idxIsDragon, idxTermOrHonor, isJoker, KIND_INDEX, KINDS34, windIdx, type Tile } from './tiles';
import type { Action, BotLevel, ClaimOption, GameState } from './types';

const rand = () => Math.random();

function visibleCounts(s: GameState, seat: number): number[] {
	const seen = new Array(34).fill(0);
	const add = (t: Tile) => {
		const i = KIND_INDEX[t.k];
		if (i !== undefined) seen[i]++;
	};
	s.players[seat].hand.forEach(add);
	for (const p of s.players) {
		p.discards.forEach((d) => add(d.tile));
		p.melds.forEach((m) => m.tiles.forEach(add));
	}
	s.dora.forEach(add);
	return seen;
}

function shanten(s: GameState, tiles: Tile[], meldCount: number) {
	const v = variantOf(s);
	return shantenOf(tiles, meldCount, v.sets, v.shantenSpecials).shanten;
}

function ukeire(s: GameState, tiles: Tile[], meldCount: number, sh: number, seen: number[]): number {
	let total = 0;
	for (let i = 0; i < 34; i++) {
		const left = 4 - seen[i];
		if (left <= 0) continue;
		const probe = [...tiles, { id: -1, k: KINDS34[i] }];
		if (shanten(s, probe, meldCount) < sh) total += left;
	}
	return total;
}

/** Value heuristics: keep honour pairs that score, lean towards a dominant suit. */
function valueBias(s: GameState, seat: number, tiles: Tile[], discard: Tile): number {
	const v = variantOf(s);
	const i = KIND_INDEX[discard.k];
	if (i === undefined) return 0;
	const count = tiles.filter((t) => t.k === discard.k).length + 1;
	const valuable = idxIsDragon(i) || i === windIdx((seat - s.dealer + 4) % 4) || i === windIdx(s.round);
	// Taiwanese tables with a round minimum need bigger hands, so value matters more.
	const greedy = v.id === 'taiwanese' && s.opts.minimum ? 3 : 1;
	let bias = 0;
	if (valuable && count >= 2) bias -= 40 * greedy;
	else if (valuable && greedy > 1) bias -= 15;
	if (v.id !== 'riichi') {
		// suit focus for flush / semi-pure hands
		const suitCount = [0, 0, 0];
		for (const t of tiles) {
			const k = KIND_INDEX[t.k];
			if (k !== undefined && k < 27) suitCount[Math.floor(k / 9)]++;
		}
		const main = suitCount.indexOf(Math.max(...suitCount));
		const total = suitCount.reduce((a, b) => a + b, 0);
		const threshold = greedy > 1 ? 0.5 : 0.6;
		if (i < 27 && suitCount[main] >= total * threshold) bias += (Math.floor(i / 9) === main ? -15 : 15) * greedy * greedy;
	} else {
		if (idxTermOrHonor(i) && !valuable) bias += 5; // drift toward tanyao
	}
	return bias;
}

function danger(s: GameState, seat: number, t: Tile, seen: number[]): number {
	const threats = s.players.filter((p, i) => i !== seat && (p.riichi || p.melds.length >= (variantOf(s).sets === 5 ? 4 : 3)));
	if (!threats.length) return 0;
	const i = KIND_INDEX[t.k];
	if (i === undefined) return 0;
	let d = 0;
	for (const p of threats) {
		if (p.discards.some((x) => x.tile.k === t.k)) continue; // genbutsu
		if (i >= 27) d += seen[i] >= 3 ? 1 : seen[i] === 2 ? 3 : 6;
		else if (i % 9 === 0 || i % 9 === 8) d += 6;
		else d += 10;
	}
	return d;
}

/**
 * With a round minimum, a ready hand whose wins are all too small is close to worthless.
 * Returns a penalty for keeping such a hand.
 */
function deadReadyPenalty(s: GameState, seat: number, rest: Tile[]): number {
	const v = variantOf(s);
	if (v.id !== 'taiwanese' || !s.opts.minimum) return 0;
	const p = s.players[seat];
	const waits = winningKinds(rest, p.melds.length, v.sets, v.special);
	if (!waits.length) return 0;
	let ron = false;
	let tsumo = false;
	for (const k of waits) {
		const t: Tile = { id: -2, k };
		const concealed = [...rest, t];
		if (!tsumo && v.scoreWin(winContext(s, seat, concealed, t, null)).valid) tsumo = true;
		if (!ron && v.scoreWin(winContext(s, seat, concealed, t, (seat + 2) % 4)).valid) ron = true;
		if (ron) break;
	}
	if (ron) return 0;
	return tsumo ? 250 : 900;
}

interface Choice {
	tile: Tile;
	score: number;
	sh: number;
}

function rankDiscards(s: GameState, seat: number, ids: number[], level: BotLevel): Choice[] {
	const p = s.players[seat];
	const seen = visibleCounts(s, seat);
	const byKind = new Map<string, Choice>();
	const cands = p.hand.filter((t) => ids.includes(t.id));
	for (const t of cands) {
		if (byKind.has(t.k + (t.red ? 'r' : ''))) continue;
		const rest = p.hand.filter((x) => x.id !== t.id);
		const sh = shanten(s, rest, p.melds.length);
		let score = -sh * 1000;
		if (isJoker(t.k)) score -= 5000;
		if (t.red) score -= 30;
		if (level !== 'beginner') score += ukeire(s, rest, p.melds.length, sh, seen) * 10;
		if (level !== 'beginner') score += valueBias(s, seat, rest, t);
		if (level !== 'beginner' && sh === 0) score -= deadReadyPenalty(s, seat, rest);
		if (level === 'expert') {
			if (sh >= 2) score -= danger(s, seat, t, seen) * 60;
			else if (sh === 1) score -= danger(s, seat, t, seen) * 15;
		}
		if (level === 'beginner') score += rand() * 300;
		else score += rand() * 2;
		byKind.set(t.k + (t.red ? 'r' : ''), { tile: t, score, sh });
	}
	return [...byKind.values()].sort((a, b) => b.score - a.score);
}

function openingIsWorthIt(s: GameState, seat: number, option: ClaimOption, level: BotLevel, before: number, after: number): boolean {
	if (after >= before) return false;
	if (level === 'beginner') return rand() < 0.8;
	const v = variantOf(s);
	const p = s.players[seat];
	const tile = s.claim!.tile;
	const i = KIND_INDEX[tile.k];
	const valuable = i !== undefined && (idxIsDragon(i) || i === windIdx((seat - s.dealer + 4) % 4) || i === windIdx(s.round));
	const alreadyOpen = p.melds.some((m) => !m.concealed);
	if (option.type !== 'chow' && valuable) return true;
	const all = [...p.hand, ...p.melds.flatMap((m) => m.tiles), tile];
	const suitCount = [0, 0, 0];
	let honors = 0;
	let termHonor = 0;
	for (const t of all) {
		const k = KIND_INDEX[t.k];
		if (k === undefined) continue;
		if (k >= 27) honors++;
		else suitCount[Math.floor(k / 9)]++;
		if (idxTermOrHonor(k)) termHonor++;
	}
	const flushPath = Math.max(...suitCount) + honors >= all.length - 2;
	if (v.id === 'riichi') {
		const hasYakuhaiMeld = p.melds.some((m) => {
			const k = KIND_INDEX[m.tiles[0].k];
			return m.type !== 'chow' && (idxIsDragon(k) || k === windIdx((seat - s.dealer + 4) % 4) || k === windIdx(s.round));
		});
		const tanyaoPath = termHonor <= 1 && !idxTermOrHonor(i);
		return hasYakuhaiMeld || tanyaoPath || flushPath;
	}
	if (v.id === 'taiwanese') {
		if (flushPath) return true;
		if (option.type !== 'chow' && p.melds.every((m) => m.type !== 'chow') && alreadyOpen) return true;
		return alreadyOpen && after <= 1;
	}
	return option.type !== 'chow' || alreadyOpen || after <= 1;
}

function decideClaim(s: GameState, seat: number, level: BotLevel): Action {
	const L = legal(s, seat);
	const win = L.claims.find((c) => c.type === 'win');
	if (win) return { t: 'claim', option: win };
	const p = s.players[seat];
	const before = shanten(s, p.hand, p.melds.length);
	let best: { option: ClaimOption; after: number } | null = null;
	for (const option of L.claims) {
		const rest = p.hand.filter((t) => !option.use.includes(t.id));
		let after: number;
		if (option.type === 'kong') after = shanten(s, rest, p.melds.length + 1);
		else {
			after = 99;
			for (const d of rest) {
				if (isJoker(d.k)) continue;
				after = Math.min(after, shanten(s, rest.filter((x) => x.id !== d.id), p.melds.length + 1));
			}
		}
		if (!openingIsWorthIt(s, seat, option, level, before, after)) continue;
		if (!best || after < best.after || (after === best.after && option.type !== 'chow')) best = { option, after };
	}
	return best ? { t: 'claim', option: best.option } : { t: 'pass' };
}

function decideTurn(s: GameState, seat: number, level: BotLevel): Action {
	const L = legal(s, seat);
	if (L.tsumo) return { t: 'tsumo' };
	const p = s.players[seat];
	if (level !== 'beginner' && L.kongs.length) {
		const before = shanten(s, p.hand, p.melds.length);
		for (const k of L.kongs) {
			const four = p.hand.filter((t) => t.k === k);
			const rest = four.length === 4 ? p.hand.filter((t) => t.k !== k) : p.hand.filter((t) => t.id !== four[0].id);
			const melds = four.length === 4 ? p.melds.length + 1 : p.melds.length;
			if (shanten(s, rest, melds) <= before) return { t: 'kong', kind: k };
		}
	}
	if (L.riichi.length && level !== 'beginner') {
		const ranked = rankDiscards(s, seat, L.riichi, level);
		if (ranked.length) return { t: 'discard', tile: ranked[0].tile.id, riichi: true };
	}
	const ranked = rankDiscards(s, seat, L.discard, level);
	return { t: 'discard', tile: ranked[0].tile.id };
}

function decidePass(s: GameState, seat: number, level: BotLevel): Action {
	const p = s.players[seat];
	const chosen: number[] = [];
	let hand = [...p.hand];
	for (let n = 0; n < 3; n++) {
		const fake: GameState = { ...s, players: s.players.map((q, i) => (i === seat ? { ...q, hand } : q)) };
		const ids = hand.filter((t) => !isJoker(t.k)).map((t) => t.id);
		const best = rankDiscards(fake, seat, ids, level)[0];
		chosen.push(best.tile.id);
		hand = hand.filter((t) => t.id !== best.tile.id);
	}
	return { t: 'pass3', tiles: chosen };
}

export function botAction(s: GameState, seat: number): Action {
	const level = s.players[seat].bot ?? 'intermediate';
	if (s.phase === 'passing') return decidePass(s, seat, level);
	if (s.phase === 'claim') return decideClaim(s, seat, level);
	if (s.phase === 'turn') return decideTurn(s, seat, level);
	return { t: 'next' };
}

/** Hint for the human: best discard according to the expert bot. */
export function suggestDiscard(s: GameState, seat: number): number | null {
	const L = legal(s, seat);
	if (!L.discard.length) return null;
	const ranked = rankDiscards(s, seat, L.discard, 'expert');
	return ranked[0]?.tile.id ?? null;
}
