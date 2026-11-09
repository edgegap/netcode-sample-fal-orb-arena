// Matchmaker settings: the API URL and Auth Token from the Edgegap dashboard (Matchmaker > your
// matchmaker). Override them in config.local.js next to this file (git-ignored, same shape), or
// with ?mm=<url>&token=<token> in the page URL.
//
// The Auth Token is the matchmaker's client token: it is made to ship in game clients and gives
// no access to the Edgegap account. Never put the Edgegap API token here.
export default {
  matchmakerUrl: "",
  matchmakerToken: "",
};
