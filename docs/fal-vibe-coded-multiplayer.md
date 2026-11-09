# How to make a multiplayer vibe-coded game with fal AI

This guide walks through how Orb Arena was made: **fal Agent** wrote a single-player browser game,
then the game went online with **Edgegap**. Each match gets its own server near its players, the
matchmaker groups players together, and the server shuts itself down when the match is over, so you
only pay while people play.

```
fal Agent ──writes──> rules.js + main.js + index.html          (solo game vs bots, in the browser)
                         │
                         │ rules.js is shared, unchanged
                         v
page (GitHub Pages) ──Find match──> Edgegap matchmaker ──starts──> one Node.js server per match
      <────────────── wss://<id>.pr.edgegap.net:<port> ───────────  runs rules.js at 60 Hz,
                                                                     fills seats with bots,
                                                                     stops itself after the match
```

Total time for this sample: about one afternoon, most of it waiting on builds. Cost of a match:
one 0.25 vCPU server for the length of the match plus about 10 seconds.

## What you need

- A fal account (fal.ai). The free models of fal Agent were enough for this game.
- An Edgegap account (app.edgegap.com). The free tier works for testing: one matchmaker that stops
  after 3 hours, one server at a time.
- A GitHub repo. GitHub Actions builds the server image and GitHub Pages hosts the page, so you
  don't need Docker or Node installed on your own computer.
- Optional but recommended: an AI coding agent with the Edgegap MCP server connected
  (`https://mcp.edgegap.dev`). Its `edgegap-vibe-coded` and `edgegap-threejs` skills hold the
  server templates, the matchmaker config and the tests used here.

## Step 1: Ask fal Agent for a game that can go online

fal Agent is built for images and video, but it will write code when you ask for it. The one thing
that makes or breaks the multiplayer step is **where the rules live**. Ask for them in their own
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

fal Agent answered in about a minute with the three files. Copy them into `client/` in your repo
and open `index.html` through any local web server: you have a working single-player game.

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
- The fal chat is your record of how the game was made: keep the link.

## Step 2: Add online play

This is the part an AI coding agent with the Edgegap MCP does well. The prompt:

> Make this game online multiplayer on Edgegap. Use the Edgegap MCP and its edgegap-vibe-coded
> skill. Keep the solo mode, add a Find match button, 2 to 4 players per match, bots fill empty
> seats. Ask me before you create anything in my Edgegap account.

What gets added (all of it is in this repo):

| File | What it does |
|---|---|
| `server/main.js`, `room.js`, `edgegap.js`, `util.js` | Edgegap templates, unchanged: connections, phases (waiting, countdown, playing, over), bots, the self-stop when the match ends. |
| `server/game.js` | About 70 lines that wrap `client/rules.js`: take inputs from players, run `step()`, send a snapshot 20 times a second. |
| `client/online.js`, `client/net.js` | Find match through the Edgegap JS SDK, then the WebSocket to the match server, with retries while the server boots. |
| `client/main.js` | fal's renderer now draws either the solo world or the server's snapshots. Solo mode is unchanged. |
| `client/config.js` | The matchmaker URL and its Auth Token. That token is made to ship in game pages: it can only ask for matches. Never put your Edgegap API token in the page. |
| `tests/local-match.mjs` | Two headless players play a full match against a local server. Runs in CI on every build. |
| `tests/e2e.mjs` | The same, through the real matchmaker and a real Edgegap server, then checks the server stopped itself. |

The server never trusts the browser: it only accepts button presses and an aim point, clamps them,
and decides movement, hits and scores itself.

## Step 3: Build the server image with GitHub Actions

`.github/workflows/server-image.yml` builds the server on every push to `main`, runs the local
match test, and pushes the image to the Edgegap Container Registry with a time-based tag such as
`20261109-1533`.

One-time setup in the GitHub repo (Settings > Secrets and variables > Actions):

1. Variable `EDGEGAP_REGISTRY_PROJECT`: the project shown in the Edgegap dashboard, Container
   Registry page (looks like `edgegap-xxxxxxxx`).
2. Secrets `EDGEGAP_REGISTRY_USERNAME` and `EDGEGAP_REGISTRY_TOKEN`: from the **Credentials** box on
   that same page. Don't click Regenerate Token if other projects already push there.

> **Pitfall we hit:** with its default settings, `docker/build-push-action` adds provenance
> attestations, which wraps the image in a multi-manifest index. Edgegap then fails with "Unable to
> pull image from registry". Keep `provenance: false` and `sbom: false` in the workflow, as this repo
> does.

## Step 4: Create the app version in the Edgegap dashboard

Applications > Create application (`orb-arena`), then the version form:

| Setting | Value | Why |
|---|---|---|
| Version name | the image tag, e.g. `20261109-1533` | Easy to match builds to versions. |
| vCPU | 0.25 (512 MB RAM) | Plenty for a 4-player Node.js match. |
| Registry | Edgegap (registry.edgegap.com), repository `<project>/orb-arena`, tag from the build | The dashboard fills the pull credentials. |
| Max duration | 30 minutes | A backstop: the server normally stops itself much earlier. |
| Restart policy | Never | A crashed match should end, not restart half-played. |
| Port | 7777, protocol **WS**, name `gameport`, **TLS Upgrade on** | Pages on https can only open `wss://`. Edgegap adds TLS in front, so the server stays plain `ws`. |
| Env `EMPTY_TIMEOUT_S` | 15 | Stop 15 s after the last player leaves. |
| Env `FIRST_JOIN_TIMEOUT_S` | 60 | Stop if matched players never connect. |
| Env `RESULTS_SECONDS` | 8 | Results screen length before the server stops. |

To ship a new server build later, change the tag on the version and save. Running matches are not
affected.

## Step 5: Create the matchmaker

Matchmakers > Create Matchmaker, upload `matchmaker/arena.json`, **Create and Start**.

- Profile `arena`: 2 to 4 players per match. After 20 seconds in the queue, a lone player gets a
  match on their own and bots fill the other seats, so nobody waits forever.
- `application.version` must be your app version name.
- `allowed_cors_origins` must list every address the page is served from, scheme + host + port
  (for example `https://edgegap.github.io` and `http://localhost:8080`). A missing origin shows up
  as Find match failing straight away in the browser.
- The dashboard may warn that the image "is not cached" or "not valid" while it can't check a
  private registry. Continue, then prove it with the end-to-end test.

Copy the **API URL** and **Auth Token** from the matchmaker page into `client/config.js`.

Free tier: the matchmaker stops about 3 hours after each start (Quick Restart brings it back), and
only one server runs at a time. A demo that stays up needs a paid tier.

## Step 6: Host the page

`.github/workflows/pages.yml` publishes `client/` to GitHub Pages on every push to `main`. Turn it
on once: Settings > Pages > Source: **GitHub Actions**. Add the Pages address to the matchmaker's
`allowed_cors_origins` (Stop > Configuration > edit > Start).

A personal GitHub account on the free plan only runs Pages for public repos. Any static host works
the same way, as long as its address is in the CORS list.

## Step 7: Prove it end to end

1. Actions > **Matchmaker e2e** > Run workflow. Two headless players queue, land on the same
   server, play to 10 points, and the test checks that the server stopped itself. The first
   passing run for this sample:

   ```
   e2e-1: SEARCHING after 3s
   e2e-2: MATCH_FOUND after 11s
   e2e-1: HOST_ASSIGNED after 13s
   server: wss://fe56c9e590b2.pr.edgegap.net:30279
   result: e2e-1 wins; scores: e2e-1 10, e2e-2 9, Zed (bot) 8, Rusty (bot) 6
   deployment stopped itself 9s after the match
   PASS
   ```

2. Open the page in two browser windows and click **Find match** in both within 20 seconds. You
   land in the same match with two bots. Alone, you get a match against three bots after 20 seconds.
3. In the dashboard's Deployments list, nothing should stay running after the match.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Deployment log: "Unable to pull image from registry" | `provenance: false` / `sbom: false` in the build, check the registry secrets, then put the new tag on the version. |
| Find match fails immediately in the browser | The page's address is missing from `allowed_cors_origins`, or `client/config.js` has the wrong URL or token. |
| "Server starting, connecting (n/10)" | Normal for a few seconds after a server is assigned. If it never connects, check the port is WS with TLS Upgrade on. |
| Matched but the page shows nobody else | Both players must queue within 20 seconds of each other, or each gets their own match with bots. |
| Matchmaker went offline | Free tier: about 3 hours per start. Use Quick Restart. |
| Servers keep running | Check the env vars above and that restart policy is Never. The 30-minute max duration stops them anyway. |

## Make your own

1. Run the Step 1 prompt with your own game idea, keeping the architecture paragraph as is.
2. Copy `server/`, `client/online.js`, `client/net.js`, `client/config.js`, `tests/` and the
   workflows from this repo, then adapt `server/game.js` to your rules (most of it is snapshot
   fields).
3. Follow steps 3 to 7.

Credits: game design, rules and renderer by fal Agent; Edgegap integration from the Edgegap MCP
skills (`edgegap-vibe-coded`, `edgegap-threejs`).
