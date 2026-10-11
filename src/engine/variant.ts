import type { SpecialShape } from './hand';
import type { Tile, WallOptions } from './tiles';
import type { GameState, Meld, ScoreLine, VariantId } from './types';

export interface WinContext {
	state: GameState;
	seat: number;
	/** concealed tiles including the winning tile */
	concealed: Tile[];
	melds: Meld[];
	flowers: Tile[];
	winTile: Tile;
	selfDraw: boolean;
	from: number | null;
	robbingKong: boolean;
	afterKong: boolean;
	lastTile: boolean;
	firstGoAround: boolean;
	seatWind: number;
	roundWind: number;
	isDealer: boolean;
}

export interface Scored {
	valid: boolean;
	/** why a complete-shaped hand still can't be declared (no yaku, below minimum) */
	reason?: string;
	lines: ScoreLine[];
	total: number;
	summary: string;
	/** Riichi: base points used for payment */
	basic?: number;
}

export interface WinSettle {
	seat: number;
	from: number | null;
	scored: Scored;
}

export interface Settlement {
	deltas: number[];
	notes: string[];
	/** the pot (riichi sticks / drawn-hand kitty) was paid out; the game resets it */
	potTaken?: boolean;
}

export interface DrawSettlement extends Settlement {
	dealerKeeps: boolean;
	tenpai?: number[];
	/** amount added to the pot */
	potAdd?: number;
}

export interface Variant {
	id: VariantId;
	name: string;
	tagline: string;
	handSize: 13 | 16;
	sets: 4 | 5;
	wall: WallOptions;
	/** tiles left in the wall when the hand ends drawn */
	reserve: number;
	allowChow: boolean;
	multipleWinners: boolean;
	startScore: number;
	riichi: boolean;
	goulash: boolean;
	special?: SpecialShape;
	shantenSpecials: { pairs?: boolean; orphans?: boolean };
	/** Riichi honba: the counter also grows on drawn hands */
	streakOnDraw: boolean;
	/** game ends when someone drops below zero */
	bustOut: boolean;
	scoreWin(ctx: WinContext): Scored;
	settleWin(state: GameState, wins: WinSettle[]): Settlement;
	settleDraw(state: GameState): DrawSettlement;
	/** the scoring table shown on the rules page */
	scoringTable: { name: string; value: string; note?: string }[];
	rulesSummary: string[];
}
