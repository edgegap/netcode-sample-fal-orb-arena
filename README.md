# How to make a multiplayer vibe-coded game with fal AI

A worked example you can follow step by step: **fal Agent** writes a single-player browser game,
then **Edgegap** takes it online with a matchmaker and one authoritative server per match. Orb
Arena, a top-down arena shooter for 4 ships, is the game built here.

This repo is a recipe, not a live demo. Nothing in it runs on its own: you create your own
Edgegap app version and matchmaker, play, and remove them when you're done. Each server stops
itself when its match ends, so you only pay while people play.

```
fal Agent ──writes──> rules.js + main.js + index.html          (solo game vs bots, in the browser)
                         │
                         │ rules.js is shared, unchanged
                         v
your page ──Find match──> Edgegap matchmaker ──starts──> one Node.js server per match
     <──────────── wss://<id>.pr.edgegap.net:<port> ────  runs rules.js at 60 Hz,
                                                           fills seats with bots,
                                                           stops itself after the match
```

Verified on 2026-11-09: two headless players and two real browser tabs were matched together
through the Edgegap matchmaker, played a full match, and the server stopped itself 9 seconds after
the match ended. Cost of a match: one 0.25 vCPU server for the length of the match plus about 10
seconds.

## What you need

- A fal account (fal.ai). The free models of fal Agent were enough for this game.
- An Edgegap account (app.edgegap.com). The free tier is enough: one matchmaker that stops about
  3 hours after each start, one server at a time.
- A GitHub repo. GitHub Actions builds the server image, so you don't need Docker on your computer.
- Optional but recommended: an AI coding agent with the Edgegap MCP server connected
  (`https://mcp.edgegap.dev`). Its `edgegap-vibe-coded` and `edgegap-threejs` skills hold the
  server templates, the matchmaker config and the tests used here.

## Values you will fill in

| Placeholder | Where it comes from | Where it goes |
|---|---|---|
| `<registry-project>` | Edgegap dashboard > Container Registry (looks like `edgegap-xxxxxxxx`) | GitHub variable `EDGEGAP_REGISTRY_PROJECT` |
| registry username / token | Container Registry > Credentials | GitHub secrets `EDGEGAP_REGISTRY_USERNAME`, `EDGEGAP_REGISTRY_TOKEN` (never in the code) |
| `<image-tag>` | The build summary of the Server image workflow (`YYYYMMDD-HHMM`) | App version tag and name, `matchmaker/arena.json` |
| `<page-origin>` | Where you serve `client/` (`http://localhost:8080`, `https://<org>.github.io`...) | `allowed_cors_origins` in `matchmaker/arena.json` |
| `<matchmaker-url>`, `<matchmaker-token>` | Matchmaker page > API URL and Auth Token | `client/config.js` |

The matchmaker Auth Token is a client token: it can only ask for matches and is made to ship in
game pages. Never put your Edgegap API token in the page, the repo or the image.

## Step 1: Ask fal Agent for a game that can go online

fal Agent is built for images and video, but it writes code when you ask for it. The one thing
that makes or breaks the multiplayer step is **where the rules live**: ask for them in their own
file, with no browser code in it, so a server can run the exact same file later.

The prompt used for Orb Arena, verbatim:

> Build me a small top-down arena browser game called "Orb Arena" as code (HTML + JavaScript, no
> frameworks, plain Canvas 2D). Gameplay: 4 round ships in a square arena (800x800 units), each
> moves with WASD/arrow keys with a bit of drift (velocity + friction), aims with the mouse and fires
> slow projectiles on click (cooldown 0.4 s, projectile speed ~420 units/s, lifetime 1.5 s). A hit
> gives +1 point to the shooter and respawns the victim at a random corner with 1 s invulnerability.
> First to 10 points wins, then a results screen and restart. The human plays against 3 simple bots.
> VERY IMPORTANT architecture: put ALL game rules in a separate file rules.js written as an ES
> module with NO window, document, canvas, audio or timers inside: export createWorld(),
> addPlayer(world, id, name, isBot), removePlayer(world, id), setInput(world, id,
> {up,down,left,right,aimX,aimY,fire}), step(world, dt) that returns an array of events
> ({type:'hit', shooter, victim} and {type:'win', winner}), and botInput(world, id) that returns an
> input object using only positions. index.html + main.js only handle rendering, keyboard/mouse
> input and calling step() at 60 Hz. Optionally generate a small dark sci-fi arena floor background
> image and use it. Please output the full content of rules.js, main.js and index.html so I can
> copy them.

For your own game, change the gameplay paragraph and keep the architecture paragraph as it is.

Why the prompt is shaped this way:

| Prompt detail | Why it matters online |
|---|---|
| Rules in `rules.js`, no `window`/`document`/canvas/timers | The Node.js server imports the same file. No port, no drift between solo and online. |
| `setInput(world, id, input)` with plain booleans and numbers | That object is exactly what the browser sends over the network. |
| `step(world, dt)` returns events | The server forwards hits to every player for effects and scores. |
| `botInput(world, id)` reads only positions | The server fills empty seats with the same bots, and the tests drive headless players with it. |
| Drift (velocity + friction), slow projectiles | The game still feels right with 50 to 100 ms of network delay. Pick slippery movement, pushing, slow shots or turn-based play; avoid precise platforming, rhythm or instant-hit aiming. |

Tips:
- Ask for "the full content of each file". Otherwise you may get a summary or a download you
  can't open.
- If you change the game afterwards in fal Agent, keep repeating "all rules stay in rules.js".

**Done when:** the three files are in `client/`, and serving that folder locally gives a playable
solo game against bots.

## Step 2: Add online play

The prompt for an AI coding agent with the Edgegap MCP:

> Make this game online multiplayer on Edgegap. Use the Edgegap MCP and its edgegap-vibe-coded
> skill. Keep the solo mode, add a Find match button, 2 to 4 players per match, bots fill empty
> seats. Ask me before you create anything in my Edgegap account.

What gets added (all of it is in this repo, ready to copy):

| File | What it does |
|---|---|
| `server/main.js`, `room.js`, `edgegap.js`, `util.js` | Edgegap templates, unchanged: connections, phases (waiting, countdown, playing, over), bots, the self-stop when the match ends. |
| `server/game.js` | About 70 lines that wrap `client/rules.js`: take inputs from players, run `step()`, send a snapshot 20 times a second. The only server file you adapt to your game. |
| `client/online.js`, `client/net.js` | Find match through the Edgegap JS SDK, then the WebSocket to the match server, with retries while the server boots. |
| `client/main.js` | fal's renderer now draws either the solo world or the server's snapshots. Solo mode is unchanged. |
| `client/config.js` | `<matchmaker-url>` and `<matchmaker-token>`, empty until step 5. |
| `server/Dockerfile` | Node 22 image with `server/` and `client/rules.js`. |
| `tests/local-match.mjs` | Two headless players play a full match against a local server. Runs in CI on every build. |
| `tests/e2e.mjs` | The same through the real matchmaker and a real Edgegap server, then checks the server stopped itself. |

The server never trusts the browser: it only accepts button presses and an aim point, clamps them,
and decides movement, hits and scores itself.

**Done when:** `npm install && npm run test:local` prints `PASS`, and two tabs on the local page
(**Local server :7777**) see the same match.

## Step 3: Build the server image with GitHub Actions

`.github/workflows/server-image.yml` builds the server on every push to `main` (and on demand),
runs the local match test, and pushes the image to the Edgegap Container Registry as
`registry.edgegap.com/<registry-project>/orb-arena:<image-tag>`.

One-time setup in the GitHub repo (Settings > Secrets and variables > Actions):

1. Variable `EDGEGAP_REGISTRY_PROJECT` = `<registry-project>`.
2. Secrets `EDGEGAP_REGISTRY_USERNAME` and `EDGEGAP_REGISTRY_TOKEN` from the Credentials box. Don't
   click Regenerate Token if other projects already push to that registry.

> **Pitfall:** with its default settings, `docker/build-push-action` adds provenance attestations,
> which wrap the image in a multi-manifest index. Edgegap then fails with "Unable to pull image from
> registry". Keep `provenance: false` and `sbom: false` in the workflow, as this repo does.

**Done when:** the workflow's summary shows `Pushed registry.edgegap.com/...:<image-tag>`.

## Step 4: Create the app version in the Edgegap dashboard

Applications > Create application (`orb-arena`), then the version form:

| Setting | Value | Why |
|---|---|---|
| Version name | `<image-tag>` | Easy to match builds to versions. |
| vCPU | 0.25 (512 MB RAM) | Plenty for a 4-player Node.js match. |
| Registry | Edgegap (registry.edgegap.com), repository `<registry-project>/orb-arena`, tag `<image-tag>` | The dashboard fills the pull credentials. |
| Max duration | 30 minutes | A backstop: the server normally stops itself much earlier. |
| Restart policy | Never | A crashed match should end, not restart half-played. |
| Port | 7777, protocol **WS**, name `gameport`, **TLS Upgrade on** | Pages on https can only open `wss://`. Edgegap adds TLS in front, so the server stays plain `ws`. |
| Env `EMPTY_TIMEOUT_S` | 15 | Stop 15 s after the last player leaves. |
| Env `FIRST_JOIN_TIMEOUT_S` | 60 | Stop if matched players never connect. |
| Env `RESULTS_SECONDS` | 8 | Results screen length before the server stops. |

To ship a new server build later, change the tag on the version and save. Running matches are not
affected.

**Done when:** the version shows the port `7777 WS gameport` with TLS Upgrade `true` and the three
env vars.

## Step 5: Create the matchmaker

1. In `matchmaker/arena.json`, set `application.version` to `<image-tag>` and list every
   `<page-origin>` in `allowed_cors_origins` (scheme + host + port; the file starts with
   `http://localhost:8080`).
2. Matchmakers > Create Matchmaker, upload the file, **Create and Start**. The dashboard may warn
   that the image "is not cached" or "not valid" when it can't check a private registry: continue,
   the end-to-end test proves it.
3. Copy the **API URL** and **Auth Token** into `client/config.js`.

The profile `arena` matches 2 to 4 players. After 20 seconds in the queue, a lone player gets a
match on their own and bots fill the other seats, so nobody waits forever.

**Done when:** the matchmaker shows ONLINE and `client/config.js` has its URL and token.

## Step 6: Serve the page

`client/` is a static page: serve it from any static host whose address is in
`allowed_cors_origins`.

- Locally: `npm run client`, then http://localhost:8080.
- GitHub Pages: `.github/workflows/pages.yml` publishes `client/` when you run it from the Actions
  tab. Turn Pages on once (Settings > Pages > Source: **GitHub Actions**) and add
  `https://<org>.github.io` to the CORS list. On the free GitHub plan, Pages only runs for public
  repos, and a new site's first deployment can sit in `deployment_queued` for several minutes.

**Done when:** the page loads and **Play vs bots** works.

## Step 7: Prove it end to end

1. Actions > **Matchmaker e2e** > Run workflow (it reads `client/config.js`). Two headless players
   queue, land on the same server, play to 10 points, and the test checks that the server stopped
   itself. The passing run for this example:

   ```
   e2e-1: SEARCHING after 3s
   e2e-2: MATCH_FOUND after 11s
   e2e-1: HOST_ASSIGNED after 13s
   server: wss://<id>.pr.edgegap.net:<port>
   result: e2e-1 wins; scores: e2e-1 10, e2e-2 9, Zed (bot) 8, Rusty (bot) 6
   deployment stopped itself 9s after the match
   PASS
   ```

2. Open the page in two browser windows and click **Find match** in both within 20 seconds. Both
   land in the same match with two bots, on a server near you. `?autoplay=1` on the URL starts
   Find match on page load.
3. In the dashboard's Deployments list, nothing stays running after the match.

**Done when:** the e2e workflow prints `PASS` and the two windows played one match together.

## Step 8: Clean up

Nothing here should run non-stop:

- Each match server stops itself when the match ends (or 15 s after everyone leaves, or 60 s if
  nobody joins; 30 minutes at most).
- **Stop or delete the matchmaker** when you're done testing. On the free tier it stops by itself
  about 3 hours after each start; Start or Quick Restart brings it back for the next session.
- If you published the page, players will only get "Could not find a match" while the matchmaker
  is off; **Play vs bots** keeps working. Unpublish it (Settings > Pages) if you don't want it up.
- The app version, registry images and GitHub secrets cost nothing while idle.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Deployment log: "Unable to pull image from registry" | `provenance: false` / `sbom: false` in the build, check the registry secrets, then put the new tag on the version. |
| Find match fails immediately in the browser | The page's origin is missing from `allowed_cors_origins`, the matchmaker is stopped, or `client/config.js` has the wrong URL or token. |
| "Server starting, connecting (n/10)" | Normal for a few seconds after a server is assigned. If it never connects, check the port is WS with TLS Upgrade on. |
| Matched but the page shows nobody else | Both players must queue within 20 seconds of each other, or each gets their own match with bots. |
| Matchmaker went offline | Free tier: about 3 hours per start. Start it again from the dashboard. |
| Servers keep running | Check the env vars in step 4 and that restart policy is Never. The 30-minute max duration stops them anyway. |

## Make your own

1. Run the step 1 prompt with your own game idea, keeping the architecture paragraph.
2. Copy `server/`, `client/online.js`, `client/net.js`, `client/config.js`, `tests/`,
   `matchmaker/` and `.github/workflows/` from this repo, then adapt `server/game.js` to your
   rules (mostly the snapshot fields) and `playLikeABot()` in `tests/headless-player.mjs`.
3. Follow steps 3 to 8 with your own placeholders.

## Repo layout

- `client/rules.js`: all game rules (fal Agent). Imported by the page for solo play and by the server online.
- `client/main.js`, `client/index.html`: fal Agent's renderer and solo loop, plus the online mode and menu.
- `client/online.js`, `client/net.js`, `client/config.js`: Edgegap JS SDK matchmaking, the WebSocket client, the matchmaker settings.
- `server/`: room, phases, bots, self-stop (Edgegap `edgegap-threejs` templates); `game.js` wraps the rules.
- `matchmaker/arena.json`: matchmaker config to upload in the Edgegap dashboard.
- `tests/`: local match test and matchmaker end-to-end test.
- `.github/workflows/`: server image build, matchmaker e2e, optional GitHub Pages.

## Run locally

```
npm install
npm run server        # ws://localhost:7777
npm run client        # http://localhost:8080 -> "Local server :7777" (open two tabs)
npm run test:local    # two headless players play a full match
```

Credits: game design, rules and renderer by fal Agent; Edgegap integration from the Edgegap MCP
skills (`edgegap-vibe-coded`, `edgegap-threejs`).
