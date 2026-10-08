// =============================================
//   GILD - RECAPTCHA V3 SOLVER
//   author  : GILD
//   contact : t.me/gild_eng
//   usage   : educational purposes only
// =============================================

import WebSocket from "ws";

const REPLY_TIMEOUT = +(process.env.CDP_TIMEOUT || 60000);

export async function connect(browserURL) {
  let base = browserURL.replace(/\/$/, "");
  let info = await (await fetch(base + "/json/version")).json();
  let socket = new WebSocket(info.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });

  await new Promise((ok, ko) => {
    socket.once("open", ok);
    socket.once("error", () => ko(new Error("connexion ws CDP echouee")));
  });
  try { socket._socket && socket._socket.setNoDelay(true); } catch (err) {}

  let seq = 1;
  let deadReason = null;
  let waiting = new Map();
  let listeners = [];

  function failEverything(reason) {
    for (let [, p] of waiting) {
      if (p.timer) clearTimeout(p.timer);
      try { p.reject(reason); } catch (err) {}
    }
    waiting.clear();
  }

  socket.on("message", (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch (err) { return; }
    if (msg.id && waiting.has(msg.id)) {
      let p = waiting.get(msg.id);
      waiting.delete(msg.id);
      if (p.timer) clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else p.resolve(msg.result);
    } else if (msg.method) {
      for (let l of listeners)
        if (l.method === msg.method && (!l.sid || l.sid === msg.sessionId)) {
          try { l.fn(msg.params, msg.sessionId); } catch (err) {}
        }
    }
  });

  socket.on("close", () => {
    deadReason = deadReason || new Error("socket CDP fermee");
    failEverything(deadReason);
  });

  socket.on("error", (err) => {
    deadReason = new Error("erreur socket CDP: " + (err?.message || err));
    failEverything(deadReason);
  });

  function call(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      if (deadReason) return reject(deadReason);
      let id = seq++;
      let entry = { resolve, reject, timer: null };
      if (REPLY_TIMEOUT > 0) {
        entry.timer = setTimeout(() => {
          if (waiting.delete(id))
            reject(new Error(`timeout CDP apres ${REPLY_TIMEOUT}ms: ${method}`));
        }, REPLY_TIMEOUT);
        if (entry.timer.unref) entry.timer.unref();
      }
      waiting.set(id, entry);
      let packet = { id, method, params };
      if (sessionId) packet.sessionId = sessionId;
      try {
        socket.send(JSON.stringify(packet));
      } catch (err) {
        waiting.delete(id);
        if (entry.timer) clearTimeout(entry.timer);
        reject(err);
      }
    });
  }

  return {
    send: call,
    on(method, fn, sid) { listeners.push({ method, fn, sid }); },
    off(method, sid) {
      for (let i = listeners.length - 1; i >= 0; i--)
        if (listeners[i].method === method && listeners[i].sid === sid) listeners.splice(i, 1);
    },
    close() { try { socket.close(); } catch (err) {} },
    get closed() { return Boolean(deadReason); },
    version: info,
  };
}
