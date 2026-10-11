import { handCounts, isStandardComplete, shantenOf, winningKinds } from './hand';
import { buildTiles, isFlower, isJoker, isSuited, kindName, nextRandom, num, shuffle, sortTiles, WIND_NAMES, type Kind, type Tile } from './tiles';
import type { Action, ClaimOption, GameOptions, GameState, HandResult, Player, WinResult } from './types';
import type { Scored, Variant, WinContext } from './variant';
import { bombay } from './variants/bombay';
import { riichi } from './variants/riichi';
import { taiwanese } from './variants/taiwanese';

export const VARIANTS: Record<string, Variant> = { taiwanese, riichi, bombay };
export const variantOf = (s: GameState) => VARIANTS[s.opts.variant];

const BOT_NAMES = ['Crane', 'Lotus', 'Tiger'];

export const seatWind = (s: GameState, seat: number) => (seat - s.dealer + 4) % 4;

/** "Crane discards" / "You discard" */
function says(p: Player, verb: string) {
	if (p.name !== 'You') return `${p.name} ${verb}`;
	const [first, ...rest] = verb.split(' ');
	const base = first.endsWith('ies') ? first.slice(0, -3) + 'y' : first.endsWith('es') && /(ss|sh|ch|x)es$/.test(first) ? first.slice(0, -2) : first.replace(/s$/, '');
	return ['You', base, ...rest].join(' ');
}

function log(s: GameState, seat: number | null, type: string, text: string, tile?: Tile) {
	s.seq++;
	s.log.push({ seq: s.seq, seat, type, text, tile });
	if (s.log.length > 80) s.log.splice(0, s.log.length - 80);
}

function emptyPlayer(name: string, bot: Player['bot'], score: number): Player {
	return {
		name,
		bot,
		hand: [],
		melds: [],
		flowers: [],
		discards: [],
		score,
		riichi: null,
		passBlock: [],
		tempFuriten: false,
		riichiFuriten: false,
		noDiscard: []
	};
}

export function newGame(opts: GameOptions): GameState {
	const v = VARIANTS[opts.variant];
	let rng = opts.seed >>> 0 || 1;
	let r: number;
	[r, rng] = nextRandom(rng);
	const firstDealer = Math.floor(r * 4);
	const s: GameState = {
		opts,
		rng,
		round: 0,
		handNo: 1,
		dealer: firstDealer,
		firstDealer,
		streak: 0,
		sticks: 0,
		goulash: false,
		wall: [],
		deadWall: [],
		dora: [],
		players: [
			emptyPlayer(opts.playerName || 'You', null, v.startScore),
			...opts.bots.map((b, i) => emptyPlayer(BOT_NAMES[i], b, v.startScore))
		],
		turn: firstDealer,
		phase: 'turn',
		drawn: null,
		claim: null,
		pending: null,
		afterKong: false,
		firstGoAround: true,
		passing: null,
		result: null,
		log: [],
		seq: 0
	};
	startHand(s);
	return s;
}

function startHand(s: GameState) {
	const v = variantOf(s);
	let tiles: Tile[];
	[tiles, s.rng] = shuffle(buildTiles({ ...v.wall, redFives: v.wall.redFives && s.opts.redFives }), s.rng);
	s.deadWall = v.riichi ? tiles.splice(tiles.length - 14, 14) : [];
	s.dora = v.riichi ? [s.deadWall[0]] : [];
	s.wall = tiles;
	s.players.forEach((p) => {
		p.hand = [];
		p.melds = [];
		p.flowers = [];
		p.discards = [];
		p.riichi = null;
		p.passBlock = [];
		p.tempFuriten = false;
		p.riichiFuriten = false;
		p.noDiscard = [];
	});
	const order = [0, 1, 2, 3].map((d) => (s.dealer + d) % 4);
	for (let n = 0; n < v.handSize; n++) for (const seat of order) s.players[seat].hand.push(s.wall.shift()!);
	const extra = s.wall.shift()!;
	s.players[s.dealer].hand.push(extra);
	s.drawn = extra;
	for (const seat of order) {
		const p = s.players[seat];
		while (p.hand.some((t) => isFlower(t.k))) {
			const f = p.hand.find((t) => isFlower(t.k))!;
			p.hand = p.hand.filter((t) => t.id !== f.id);
			p.flowers.push(f);
			const rep = s.wall.pop()!;
			p.hand.push(rep);
			if (s.drawn && f.id === s.drawn.id) s.drawn = rep;
		}
	}
	s.turn = s.dealer;
	s.claim = null;
	s.pending = null;
	s.result = null;
	s.afterKong = false;
	s.firstGoAround = true;
	log(s, null, 'deal', `${WIND_NAMES[s.round]} round, hand ${s.handNo}. ${says(s.players[s.dealer], 'deals')}.`);
	if (s.goulash) {
		s.phase = 'passing';
		s.passing = { round: 0, chosen: [null, null, null, null] };
		s.drawn = null;
		log(s, null, 'goulash', 'Goulash hand: pass three tiles to the right.');
	} else {
		s.phase = 'turn';
		s.passing = null;
	}
}

/** Draw from the live wall (front) or the back; flowers are set aside and replaced. Null = wall exhausted. */
function drawTile(s: GameState, seat: number, fromBack: boolean): Tile | null {
	const v = variantOf(s);
	const p = s.players[seat];
	let back = fromBack;
	for (;;) {
		let t: Tile | undefined;
		if (back && v.riichi) {
			t = s.deadWall.pop();
			const refill = s.wall.pop();
			if (refill) s.deadWall.splice(10, 0, refill);
		} else {
			if (s.wall.length <= v.reserve) return null;
			t = back ? s.wall.pop() : s.wall.shift();
		}
		if (!t) return null;
		if (isFlower(t.k)) {
			p.flowers.push(t);
			log(s, seat, 'flower', `${says(p, 'sets')} aside ${kindName(t.k)}.`, t);
			back = true;
			continue;
		}
		return t;
	}
}

function startTurn(s: GameState, seat: number) {
	const p = s.players[seat];
	p.passBlock = [];
	p.tempFuriten = false;
	s.claim = null;
	const t = drawTile(s, seat, false);
	if (!t) return exhaustiveDraw(s);
	p.hand.push(t);
	s.drawn = t;
	s.turn = seat;
	s.phase = 'turn';
	s.afterKong = false;
}

function replacementDraw(s: GameState, seat: number) {
	const v = variantOf(s);
	if (v.riichi) {
		const idx = s.dora.length;
		if (idx < 5) s.dora.push(s.deadWall[idx]);
	}
	const t = drawTile(s, seat, true);
	if (!t) return exhaustiveDraw(s);
	s.players[seat].hand.push(t);
	s.drawn = t;
	s.turn = seat;
	s.phase = 'turn';
	s.afterKong = true;
}

export function winContext(
	s: GameState,
	seat: number,
	concealed: Tile[],
	winTile: Tile,
	from: number | null,
	robbingKong = false
): WinContext {
	const v = variantOf(s);
	const p = s.players[seat];
	return {
		state: s,
		seat,
		concealed,
		melds: p.melds,
		flowers: p.flowers,
		winTile,
		selfDraw: from === null,
		from,
		robbingKong,
		afterKong: from === null && s.afterKong,
		lastTile: s.wall.length <= v.reserve && !robbingKong,
		firstGoAround: s.firstGoAround && p.discards.length === 0,
		seatWind: seatWind(s, seat),
		roundWind: s.round,
		isDealer: seat === s.dealer
	};
}

function shapeComplete(s: GameState, concealed: Tile[], meldCount: number) {
	const v = variantOf(s);
	if (isStandardComplete(concealed, meldCount, v.sets)) return true;
	if (!v.special) return false;
	const { counts, jokers } = handCounts(concealed);
	return !!v.special(counts, jokers, meldCount);
}

function furiten(s: GameState, seat: number): boolean {
	const v = variantOf(s);
	if (!v.riichi) return false;
	const p = s.players[seat];
	if (p.tempFuriten || p.riichiFuriten) return true;
	const waits = winningKinds(p.hand, p.melds.length, v.sets, v.special);
	return p.discards.some((d) => waits.includes(d.tile.k));
}

export interface WinCheck {
	scored: Scored | null;
	blocked?: string;
}

function checkWin(s: GameState, seat: number, winTile: Tile, from: number | null, robbing = false): WinCheck {
	const p = s.players[seat];
	const concealed = from === null ? p.hand : [...p.hand, winTile];
	if (!shapeComplete(s, concealed, p.melds.length)) return { scored: null };
	if (from !== null && p.passBlock.includes(winTile.k)) return { scored: null, blocked: 'You passed this tile earlier.' };
	if (from !== null && furiten(s, seat)) return { scored: null, blocked: 'Furiten: a winning tile is in your discards.' };
	const scored = variantOf(s).scoreWin(winContext(s, seat, concealed, winTile, from, robbing));
	if (!scored.valid) return { scored: null, blocked: scored.reason };
	return { scored };
}

function claimOptions(s: GameState, seat: number, tile: Tile, from: number, kind: 'discard' | 'robkong'): ClaimOption[] {
	const v = variantOf(s);
	const p = s.players[seat];
	const opts: ClaimOption[] = [];
	if (checkWin(s, seat, tile, from, kind === 'robkong').scored) opts.push({ type: 'win', use: [] });
	if (kind === 'robkong' || p.riichi || isJoker(tile.k) || p.passBlock.includes(tile.k)) return opts;
	if (s.wall.length <= v.reserve) return opts;
	const nat = p.hand.filter((t) => t.k === tile.k);
	const jokers = p.hand.filter((t) => isJoker(t.k));
	if (nat.length >= 2) opts.push({ type: 'pung', use: nat.slice(0, 2).map((t) => t.id) });
	else if (nat.length === 1 && jokers.length) opts.push({ type: 'pung', use: [nat[0].id, jokers[0].id] });
	if (nat.length >= 3) opts.push({ type: 'kong', use: nat.slice(0, 3).map((t) => t.id) });
	if (v.allowChow && seat === (from + 1) % 4 && isSuited(tile.k)) {
		const n = num(tile.k);
		const suit = tile.k[0];
		for (const [a, b] of [
			[n - 2, n - 1],
			[n - 1, n + 1],
			[n + 1, n + 2]
		]) {
			if (a < 1 || b > 9) continue;
			const ta = p.hand.find((t) => t.k === suit + a);
			const tb = p.hand.find((t) => t.k === suit + b);
			if (ta && tb) opts.push({ type: 'chow', use: [ta.id, tb.id] });
		}
	}
	return opts;
}

function openClaimWindow(s: GameState, tile: Tile, from: number, kind: 'discard' | 'robkong'): boolean {
	const options = [0, 1, 2, 3].map((seat) => {
		if (seat === from) return null;
		const o = claimOptions(s, seat, tile, from, kind);
		return o.length ? o : null;
	});
	if (options.every((o) => o === null)) return false;
	s.claim = { tile, from, kind, options, responses: [null, null, null, null] };
	s.phase = 'claim';
	return true;
}

export interface Legal {
	discard: number[];
	riichi: number[];
	tsumo: Scored | null;
	tsumoBlocked?: string;
	kongs: Kind[];
	claims: ClaimOption[];
	claimBlocked?: string;
	pass3: boolean;
	next: boolean;
}

export function legal(s: GameState, seat: number): Legal {
	const v = variantOf(s);
	const p = s.players[seat];
	const L: Legal = { discard: [], riichi: [], tsumo: null, kongs: [], claims: [], pass3: false, next: false };
	if (s.phase === 'ended') {
		L.next = true;
		return L;
	}
	if (s.phase === 'passing') {
		L.pass3 = !!s.passing && s.passing.chosen[seat] === null;
		return L;
	}
	if (s.phase === 'claim' && s.claim) {
		if (s.claim.responses[seat] === null && s.claim.options[seat]) L.claims = s.claim.options[seat]!;
		if (!L.claims.some((c) => c.type === 'win') && seat !== s.claim.from) {
			const w = checkWin(s, seat, s.claim.tile, s.claim.from, s.claim.kind === 'robkong');
			if (w.blocked) L.claimBlocked = w.blocked;
		}
		return L;
	}
	if (s.phase !== 'turn' || s.turn !== seat) return L;

	if (p.riichi && s.drawn) L.discard = [s.drawn.id];
	else {
		const allowed = p.hand.filter((t) => !p.noDiscard.includes(t.k));
		L.discard = (allowed.length ? allowed : p.hand).map((t) => t.id);
	}
	if (s.drawn) {
		const w = checkWin(s, seat, s.drawn, null);
		L.tsumo = w.scored;
		L.tsumoBlocked = w.blocked;
	}
	const totalKongs = s.players.reduce((a, q) => a + q.melds.filter((m) => m.type === 'kong').length, 0);
	if (!p.riichi && s.wall.length > v.reserve && totalKongs < 4) {
		const seen = new Set<Kind>();
		for (const t of p.hand) {
			if (seen.has(t.k) || isJoker(t.k)) continue;
			seen.add(t.k);
			if (p.hand.filter((x) => x.k === t.k).length === 4) L.kongs.push(t.k);
			else if (p.melds.some((m) => m.type === 'pung' && m.tiles.some((x) => x.k === t.k) && !m.tiles.some((x) => isJoker(x.k))))
				L.kongs.push(t.k);
		}
	}
	if (v.riichi && !p.riichi && p.melds.every((m) => m.concealed) && p.score >= 1000 && s.wall.length >= 4 && s.drawn) {
		const ready = new Map<Kind, boolean>();
		for (const t of p.hand) {
			if (!ready.has(t.k)) {
				const rest = p.hand.filter((x) => x.id !== t.id);
				ready.set(t.k, shantenOf(rest, p.melds.length, v.sets, v.shantenSpecials).shanten === 0);
			}
			if (ready.get(t.k)) L.riichi.push(t.id);
		}
	}
	return L;
}

/** Seats the game is waiting on. */
export function pendingSeats(s: GameState): number[] {
	if (s.phase === 'turn') return [s.turn];
	if (s.phase === 'claim' && s.claim) return [0, 1, 2, 3].filter((i) => s.claim!.options[i] && s.claim!.responses[i] === null);
	if (s.phase === 'passing' && s.passing) return [0, 1, 2, 3].filter((i) => s.passing!.chosen[i] === null);
	return [];
}

function removeTiles(p: Player, ids: number[]): Tile[] {
	const out: Tile[] = [];
	for (const id of ids) {
		const i = p.hand.findIndex((t) => t.id === id);
		if (i < 0) throw new Error(`tile ${id} not in hand`);
		out.push(p.hand.splice(i, 1)[0]);
	}
	return out;
}

function breakIppatsu(s: GameState) {
	for (const p of s.players) if (p.riichi) p.riichi.ippatsu = false;
	s.firstGoAround = false;
}

function doDiscard(s: GameState, seat: number, tileId: number, withRiichi: boolean) {
	const p = s.players[seat];
	const [tile] = removeTiles(p, [tileId]);
	if (p.riichi) p.riichi.ippatsu = false;
	const entry: Player['discards'][number] = { tile, n: s.seq };
	if (withRiichi) {
		p.riichi = { at: p.discards.length, ippatsu: true, double: s.firstGoAround && p.discards.length === 0 };
		p.score -= 1000;
		s.sticks += 1;
		entry.riichi = true;
		log(s, seat, 'riichi', `${says(p, 'declares')} riichi!`);
	}
	p.discards.push(entry);
	p.noDiscard = [];
	s.drawn = null;
	s.afterKong = false;
	log(s, seat, 'discard', `${says(p, 'discards')} ${kindName(tile.k)}.`, tile);
	if (!openClaimWindow(s, tile, seat, 'discard')) startTurn(s, (seat + 1) % 4);
}

function finishWin(s: GameState, winners: number[], tile: Tile, from: number | null, robbing: boolean) {
	const v = variantOf(s);
	if (from !== null) {
		const fp = s.players[from];
		if (robbing) fp.hand = fp.hand.filter((t) => t.id !== tile.id);
		else {
			const last = fp.discards[fp.discards.length - 1];
			if (last && last.tile.id === tile.id) last.taken = true;
		}
	}
	const wins: WinResult[] = [];
	const settles = winners.map((seat) => {
		const p = s.players[seat];
		const concealed = from === null ? p.hand : [...p.hand, tile];
		const scored = v.scoreWin(winContext(s, seat, concealed, tile, from, robbing));
		wins.push({
			seat,
			from,
			tile,
			hand: sortTiles(concealed.filter((t) => t.id !== tile.id)),
			melds: p.melds,
			flowers: p.flowers,
			lines: scored.lines,
			summary: scored.summary,
			total: scored.total
		});
		return { seat, from, scored };
	});
	const st = v.settleWin(s, settles);
	st.deltas.forEach((d, i) => (s.players[i].score += d));
	if (st.potTaken) s.sticks = 0;
	const result: HandResult = {
		type: 'win',
		wins,
		deltas: st.deltas,
		notes: st.notes,
		dealerKeeps: winners.includes(s.dealer),
		uraIndicators: v.riichi && winners.some((w) => s.players[w].riichi) ? s.deadWall.slice(5, 5 + s.dora.length) : undefined
	};
	s.result = result;
	s.claim = null;
	s.phase = 'ended';
	for (const w of wins) {
		const p = s.players[w.seat];
		log(s, w.seat, 'win', from === null ? `${says(p, 'wins')} by self-draw! ${w.summary}` : `${says(p, 'wins')} off ${s.players[from].name}! ${w.summary}`, tile);
	}
}

function exhaustiveDraw(s: GameState) {
	const v = variantOf(s);
	const st = v.settleDraw(s);
	st.deltas.forEach((d, i) => (s.players[i].score += d));
	s.sticks += st.potAdd ?? 0;
	s.result = { type: 'draw', wins: [], deltas: st.deltas, notes: st.notes, tenpai: st.tenpai, dealerKeeps: st.dealerKeeps };
	s.claim = null;
	s.drawn = null;
	s.phase = 'ended';
	log(s, null, 'draw', 'The wall is exhausted. Drawn hand.');
}

function resolveClaims(s: GameState) {
	const v = variantOf(s);
	const c = s.claim!;
	const order = [1, 2, 3].map((d) => (c.from + d) % 4);
	const resp = (seat: number) => c.responses[seat];
	const winners = order.filter((seat) => {
		const r = resp(seat);
		return r && r !== 'pass' && r.type === 'win';
	});
	if (winners.length) return finishWin(s, v.multipleWinners ? winners : [winners[0]], c.tile, c.from, c.kind === 'robkong');
	if (c.kind === 'robkong') {
		s.claim = null;
		return completeAddedKong(s, c.from, c.tile);
	}
	const pick =
		order.find((seat) => {
			const r = resp(seat);
			return r && r !== 'pass' && (r.type === 'pung' || r.type === 'kong');
		}) ??
		order.find((seat) => {
			const r = resp(seat);
			return r && r !== 'pass' && r.type === 'chow';
		});
	s.claim = null;
	if (pick === undefined) return startTurn(s, (c.from + 1) % 4);
	const option = resp(pick) as ClaimOption;
	const p = s.players[pick];
	const used = removeTiles(p, option.use);
	const fromP = s.players[c.from];
	const last = fromP.discards[fromP.discards.length - 1];
	if (last && last.tile.id === c.tile.id) last.taken = true;
	const tiles = option.type === 'chow' ? sortTiles([...used, c.tile]) : [...used, c.tile];
	p.melds.push({ type: option.type as 'chow' | 'pung' | 'kong', tiles, from: c.from, concealed: false, claimed: c.tile.id });
	breakIppatsu(s);
	const verb = { chow: v.id === 'taiwanese' ? 'sheungs' : 'chows', pung: 'pongs', kong: 'gongs', win: '' }[option.type];
	log(s, pick, option.type, `${says(p, verb)} ${kindName(c.tile.k)}.`, c.tile);
	s.turn = pick;
	s.drawn = null;
	p.noDiscard = v.riichi ? [c.tile.k] : [];
	if (option.type === 'kong') return replacementDraw(s, pick);
	s.phase = 'turn';
}

function completeAddedKong(s: GameState, seat: number, tile: Tile) {
	const p = s.players[seat];
	const meld = p.melds.find((m) => m.type === 'pung' && m.tiles.some((t) => t.k === tile.k))!;
	removeTiles(p, [tile.id]);
	meld.type = 'kong';
	meld.tiles = [...meld.tiles, tile];
	log(s, seat, 'kong', `${says(p, 'adds')} to a gong: ${kindName(tile.k)}.`, tile);
	replacementDraw(s, seat);
}

function doKong(s: GameState, seat: number, kind: Kind) {
	const p = s.players[seat];
	const four = p.hand.filter((t) => t.k === kind);
	breakIppatsu(s);
	if (four.length === 4) {
		removeTiles(p, four.map((t) => t.id));
		p.melds.push({ type: 'kong', tiles: four, from: null, concealed: true });
		log(s, seat, 'kong', `${says(p, 'declares')} a concealed gong.`);
		return replacementDraw(s, seat);
	}
	const tile = four[0];
	s.drawn = null;
	if (openClaimWindow(s, tile, seat, 'robkong')) return;
	completeAddedKong(s, seat, tile);
}

function doPass3(s: GameState, seat: number, ids: number[]) {
	const ps = s.passing!;
	if (ids.length !== 3 || new Set(ids).size !== 3) throw new Error('choose three tiles');
	const p = s.players[seat];
	if (ids.some((id) => { const t = p.hand.find((x) => x.id === id); return !t || isJoker(t.k); })) throw new Error('cannot pass that tile');
	ps.chosen[seat] = ids;
	if (ps.chosen.some((c) => c === null)) return;
	const offset = [1, 2, 3][ps.round];
	const moving = ps.chosen.map((c, i) => removeTiles(s.players[i], c!));
	moving.forEach((tiles, i) => s.players[(i + offset) % 4].hand.push(...tiles));
	ps.round++;
	ps.chosen = [null, null, null, null];
	if (ps.round >= 3) {
		s.passing = null;
		s.phase = 'turn';
		s.turn = s.dealer;
		log(s, null, 'goulash', 'Passing done. The dealer discards first.');
	} else log(s, null, 'goulash', `Now pass three tiles ${ps.round === 1 ? 'across' : 'to the left'}.`);
}

function advance(s: GameState) {
	const v = variantOf(s);
	const r = s.result;
	if (!r) return;
	if (r.type === 'draw' && v.streakOnDraw) s.streak++;
	else if (r.dealerKeeps) s.streak++;
	else s.streak = 0;
	if (!r.dealerKeeps) {
		s.dealer = (s.dealer + 1) % 4;
		if (s.dealer === s.firstDealer) s.round++;
	}
	s.goulash = v.goulash && r.type === 'draw';
	s.handNo++;
	if (s.round >= s.opts.rounds || (v.bustOut && s.players.some((p) => p.score < 0))) {
		s.phase = 'gameover';
		log(s, null, 'gameover', 'Game over.');
		return;
	}
	startHand(s);
}

export function applyAction(state: GameState, seat: number, action: Action): GameState {
	const s: GameState = structuredClone(state);
	const L = legal(s, seat);
	switch (action.t) {
		case 'discard': {
			if (action.riichi ? !L.riichi.includes(action.tile) : !L.discard.includes(action.tile)) throw new Error('illegal discard');
			doDiscard(s, seat, action.tile, !!action.riichi);
			break;
		}
		case 'tsumo': {
			if (!L.tsumo || !s.drawn) throw new Error('cannot win');
			finishWin(s, [seat], s.drawn, null, false);
			break;
		}
		case 'kong': {
			if (!L.kongs.includes(action.kind)) throw new Error('illegal kong');
			doKong(s, seat, action.kind);
			break;
		}
		case 'claim':
		case 'pass': {
			if (s.phase !== 'claim' || !s.claim || !s.claim.options[seat] || s.claim.responses[seat] !== null)
				throw new Error('nothing to claim');
			const c = s.claim;
			const p = s.players[seat];
			if (action.t === 'claim') {
				const ok = c.options[seat]!.some((o) => o.type === action.option.type && o.use.join() === action.option.use.join());
				if (!ok) throw new Error('illegal claim');
				c.responses[seat] = action.option;
			} else {
				c.responses[seat] = 'pass';
				const hadWin = c.options[seat]!.some((o) => o.type === 'win');
				if (hadWin && p.riichi) p.riichiFuriten = true;
				else if (hadWin) p.tempFuriten = true;
				if (variantOf(s).id === 'taiwanese') p.passBlock.push(c.tile.k);
			}
			if (pendingSeats(s).length === 0) resolveClaims(s);
			break;
		}
		case 'pass3': {
			if (!L.pass3) throw new Error('not passing now');
			doPass3(s, seat, action.tiles);
			break;
		}
		case 'next': {
			if (s.phase !== 'ended') throw new Error('hand not over');
			advance(s);
			break;
		}
	}
	return s;
}

export function standings(s: GameState) {
	return s.players.map((p, seat) => ({ seat, name: p.name, score: p.score })).sort((a, b) => b.score - a.score);
}
