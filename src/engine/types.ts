import type { Kind, Tile } from './tiles';

export type VariantId = 'taiwanese' | 'riichi' | 'bombay';
export type BotLevel = 'beginner' | 'intermediate' | 'expert';

export interface Meld {
	type: 'chow' | 'pung' | 'kong';
	tiles: Tile[];
	/** seat the claimed tile came from; null for concealed kongs */
	from: number | null;
	concealed: boolean;
	/** the tile taken from a discard, if any */
	claimed?: number;
}

export interface DiscardEntry {
	tile: Tile;
	/** taken by another player for a meld / win */
	taken?: boolean;
	riichi?: boolean;
	/** order of play across the whole table */
	n?: number;
}

export interface Player {
	name: string;
	bot: BotLevel | null;
	hand: Tile[];
	melds: Meld[];
	flowers: Tile[];
	discards: DiscardEntry[];
	score: number;
	riichi: null | { at: number; ippatsu: boolean; double: boolean };
	/** kinds this player passed on and may not claim until their next draw */
	passBlock: Kind[];
	tempFuriten: boolean;
	riichiFuriten: boolean;
	/** a kind that may not be discarded this turn (after a chow/pung, riichi kuikae) */
	noDiscard: Kind[];
}

export type ClaimType = 'chow' | 'pung' | 'kong' | 'win';

export interface ClaimOption {
	type: ClaimType;
	/** tile ids from the hand that go with the claimed tile */
	use: number[];
}

export interface ClaimWindow {
	tile: Tile;
	from: number;
	kind: 'discard' | 'robkong';
	options: (ClaimOption[] | null)[];
	responses: (ClaimOption | 'pass' | null)[];
}

export interface ScoreLine {
	name: string;
	value: number | string;
}

export interface WinResult {
	seat: number;
	from: number | null; // null = self-draw
	tile: Tile;
	hand: Tile[];
	melds: Meld[];
	flowers: Tile[];
	lines: ScoreLine[];
	/** headline, e.g. "48 points" or "Mangan 8000" */
	summary: string;
	total: number;
}

export interface HandResult {
	type: 'win' | 'draw';
	wins: WinResult[];
	deltas: number[];
	notes: string[];
	tenpai?: number[];
	uraIndicators?: Tile[];
	dealerKeeps: boolean;
}

export interface PassState {
	round: number; // 0 = right, 1 = across, 2 = left
	chosen: (number[] | null)[];
}

export type Phase = 'turn' | 'claim' | 'passing' | 'ended' | 'gameover';

export interface GameOptions {
	variant: VariantId;
	bots: [BotLevel, BotLevel, BotLevel];
	/** number of wind rounds to play (1 = East only) */
	rounds: number;
	playerName: string;
	/** Taiwanese: enforce round minimum */
	minimum: boolean;
	/** Riichi: red fives */
	redFives: boolean;
	seed: number;
}

export interface GameEvent {
	seq: number;
	seat: number | null;
	type: string;
	text: string;
	tile?: Tile;
}

export interface GameState {
	opts: GameOptions;
	rng: number;
	round: number; // prevailing wind 0..3
	handNo: number;
	dealer: number;
	firstDealer: number;
	streak: number; // dealer repeats (Taiwanese streak / Riichi honba)
	sticks: number; // riichi deposits / Taiwanese kitty
	goulash: boolean;
	wall: Tile[];
	deadWall: Tile[];
	dora: Tile[];
	players: Player[];
	turn: number;
	phase: Phase;
	drawn: Tile | null;
	claim: ClaimWindow | null;
	pending: { kongKind?: Kind } | null;
	afterKong: boolean;
	/** no calls made yet and first go-around not finished */
	firstGoAround: boolean;
	passing: PassState | null;
	result: HandResult | null;
	log: GameEvent[];
	seq: number;
}

export type Action =
	| { t: 'discard'; tile: number; riichi?: boolean }
	| { t: 'tsumo' }
	| { t: 'kong'; kind: Kind }
	| { t: 'claim'; option: ClaimOption }
	| { t: 'pass' }
	| { t: 'pass3'; tiles: number[] }
	| { t: 'next' };
