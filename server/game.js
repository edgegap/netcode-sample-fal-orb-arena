// Orb Arena on the server. The rules are client/rules.js, the same file the browser runs for solo
// play; here the server owns the world and players only send inputs.
// Implements the room.js game contract from the edgegap-threejs skill (assets/server/game.js).

import * as R from "../client/rules.js";
import { clamp, ffaResult } from "./util.js";

const r1 = (v) => Math.round(v * 10) / 10;
const aim = (v) => (Number.isFinite(v) ? clamp(v, -200, R.ARENA_SIZE + 200) : undefined);

export function createGame() {
  let world = R.createWorld();
  let events = []; // hits since the last snapshot, for client effects

  return {
    name: "orb-arena",
    // Bots fill every empty seat, so 1 to 4 humans always play a 4-ship match.
    config: { tickHz: 60, sendHz: 20, maxPlayers: 4, botFill: 4, matchSeconds: 180 },
    info: () => ({ scoreToWin: R.WIN_SCORE, arena: R.ARENA_SIZE }),

    addPlayer(p) {
      R.addPlayer(world, p.id, p.name, p.bot);
    },
    removePlayer(p) {
      R.removePlayer(world, p.id);
    },
    // Never trust the wire: booleans and clamped numbers only.
    input(p, msg) {
      R.setInput(world, p.id, {
        up: !!msg.up, down: !!msg.down, left: !!msg.left, right: !!msg.right,
        aimX: aim(msg.aimX), aimY: aim(msg.aimY), fire: !!msg.fire,
      });
    },
    // A fresh world for each match, with the room's current players in it.
    start(room) {
      world = R.createWorld();
      for (const p of room.players.values()) R.addPlayer(world, p.id, p.name, p.bot);
      events = [];
    },
    reset() {
      world = R.createWorld();
    },

    update(dt, room) {
      for (const p of Object.values(world.players)) if (p.isBot) R.setInput(world, p.id, R.botInput(world, p.id));
      for (const e of R.step(world, dt)) {
        if (e.type === "hit") {
          const shooter = room.players.get(e.shooter);
          if (shooter) shooter.score = world.players[e.shooter]?.score ?? shooter.score + 1;
          events.push({ type: "hit", shooter: e.shooter, victim: e.victim });
        }
      }
    },

    result(room) {
      return world.winner != null ? ffaResult(room) : null;
    },
    timeUp: (room) => ffaResult(room),

    snapshot() {
      const s = {
        p: Object.values(world.players).map((p) => ({
          id: p.id, x: r1(p.x), y: r1(p.y),
          ax: r1(world.inputs[p.id]?.aimX ?? p.x + 1), ay: r1(world.inputs[p.id]?.aimY ?? p.y),
          inv: p.invulnerable > 0,
        })),
        b: world.projectiles.map((b) => [r1(b.x), r1(b.y)]),
        ev: events,
      };
      events = [];
      return s;
    },
  };
}
