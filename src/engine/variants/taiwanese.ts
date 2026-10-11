import { handCounts, interpretations, winningKinds, type Interpretation } from '../hand';
import { idxIsDragon, idxIsWind, idxTermOrHonor, windIdx } from '../tiles';
import type { GameState, ScoreLine } from '../types';
import type { Scored, Variant, WinContext } from '../variant';

export const ROUND_MINIMUM = [20, 22, 24, 26];
const BASE = 5;
const WIND = ['East', 'South', 'West', 'North'];
const DRAGON = ['Red', 'Green', 'White'];

type Line = [string, number];

/** Seven pairs plus one pung, 17 tiles, fully concealed. */
function isNicoNico(counts: number[]) {
	let pairs = 0;
	let pungs = 0;
	for (const n of counts) {
		if (n === 2) pairs++;
		else if (n === 3) pungs++;
		else if (n === 4) pairs += 2;
		else if (n !== 0) return false;
	}
	return pairs === 7 && pungs === 1;
}

/** 13 terminals/honours + one duplicate + a set (17 tiles). */
function isThirteenOrphans(counts: number[]) {
	const c = counts.slice();
	for (let i = 0; i < 34; i++) if (idxTermOrHonor(i)) { if (!c[i]) return false; c[i]--; }
	// remaining 4 tiles: one more terminal/honour (pair) + a set
	for (let p = 0; p < 34; p++) {
		if (!idxTermOrHonor(p) || !c[p]) continue;
		c[p]--;
		const rest = c.flatMap((n, i) => Array(n).fill(i));
		const ok =
			rest.length === 3 &&
			((rest[0] === rest[1] && rest[1] === rest[2]) ||
				(rest[0] < 27 && rest[1] === rest[0] + 1 && rest[2] === rest[0] + 2 && Math.floor(rest[0] / 9) === Math.floor(rest[2] / 9)));
		c[p]++;
		if (ok) return true;
	}
	return false;
}

/** Three tiles per suit with gaps of at least 3, all seven honours, one duplicate. */
function isSixteenOrphans(counts: number[]) {
	if (counts.reduce((a, b) => a + b, 0) !== 17) return false;
	for (let i = 27; i < 34; i++) if (!counts[i]) return false;
	let dup = 0;
	for (let s = 0; s < 3; s++) {
		const nums: number[] = [];
		for (let n = 0; n < 9; n++) {
			const k = counts[s * 9 + n];
			if (k > 2) return false;
			if (k === 2) dup++;
			if (k) nums.push(n);
		}
		if (nums.length !== 3) return false;
		if (nums[1] - nums[0] < 3 || nums[2] - nums[1] < 3) return false;
	}
	for (let i = 27; i < 34; i++) {
		if (counts[i] > 2) return false;
		if (counts[i] === 2) dup++;
	}
	return dup === 1;
}

function flowerLines(ctx: WinContext, lines: Line[]) {
	const fl = ctx.flowers.map((t) => t.k);
	if (fl.length === 0) {
		lines.push(['No flowers', 1]);
		return;
	}
	const seatNo = String(ctx.seatWind + 1);
	for (const set of ['f', 's']) {
		const have = fl.filter((k) => k[0] === set).length;
		if (have === 4) lines.push([set === 'f' ? 'Bouquet of flowers' : 'Bouquet of seasons', 10]);
		else if (fl.includes(set + seatNo)) lines.push([set === 'f' ? 'Seat flower' : 'Seat season', 1]);
	}
}

function situational(ctx: WinContext, concealedHand: boolean, lines: Line[]) {
	if (ctx.selfDraw && concealedHand) lines.push(['Concealed self-draw', 10]);
	else if (ctx.selfDraw) lines.push(['Self-draw', 1]);
	else if (concealedHand) lines.push(['Concealed hand by discard', 5]);
	if (ctx.robbingKong) lines.push(['Robbing the gong', 10]);
	if (ctx.afterKong && ctx.selfDraw) lines.push(['Win on gong replacement', 10]);
	if (ctx.lastTile) lines.push(['Last tile', 10]);
	if (ctx.firstGoAround && ctx.melds.length === 0) {
		if (ctx.isDealer && ctx.selfDraw) lines.push(['Heavenly hand', 100]);
		else if (!ctx.isDealer) lines.push(['Earthly hand', 50]);
	}
}

function suitLines(all: number[], lines: Line[]) {
	const suits = new Set(all.filter((i) => i < 27).map((i) => Math.floor(i / 9)));
	const honors = all.some((i) => i >= 27);
	if (suits.size === 0) lines.push(['All honours', 140]);
	else if (suits.size === 1 && !honors) lines.push(['Pure suit hand', 40]);
	else if (suits.size === 1) lines.push(['Semi-pure hand', 15]);
	if (!honors) lines.push(['No honours', 1]);
	const hasWind = all.some(idxIsWind);
	const hasDragon = all.some(idxIsDragon);
	if (suits.size === 3 && hasWind && hasDragon) lines.push(['All five suits', 10]);
	if (all.every(idxTermOrHonor) && suits.size > 0 && honors) lines.push(['Terminals with honours', 30]);
	if (all.every((i) => i < 27 && (i % 9 === 0 || i % 9 === 8))) lines.push(['Terminals, no honours', 60]);
}

function evalStandard(ctx: WinContext, it: Interpretation, singleWait: boolean): Line[] {
	const lines: Line[] = [];
	const concealedHand = ctx.melds.every((m) => m.concealed);
	situational(ctx, concealedHand, lines);
	flowerLines(ctx, lines);
	const gs = it.groups;
	const pungs = gs.filter((g) => g.type !== 'chow');
	const chows = gs.filter((g) => g.type === 'chow');
	const all = [...gs.flatMap((g) => (g.type === 'chow' ? [g.i, g.i + 1, g.i + 2] : [g.i])), it.pair];

	const dragonPungs = pungs.filter((g) => idxIsDragon(g.i));
	const windPungs = pungs.filter((g) => idxIsWind(g.i));
	if (dragonPungs.length === 3) lines.push(['Big three dragons', 40]);
	else if (dragonPungs.length === 2 && idxIsDragon(it.pair)) lines.push(['Little three dragons', 20]);
	else for (const g of dragonPungs) lines.push([`${DRAGON[g.i - 31]} dragon pong`, 2]);

	if (windPungs.length === 4) lines.push(['Big four winds', 60]);
	else if (windPungs.length === 3 && idxIsWind(it.pair)) lines.push(['Little four winds', 40]);
	else if (windPungs.length === 3) lines.push(['Big three winds', 15]);
	else if (windPungs.length === 2 && idxIsWind(it.pair)) lines.push(['Little three winds', 10]);
	else {
		for (const g of windPungs) {
			if (g.i === windIdx(ctx.seatWind)) lines.push([`Seat wind pong (${WIND[ctx.seatWind]})`, 1]);
			if (g.i === windIdx(ctx.roundWind)) lines.push([`Round wind pong (${WIND[ctx.roundWind]})`, 1]);
		}
	}

	for (const g of gs.filter((g) => g.type === 'kong')) lines.push(g.concealedKong ? ['Concealed gong', 2] : ['Gong', 1]);

	if (chows.length === 0) lines.push(['All pong hand', 15]);
	if (pungs.length === 0 && it.pair < 27 && ctx.flowers.length === 0) lines.push(['All sequences, no flowers', 5]);
	else if (pungs.length === 0) lines.push(['All sequences', 3]);

	const concealedPungs = pungs.filter((g) => !g.open).length;
	if (concealedPungs >= 5) lines.push(['Five concealed pongs', 40]);
	else if (concealedPungs === 4) lines.push(['Four concealed pongs', 20]);
	else if (concealedPungs === 3) lines.push(['Three concealed pongs', 10]);

	// step-up: five chows whose starting numbers rise by one
	if (chows.length === 5) {
		const nums = chows.map((c) => c.i % 9).sort((a, b) => a - b);
		if (nums.every((n, i) => i === 0 || n === nums[i - 1] + 1)) lines.push(['All step-up', 20]);
	}
	for (let n = 0; n < 7; n++) {
		if ([0, 1, 2].every((s) => chows.some((c) => c.i === s * 9 + n + s))) {
			lines.push(['Three-suit step-up', 5]);
			break;
		}
	}

	suitLines(all, lines);
	if (singleWait) lines.push(['Single wait', 5]);
	if (it.pair < 27 && [2, 5, 8].includes((it.pair % 9) + 1)) lines.push(['Good eyes (2, 5 or 8 pair)', 2]);
	return lines;
}

function evalSpecial(ctx: WinContext, name: string, value: number): Line[] {
	const lines: Line[] = [[name, value]];
	if (ctx.selfDraw) lines.push(['Self-draw', 1]);
	flowerLines(ctx, lines);
	return lines;
}

export function scoreTaiwanese(ctx: WinContext): Scored {
	const { counts } = handCounts(ctx.concealed);
	const candidates: Line[][] = [];
	if (ctx.melds.length === 0) {
		if (isThirteenOrphans(counts)) candidates.push(evalSpecial(ctx, '13 Orphans', 90));
		if (isSixteenOrphans(counts)) candidates.push(evalSpecial(ctx, '16 Orphans', 50));
		if (isNicoNico(counts)) {
			const l = evalSpecial(ctx, 'Nico Nico (seven pairs and a pong)', 40);
			suitLines(counts.flatMap((n, i) => (n ? [i] : [])), l);
			candidates.push(l);
		}
	}
	const its = interpretations(ctx.concealed, ctx.melds, 5, ctx.winTile.k, ctx.selfDraw);
	if (its.length) {
		const without = ctx.concealed.filter((t) => t.id !== ctx.winTile.id);
		const single = winningKinds(without, ctx.melds.length, 5).length === 1;
		for (const it of its) candidates.push(evalStandard(ctx, it, single));
	}
	if (!candidates.length) return { valid: false, reason: 'Not a complete hand', lines: [], total: 0, summary: '' };

	let best: { lines: Line[]; total: number } | null = null;
	for (let lines of candidates) {
		let pts = lines.reduce((a, [, v]) => a + v, 0);
		if (pts === 1 && !lines.some(([n]) => n.includes('Orphans') || n.includes('Nico'))) {
			lines = [['Chicken hand', 20]];
			pts = 20;
		}
		const total = pts + BASE;
		if (!best || total > best.total) best = { lines: [...lines, ['Mahjong base', BASE]], total };
	}
	const b = best!;
	const min = ROUND_MINIMUM[ctx.roundWind];
	const streakBonus = streakBonusFor(ctx.state, ctx.seat, ctx.from);
	const lines: ScoreLine[] = b.lines.map(([name, value]) => ({ name, value }));
	if (streakBonus) lines.push({ name: `Dealer streak ×${ctx.state.streak}`, value: streakBonus });
	const total = b.total + streakBonus;
	if (ctx.state.opts.minimum && b.total < min) {
		return { valid: false, reason: `${b.total} points is below the ${WIND[ctx.roundWind]} round minimum of ${min}`, lines, total, summary: '' };
	}
	return { valid: true, lines, total, summary: `${total} points` };
}

function streakBonusFor(state: GameState, seat: number, from: number | null) {
	if (state.streak <= 0) return 0;
	const dealerInvolved = seat === state.dealer || from === state.dealer || from === null;
	return dealerInvolved ? 2 * state.streak + 1 : 0;
}

export const taiwanese: Variant = {
	id: 'taiwanese',
	name: 'Taiwanese Mahjong',
	tagline: 'Sixteen tiles, flowers, gongs and big point hands.',
	handSize: 16,
	sets: 5,
	wall: { flowers: true, jokers: 0, redFives: false },
	reserve: 16,
	allowChow: true,
	multipleWinners: true,
	startScore: 0,
	riichi: false,
	goulash: false,
	streakOnDraw: false,
	bustOut: false,
	shantenSpecials: {},
	special: (counts, _j, meldCount) =>
		meldCount === 0 && (isNicoNico(counts) || isThirteenOrphans(counts) || isSixteenOrphans(counts)) ? 'special' : null,
	scoreWin: scoreTaiwanese,
	settleWin(state, wins) {
		const deltas = [0, 0, 0, 0];
		const notes: string[] = [];
		for (const w of wins) {
			if (w.from !== null) {
				deltas[w.from] -= w.scored.total;
				deltas[w.seat] += w.scored.total;
			} else {
				for (let s = 0; s < 4; s++) {
					if (s === w.seat) continue;
					deltas[s] -= w.scored.total;
					deltas[w.seat] += w.scored.total;
				}
			}
		}
		const selfDrawWinner = wins.find((w) => w.from === null);
		if (selfDrawWinner && state.sticks) {
			deltas[selfDrawWinner.seat] += state.sticks;
			notes.push(`Kitty: +${state.sticks}`);
			return { deltas, notes, potTaken: true };
		}
		return { deltas, notes };
	},
	settleDraw() {
		return {
			deltas: [-5, -5, -5, -5],
			notes: ['Wall exhausted: everyone puts 5 into the kitty for the next self-draw winner.'],
			dealerKeeps: false,
			potAdd: 20
		};
	},
	rulesSummary: [
		'144 tiles including eight flowers. Flowers are set aside and replaced from the back of the wall.',
		'Each player holds 16 tiles; a win is five sets and a pair (17 tiles). The dealer starts with 17.',
		'Chow only from the player before you. Pong, gong and Mahjong from anyone. Mahjong beats pong beats chow.',
		'If you pass a tile you could claim, you cannot claim that tile again until your next draw.',
		'Several players may win on the same discard; each is paid in full.',
		'Add up the scoring rows, then the base of 5. The total must reach the round minimum: East 20, South 22, West 24, North 26.',
		'Discard win: the discarder pays. Self-draw: all three opponents pay. A dealer streak adds 2n+1.',
		'A drawn hand sends 5 from each player to a kitty that the next self-draw winner collects.'
	],
	scoringTable: [
		{ name: 'Mahjong base', value: '5' },
		{ name: 'Self-draw / Concealed hand by discard / Concealed self-draw', value: '1 / 5 / 10' },
		{ name: 'No flowers / Seat flower', value: '1 / 1' },
		{ name: 'Bouquet (all four flowers or seasons)', value: '10' },
		{ name: 'Seat wind pong / Round wind pong', value: '1 / 1' },
		{ name: 'Dragon pong', value: '2 each' },
		{ name: 'Little / Big three winds', value: '10 / 15' },
		{ name: 'Little / Big four winds', value: '40 / 60' },
		{ name: 'Little / Big three dragons', value: '20 / 40' },
		{ name: 'Gong / Concealed gong', value: '1 / 2' },
		{ name: 'Three / Four / Five concealed pongs', value: '10 / 20 / 40' },
		{ name: 'All pong hand', value: '15' },
		{ name: 'All sequences (no flowers: 5)', value: '3' },
		{ name: 'No honours', value: '1' },
		{ name: 'All five suits', value: '10' },
		{ name: 'Semi-pure / Pure suit hand', value: '15 / 40' },
		{ name: 'Terminals with honours / without', value: '30 / 60' },
		{ name: 'All honours', value: '140' },
		{ name: 'Three-suit step-up / All step-up', value: '5 / 20' },
		{ name: 'Single wait / Good eyes', value: '5 / 2' },
		{ name: 'Robbing the gong / Gong replacement / Last tile', value: '10 each' },
		{ name: 'Chicken hand (exactly 1 point)', value: '20 (25 with base)' },
		{ name: 'Nico Nico (seven pairs + pong)', value: '40' },
		{ name: '16 Orphans / 13 Orphans', value: '50 / 90' },
		{ name: 'Earthly / Heavenly hand', value: '50 / 100' }
	]
};

export { WIND };
export type { GameState };
