// WebSocket connection to the game server: hello handshake, retries, message dispatch.
//
// A fresh Edgegap deployment can refuse connections (or answer 502 through the TLS proxy) for a
// few seconds after the matchmaker says HOST_ASSIGNED, so the first connect is retried.
//
// Once in, the client sends {t:"ping"} every 5 s from a timer. Inputs come from the render loop,
// which a hidden tab doesn't run; timers keep going there, so the server's IDLE_TIMEOUT_S only
// drops players whose page is really gone, not players who switched tabs.

export function connect(url, hello, { attempts = 10, onStatus = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    let tries = 0;
    const attempt = () => {
      tries++;
      const ws = new WebSocket(url);
      let welcomed = false;
      let heartbeat = 0;
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
          heartbeat = setInterval(() => conn.send({ t: "ping" }), 5000);
          resolve({ conn, welcome: msg });
        } else if (msg.t === "error") {
          welcomed = true; // a real answer from the server: don't retry
          reject(new Error(msg.message));
        }
        handlers.get(msg.t)?.(msg);
      };
      ws.onclose = (e) => {
        clearInterval(heartbeat);
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
