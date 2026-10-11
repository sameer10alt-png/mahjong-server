import { shantenKokushi } from '../analysis';
import { handCounts, interpretations, winningKinds, type Interpretation, type ScoreGroup } from '../hand';
import { idxIsDragon, idxIsWind, idxTermOrHonor, KIND_INDEX, windIdx, type Tile } from '../tiles';
import type { GameState, ScoreLine } from '../types';
import type { Scored, Variant, WinContext } from '../variant';

const DRAGON_NAME: Record<number, string> = { 31: 'Red dragon', 32: 'Green dragon', 33: 'White dragon' };
const WIND = ['East', 'South', 'West', 'North'];

/** The kind index a dora indicator points at. */
export function doraOf(i: number): number {
	if (i < 27) return Math.floor(i / 9) * 9 + ((i % 9) + 1) % 9;
	if (i <= 30) return 27 + ((i - 27 + 1) % 4);
	// dragons: white -> green -> red -> white  (indices dr 31, dg 32, dw 33)
	return i === 33 ? 32 : i === 32 ? 31 : 33;
}

const ceil100 = (n: number) => Math.ceil(n / 100) * 100;

function groupKinds(g: ScoreGroup): number[] {
	if (g.type === 'chow') return [g.i, g.i + 1, g.i + 2];
	return [g.i];
}

function isChiitoi(counts: number[]) {
	return counts.filter((n) => n === 2).length === 7;
}

function basicPoints(han: number, fu: number, yakuman: number): { basic: number; label: string } {
	if (yakuman > 0) return { basic: 8000 * yakuman, label: yakuman > 1 ? `${yakuman}× Yakuman` : 'Yakuman' };
	if (han >= 13) return { basic: 8000, label: 'Counted yakuman' };
	if (han >= 11) return { basic: 6000, label: 'Sanbaiman' };
	if (han >= 8) return { basic: 4000, label: 'Baiman' };
	if (han >= 6) return { basic: 3000, label: 'Haneman' };
	const b = fu * Math.pow(2, han + 2);
	if (han >= 5 || b >= 2000) return { basic: 2000, label: 'Mangan' };
	return { basic: b, label: `${han} han ${fu} fu` };
}

interface Eval {
	yaku: [string, number][];
	yakuman: [string, number][];
	fu: number;
}

function situational(ctx: WinContext, menzen: boolean, yaku: [string, number][], yakuman: [string, number][]) {
	const p = ctx.state.players[ctx.seat];
	if (p.riichi) {
		yaku.push(p.riichi.double ? ['Double riichi', 2] : ['Riichi', 1]);
		if (p.riichi.ippatsu) yaku.push(['Ippatsu', 1]);
	}
	if (menzen && ctx.selfDraw) yaku.push(['Menzen tsumo', 1]);
	if (ctx.lastTile && !ctx.afterKong) yaku.push(ctx.selfDraw ? ['Haitei (last tile)', 1] : ['Houtei (last discard)', 1]);
	if (ctx.afterKong && ctx.selfDraw) yaku.push(['Rinshan kaihou', 1]);
	if (ctx.robbingKong) yaku.push(['Chankan (robbing the kong)', 1]);
	if (ctx.firstGoAround && ctx.selfDraw && ctx.melds.length === 0) {
		yakuman.push(ctx.isDealer ? ['Tenhou (heavenly hand)', 1] : ['Chiihou (earthly hand)', 1]);
	}
}

function colorYaku(all: number[], menzen: boolean, yaku: [string, number][], yakuman: [string, number][]) {
	const suits = new Set(all.filter((i) => i < 27).map((i) => Math.floor(i / 9)));
	const honors = all.some((i) => i >= 27);
	if (suits.size === 0) yakuman.push(['Tsuuiisou (all honours)', 1]);
	else if (suits.size === 1) {
		if (honors) yaku.push(['Honitsu (half flush)', menzen ? 3 : 2]);
		else yaku.push(['Chinitsu (full flush)', menzen ? 6 : 5]);
	}
	if (all.every((i) => !idxTermOrHonor(i))) yaku.push(['Tanyao (all simples)', 1]);
	if (all.every((i) => i < 27 && (i % 9 === 0 || i % 9 === 8))) yakuman.push(['Chinroutou (all terminals)', 1]);
	const green = new Set([KIND_INDEX.b2, KIND_INDEX.b3, KIND_INDEX.b4, KIND_INDEX.b6, KIND_INDEX.b8, KIND_INDEX.dg]);
	if (all.every((i) => green.has(i))) yakuman.push(['Ryuuiisou (all green)', 1]);
}

function evalStandard(ctx: WinContext, it: Interpretation, menzen: boolean): Eval {
	const yaku: [string, number][] = [];
	const yakuman: [string, number][] = [];
	situational(ctx, menzen, yaku, yakuman);
	const seatW = windIdx(ctx.seatWind);
	const roundW = windIdx(ctx.roundWind);
	const gs = it.groups;
	const chows = gs.filter((g) => g.type === 'chow');
	const pungs = gs.filter((g) => g.type !== 'chow');
	const all = [...gs.flatMap(groupKinds), it.pair];

	// value honours
	for (const g of pungs) {
		if (idxIsDragon(g.i)) yaku.push([`Yakuhai: ${DRAGON_NAME[g.i]}`, 1]);
		if (g.i === seatW) yaku.push([`Yakuhai: seat wind ${WIND[ctx.seatWind]}`, 1]);
		if (g.i === roundW) yaku.push([`Yakuhai: round wind ${WIND[ctx.roundWind]}`, 1]);
	}
	const pairValue = idxIsDragon(it.pair) || it.pair === seatW || it.pair === roundW;
	const pinfu = menzen && chows.length === 4 && !pairValue && it.wait === 'ryanmen';
	if (pinfu) yaku.push(['Pinfu', 1]);

	if (menzen) {
		const byStart = new Map<number, number>();
		for (const c of chows) byStart.set(c.i, (byStart.get(c.i) ?? 0) + 1);
		const dup = [...byStart.values()].reduce((a, n) => a + Math.floor(n / 2), 0);
		if (dup === 2) yaku.push(['Ryanpeikou', 3]);
		else if (dup === 1) yaku.push(['Iipeikou', 1]);
	}
	for (let n = 0; n < 7; n++) {
		if ([0, 9, 18].every((s) => chows.some((c) => c.i === s + n))) {
			yaku.push(['Sanshoku doujun', menzen ? 2 : 1]);
			break;
		}
	}
	for (const s of [0, 9, 18]) {
		if ([0, 3, 6].every((o) => chows.some((c) => c.i === s + o))) yaku.push(['Ittsu (pure straight)', menzen ? 2 : 1]);
	}
	for (let n = 0; n < 9; n++) {
		if ([0, 9, 18].every((s) => pungs.some((g) => g.i === s + n))) yaku.push(['Sanshoku doukou', 2]);
	}
	if (pungs.length === 4) yaku.push(['Toitoi (all pungs)', 2]);
	const concealedPungs = pungs.filter((g) => !g.open).length;
	if (concealedPungs === 4) yakuman.push(['Suuankou (four concealed pungs)', 1]);
	else if (concealedPungs === 3) yaku.push(['Sanankou (three concealed pungs)', 2]);
	const kongs = gs.filter((g) => g.type === 'kong').length;
	if (kongs === 4) yakuman.push(['Suukantsu (four kongs)', 1]);
	else if (kongs === 3) yaku.push(['Sankantsu (three kongs)', 2]);

	const groupHasTerm = (g: ScoreGroup) => groupKinds(g).some(idxTermOrHonor);
	const hasHonor = all.some((i) => i >= 27);
	if (gs.every(groupHasTerm) && idxTermOrHonor(it.pair) && chows.length > 0) {
		if (hasHonor) yaku.push(['Chanta', menzen ? 2 : 1]);
		else yaku.push(['Junchan', menzen ? 3 : 2]);
	}
	if (chows.length === 0 && all.every(idxTermOrHonor) && hasHonor && all.some((i) => i < 27)) yaku.push(['Honroutou', 2]);

	const dragonPungs = pungs.filter((g) => idxIsDragon(g.i)).length;
	if (dragonPungs === 3) yakuman.push(['Daisangen (big three dragons)', 1]);
	else if (dragonPungs === 2 && idxIsDragon(it.pair)) yaku.push(['Shousangen (little three dragons)', 2]);
	const windPungs = pungs.filter((g) => idxIsWind(g.i)).length;
	if (windPungs === 4) yakuman.push(['Daisuushii (big four winds)', 2]);
	else if (windPungs === 3 && idxIsWind(it.pair)) yakuman.push(['Shousuushii (little four winds)', 1]);

	colorYaku(all, menzen, yaku, yakuman);

	if (menzen && ctx.melds.length === 0) {
		const { counts } = handCounts(ctx.concealed);
		for (const s of [0, 9, 18]) {
			const c = counts.slice(s, s + 9);
			if (c.reduce((a, b) => a + b, 0) !== 14) continue;
			const need = [3, 1, 1, 1, 1, 1, 1, 1, 3];
			if (need.every((n, i) => c[i] >= n)) yakuman.push(['Chuuren poutou (nine gates)', 1]);
		}
	}

	// fu
	let fu = 20;
	if (pinfu && ctx.selfDraw) fu = 20;
	else {
		if (menzen && !ctx.selfDraw) fu += 10;
		if (ctx.selfDraw && !pinfu) fu += 2;
		for (const g of pungs) {
			let f = 2;
			if (idxTermOrHonor(g.i)) f *= 2;
			if (!g.open) f *= 2;
			if (g.type === 'kong') f *= 4;
			fu += f;
		}
		if (idxIsDragon(it.pair)) fu += 2;
		if (it.pair === seatW) fu += 2;
		if (it.pair === roundW) fu += 2;
		if (it.wait === 'kanchan' || it.wait === 'penchan' || it.wait === 'tanki') fu += 2;
		if (fu === 20 && !menzen) fu = 30;
		fu = Math.ceil(fu / 10) * 10;
	}
	return { yaku, yakuman, fu };
}

function doraCount(ctx: WinContext): { dora: number; red: number; ura: number } {
	const tiles: Tile[] = [...ctx.concealed, ...ctx.melds.flatMap((m) => m.tiles)];
	const kinds = tiles.map((t) => KIND_INDEX[t.k]);
	const count = (indicators: Tile[]) =>
		indicators.reduce((a, ind) => a + kinds.filter((k) => k === doraOf(KIND_INDEX[ind.k])).length, 0);
	const st = ctx.state;
	const ura = st.players[ctx.seat].riichi ? st.deadWall.slice(5, 5 + st.dora.length) : [];
	return { dora: count(st.dora), red: tiles.filter((t) => t.red).length, ura: count(ura) };
}

export function scoreRiichi(ctx: WinContext): Scored {
	const menzen = ctx.melds.every((m) => m.concealed);
	const { counts } = handCounts(ctx.concealed);
	const candidates: Eval[] = [];

	if (ctx.melds.length === 0 && shantenKokushi(counts) === -1) {
		const yakuman: [string, number][] = [['Kokushi musou (thirteen orphans)', 1]];
		situational(ctx, true, [], yakuman);
		candidates.push({ yaku: [], yakuman, fu: 30 });
	}
	if (ctx.melds.length === 0 && isChiitoi(counts)) {
		const yaku: [string, number][] = [['Chiitoitsu (seven pairs)', 2]];
		const yakuman: [string, number][] = [];
		situational(ctx, true, yaku, yakuman);
		const all = counts.flatMap((n, i) => (n ? [i] : []));
		colorYaku(all, true, yaku, yakuman);
		if (all.every(idxTermOrHonor) && all.some((i) => i >= 27) && all.some((i) => i < 27)) yaku.push(['Honroutou', 2]);
		candidates.push({ yaku, yakuman, fu: 25 });
	}
	for (const it of interpretations(ctx.concealed, ctx.melds, 4, ctx.winTile.k, ctx.selfDraw)) {
		candidates.push(evalStandard(ctx, it, menzen));
	}
	if (!candidates.length) return { valid: false, reason: 'Not a complete hand', lines: [], total: 0, summary: '' };

	const d = doraCount(ctx);
	let best: Scored | null = null;
	for (const c of candidates) {
		const ym = c.yakuman.reduce((a, [, n]) => a + n, 0);
		const yakuHan = c.yaku.reduce((a, [, n]) => a + n, 0);
		if (ym === 0 && yakuHan === 0) continue;
		const lines: ScoreLine[] = ym
			? c.yakuman.map(([n, m]) => ({ name: n, value: m > 1 ? `${m}× yakuman` : 'yakuman' }))
			: c.yaku.map(([n, h]) => ({ name: n, value: `${h} han` }));
		let han = yakuHan;
		if (!ym) {
			if (d.dora) lines.push({ name: 'Dora', value: `${d.dora} han` });
			if (d.red) lines.push({ name: 'Red fives', value: `${d.red} han` });
			if (d.ura) lines.push({ name: 'Ura dora', value: `${d.ura} han` });
			han += d.dora + d.red + d.ura;
			lines.push({ name: 'Fu', value: c.fu });
		}
		const { basic, label } = basicPoints(han, c.fu, ym);
		const total = ceil100(basic * (ctx.isDealer ? 6 : 4));
		if (!best || (best.basic ?? 0) < basic) {
			best = { valid: true, lines, total, basic, summary: `${label} · ${total.toLocaleString()}` };
		}
	}
	return best ?? { valid: false, reason: 'No yaku', lines: [], total: 0, summary: '' };
}

export const riichi: Variant = {
	id: 'riichi',
	name: 'Riichi Mahjong',
	tagline: "Japan's game. Tight, tactical, and the wait is everything.",
	handSize: 13,
	sets: 4,
	wall: { flowers: false, jokers: 0, redFives: true },
	reserve: 0,
	allowChow: true,
	multipleWinners: false,
	startScore: 25000,
	riichi: true,
	goulash: false,
	streakOnDraw: true,
	bustOut: true,
	shantenSpecials: { pairs: true, orphans: true },
	special: (counts, _j, meldCount) =>
		meldCount === 0 && (isChiitoi(counts) || shantenKokushi(counts) === -1) ? 'special' : null,
	scoreWin: scoreRiichi,
	settleWin(state: GameState, wins) {
		const deltas = [0, 0, 0, 0];
		const notes: string[] = [];
		const honba = state.streak;
		for (const w of wins) {
			const basic = w.scored.basic ?? 0;
			const dealerWin = w.seat === state.dealer;
			if (w.from !== null) {
				const pay = ceil100(basic * (dealerWin ? 6 : 4)) + 300 * honba;
				deltas[w.from] -= pay;
				deltas[w.seat] += pay;
			} else {
				for (let s = 0; s < 4; s++) {
					if (s === w.seat) continue;
					const pay = (dealerWin || s === state.dealer ? ceil100(basic * 2) : ceil100(basic)) + 100 * honba;
					deltas[s] -= pay;
					deltas[w.seat] += pay;
				}
			}
		}
		if (honba) notes.push(`Honba ${honba}: +${300 * honba}`);
		if (state.sticks) {
			deltas[wins[0].seat] += state.sticks * 1000;
			notes.push(`Riichi deposits: +${state.sticks * 1000}`);
		}
		return { deltas, notes, potTaken: true };
	},
	settleDraw(state) {
		const tenpai: number[] = [];
		state.players.forEach((p, s) => {
			if (winningKinds(p.hand, p.melds.length, 4, riichi.special).length > 0) tenpai.push(s);
		});
		const deltas = [0, 0, 0, 0];
		if (tenpai.length > 0 && tenpai.length < 4) {
			const gain = 3000 / tenpai.length;
			const loss = 3000 / (4 - tenpai.length);
			for (let s = 0; s < 4; s++) deltas[s] = tenpai.includes(s) ? gain : -loss;
		}
		return {
			deltas,
			tenpai,
			notes: [tenpai.length ? `Ready: ${tenpai.length} player(s)` : 'Nobody ready'],
			dealerKeeps: tenpai.includes(state.dealer)
		};
	},
	rulesSummary: [
		'136 tiles, no flowers. Three red fives count as bonus dora.',
		'Each player holds 13 tiles; a win is four sets and a pair (or seven pairs / thirteen orphans).',
		'You need at least one yaku to win. Dora add han but are not yaku.',
		'Declare riichi with a closed ready hand (costs 1,000 points) to gain a yaku and ura dora.',
		'Furiten: you cannot win off a discard if any of your winning tiles is in your own discards.',
		'Score = fu × 2^(han+2), capped at mangan and beyond. Dealer earns 1.5×.',
		'Starting points 25,000. East round only by default; the game ends early if someone goes below zero.'
	],
	scoringTable: [
		{ name: 'Riichi / Double riichi', value: '1 / 2 han' },
		{ name: 'Ippatsu', value: '1 han' },
		{ name: 'Menzen tsumo', value: '1 han' },
		{ name: 'Pinfu', value: '1 han' },
		{ name: 'Tanyao (all simples)', value: '1 han' },
		{ name: 'Iipeikou', value: '1 han' },
		{ name: 'Yakuhai (dragon, seat or round wind pung)', value: '1 han each' },
		{ name: 'Haitei / Houtei / Rinshan / Chankan', value: '1 han' },
		{ name: 'Chiitoitsu (seven pairs)', value: '2 han, 25 fu' },
		{ name: 'Toitoi / Sanankou / Sankantsu', value: '2 han' },
		{ name: 'Sanshoku doujun / Ittsu / Chanta', value: '2 han (1 open)' },
		{ name: 'Sanshoku doukou / Honroutou / Shousangen', value: '2 han' },
		{ name: 'Junchan / Honitsu', value: '3 han (2 open)' },
		{ name: 'Ryanpeikou', value: '3 han' },
		{ name: 'Chinitsu (full flush)', value: '6 han (5 open)' },
		{ name: 'Yakuman: Kokushi, Suuankou, Daisangen, Tsuuiisou, Ryuuiisou, Chinroutou, Chuuren, Suukantsu, Shousuushii, Tenhou, Chiihou', value: '8,000 base' },
		{ name: 'Daisuushii', value: 'Double yakuman' }
	]
};
