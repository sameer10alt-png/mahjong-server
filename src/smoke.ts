/** Smoke test: one client joins, starts a game, and plays its seat with the bot
 *  brain until the game ends — exercising join/start/action/state end to end. */
import { WebSocket } from 'ws';
import { botAction } from './engine/bots.ts';
import type { GameState } from './engine/types.ts';

const url = process.env.URL || 'ws://localhost:8080';
const ws = new WebSocket(url);
let seat = -1;
let acted = 0;
const started = Date.now();

function fail(m: string) { console.error('FAIL:', m); process.exit(1); }
setTimeout(() => fail('timeout — game did not finish in 20s'), 20000);

ws.on('open', () => ws.send(JSON.stringify({ t: 'join', name: 'Tester', variant: 'taiwanese' })));

ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.t === 'joined') {
    seat = msg.seat;
    console.log(`joined room ${msg.room} at seat ${seat}`);
    ws.send(JSON.stringify({ t: 'start', level: 'beginner', rounds: 1 }));
    return;
  }
  if (msg.t === 'error') return fail('server error: ' + msg.message);
  if (msg.t !== 'state') return;

  const s = msg.state as GameState;
  if (s.phase === 'gameover') {
    const standings = s.players
      .map((p, i) => `${p.name || 'seat ' + i}:${p.score}`)
      .join('  ');
    console.log(`GAME OVER after ${acted} of my actions, ${(Date.now() - started) / 1000}s`);
    console.log('scores:', standings);
    console.log('PASS');
    process.exit(0);
  }
  if (msg.yourTurn && (s.phase === 'turn' || s.phase === 'claim' || s.phase === 'passing')) {
    const action = botAction(s, seat);
    acted++;
    ws.send(JSON.stringify({ t: 'action', action }));
  }
});

ws.on('error', (e) => fail('ws error: ' + e.message));
