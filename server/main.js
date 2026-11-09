// Game server entry point: one process = one match = one Edgegap deployment.
// It listens for WebSocket connections on PORT (default 7777). On Edgegap the app version maps
// that port as "gameport", protocol WS, TLS Upgrade on, so browsers connect with
// wss://<fqdn>:<external port>.
//
// From the edgegap-threejs skill (assets/server/main.js), unchanged except for this header.

import http from "node:http";
import { WebSocketServer } from "ws";
import { Room } from "./room.js";
import { createGame } from "./game.js";
import { describeDeployment, log, onEdgegap, selfStop } from "./edgegap.js";

const room = new Room(createGame());

const port = Number(process.env.PORT ?? 7777);
const server = http.createServer((req, res) => {
  // Plain HTTP answers with a status line: handy for curl and for Edgegap's port check.
  res.writeHead(200, { "content-type": "text/plain" });
  res.end(`${room.game.name} ${room.phase} ${room.humans().length} player(s)\n`);
});
new WebSocketServer({ server }).on("connection", (ws) => room.accept(ws));
server.listen(port, () => {
  log(`${room.game.name} server listening on :${port}`);
  log(describeDeployment());
});

// Edgegap sends SIGTERM when the deployment stops (self-stop, dashboard, API or max duration).
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    log(`${sig}: closing`);
    for (const p of room.humans()) p.ws?.close(1001, "server stopping");
    setTimeout(() => process.exit(0), 200);
  });
}
if (onEdgegap) process.on("uncaughtException", (err) => (console.error(err), selfStop("crash")));
