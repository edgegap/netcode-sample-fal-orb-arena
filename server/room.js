// One match on one server: connections, phases, the fixed-rate simulation and state broadcast.
// From the edgegap-threejs skill (assets/server/room.js), unchanged.
//
// Phases: waiting -> countdown -> playing -> over.
//   waiting   until every matched player is in (MM_TICKET_IDS), or WAIT_SECONDS after the first join.
//   countdown COUNTDOWN_SECONDS, the game places players (and bots) for the start.
//   playing   until the game reports a result or MATCH_SECONDS runs out.
//   over      results stay on screen RESULTS_SECONDS, then the deployment stops itself on Edgegap
//             (locally the room goes back to waiting so you can play again).
//
// Wire protocol, JSON text frames:
//   client -> server  {t:"hello", name, ticket?}   {t:"input", ...game fields}
//   server -> client  {t:"welcome", id, game, info}  {t:"state", phase, timer, players, s}  {t:"error", message}

import { onEdgegap, match, selfStop, log } from "./edgegap.js";

const env = process.env;
const num = (v, d) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : d);

const WAIT_SECONDS = num(env.WAIT_SECONDS, 15);
const COUNTDOWN_SECONDS = num(env.COUNTDOWN_SECONDS, 3);
const RESULTS_SECONDS = num(env.RESULTS_SECONDS, 12);
const FIRST_JOIN_TIMEOUT = num(env.FIRST_JOIN_TIMEOUT_S, 120);
const EMPTY_TIMEOUT = num(env.EMPTY_TIMEOUT_S, 30);
const REQUIRE_TICKET = env.REQUIRE_TICKET === "1";

const BOT_NAMES = ["Bolt", "Pixel", "Nova", "Rusty", "Zed", "Mochi", "Turbo", "Echo"];

export class Room {
  constructor(game) {
    this.game = game;
    this.cfg = { tickHz: 30, sendHz: 20, maxPlayers: 8, minPlayers: 1, matchSeconds: 180, ...game.config };
    this.cfg.matchSeconds = num(env.MATCH_SECONDS, this.cfg.matchSeconds);
    this.players = new Map(); // id -> player (humans and bots)
    this.nextId = 1;
    this.phase = "waiting";
    this.phaseEnds = 0; // ms timestamp, 0 = open-ended
    this.firstJoinAt = 0;
    this.result = null;
    this.humansEver = 0;
    this.emptySince = 0;
    this.bootAt = Date.now();
    this.expected = match?.ticketIds.length ?? 0;

    this.lastTick = Date.now();
    setInterval(() => this.tick(), 1000 / this.cfg.tickHz);
    setInterval(() => this.broadcastState(), 1000 / this.cfg.sendHz);
    setInterval(() => this.watchdog(), 1000);
  }

  // ---- connections -------------------------------------------------------------------------

  accept(ws) {
    let player = null;
    ws.on("message", (data) => {
      let msg;
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }
      if (!player) {
        if (msg.t !== "hello") return;
        player = this.join(ws, msg);
        return;
      }
      if (msg.t === "input" && this.phase !== "over") this.game.input(player, msg);
    });
    ws.on("close", () => player && this.leave(player));
  }

  join(ws, hello) {
    const humans = [...this.players.values()].filter((p) => !p.bot);
    const reject = (message) => {
      ws.send(JSON.stringify({ t: "error", message }));
      ws.close();
      return null;
    };
    if (REQUIRE_TICKET && match && !match.ticketIds.includes(hello.ticket)) return reject("Unknown matchmaker ticket");
    if (humans.length >= this.cfg.maxPlayers) return reject("Server full");
    if (this.phase === "over") return reject("Match already finished");

    // A late human replaces a bot if the match is full of them.
    if (this.players.size >= this.cfg.maxPlayers) {
      const bot = [...this.players.values()].find((p) => p.bot);
      if (bot) this.removePlayer(bot);
    }

    const name = String(hello.name ?? "").trim().slice(0, 16) || `Player ${this.nextId}`;
    const team = match && hello.ticket ? match.teamOf(hello.ticket) : null;
    const player = { id: this.nextId++, name, ws, bot: false, ticket: hello.ticket ?? null, team, score: 0 };
    this.players.set(player.id, player);
    this.humansEver++;
    this.emptySince = 0;
    if (!this.firstJoinAt) this.firstJoinAt = Date.now();
    this.game.addPlayer(player, this);
    const matchInfo = match ? { id: match.id, profile: match.profile, players: match.ticketIds.length } : null;
    ws.send(JSON.stringify({ t: "welcome", id: player.id, team: player.team, game: this.game.name, match: matchInfo, info: this.game.info?.() ?? {} }));
    log(`join #${player.id} "${name}" ticket=${player.ticket ?? "-"} team=${team ?? "-"} (${humans.length + 1} human)`);
    return player;
  }

  leave(player) {
    this.removePlayer(player);
    log(`leave #${player.id} "${player.name}"`);
    if (![...this.players.values()].some((p) => !p.bot)) this.emptySince = Date.now();
  }

  removePlayer(player) {
    this.players.delete(player.id);
    this.game.removePlayer(player, this);
  }

  addBots(count) {
    for (let i = 0; i < count; i++) {
      const id = this.nextId++;
      const bot = { id, name: `${BOT_NAMES[id % BOT_NAMES.length]} (bot)`, bot: true, team: null, score: 0 };
      this.players.set(id, bot);
      this.game.addPlayer(bot, this);
    }
  }

  humans() {
    return [...this.players.values()].filter((p) => !p.bot);
  }

  // ---- phases ------------------------------------------------------------------------------

  setPhase(phase, seconds = 0) {
    this.phase = phase;
    this.phaseEnds = seconds ? Date.now() + seconds * 1000 : 0;
    log(`phase ${phase}${seconds ? ` (${seconds}s)` : ""}`);
  }

  tick() {
    const now = Date.now();
    const dt = Math.min(0.1, (now - this.lastTick) / 1000);
    this.lastTick = now;
    const humans = this.humans().length;

    switch (this.phase) {
      case "waiting": {
        const everyone = this.expected > 0 && humans >= this.expected;
        const graceOver = this.firstJoinAt && now - this.firstJoinAt > WAIT_SECONDS * 1000;
        if (humans > 0 && (everyone || graceOver)) {
          const missing = this.game.botsNeeded?.(this) ?? Math.max(0, (this.cfg.botFill ?? 0) - this.players.size);
          if (missing) this.addBots(missing);
          for (const p of this.players.values()) p.score = 0;
          this.result = null;
          this.game.start(this);
          this.setPhase("countdown", COUNTDOWN_SECONDS);
        }
        break;
      }
      case "countdown":
        if (now >= this.phaseEnds) this.setPhase("playing", this.cfg.matchSeconds);
        break;
      case "playing": {
        this.game.update(dt, this);
        const result = this.game.result?.(this) ?? (now >= this.phaseEnds ? this.game.timeUp(this) : null);
        if (result) this.finish(result);
        break;
      }
      case "over":
        if (now >= this.phaseEnds) {
          if (onEdgegap) selfStop("match over");
          else this.reset();
        }
        break;
    }
    if (this.phase !== "playing" && this.game.idle) this.game.idle(dt, this);
  }

  finish(result) {
    // result: { winner: "text shown to everyone", ranking: [{id, name, score}] }
    this.result = result;
    log(`match over: ${result.winner}`);
    this.setPhase("over", RESULTS_SECONDS);
  }

  reset() {
    for (const p of [...this.players.values()]) if (p.bot) this.removePlayer(p);
    this.firstJoinAt = this.humans().length ? Date.now() : 0;
    this.game.reset?.(this);
    this.setPhase("waiting");
  }

  watchdog() {
    if (!onEdgegap) return;
    const now = Date.now();
    if (!this.humansEver && now - this.bootAt > FIRST_JOIN_TIMEOUT * 1000) selfStop(`nobody joined within ${FIRST_JOIN_TIMEOUT}s`);
    if (this.emptySince && now - this.emptySince > EMPTY_TIMEOUT * 1000) selfStop(`empty for ${EMPTY_TIMEOUT}s`);
  }

  // ---- state ---------------------------------------------------------------------------------

  broadcastState() {
    if (!this.players.size) return;
    const msg = JSON.stringify({
      t: "state",
      phase: this.phase,
      timer: this.phaseEnds ? Math.max(0, Math.ceil((this.phaseEnds - Date.now()) / 1000)) : null,
      waitingFor: this.phase === "waiting" && this.expected ? this.expected - this.humans().length : null,
      players: [...this.players.values()].map((p) => ({ id: p.id, name: p.name, score: p.score, team: p.team, bot: p.bot })),
      result: this.result,
      s: this.game.snapshot(this),
    });
    for (const p of this.players.values()) if (p.ws?.readyState === 1) p.ws.send(msg);
  }
}
