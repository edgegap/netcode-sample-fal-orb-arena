// Online play: Find Match through the Edgegap matchmaker, then a WebSocket to that match's server.
// The server decides everything; this file sends inputs and hands server state to the page.
// Copied from the Orb Herders sample (edgegap/netcode-sample-threejs-vibe-coded).
// The Find Match block follows the edgegap-threejs skill (assets/client/shell.js).

import { getConnectionUrl, matchmaking } from "@edgegap/sdk";
import { connect } from "./net.js";
import baseConfig from "./config.js";

export const PROFILE = "arena"; // matchmaker profile name
export const LOCAL_PORT = 7777;

const params = new URLSearchParams(location.search);

const MATCHMAKING_STATUS = {
  SEARCHING: "Searching for players...",
  TEAM_FOUND: "Match found! Starting a server near you...",
  MATCH_FOUND: "Match found! Starting a server near you...",
  HOST_ASSIGNED: "Server ready!",
};

export async function loadConfig() {
  const cfg = { ...baseConfig };
  try {
    Object.assign(cfg, (await import("./config.local.js")).default);
  } catch {}
  if (params.get("mm")) cfg.matchmakerUrl = params.get("mm");
  if (params.get("token")) cfg.matchmakerToken = params.get("token");
  return cfg;
}

let mm = null;

/** Queue as a group of one; resolves with the server URL and our ticket once a server is up. */
export async function findMatch(config, onStatus) {
  onStatus("Joining queue...");
  mm?.dispose();
  // The Auth Token is the matchmaker's client token, sent raw. The page's origin must be in the
  // matchmaker config's allowed_cors_origins.
  mm = new matchmaking.GroupAgent({ baseUrl: config.matchmakerUrl, authToken: config.matchmakerToken, logGroupUpdates: false });
  mm.initialize(undefined, ({ current }) => {
    if (MATCHMAKING_STATUS[current?.status]) onStatus(MATCHMAKING_STATUS[current.status]);
  });
  mm.createGroup({ profile: PROFILE, attributes: {}, is_ready: true }, true);
  try {
    const assignment = await mm.nextAssignment();
    const ticketId = mm.group.current.ticket_id;
    // TLS Upgrade is on for the port, so connect by fqdn: the certificate matches it.
    return { url: getConnectionUrl(assignment, "gameport"), ticketId };
  } finally {
    mm?.dispose(); // matched (leaving now would only get a 409) or failed
    mm = null;
  }
}

export function cancelMatchmaking() {
  mm?.stopMatchmaking();
}
addEventListener("pagehide", cancelMatchmaking);

/**
 * Connect to a game server and play. handlers: { onState(msg), onClose(), onStatus(text) }.
 * Returns { myId, sendInput(obj), close() }.
 */
export async function joinServer(url, name, ticket, { onState, onClose, onStatus }) {
  const { conn, welcome } = await connect(url, { name, ticket }, { onStatus });
  conn.on("state", onState);
  conn.onclose = onClose;
  let lastInput = "";
  let lastInputAt = 0;
  return {
    myId: welcome.id,
    match: welcome.match,
    // Inputs go out at most 30 times a second, and at least every 250 ms.
    sendInput(obj) {
      const s = JSON.stringify(obj);
      const now = performance.now();
      if ((s !== lastInput && now - lastInputAt > 33) || now - lastInputAt > 250) {
        conn.send({ t: "input", ...obj });
        lastInput = s;
        lastInputAt = now;
      }
    },
    close: () => conn.close(),
  };
}

export const directServer = params.get("server"); // ?server=wss://<fqdn>:<port> joins one deployment
export const autoplay = params.get("autoplay"); // "1" = Find Match on load, "local" = local server
