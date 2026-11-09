// Edgegap integration for one deployment = one match. Nothing in here runs off Edgegap.
// From the edgegap-threejs skill (assets/server/edgegap.js), unchanged.
//
// Edgegap injects ARBITRIUM_* variables into every deployment, and MM_* variables when the
// matchmaker created it. @edgegap/sdk parses them; this module stops the deployment when the
// match is over: DELETE $ARBITRIUM_DELETE_URL with $ARBITRIUM_DELETE_TOKEN. Billing stops with it.

import { DeploymentEnvironment, SafeHttpRequest } from "@edgegap/sdk";
import { MatchEnvironment } from "@edgegap/sdk/matchmaking";

export const onEdgegap = !!process.env.ARBITRIUM_REQUEST_ID;
const deployment = onEdgegap ? DeploymentEnvironment.fromEnv(process.env) : null;
export const requestId = deployment?.requestId ?? "local";

/** What the matchmaker told us about this match, or null for a direct deployment / local run. */
export const match = process.env.MM_TICKET_IDS ? readMatch(MatchEnvironment.fromEnv(process.env)) : null;

function readMatch({ matchId, matchProfile, ticketIds, tickets }) {
  // Turn the matchmaker's team ids into 0, 1, 2... in a stable order.
  const teamIds = [...new Set(Object.values(tickets).map((t) => t.team_id).filter(Boolean))].sort();
  const teamOf = (ticketId) => {
    const i = teamIds.indexOf(tickets[ticketId]?.team_id);
    return i < 0 ? null : i;
  };
  return { id: matchId, profile: matchProfile, ticketIds: ticketIds ?? Object.keys(tickets), tickets, teamOf };
}

export function describeDeployment() {
  if (!onEdgegap) return "local run (not on Edgegap): no self-stop, matches loop forever";
  return (
    `deployment ${requestId} at ${deployment.publicIp ?? "?"} ` +
    `(${deployment.hostId ?? "?"}), ` +
    (match ? `match ${match.id} profile ${match.profile}, ${match.ticketIds.length} ticket(s)` : "direct deploy")
  );
}

let stopping = false;

/** Ask Edgegap to stop this deployment. Edgegap then sends SIGTERM. */
export function selfStop(reason) {
  if (!onEdgegap || stopping) return;
  stopping = true;
  log(`self-stop: ${reason}`);
  const { selfStopUrl, selfStopToken } = deployment;
  if (!selfStopUrl || !selfStopToken) {
    log("ARBITRIUM_DELETE_URL/TOKEN missing, exiting instead");
    process.exit(0);
  }
  new SafeHttpRequest().delete(
    selfStopUrl,
    selfStopToken,
    (_body, { status }) => log(`self-stop request: HTTP ${status}`),
    (error) => {
      log(`self-stop request failed: ${error}`);
      process.exit(0); // restart policy is Never, so exiting ends the deployment too
    }
  );
}

export function log(msg) {
  console.log(`[edgegap] ${msg}`);
}
