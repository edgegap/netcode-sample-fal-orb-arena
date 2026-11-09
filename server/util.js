// Small helpers for the server. From the edgegap-threejs skill (assets/server/util.js), trimmed to
// what Orb Arena uses.

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Axis input from a client, sanitised: never trust the numbers that come over the wire. */
export const axisIn = (v) => (Number.isFinite(v) ? clamp(v, -1, 1) : 0);

/** Players sorted by score, the shape Room.finish() expects in result.ranking. */
export function ranking(room) {
  return [...room.players.values()]
    .sort((a, b) => b.score - a.score)
    .map((p) => ({ id: p.id, name: p.name, score: p.score }));
}

/** Free-for-all result: highest score wins. */
export function ffaResult(room, suffix = "") {
  const rank = ranking(room);
  const top = rank[0];
  const tie = rank[1] && rank[1].score === top.score;
  return { winner: tie ? "Draw!" : `${top.name} wins${suffix}`, ranking: rank };
}
