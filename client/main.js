// Orb Arena page. The solo game and renderer were written by fal Agent; online play on Edgegap
// (Find Match through the matchmaker, one authoritative server per match) was added around them.
// Solo: this page runs rules.js itself. Online: the server runs rules.js, this page sends inputs
// and draws the snapshots it gets back.
import { createWorld, addPlayer, setInput, step, botInput, WIN_SCORE } from "./rules.js";
import { LOCAL_PORT, autoplay, cancelMatchmaking, directServer, findMatch, joinServer, loadConfig } from "./online.js";

const canvas = document.querySelector("#game");
const ctx = canvas.getContext("2d");
const $ = (id) => document.getElementById(id);
const ui = { menu: $("menu"), name: $("name"), find: $("find"), solo: $("solo"), local: $("local"),
  cancel: $("cancel"), status: $("status"), restart: $("restart"), leave: $("leave") };

const SIZE = 800;
const FIXED_DT = 1 / 60;
const PALETTE = ["#56e0ff", "#ff6384", "#ffd166", "#a78bfa"];

const keysDown = new Set();
const controlledKeys = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight"]);

let mode = "menu"; // "menu" | "solo" | "online"
let world = null; // solo world
let online = null; // { session, state, view, myId }
let mouse = { x: SIZE / 2, y: SIZE / 2 };
let mouseDown = false;
let fireQueued = false;
let accumulator = 0;
let previousTime = 0;

try { ui.name.value = localStorage.getItem("orb-arena-name") || ""; } catch {}
if (!ui.name.value) ui.name.value = `Pilot${Math.floor(Math.random() * 900 + 100)}`;
const playerName = () => {
  const n = ui.name.value.trim().slice(0, 16) || "Pilot";
  try { localStorage.setItem("orb-arena-name", n); } catch {}
  return n;
};
if (["localhost", "127.0.0.1"].includes(location.hostname)) ui.local.hidden = false;

// ---- solo (fal Agent's game loop) ---------------------------------------------------------------

function startSolo() {
  world = createWorld();
  addPlayer(world, "human", playerName(), false);
  addPlayer(world, "bot1", "Bot 1", true);
  addPlayer(world, "bot2", "Bot 2", true);
  addPlayer(world, "bot3", "Bot 3", true);
  fireQueued = false;
  accumulator = 0;
  mode = "solo";
  ui.menu.hidden = true;
  ui.restart.hidden = true;
  ui.leave.hidden = false;
}

function humanInput() {
  return {
    up: keysDown.has("KeyW") || keysDown.has("ArrowUp"),
    down: keysDown.has("KeyS") || keysDown.has("ArrowDown"),
    left: keysDown.has("KeyA") || keysDown.has("ArrowLeft"),
    right: keysDown.has("KeyD") || keysDown.has("ArrowRight"),
    aimX: Math.round(mouse.x),
    aimY: Math.round(mouse.y),
    fire: fireQueued || mouseDown,
  };
}

function updateSolo(dt) {
  setInput(world, "human", humanInput());
  fireQueued = false;
  for (const id of ["bot1", "bot2", "bot3"]) setInput(world, id, botInput(world, id));
  for (const event of step(world, dt)) if (event.type === "win") ui.restart.hidden = false;
}

function soloView() {
  const players = Object.values(world.players).map((p, i) => ({
    id: p.id, name: p.name, score: p.score, x: p.x, y: p.y, radius: p.radius,
    inv: p.invulnerable > 0, aimX: world.inputs[p.id]?.aimX ?? p.x + 1, aimY: world.inputs[p.id]?.aimY ?? p.y,
    color: PALETTE[i % PALETTE.length], me: p.id === "human",
  }));
  const w = world.winner && world.players[world.winner];
  return { players, projectiles: world.projectiles, big: w ? `${w.name} wins!` : "", sub: w ? "Press Restart to play again" : "", banner: "" };
}

// ---- online (Edgegap) ---------------------------------------------------------------------------

async function play(url, ticket) {
  ui.status.textContent = "Connecting to the match server...";
  online = { state: null, view: new Map(), myId: null, session: null };
  const session = await joinServer(url, playerName(), ticket, {
    onState: (msg) => (online.state = msg),
    onClose: () => online && backToMenu(online.state?.phase === "over" ? "Match finished. Find another?" : "Disconnected from the match server."),
    onStatus: (t) => (ui.status.textContent = t),
  });
  online.session = session;
  online.myId = session.myId;
  mode = "online";
  ui.menu.hidden = true;
  ui.leave.hidden = false;
  ui.restart.hidden = true;
}

async function onFindMatch() {
  setBusy(true);
  try {
    const config = await loadConfig();
    if (!config.matchmakerUrl || !config.matchmakerToken) throw new Error("No matchmaker configured (client/config.js).");
    const { url, ticketId } = await findMatch(config, (t) => (ui.status.textContent = t));
    await play(url, ticketId);
  } catch (err) {
    ui.status.textContent = err?.message === "cancelled" || err?.event?.status === "CANCELLED" ? "Search cancelled." : `Could not find a match: ${err?.message ?? err}`;
  } finally {
    setBusy(false);
  }
}

async function onDirect(url) {
  setBusy(true);
  try {
    await play(url, undefined);
  } catch (err) {
    ui.status.textContent = `Could not join: ${err?.message ?? err}`;
  } finally {
    setBusy(false);
  }
}

function setBusy(busy) {
  ui.find.disabled = ui.solo.disabled = ui.local.disabled = busy;
  ui.cancel.hidden = !busy;
}

function sendOnlineInput() {
  if (online?.state?.phase !== "playing") return;
  online.session.sendInput(humanInput());
  fireQueued = false;
}

// Ease every ship toward the latest server position: no client-side rules, just smoothing.
function onlineView(dt) {
  const st = online.state;
  if (!st) return { players: [], projectiles: [], big: "", sub: "", banner: "Waiting for the server..." };
  const names = new Map(st.players.map((p) => [p.id, p]));
  const k = 1 - Math.exp(-18 * dt);
  const order = st.players.map((p) => p.id);
  const players = st.s.p.map((s) => {
    let v = online.view.get(s.id);
    if (!v) online.view.set(s.id, (v = { x: s.x, y: s.y }));
    if (Math.hypot(s.x - v.x, s.y - v.y) > 120) Object.assign(v, { x: s.x, y: s.y }); // respawn: snap
    v.x += (s.x - v.x) * k;
    v.y += (s.y - v.y) * k;
    const info = names.get(s.id) ?? { name: "?", score: 0 };
    const me = s.id === online.myId;
    const others = order.filter((id) => id !== online.myId);
    const color = me ? PALETTE[0] : PALETTE[1 + (others.indexOf(s.id) % 3)];
    const aim = me ? mouse : { x: s.ax, y: s.ay };
    return { id: s.id, name: info.name, score: info.score, x: v.x, y: v.y, radius: 18, inv: s.inv, aimX: aim.x, aimY: aim.y, color, me };
  });
  const projectiles = st.s.b.map(([x, y]) => ({ x, y }));
  const t = st.timer;
  let banner = "", big = "", sub = "";
  if (st.phase === "waiting") banner = st.waitingFor > 0 ? `Waiting for ${st.waitingFor} more player(s)...` : "Waiting for players...";
  else if (st.phase === "countdown") big = t > 0 ? String(t) : "GO!";
  else if (st.phase === "playing") banner = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")} · first to ${WIN_SCORE}`;
  else if (st.phase === "over") { big = st.result?.winner ?? "Match over"; sub = t != null ? `Server closes in ${t}s` : ""; }
  return { players, projectiles, big, sub, banner };
}

function backToMenu(message = "") {
  if (mode === "online") {
    const s = online?.session;
    online = null;
    mode = "menu";
    s?.close();
  }
  mode = "menu";
  world = null;
  ui.menu.hidden = false;
  ui.restart.hidden = true;
  ui.leave.hidden = true;
  ui.status.textContent = message;
}

// ---- rendering (fal Agent's, drawing a view shared by solo and online) --------------------------

function drawArena() {
  ctx.fillStyle = "#101722";
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.strokeStyle = "rgba(122, 160, 190, 0.09)";
  ctx.lineWidth = 1;
  for (let line = 40; line < SIZE; line += 40) {
    ctx.beginPath(); ctx.moveTo(line, 0); ctx.lineTo(line, SIZE); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, line); ctx.lineTo(SIZE, line); ctx.stroke();
  }
  ctx.strokeStyle = "#3b5165";
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, SIZE - 4, SIZE - 4);
  ctx.strokeStyle = "rgba(86, 224, 255, 0.14)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(SIZE / 2, SIZE / 2, 75, 0, Math.PI * 2);
  ctx.stroke();
}

function drawPlayer(p) {
  const angle = Math.atan2(p.aimY - p.y, p.aimX - p.x);
  const blinking = p.inv && Math.floor(performance.now() / 90) % 2 === 0;
  ctx.save();
  ctx.globalAlpha = blinking ? 0.38 : 1;
  ctx.fillStyle = p.color;
  ctx.shadowColor = p.color;
  ctx.shadowBlur = 16;
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "#071018";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(p.x + Math.cos(angle) * 6, p.y + Math.sin(angle) * 6);
  ctx.lineTo(p.x + Math.cos(angle) * (p.radius + 7), p.y + Math.sin(angle) * (p.radius + 7));
  ctx.stroke();
  if (p.inv) {
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius + 5, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#e8f0f7";
  ctx.font = `${p.me ? "bold " : ""}13px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText(p.me ? `${p.name} (you)` : p.name, p.x, p.y - p.radius - 12);
  ctx.restore();
}

function drawHud(view) {
  ctx.textAlign = "left";
  ctx.font = "bold 16px system-ui, sans-serif";
  let y = 26;
  for (const p of [...view.players].sort((a, b) => b.score - a.score)) {
    ctx.fillStyle = p.color;
    ctx.fillText(`${p.name}: ${p.score}`, 18, y);
    y += 23;
  }
  if (view.banner) {
    ctx.textAlign = "right";
    ctx.fillStyle = "#b9c9d8";
    ctx.fillText(view.banner, SIZE - 18, 26);
  }
}

function drawProjectiles(view) {
  for (const b of view.projectiles) {
    ctx.fillStyle = "#fff2b2";
    ctx.shadowColor = "#ffcc66";
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(b.x, b.y, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;
}

function drawBig(view) {
  if (!view.big) return;
  ctx.fillStyle = "rgba(5, 10, 16, 0.6)";
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.textAlign = "center";
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 48px system-ui, sans-serif";
  ctx.fillText(view.big, SIZE / 2, SIZE / 2 - 12);
  if (view.sub) {
    ctx.fillStyle = "#b9c9d8";
    ctx.font = "20px system-ui, sans-serif";
    ctx.fillText(view.sub, SIZE / 2, SIZE / 2 + 30);
  }
}

function render(view) {
  drawArena();
  if (!view) return;
  drawProjectiles(view);
  for (const p of view.players) drawPlayer(p);
  drawHud(view);
  drawBig(view);
}

function frame(timestamp) {
  if (!previousTime) previousTime = timestamp;
  const elapsed = Math.min((timestamp - previousTime) / 1000, 0.1);
  previousTime = timestamp;

  if (mode === "solo") {
    accumulator += elapsed;
    while (accumulator >= FIXED_DT) {
      if (!world.winner) updateSolo(FIXED_DT);
      accumulator -= FIXED_DT;
    }
    render(soloView());
  } else if (mode === "online") {
    sendOnlineInput();
    render(onlineView(elapsed));
  } else {
    render(null);
  }
  requestAnimationFrame(frame);
}

// ---- input --------------------------------------------------------------------------------------

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: ((event.clientX - rect.left) / rect.width) * SIZE, y: ((event.clientY - rect.top) / rect.height) * SIZE };
}

window.addEventListener("keydown", (event) => {
  if (event.target === ui.name) return;
  if (controlledKeys.has(event.code)) {
    event.preventDefault();
    keysDown.add(event.code);
  }
});
window.addEventListener("keyup", (event) => keysDown.delete(event.code));
window.addEventListener("blur", () => { keysDown.clear(); mouseDown = false; });
canvas.addEventListener("pointermove", (event) => (mouse = canvasPoint(event)));
canvas.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  mouse = canvasPoint(event);
  fireQueued = true;
  mouseDown = true;
});
window.addEventListener("pointerup", () => (mouseDown = false));

ui.solo.onclick = startSolo;
ui.restart.onclick = startSolo;
ui.find.onclick = onFindMatch;
ui.local.onclick = () => onDirect(`ws://${location.hostname}:${LOCAL_PORT}`);
ui.cancel.onclick = () => { cancelMatchmaking(); ui.status.textContent = "Cancelling..."; };
ui.leave.onclick = () => backToMenu();

requestAnimationFrame(frame);
if (directServer) onDirect(directServer);
else if (autoplay === "1") onFindMatch();
else if (autoplay === "local") onDirect(`ws://${location.hostname}:${LOCAL_PORT}`);
