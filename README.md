# Mahjong server (step 1)

A server-authoritative WebSocket server for the mahjong game. It reuses the
browser **engine** unchanged — the server is the referee. Clients send an
`action`, the server runs the rules, fills empty and vacated seats with bots,
and broadcasts the new game state to everyone in the room.

This covers: **online play**, **private tables** (join by room code), and
**quick match** (create a room, bots fill until people join). Accounts and a
friends list come later — they sit on top of this.

## Run it locally

```bash
npm install
npm run dev        # starts on ws://localhost:8080, reloads on change
# or: npm start
npm run smoke      # plays a full game through the server end-to-end
```

Node 20+.

## How it works

- `src/engine/` — the game, copied from the browser app. Pure rules, no UI.
  `applyAction(state, seat, action)` is the only way the game changes.
- `src/server.ts` — rooms, the WebSocket protocol, and the loop that plays bots
  and auto-continues finished hands until a human has to act. State lives on the
  server, so a client can't cheat by editing its copy.

A room is one game plus four seats. Humans take seats in join order; the rest
are bots. If someone disconnects mid-game, their seat keeps playing as a bot so
the table doesn't stall.

## Protocol (JSON over WebSocket)

Client → server:

| message | does |
|---|---|
| `{ t:'join', name, room?, variant? }` | join a room by code, or create one (omit `room`) |
| `{ t:'start', level?, rounds?, minimum?, redFives? }` | begin; empty seats become bots |
| `{ t:'action', action }` | an engine `Action` for your seat |

Server → client:

| message | carries |
|---|---|
| `{ t:'joined', room, seat }` | your room code and seat number |
| `{ t:'lobby', room, seats, started }` | who's in each seat |
| `{ t:'state', seat, state, pending, yourTurn }` | the full game state after each change |
| `{ t:'error', message }` | a rejected message |

`variant` is `taiwanese` | `riichi` | `bombay`. `level` is `beginner` |
`intermediate` | `expert`.

## Environment variables

| var | default | meaning |
|---|---|---|
| `PORT` | `8080` | listen port (Railway/Fly set this for you) |
| `BOT_MS` | `600` | pause before a bot moves, ms (lower = faster games) |
| `END_MS` | `2500` | pause on a finished hand before dealing the next |

## Deploy to Railway

1. Push this folder to a GitHub repo.
2. In Railway: **New Project → Deploy from GitHub repo**, pick it.
3. Railway builds with Nixpacks and runs `npm start`. Health check is `/health`.
4. In the service's **Settings → Networking**, generate a public domain. Your
   server is then reachable at `wss://<your-app>.up.railway.app`.

Fly.io works the same way (`fly launch`, it detects Node); the health check
path is `/health` and it should keep one machine always on.

## Connecting the game client (next step)

The browser client currently runs the whole game locally. To go online, add an
"online" mode that opens `new WebSocket('wss://<your-app>...')`, sends `join`
and `start`, renders from the `state` messages, and sends an `action` on each
move instead of calling `applyAction` in the page. The message shapes match the
engine's `Action` type, so the table UI barely changes.

## Before you make it public

`viewFor()` in `server.ts` currently sends every seat the full state, which
includes opponents' concealed tiles. Redact other seats' hands there (keep the
tile count, blank the identities) except when the hand is over. It's marked with
a comment in the code.
