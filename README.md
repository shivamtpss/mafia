# AI Mafia 🎭

A real-time multiplayer social deduction game (Mafia / Werewolf) built as a
production-oriented, monetizable SaaS game platform.

**Status: Phase 1 complete — a fully playable, server-authoritative multiplayer lobby over real Socket.IO.** Later phases add the full game loop, AI narration, AI opponents, progression, and monetization.

---

## Architecture

```
ai-mafia/
├── apps/
│   ├── web/        # Next.js (App Router, TS, Tailwind, Framer Motion, Socket.IO client)
│   └── server/     # NestJS (Socket.IO gateway, authoritative game engine, Prisma, Redis-ready)
├── packages/
│   └── shared/     # Shared TS types, Socket.IO event contract, game config, validation
├── docker-compose.yml
└── .env.example
```

- **The server is the single source of truth.** Clients send *requests*; the gateway validates phase, identity, host/role permissions, and alive status before mutating state. Clients never send a trusted role, vote total, timer, or winner.
- **Secrecy is a first-class concern.** Only the public projection of room state is broadcast. Private data (roles, night actions) is sent to a single socket, never to a room. See `PublicRoomState` vs `ServerPlayer` in the code.
- **Ollama is server-side only.** It is never reachable from the browser (added in Phase 4+).

### Data flow

```
Browser ──HTTP──▶  NestJS REST (read-only room lookup)
Browser ◀─WS────▶  NestJS Socket.IO gateway ──▶ RoomsService (authoritative) ──▶ RoomStore (in-memory / Redis-ready)
                                                              └──▶ (Phase 4+) AiGameMaster ──▶ Ollama (llama3.2)
Prisma/PostgreSQL stores finalized matches, profiles, XP, cosmetics (Phase 6+).
```

---

## Prerequisites

- **Node.js ≥ 20** (tested on Node 22)
- Optional for later phases: **Docker** (PostgreSQL + Redis), **Ollama** with `llama3.2` pulled.

Phase 1 needs none of Postgres/Redis/Ollama — the lobby runs fully in-memory.

---

## Quick start (local, no Docker)

```bash
# 1. install everything (npm workspaces)
npm install

# 2. copy env (defaults work out of the box for Phase 1)
cp .env.example .env

# 3. build the shared package once
npm run build:shared

# 4. run server + web together
npm run dev
```

- Web: http://localhost:3000
- Server: http://localhost:4000 (health: `GET /health`)

Or run them separately:

```bash
npm run dev:server   # NestJS on :4000
npm run dev:web      # Next.js on :3000
```

> The web app reads `NEXT_PUBLIC_SERVER_URL` (default `http://localhost:4000`). The server reads `CORS_ORIGIN` (default `http://localhost:3000`).

---

## Testing it with multiple browser tabs

1. Start both apps (`npm run dev`).
2. Open http://localhost:3000 and click **Play Now → Create a room**. Pick a name + mask. You land in a room with a 5-letter code.
3. Click the code to **copy the invite link**.
4. Open a **second tab** (or an incognito window / another device on your LAN) and paste the invite link, or go to **Join with a code** and type the code. Pick a different name.
5. Watch both tabs update live: players appear, ready-status syncs, lobby chat broadcasts in real time.
6. Add at least 4 players total, have everyone click **I'm ready**, and the host clicks **Start game** — all tabs transition to the Role Reveal phase.

Refreshing a tab reclaims the same seat (session is stored in `localStorage`). Closing a tab marks you disconnected; your seat is held for 60s before removal.

### Automated multi-client smoke test

With the server running on :4000:

```bash
node apps/server/test/smoke-lobby.js
```

This connects multiple Socket.IO clients and asserts create/join, duplicate-name rejection, not-enough-players and non-host start rejection, the authoritative start transition, and chat broadcast.

---

## Verification commands

```bash
npm run build          # build shared + server + web
npm run typecheck      # typecheck every workspace
npm run test           # run unit tests (server: role distribution + lobby rules)
```

Server unit tests live in `apps/server/src/**/*.spec.ts`.

---

## Running with Docker (Postgres + Redis + apps)

```bash
cp .env.example .env
docker compose up --build
```

This brings up PostgreSQL, Redis, the server, and the web app. Ollama is commented out in `docker-compose.yml`; run it on the host (recommended for GPU) and the server reaches it via `OLLAMA_BASE_URL`.

---

## Game rules (target design)

- **Roles:** Townsperson, Detective (investigate 1/night), Doctor (protect 1/night), Mafia (shared night kill). Counts scale with player count — see `roleDistribution()` in `packages/shared`.
- **Loop:** Lobby → Role reveal → Night → Resolution → Day → Voting → Elimination → Win check → repeat → Results.
- **Config:** phase durations, tie rules, role reveal on elimination, and vote-change are all in `RoomSettings`.
- Victory: Town wins when all Mafia are eliminated; Mafia wins when they reach parity with Town.

The deterministic engine (role assignment, night resolution, voting, win checks) is implemented in **Phase 2**.

---

## Roadmap

| Phase | Scope | State |
|------|-------|-------|
| 1 | Monorepo, shared contract, playable realtime lobby | ✅ done |
| 2 | Full human-only game loop (authoritative engine) | next |
| 3 | Timers, reconnection hardening, anti-cheat, Redis scaling | |
| 4 | Ollama narration + scenario generation | |
| 5 | AI opponents (role-aware, bounded prompts, fallbacks) | |
| 6 | Profiles, XP, achievements, leaderboards | |
| 7 | Entitlements + cosmetic inventory (no pay-to-win) | |
| 8 | Full tests, Docker, observability, security + perf | |

---

## Security notes

- Every inbound Socket.IO event is validated server-side (`packages/shared/validation.ts` + `RoomsService` guards).
- Chat, room creation, and joins are rate-limited (token bucket).
- Session tokens are opaque; `sessionId` is never part of the public player projection.
- No secret game state is placed in client-readable storage or `NEXT_PUBLIC_*` env vars.
