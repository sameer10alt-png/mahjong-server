import { shantenKokushi } from '../analysis';
import { handCounts, interpretations, winningKinds, type Interpretation } from '../hand';
import { idxIsDragon, idxIsWind, idxTermOrHonor, isJoker, windIdx } from '../tiles';
import type { ScoreLine } from '../types';
import type { Scored, Variant, WinContext } from '../variant';

const LIMIT = 1000;
const WIND = ['East', 'South', 'West', 'North'];
const DRAGON = ['Red', 'Green', 'White'];

interface Tally {
	points: [string, number][];
	doubles: [string, number][];
	limit?: string;
}

function common(ctx: WinContext, t: Tally) {
	t.points.push(['Mahjong', 20]);
	if (ctx.selfDraw) t.points.push(['Self-draw', 2]);
	const seatNo = String(ctx.seatWind + 1);
	for (const f of ctx.flowers) t.points.push([`Flower`, 4]);
	for (const set of ['f', 's']) {
		const fl = ctx.flowers.filter((x) => x.k[0] === set);
		if (fl.length === 4) t.doubles.push([set === 'f' ? 'All four flowers' : 'All four seasons', 2]);
		else if (fl.some((x) => x.k === set + seatNo)) t.doubles.push([set === 'f' ? 'Own flower' : 'Own season', 1]);
	}
	if (ctx.melds.every((m) => m.concealed)) t.doubles.push(['Concealed hand', 1]);
	if (![...ctx.concealed, ...ctx.melds.flatMap((m) => m.tiles)].some((x) => isJoker(x.k))) t.doubles.push(['Natural hand (no jokers)', 1]);
	if (ctx.robbingKong) t.doubles.push(['Robbing the kong', 1]);
	if (ctx.afterKong && ctx.selfDraw) t.doubles.push(['Win on kong replacement', 1]);
	if (ctx.lastTile) t.doubles.push(['Last tile', 1]);
}

function evalStandard(ctx: WinContext, it: Interpretation, singleWait: boolean): Tally {
	const t: Tally = { points: [], doubles: [] };
	common(ctx, t);
	const seatW = windIdx(ctx.seatWind);
	const roundW = windIdx(ctx.roundWind);
	const pungs = it.groups.filter((g) => g.type !== 'chow');
	const chows = it.groups.filter((g) => g.type === 'chow');
	for (const g of pungs) {
		if (g.i < 0) {
			t.points.push(['Joker pung', 2]);
			continue;
		}
		let v = idxTermOrHonor(g.i) ? 4 : 2;
		if (!g.open && !g.jokers) v *= 2;
		if (g.type === 'kong') v *= 4;
		t.points.push([`${g.type === 'kong' ? 'Kong' : 'Pung'}${idxTermOrHonor(g.i) ? ' (terminal/honour)' : ''}${!g.open && !g.jokers ? ', concealed' : ''}`, v]);
		if (idxIsDragon(g.i)) t.doubles.push([`${DRAGON[g.i - 31]} dragon pung`, 1]);
		if (g.i === seatW) t.doubles.push([`Seat wind pung (${WIND[ctx.seatWind]})`, 1]);
		if (g.i === roundW) t.doubles.push([`Round wind pung (${WIND[ctx.roundWind]})`, 1]);
	}
	if (idxIsDragon(it.pair) || it.pair === seatW || it.pair === roundW) t.points.push(['Value pair', 2]);
	if (singleWait) t.points.push(['Single wait', 2]);

	if (chows.length === 0) t.doubles.push(['All pungs', 1]);
	if (pungs.length === 0 && !(idxIsDragon(it.pair) || it.pair === seatW || it.pair === roundW)) t.doubles.push(['All chows', 1]);

	const all = [...it.groups.filter((g) => g.i >= 0).flatMap((g) => (g.type === 'chow' ? [g.i, g.i + 1, g.i + 2] : [g.i])), it.pair];
	const suits = new Set(all.filter((i) => i < 27).map((i) => Math.floor(i / 9)));
	const honors = all.some((i) => i >= 27);
	if (suits.size === 0) t.limit = 'All honours';
	else if (suits.size === 1 && !honors) t.doubles.push(['Full flush', 3]);
	else if (suits.size === 1) t.doubles.push(['Half flush', 1]);

	const dragonPungs = pungs.filter((g) => g.i >= 0 && idxIsDragon(g.i)).length;
	const windPungs = pungs.filter((g) => g.i >= 0 && idxIsWind(g.i)).length;
	if (dragonPungs === 3) t.limit = 'Big three dragons';
	else if (dragonPungs === 2 && idxIsDragon(it.pair)) t.doubles.push(['Little three dragons', 1]);
	if (windPungs === 4) t.limit = 'Big four winds';
	else if (windPungs === 3 && idxIsWind(it.pair)) t.doubles.push(['Little four winds', 2]);
	if (ctx.firstGoAround && ctx.melds.length === 0 && ctx.selfDraw) t.limit = ctx.isDealer ? 'Heaven’s blessing' : 'Earth’s blessing';
	return t;
}

function total(t: Tally) {
	if (t.limit) return LIMIT;
	const pts = t.points.reduce((a, [, v]) => a + v, 0);
	const dbl = t.doubles.reduce((a, [, v]) => a + v, 0);
	return Math.min(LIMIT, Math.ceil((pts * Math.pow(2, dbl)) / 2) * 2);
}

export function scoreBombay(ctx: WinContext): Scored {
	const { counts, jokers } = handCounts(ctx.concealed);
	const tallies: Tally[] = [];
	if (ctx.melds.length === 0 && jokers === 0 && shantenKokushi(counts) === -1) {
		const t: Tally = { points: [], doubles: [], limit: 'Thirteen orphans' };
		tallies.push(t);
	}
	const its = interpretations(ctx.concealed, ctx.melds, 4, ctx.winTile.k, ctx.selfDraw);
	if (its.length) {
		const without = ctx.concealed.filter((x) => x.id !== ctx.winTile.id);
		const single = winningKinds(without, ctx.melds.length, 4).length === 1;
		for (const it of its) tallies.push(evalStandard(ctx, it, single));
	}
	if (!tallies.length) return { valid: false, reason: 'Not a complete hand', lines: [], total: 0, summary: '' };
	let best = tallies[0];
	for (const t of tallies) if (total(t) > total(best)) best = t;
	const value = total(best);
	const lines: ScoreLine[] = best.limit
		? [{ name: best.limit, value: 'Limit' }]
		: [
				...best.points.map(([name, v]) => ({ name, value: v })),
				...best.doubles.map(([name, v]) => ({ name, value: `×${Math.pow(2, v)}` }))
			];
	return { valid: true, lines, total: value, summary: value >= LIMIT ? `Limit · ${LIMIT}` : `${value} points` };
}

export const bombay: Variant = {
	id: 'bombay',
	name: 'Bombay Traditional',
	tagline: 'The classic club game. Jokers, flowers and a Goulash round.',
	handSize: 13,
	sets: 4,
	wall: { flowers: true, jokers: 8, redFives: false },
	reserve: 14,
	allowChow: true,
	multipleWinners: false,
	startScore: 0,
	riichi: false,
	goulash: true,
	streakOnDraw: false,
	bustOut: false,
	shantenSpecials: { orphans: true },
	special: (counts, jokers, meldCount) => (meldCount === 0 && jokers === 0 && shantenKokushi(counts) === -1 ? 'special' : null),
	scoreWin: scoreBombay,
	settleWin(state, wins) {
		const deltas = [0, 0, 0, 0];
		for (const w of wins) {
			for (let s = 0; s < 4; s++) {
				if (s === w.seat) continue;
				let pay = w.scored.total;
				if (s === state.dealer || w.seat === state.dealer) pay *= 2;
				if (w.from === s) pay *= 2;
				pay = Math.min(pay, LIMIT * 4);
				deltas[s] -= pay;
				deltas[w.seat] += pay;
			}
		}
		return { deltas, notes: ['Dealer pays and collects double. The discarder pays double.'] };
	},
	settleDraw() {
		return { deltas: [0, 0, 0, 0], notes: ['Wall game. The next hand is a Goulash: pass three tiles right, across and left before play.'], dealerKeeps: true };
	},
	rulesSummary: [
		'152 tiles: the 136 standard tiles, eight flowers and eight jokers.',
		'Each player holds 13 tiles; a win is four sets and a pair.',
		'Jokers stand in for any tile in a pung or kong, never in a pair or a chow. A discarded joker is dead.',
		'You may claim a pung with one natural tile plus a joker.',
		'Score = points × 2 per double, up to a limit of 1,000. Dealer pays and collects double; the discarder pays double.',
		'After a drawn hand (wall game) the next hand is a Goulash: everyone passes three tiles right, across, then left.',
		'Bombay house rules vary from club to club. Treat these as a starting point.'
	],
	scoringTable: [
		{ name: 'Mahjong', value: '20' },
		{ name: 'Self-draw', value: '2' },
		{ name: 'Flower', value: '4 each' },
		{ name: 'Pung: simple / terminal or honour', value: '2 / 4 (×2 concealed natural)' },
		{ name: 'Kong', value: '×4 the pung value' },
		{ name: 'Value pair / Single wait', value: '2 / 2' },
		{ name: 'Dragon, seat wind or round wind pung', value: '1 double each' },
		{ name: 'Own flower or season', value: '1 double' },
		{ name: 'All four flowers / seasons', value: '2 doubles' },
		{ name: 'Concealed hand / Natural hand (no jokers)', value: '1 double each' },
		{ name: 'All pungs / All chows', value: '1 double' },
		{ name: 'Half flush / Full flush', value: '1 / 3 doubles' },
		{ name: 'Little three dragons / Little four winds', value: '1 / 2 doubles' },
		{ name: 'Robbing the kong / Kong replacement / Last tile', value: '1 double' },
		{ name: 'Limit: Big three dragons, Big four winds, All honours, Thirteen orphans, Heaven’s/Earth’s blessing', value: '1,000' }
	]
};
