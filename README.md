# Orb Arena

A small top-down arena shooter for 4 ships, built by **fal Agent** (gameplay, rules and renderer)
and made online multiplayer on **Edgegap**: Find Match goes through the Edgegap matchmaker, which
starts one authoritative Node.js server per match near the players. Empty seats are filled with bots,
and the server stops its own deployment when the match ends.

```
page (client/) --Find match--> Edgegap matchmaker (profile "arena", 2-4 players, alone after 20 s)
     <-- wss://<fqdn>:<port> --  one server per match (server/), runs client/rules.js at 60 Hz
```

- `client/rules.js`: all game rules (fal Agent). Imported by the page for solo play and by the server online.
- `client/main.js`: fal Agent's renderer and solo loop, plus the online mode.
- `client/online.js`, `client/net.js`: Edgegap JS SDK matchmaking and the WebSocket client.
- `server/`: room, phases, bots, self-stop (Edgegap `edgegap-threejs` templates), `game.js` wraps the rules.
- `matchmaker/arena.json`: matchmaker config to upload in the Edgegap dashboard.

## Run locally

```
npm install
npm run server        # ws://localhost:7777
npm run client        # http://localhost:8080 -> "Local server :7777" (open two tabs)
npm run test:local    # two headless players play a full match
```

## Online

1. Push to `main`: the GitHub Action builds the image and pushes `registry.edgegap.com/<project>/orb-arena:<YYYYMMDD-HHMM>`.
2. Edgegap app `orb-arena`, version = that tag: port 7777, name `gameport`, protocol WS, TLS Upgrade on,
   256 vCPU units / 512 MB, restart policy Never, max duration 30 min.
3. Matchmaker from `matchmaker/arena.json` (set the version), then put its API URL and Auth Token in `client/config.js`.
