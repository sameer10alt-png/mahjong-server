/**
 * Server-authoritative mahjong server.
 *
 * The browser engine (src/engine, copied unchanged from the game) is the single
 * source of truth. Clients never run the rules; they send an `action`, the
 * server validates it with the engine, advances the game, fills empty seats and
 * disconnected seats with bots, and broadcasts the new state.
 *
 * Protocol (JSON over WebSocket)
 *   client -> server
 *     { t:'join',   name, room?, variant? }   join a room by code, or create one
 *     { t:'start',  level?, rounds?, minimum?, redFives? }   begin the game
 *     { t:'action', action }                   an engine Action for your seat
 *   server -> client
 *     { t:'joined', room, seat }
 *     { t:'lobby',  room, seats:[{seat,name,bot,connected}], started }
 *     { t:'state',  seat, state, pending:number[], yourTurn }
 *     { t:'error',  message }
 */
import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { newGame, applyAction, pendingSeats, VARIANTS } from './engine/game.ts';
import { botAction } from './engine/bots.ts';
import type { GameState, GameOptions, BotLevel, VariantId, Action } from './engine/types.ts';

const PORT = Number(process.env.PORT) || 8080;
const BOT_MS = Number(process.env.BOT_MS) || 600; // bot "think" delay, ms
const END_MS = Number(process.env.END_MS) || 2500; // pause on a finished hand

type Conn = WebSocket & { id: string; room?: string; seat?: number };
interface Seat {
  name: string;
  conn: Conn | null;
  bot: BotLevel | null; // null = human seat
}
interface Room {
  code: string;
  variant: VariantId;
  rounds: number;
  seats: Seat[]; // always length 4
  state: GameState | null;
  driving: boolean;
}

const rooms = new Map<string, Room>();

function makeCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  do {
    code = Array.from({ length: 4 }, () => alphabet[(Math.random() * alphabet.length) | 0]).join('');
  } while (rooms.has(code));
  return code;
}

function newRoom(variant: VariantId): Room {
  const room: Room = {
    code: makeCode(),
    variant,
    rounds: 1,
    seats: Array.from({ length: 4 }, () => ({ name: 'Open', conn: null, bot: null })),
    state: null,
    driving: false
  };
  rooms.set(room.code, room);
  return room;
}

function firstFreeSeat(room: Room): number {
  return room.seats.findIndex((s) => s.conn === null && s.bot === null);
}

// A seat the server plays: an explicit bot, or a human who has left mid-game.
function serverControlled(room: Room, seat: number): boolean {
  const s = room.seats[seat];
  return s.bot !== null || s.conn === null;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function send(conn: Conn | null, msg: unknown) {
  if (conn && conn.readyState === WebSocket.OPEN) conn.send(JSON.stringify(msg));
}

function lobby(room: Room) {
  return {
    t: 'lobby',
    room: room.code,
    started: room.state !== null,
    seats: room.seats.map((s, seat) => ({
      seat,
      name: s.name,
      bot: s.bot,
      connected: s.conn !== null
    }))
  };
}

function broadcastLobby(room: Room) {
  const msg = lobby(room);
  for (const s of room.seats) send(s.conn, msg);
}

/**
 * The per-seat view of the game. For now it sends the full state so the existing
 * browser client works unchanged. HARDEN BEFORE PUBLIC: redact other seats'
 * concealed hands here (keep hand length, blank tile identity) except when
 * state.phase is 'ended' or 'gameover', so players can't read opponents' tiles.
 */
function viewFor(_seat: number, state: GameState): GameState {
  return state;
}

function broadcastState(room: Room) {
  if (!room.state) return;
  const pend = pendingSeats(room.state);
  for (let seat = 0; seat < 4; seat++) {
    const conn = room.seats[seat].conn;
    if (!conn) continue;
    send(conn, {
      t: 'state',
      seat,
      state: viewFor(seat, room.state),
      pending: pend,
      yourTurn: pend.includes(seat)
    });
  }
}

/**
 * Advance the game as far as the server can: play every bot / vacated seat, and
 * auto-continue finished hands, stopping only when a connected human must act.
 * Guarded by room.driving so it never runs twice at once.
 */
async function drive(room: Room) {
  if (room.driving || !room.state) return;
  room.driving = true;
  try {
    while (room.state) {
      const s = room.state;
      if (s.phase === 'gameover') break;

      if (s.phase === 'ended') {
        await delay(END_MS);
        if (!room.state) break;
        room.state = applyAction(room.state, 0, { t: 'next' });
        broadcastState(room);
        continue;
      }

      const pend = pendingSeats(s);
      const toPlay = pend.filter((seat) => serverControlled(room, seat));
      if (toPlay.length === 0) break; // waiting on a human

      const seat = toPlay[0];
      await delay(BOT_MS);
      if (!room.state) break;
      try {
        room.state = applyAction(room.state, seat, botAction(room.state, seat));
      } catch (err) {
        console.error(`bot error room=${room.code} seat=${seat}:`, err);
        break;
      }
      broadcastState(room);
    }
  } finally {
    room.driving = false;
  }
}

function startGame(room: Room, opts: { level?: BotLevel; rounds?: number; minimum?: boolean; redFives?: boolean }) {
  const humans = room.seats.filter((s) => s.conn !== null);
  if (humans.length === 0) throw new Error('need at least one player to start');

  const level: BotLevel = opts.level ?? 'intermediate';
  // Fill empty seats with bots.
  for (const s of room.seats) {
    if (s.conn === null) {
      s.bot = level;
      if (s.name === 'Open') s.name = '';
    } else {
      s.bot = null;
    }
  }

  const gameOpts: GameOptions = {
    variant: room.variant,
    bots: [level, level, level],
    rounds: opts.rounds ?? room.rounds,
    playerName: room.seats[0].name || 'Player',
    minimum: opts.minimum ?? false,
    redFives: opts.redFives ?? true,
    seed: (Math.random() * 0xffffffff) >>> 0
  };

  const state = newGame(gameOpts);
  // Map our seats onto the engine players (names + who is a bot).
  for (let i = 0; i < 4; i++) {
    const seat = room.seats[i];
    state.players[i].bot = seat.bot;
    if (seat.name) state.players[i].name = seat.name;
  }
  room.state = state;
  broadcastLobby(room);
  broadcastState(room);
  void drive(room);
}

function handle(conn: Conn, raw: string) {
  let msg: any;
  try {
    msg = JSON.parse(raw);
  } catch {
    return send(conn, { t: 'error', message: 'bad json' });
  }

  if (msg.t === 'join') {
    const variant: VariantId = VARIANTS[msg.variant] ? msg.variant : 'taiwanese';
    let room: Room;
    if (msg.room) {
      const found = rooms.get(String(msg.room).toUpperCase());
      if (!found) return send(conn, { t: 'error', message: 'no such room' });
      room = found;
    } else {
      room = newRoom(variant);
    }
    const seat = firstFreeSeat(room);
    if (seat === -1) return send(conn, { t: 'error', message: 'room is full' });

    room.seats[seat] = { name: (msg.name || `Player ${seat + 1}`).slice(0, 24), conn, bot: null };
    conn.room = room.code;
    conn.seat = seat;
    send(conn, { t: 'joined', room: room.code, seat });
    broadcastLobby(room);
    if (room.state) broadcastState(room); // joined a game in progress
    return;
  }

  const room = conn.room ? rooms.get(conn.room) : undefined;
  if (!room || conn.seat === undefined) return send(conn, { t: 'error', message: 'join a room first' });

  if (msg.t === 'start') {
    if (room.state) return send(conn, { t: 'error', message: 'already started' });
    try {
      startGame(room, msg);
    } catch (err: any) {
      send(conn, { t: 'error', message: err?.message || 'could not start' });
    }
    return;
  }

  if (msg.t === 'action') {
    if (!room.state) return send(conn, { t: 'error', message: 'game not started' });
    const action = msg.action as Action;
    const st = room.state;
    // Ignore harmless stragglers instead of erroring: a claim/pass for a window
    // this seat has already answered (or that has since closed), or a 'next'
    // the server auto-advances itself. Real clients can double-fire these.
    if (action.t === 'claim' || action.t === 'pass') {
      if (st.phase !== 'claim' || !st.claim || !st.claim.options[conn.seat] || st.claim.responses[conn.seat] !== null) return;
    }
    if (action.t === 'next' && st.phase !== 'ended') return;
    try {
      room.state = applyAction(room.state, conn.seat, action);
    } catch (err: any) {
      return send(conn, { t: 'error', message: err?.message || 'illegal action' });
    }
    broadcastState(room);
    void drive(room);
    return;
  }

  send(conn, { t: 'error', message: `unknown message: ${msg.t}` });
}

function onDisconnect(conn: Conn) {
  const room = conn.room ? rooms.get(conn.room) : undefined;
  if (!room || conn.seat === undefined) return;
  const seat = room.seats[conn.seat];
  if (seat && seat.conn === conn) {
    seat.conn = null; // seat becomes server-controlled; the game continues
  }
  broadcastLobby(room);
  if (room.state) void drive(room);

  // Drop an idle room once everyone has left and no game is running.
  const anyone = room.seats.some((s) => s.conn !== null);
  if (!anyone && !room.state) rooms.delete(room.code);
}

const http = createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server: http });
let nextId = 1;
wss.on('connection', (ws) => {
  const conn = ws as Conn;
  conn.id = String(nextId++);
  conn.on('message', (data) => handle(conn, data.toString()));
  conn.on('close', () => onDisconnect(conn));
  conn.on('error', () => {});
});

http.listen(PORT, () => {
  console.log(`mahjong server listening on :${PORT}  (bots ${BOT_MS}ms, variants: ${Object.keys(VARIANTS).join(', ')})`);
});
