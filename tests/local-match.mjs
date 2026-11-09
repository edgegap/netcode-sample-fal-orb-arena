#!/usr/bin/env node
// Local check, no Edgegap: two headless players play a whole match on a game server.
//
//   node tests/local-match.mjs                       starts server/main.js itself, short timers
//   SERVER_URL=ws://localhost:31504 node tests/local-match.mjs   uses a server you started (e.g. the container)
//
// Passes when both players see countdown -> playing -> over, the same result, and hits were scored.

import { spawn } from "node:child_process";
import { playSession, playLikeABot } from "./headless-player.mjs";

const external = process.env.SERVER_URL;
const PORT = 7790;
let server = null;
if (!external) {
  server = spawn(process.execPath, ["server/main.js"], {
    env: { ...process.env, PORT: String(PORT), WAIT_SECONDS: "2", COUNTDOWN_SECONDS: "1", RESULTS_SECONDS: "2", MATCH_SECONDS: process.env.MATCH_SECONDS ?? "45" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  server.stdout.on("data", (d) => process.env.VERBOSE && process.stdout.write(d));
  await new Promise((r) => server.stdout.once("data", r));
}
const url = external ?? `ws://localhost:${PORT}`;
console.log(`playing on ${url}`);

const names = ["local-1", "local-2"];
const reports = await Promise.all(names.map((name) => playSession({ url, name, makeInput: playLikeABot(), maxSeconds: 400 })));

const problems = [];
for (const r of reports) {
  if (r.error) problems.push(`${r.name}: ${r.error}`);
  for (const p of ["countdown", "playing", "over"]) if (!r.phases.includes(p)) problems.push(`${r.name}: never saw ${p}`);
}
const [a, b] = reports;
if (a.result?.winner !== b.result?.winner) problems.push("players saw different results");
const scores = a.result?.ranking ?? [];
const total = scores.reduce((s, p) => s + p.score, 0);
if (!total) problems.push("no hits scored");
if (a.players.length !== 4) problems.push(`expected 4 ships (2 players + 2 bots), saw ${a.players.length}`);

console.log(`result: ${a.result?.winner}; scores: ${scores.map((p) => `${p.name} ${p.score}`).join(", ")}`);
server?.kill("SIGTERM");
console.log(problems.length ? `FAIL\n - ${problems.join("\n - ")}` : "PASS");
process.exit(problems.length ? 1 : 0);
