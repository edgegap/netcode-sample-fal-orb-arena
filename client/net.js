// WebSocket connection to the game server: hello handshake, retries, message dispatch.
// From the edgegap-threejs skill (assets/client/net.js), unchanged.
//
// A fresh Edgegap deployment can refuse connections (or answer 502 through the TLS proxy) for a
// few seconds after the matchmaker says HOST_ASSIGNED, so the first connect is retried.

export function connect(url, hello, { attempts = 10, onStatus = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    let tries = 0;
    const attempt = () => {
      tries++;
      const ws = new WebSocket(url);
      let welcomed = false;
      const handlers = new Map();
      const conn = {
        ws,
        on: (type, fn) => handlers.set(type, fn),
        send: (msg) => ws.readyState === 1 && ws.send(JSON.stringify(msg)),
        close: () => ws.close(),
        onclose: null,
      };
      ws.onopen = () => ws.send(JSON.stringify({ t: "hello", ...hello }));
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.t === "welcome" && !welcomed) {
          welcomed = true;
          resolve({ conn, welcome: msg });
        } else if (msg.t === "error") {
          welcomed = true; // a real answer from the server: don't retry
          reject(new Error(msg.message));
        }
        handlers.get(msg.t)?.(msg);
      };
      ws.onclose = (e) => {
        if (welcomed) return conn.onclose?.(e);
        if (tries < attempts) {
          onStatus(`Server starting, connecting (${tries}/${attempts})...`);
          setTimeout(attempt, 1000);
        } else reject(new Error(`Could not connect to ${url}`));
      };
    };
    attempt();
  });
}
