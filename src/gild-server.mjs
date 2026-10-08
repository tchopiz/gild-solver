// =============================================
//   GILD - RECAPTCHA V3 SOLVER
//   author  : GILD
//   contact : t.me/gild_eng
//   usage   : educational purposes only
// =============================================

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

import { connect } from "./gild-cdp.mjs";
import { warmPage, executeOn, closePage } from "./gild-solve.mjs";
import { printBanner, step, result, nextId, startSpinner } from "./gild-ui.mjs";

function stamp() {
  let d = new Date(), p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function say(...args) {
  console.log(stamp(), ...args);
}

const wait = (ms) => new Promise((done) => setTimeout(done, ms));

function readEnvFile() {
  let dirs = [process.cwd(), path.join(process.cwd(), ".."), path.dirname(process.execPath)];
  for (let dir of dirs) {
    try {
      let raw = fs.readFileSync(path.join(dir, ".env"), "utf8");
      for (let ln of raw.split(/\r?\n/)) {
        if (ln.trim().startsWith("#")) continue;
        let mm = ln.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
        if (!mm || process.env[mm[1]] !== undefined) continue;
        let v = mm[2];
        if (v.startsWith('"') || v.startsWith("'")) v = v.replace(/^["']|["']$/g, "");
        else v = v.replace(/\s+#.*$/, "").trim();
        process.env[mm[1]] = v;
      }
      return;
    } catch (err) { /* pas de .env ici, on passe au dossier suivant */ }
  }
}

function confInt(aliases, fallback, lo = 0, hi = Infinity) {
  if (!Array.isArray(aliases)) aliases = [aliases];
  let picked = null, used = aliases[0];
  for (let a of aliases) {
    let raw = process.env[a];
    if (raw !== undefined && raw !== "") { picked = raw; used = a; break; }
  }
  if (picked === null) return fallback;
  let n = Number(picked);
  if (!Number.isFinite(n) || n < lo || n > hi) {
    console.error(stamp(), `[config] ${used}="${picked}" hors limites (${lo}..${hi}), je garde ${fallback}`);
    return fallback;
  }
  return n;
}

readEnvFile();

// ---- reglages generaux (tout se pilote par le .env)

const PROXY_ON = /^(on|1|true|yes)$/i.test(process.env.USE_PROXIES || process.env.PROXY_MODE || "");
const PORT = confInt("PORT", 4100, 1, 65535);
const POOL_SIZE = confInt(["BROWSERS", "BROWSERS_PER_FLEET"], 4, 1);
const TABS_EACH = confInt(["TABS", "TABS_PER_BROWSER"], 1, 1);
const HARD_CAP = confInt("MAX_BROWSERS", 16, 1);
let FRESH_AFTER = confInt(["RECYCLE_AFTER_MINTS", "MINTS_PER_BROWSER"], PROXY_ON ? 9 : 18, 1);
const WARMUP_SHOTS = confInt("WARMUP", 1);
const MAX_TRIES = confInt("RETRIES", 3, 1);
const TIME_LIMIT = confInt("TOKEN_DEADLINE", 40000, 5000);
const RELAUNCH_ATTEMPTS = confInt("RECYCLE_RETRIES", 4, 1);
const WATCHDOG_EVERY = confInt("WATCHDOG_MS", 5000);
const ROLLING = process.env.ROLLING !== "0";
const PRE_MADE = confInt("BUFFER_SIZE", 0);
const TOKEN_LIFE = confInt("TOKEN_TTL_MS", 60000, 1000);
const SCREEN_W = confInt("VIEWPORT_W", 1280, 1);
const SCREEN_H = confInt("VIEWPORT_H", 800, 1);
const HIDDEN = process.env.HEADLESS === "1";
const VERBOSE = process.env.DEBUG === "1" || process.argv.includes("debug");

const UA_STRING = process.env.UA || `Mozilla/5.0 (${
  process.platform === "win32" ? "Windows NT 10.0; Win64; x64"
    : process.platform === "darwin" ? "Macintosh; Intel Mac OS X 10_15_7"
    : "X11; Linux x86_64"
}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36`;

const SHARED_CACHE = process.env.DISK_CACHE || path.join(os.tmpdir(), "rev3-shared-cache");
const EXTRA_ARGS = (process.env.EXTRA_FLAGS || "").split(/\s+/).filter(Boolean);

// ---- proxys

export function parseProxies(text) {
  let out = [];
  for (let entry of (text || "").split(/[\n,]+/)) {
    entry = entry.trim();
    if (!entry) continue;
    let mm;
    if ((mm = entry.match(/^(?:(\w+):\/\/)?(?:([^:@\s]+):([^@\s]+)@)?([^:@\s]+):(\d+)$/))) {
      out.push({ server: `${mm[1] || "http"}://${mm[4]}:${mm[5]}`, username: mm[2], password: mm[3] });
    } else if ((mm = entry.match(/^([^:\s]+):(\d+):([^:\s]+):([^\s]+)$/))) {
      out.push({ server: `http://${mm[1]}:${mm[2]}`, username: mm[3], password: mm[4] });
    }
  }
  return out;
}

function grabProxies() {
  if (!PROXY_ON) return [];
  let fromEnv = process.env.PROXIES || "";
  if (!fromEnv.trim()) {
    let files = [
      path.join(process.cwd(), process.env.PROXIES_FILE || "proxies.txt"),
      path.join(process.cwd(), "..", "proxies.txt"),
    ];
    for (let f of files) {
      try {
        let content = fs.readFileSync(f, "utf8");
        if (content.trim()) { fromEnv = content; break; }
      } catch (err) {}
    }
  }
  return parseProxies(fromEnv);
}

const PROXY_LIST = grabProxies();
const sickProxies = new Map();   // serveur -> nb d'echecs de lancement
const benchedProxies = new Map(); // serveur -> timestamp de fin de pause
const BENCH_AFTER = +(process.env.PROXY_DEAD_AFTER || 2);
const BENCH_TIME = +(process.env.PROXY_COOLDOWN_MS || 120000);
let proxyTurn = 0;

export function pickProxy() {
  if (!PROXY_LIST.length) return null;
  let now = Date.now();
  for (let tries = 0; tries < PROXY_LIST.length; tries++) {
    let p = PROXY_LIST[proxyTurn++ % PROXY_LIST.length];
    if ((benchedProxies.get(p.server) || 0) <= now) return p;
  }
  return null;
}

function proxyFailed(p) {
  if (!p || !p.server) return;
  let n = (sickProxies.get(p.server) || 0) + 1;
  sickProxies.set(p.server, n);
  if (n >= BENCH_AFTER) {
    benchedProxies.set(p.server, Date.now() + BENCH_TIME);
    sickProxies.set(p.server, 0);
    say(`[proxy] ${p.server} mis de cote ${Math.round(BENCH_TIME / 1000)}s (${n} lancements rates)`);
  }
}

function proxyWorked(p) {
  if (!p || !p.server) return;
  sickProxies.delete(p.server);
  benchedProxies.delete(p.server);
}

export const looksLikeToken = (t) => typeof t === "string" && t.length > 100 && !/\s/.test(t);

export const counters = {
  requests: 0, ok: 0, fail: 0, retries: 0, recycles: 0, recycleFails: 0,
  watchdogKills: 0, bufferHits: 0, bufferStale: 0, started: Date.now(), msSum: 0, msN: 0,
};

// ---- chrome en local

const CHROME_SWITCHES = [
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-blink-features=AutomationControlled",
  "--disable-background-networking",
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  "--disable-hang-monitor",
  "--disable-sync",
  "--disable-breakpad",
  "--disable-component-extensions-with-background-pages",
  "--disable-ipc-flooding-protection",
  "--metrics-recording-only",
  "--password-store=basic",
  "--use-mock-keychain",
  "--no-pings",
  "--disable-domain-reliability",
  "--disable-features=Translate,BackForwardCache,MediaRouter,OptimizationHints",
  "--mute-audio",
];

function locateChrome() {
  if (process.env.CHROME_BIN && fs.existsSync(process.env.CHROME_BIN)) return process.env.CHROME_BIN;
  let guesses = [
    path.join(process.env["ProgramFiles"] || "C:\\Program Files", "Google\\Chrome\\Application\\chrome.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Google\\Chrome\\Application\\chrome.exe"),
    path.join(process.env["LOCALAPPDATA"] || "", "Google\\Chrome\\Application\\chrome.exe"),
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
  ];
  for (let g of guesses) if (g && fs.existsSync(g)) return g;
  throw new Error("Chrome introuvable — renseigne CHROME_BIN dans le .env");
}
const CHROME_PATH = locateChrome();

async function cdpReady(port, budget = 25000) {
  let limit = Date.now() + budget;
  while (Date.now() < limit) {
    try {
      await fetch(`http://localhost:${port}/json/version`);
      return;
    } catch (err) {}
    await wait(250);
  }
  throw new Error("le port CDP " + port + " ne repond pas");
}

function killProcessTree(child) {
  if (!child || child.killed) return;
  try {
    if (process.platform === "win32")
      spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else child.kill("SIGKILL");
  } catch (err) {}
}

// ---- un navigateur = un chrome + ses onglets prechauffes

let nextDebugPort = 9400;
let chromeCount = 0;
let currentReqId = 0;
const stats = counters;

export class Browser {
  constructor(id, opts) {
    this.id = id;
    this.opts = opts;
    this.proc = null;
    this.cdp = null;
    this.tabs = [];
    this.dataDir = null;
    this.debugPort = 0;
    this.uses = 0;
    this.fault = null;
    this.refreshing = false;
    this.dead = false;
    this.ready = false;
    this.lastUsed = 0;
    this.proxy = null;
    this.retiring = false;
    this.debugLog = VERBOSE ? (msg) => step(true, currentReqId, `W${this.id}`, "MINT", msg) : () => {};
  }

  alive() {
    return Boolean(this.proc) && !this.proc.killed && Boolean(this.cdp) && !this.cdp.closed;
  }

  freeTab() {
    return this.tabs.find((t) => !t.busy);
  }

  busyCount() {
    return this.tabs.filter((t) => t.busy).length;
  }

  async start() {
    this.ready = false;
    this.uses = 0;
    this.tabs = [];
    this.debugPort = nextDebugPort++;
    this.proxy = pickProxy();
    if (PROXY_ON && PROXY_LIST.length && !this.proxy)
      throw new Error("tous les proxys sont morts ou en pause — je refuse de sortir sur l'IP de la box (PROXY_MODE=on)");
    this.dataDir = path.join(os.tmpdir(), `rev3-${this.debugPort}-${process.pid}`);

    let args = [
      `--remote-debugging-port=${this.debugPort}`,
      `--user-data-dir=${this.dataDir}`,
      `--disk-cache-dir=${SHARED_CACHE}`,
      `--window-size=${SCREEN_W},${SCREEN_H}`,
      ...CHROME_SWITCHES,
    ];
    if (HIDDEN) args.push("--headless=new", `--user-agent=${UA_STRING}`);
    if (process.platform === "linux")
      args.push("--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader");
    if (this.proxy) args.push(`--proxy-server=${this.proxy.server}`);
    args.push(...EXTRA_ARGS, "about:blank");

    this.proc = spawn(CHROME_PATH, args, { stdio: "ignore" });
    await cdpReady(this.debugPort);
    this.cdp = await connect(`http://localhost:${this.debugPort}`);

    let creds = this.proxy && this.proxy.username
      ? { username: this.proxy.username, password: this.proxy.password }
      : null;
    let main = await warmPage(this.cdp, { ...this.opts, proxyAuth: creds, reuseInitialTab: true, log: this.debugLog });
    let others = [];
    for (let k = 1; k < TABS_EACH; k++)
      others.push(await warmPage(this.cdp, { ...this.opts, proxyAuth: creds }));
    this.tabs = [main, ...others].map((p) => ({ sessionId: p.sessionId, targetId: p.targetId, busy: false }));

    for (let k = 0; k < WARMUP_SHOTS; k++) {
      try { await executeOn(this.cdp, this.tabs[0].sessionId, this.opts); } catch (err) {}
    }
    this.fault = null;
    this.ready = true;
  }

  async mint(tab, action) {
    try {
      let token = await executeOn(this.cdp, tab.sessionId, { ...this.opts, action, log: this.debugLog });
      if (!looksLikeToken(token))
        throw new Error("token invalide: " + JSON.stringify(String(token).slice(0, 30)));
      this.uses++;
      this.lastUsed = Date.now();
      proxyWorked(this.proxy);
      return token;
    } finally {
      tab.busy = false;
    }
  }

  flagAsBad(reason) {
    if (this.fault || this.refreshing) return;
    this.fault = reason || "unknown";
    this.ready = false;
    this.refresh().catch(() => {});
  }

  async stop() {
    this.ready = false;
    this.retiring = true;
    for (let t of this.tabs) {
      try { await closePage(this.cdp, t.sessionId, t.targetId); } catch (err) {}
    }
    try { this.cdp && this.cdp.close(); } catch (err) {}
    killProcessTree(this.proc);
    try { fs.rmSync(this.dataDir, { recursive: true, force: true }); } catch (err) {}
  }

  async refresh() {
    if (this.refreshing) return;
    this.refreshing = true;
    this.ready = false;
    for (let t of this.tabs) {
      try { await closePage(this.cdp, t.sessionId, t.targetId); } catch (err) {}
    }
    try { this.cdp && this.cdp.close(); } catch (err) {}
    killProcessTree(this.proc);
    await wait(300);
    try { fs.rmSync(this.dataDir, { recursive: true, force: true }); } catch (err) {}

    let lastError;
    for (let attempt = 0; attempt < RELAUNCH_ATTEMPTS; attempt++) {
      try {
        await this.start();
        this.fault = null;
        this.refreshing = false;
        stats.recycles++;
        return;
      } catch (err) {
        lastError = err;
        killProcessTree(this.proc);
        await wait(500 * (attempt + 1));
      }
    }
    this.refreshing = false;
    this.dead = true;
    this.fault = "relancement impossible: " + (lastError && lastError.message);
    stats.recycleFails++;
  }
}

// ---- le pool qui distribue les onglets

export class Fleet {
  constructor(opts) {
    this.opts = opts;
    this.browsers = [];
  }

  cleanup() {
    this.browsers = this.browsers.filter((b) => {
      if (!b.dead) return true;
      chromeCount = Math.max(0, chromeCount - 1);
      return false;
    });
  }

  async acquire(deadline = Date.now() + 40000) {
    while (Date.now() < deadline) {
      this.cleanup();
      for (let b of this.browsers) {
        if (b.ready && !b.fault && !b.retiring && b.alive()) {
          let t = b.freeTab();
          if (t) {
            t.busy = true;
            return { browser: b, tab: t };
          }
        }
      }
      let active = this.browsers.filter((b) => !b.retiring).length;
      if (active < POOL_SIZE && chromeCount < HARD_CAP) {
        chromeCount++;
        let b = new Browser(chromeCount, this.opts);
        this.browsers.push(b);
        try {
          await b.start();
        } catch (err) {
          proxyFailed(b.proxy);
          this.browsers = this.browsers.filter((x) => x !== b);
          chromeCount--;
          throw err;
        }
        let t = b.freeTab();
        if (t) {
          t.busy = true;
          return { browser: b, tab: t };
        }
      }
      await wait(25);
    }
    throw new Error("aucun onglet libre avant la deadline (pool sature ou proxys morts — augmente MAX_BROWSERS / BROWSERS / TABS ou verifie les proxys)");
  }

  async swapOut(tired) {
    if (tired.retiring) return;
    tired.retiring = true;
    tired.ready = false;
    chromeCount++;
    let fresh = new Browser(chromeCount, this.opts);
    this.browsers.push(fresh);
    let ok = true;
    try {
      await fresh.start();
    } catch (err) {
      ok = false;
      proxyFailed(fresh.proxy);
      this.browsers = this.browsers.filter((x) => x !== fresh);
      chromeCount--;
    }
    if (!ok) {
      tired.retiring = false;
      tired.ready = !tired.fault;
      return;
    }
    let drainLimit = Date.now() + 30000;
    while (tired.busyCount() > 0 && Date.now() < drainLimit) await wait(100);
    this.browsers = this.browsers.filter((x) => x !== tired);
    chromeCount = Math.max(0, chromeCount - 1);
    try { await tired.stop(); } catch (err) {}
    stats.recycles++;
  }
}

const pools = new Map();
function poolKey(o) {
  return `${o.enterprise ? "e:" : ""}${o.sitekey}|${o.targetUrl}`;
}
function poolFor(opts) {
  let k = poolKey(opts);
  if (!pools.has(k)) pools.set(k, new Fleet(opts));
  return pools.get(k);
}
export const fleets = pools;

export async function mintWithRetry(pool, action, attempts = MAX_TRIES) {
  let limit = Date.now() + TIME_LIMIT;
  let lastError;
  for (let i = 0; i < attempts && Date.now() < limit; i++) {
    let handle;
    try {
      handle = await pool.acquire(limit);
    } catch (err) {
      lastError = err;
      break;
    }
    try {
      return { browser: handle.browser, token: await handle.browser.mint(handle.tab, action) };
    } catch (err) {
      lastError = err;
      stats.retries++;
      handle.browser.flagAsBad("erreur de service: " + err.message);
    }
  }
  throw lastError || new Error("echec de generation");
}

// ---- reserve de tokens pre-generes

export class TokenBuffer {
  constructor(size = PRE_MADE, ttl = TOKEN_LIFE) {
    this.size = size;
    this.ttl = ttl;
    this.items = [];
    this.busy = false;
  }
  put(token, when) {
    this.items.push({ token, when });
  }
  take(when) {
    while (this.items.length) {
      let it = this.items.shift();
      if (when - it.when < this.ttl) return it.token;
      stats.bufferStale++;
    }
    return null;
  }
  freshCount(when) {
    let n = 0;
    for (let it of this.items) if (when - it.when < this.ttl) n++;
    return n;
  }
}

const bufferPool = new Map();
export function bufFor(pool, action) {
  let k = poolKey(pool.opts) + "::" + action;
  if (!bufferPool.has(k)) bufferPool.set(k, new TokenBuffer());
  return bufferPool.get(k);
}

export async function fillBuffer(pool, action, buf) {
  if (buf.size <= 0 || buf.busy) return;
  buf.busy = true;
  try {
    while (buf.freshCount(Date.now()) < buf.size) {
      let handle = null;
      outer: for (let b of pool.browsers) {
        if (!(b.ready && !b.fault && !b.retiring && b.alive())) continue;
        let t = b.freeTab();
        if (t) {
          t.busy = true;
          handle = { browser: b, tab: t };
          break outer;
        }
      }
      if (!handle) break;
      try {
        let tk = await handle.browser.mint(handle.tab, action);
        buf.put(tk, Date.now());
        if (handle.browser.uses >= FRESH_AFTER) handle.browser.refresh().catch(() => {});
      } catch (err) {
        handle.browser.flagAsBad("remplissage: " + err.message);
      }
    }
  } finally {
    buf.busy = false;
  }
}

export function watchdog() {
  for (let pool of pools.values()) {
    for (let b of pool.browsers) {
      if (b.dead || b.refreshing || b.retiring || b.busyCount() > 0) continue;
      if (b.ready && !b.alive()) {
        stats.watchdogKills++;
        b.flagAsBad("watchdog: chrome ou cdp mort");
      }
    }
    pool.cleanup();
  }
}

// ---- l'api http

function readBody(req, max = 1048576) {
  return new Promise((ok, ko) => {
    let buf = "", total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > max) {
        req.destroy();
        ko(new Error("body trop gros"));
      } else buf += chunk;
    });
    req.on("end", () => ok(buf));
    req.on("error", ko);
  });
}

const server = http.createServer(async (req, res) => {
  let target = new URL(req.url, "http://x");
  res.setHeader("content-type", "application/json");

  if (target.pathname === "/health") {
    let list = [];
    for (let [k, f] of pools) {
      let tabTotal = 0;
      for (let b of f.browsers) tabTotal += b.tabs.length;
      list.push({ key: k, browsers: f.browsers.length, tabs: tabTotal });
    }
    res.end(JSON.stringify({ ok: true, globalBrowsers: chromeCount, fleets: list }));
    return;
  }

  if (target.pathname === "/stats") {
    let fleetList = [];
    for (let [k, f] of pools) {
      fleetList.push({
        key: k,
        browsers: f.browsers.map((b) => ({
          id: b.id,
          uses: b.uses,
          tabs: b.tabs.length,
          busyTabs: b.busyCount(),
          ready: b.ready,
          bad: b.fault,
          recycling: b.refreshing,
          alive: b.alive(),
          proxy: b.proxy ? b.proxy.server : null,
        })),
      });
    }
    res.end(JSON.stringify({
      ...counters,
      avgMs: counters.msN ? Math.round(counters.msSum / counters.msN) : 0,
      uptimeS: Math.round((Date.now() - counters.started) / 1000),
      globalBrowsers: chromeCount,
      fleets: fleetList,
    }));
    return;
  }

  if (target.pathname !== "/gild/token" && target.pathname !== "/gild") {
    res.statusCode = 404;
    res.end('{"error":"POST /gild/token avec JSON {sitekey,target|url,action} (ou ?query / headers x-*)"}');
    return;
  }

  let body = {};
  if (req.method === "POST") {
    try {
      let raw = await readBody(req);
      body = raw ? JSON.parse(raw) : {};
    } catch (err) {
      body = {};
    }
  }

  let hd = req.headers;
  let sitekey = body.sitekey || hd["x-sitekey"] || target.searchParams.get("sitekey");
  let pageUrl = body.target || body.url || body.targetUrl || hd["x-target"] || hd["x-url"]
    || target.searchParams.get("target") || target.searchParams.get("targetUrl");
  let act = body.action || hd["x-action"] || target.searchParams.get("action") || "verify";
  let ent = body.enterprise === true || body.enterprise === "1"
    || hd["x-enterprise"] === "1" || target.searchParams.get("enterprise") === "1";

  if (!sitekey || !pageUrl) {
    res.statusCode = 400;
    res.end('{"error":"il faut sitekey + target/url (JSON, headers x-* ou ?query)"}');
    return;
  }

  let reqId = nextId();
  step(VERBOSE, reqId, "", "RECV",
    `${pageUrl.slice(0, 40)} | ${sitekey.slice(0, 18)} | ${act}${ent ? " (ent)" : ""}`);
  let startedAt = Date.now();
  let spinner = null;
  counters.requests++;

  try {
    let pool = poolFor({ sitekey, targetUrl: pageUrl, enterprise: ent });

    if (PRE_MADE > 0) {
      let buf = bufFor(pool, act);
      let ready = buf.take(Date.now());
      if (ready) {
        let took = Date.now() - startedAt;
        counters.ok++;
        counters.bufferHits++;
        counters.msSum += took;
        counters.msN++;
        res.end(JSON.stringify({ token: ready, ms: took, buffered: true }));
        result({ debug: VERBOSE, id: reqId, label: "buf", ok: true, ms: took, token: ready, tag: "buffer" });
        fillBuffer(pool, act, buf).catch(() => {});
        return;
      }
    }

    step(VERBOSE, reqId, "", "ACQUIRE", "browser/tab");
    spinner = VERBOSE ? null : startSpinner(`generation du token #${reqId}...`);
    let win = await mintWithRetry(pool, act);
    if (spinner) spinner(true, `token #${reqId} pret — W${win.browser.id} - ${Date.now() - startedAt}ms`);

    let took = Date.now() - startedAt;
    counters.ok++;
    counters.msSum += took;
    counters.msN++;
    step(VERBOSE, reqId, `W${win.browser.id}`, "TOKEN", `len ${win.token.length} - uses ${win.browser.uses}`);
    res.end(JSON.stringify({ token: win.token, ms: took, browser: win.browser.id, uses: win.browser.uses }));
    result({ debug: VERBOSE, id: reqId, label: `W${win.browser.id}`, ok: true, ms: took, token: win.token });

    if (win.browser.uses >= FRESH_AFTER)
      (ROLLING ? pool.swapOut(win.browser) : win.browser.refresh())
        .catch((err) => say(`[browser ${win.browser.id}] recycle KO:`, err.message));
    if (PRE_MADE > 0) fillBuffer(pool, act, bufFor(pool, act)).catch(() => {});
  } catch (err) {
    if (spinner) spinner(false, `token #${reqId} echoue`);
    let took = Date.now() - startedAt;
    counters.fail++;
    res.statusCode = 500;
    res.end(JSON.stringify({ error: String(err?.message || err), ms: took }));
    result({ debug: VERBOSE, id: reqId, label: "W-", ok: false, ms: took, err: String(err?.message || err) });
  }
});

function shutDown() {
  for (let f of pools.values()) for (let b of f.browsers) killProcessTree(b.proc);
  process.exit(0);
}
process.on("SIGINT", shutDown);
process.on("SIGTERM", shutDown);

if (import.meta.url === pathToFileURL(process.argv[1] || "").href || process.argv[1] === process.execPath) {
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`${stamp()} [fatal] le port ${PORT} est deja pris — une autre instance de GILD tourne probablement.`);
      console.error(`${stamp()} [fatal] ferme-la (netstat -ano | findstr :${PORT} puis taskkill /PID <pid> /F) ou change PORT dans le .env.`);
      process.exit(1);
    }
    throw err;
  });
  if (WATCHDOG_EVERY > 0) setInterval(watchdog, WATCHDOG_EVERY).unref();

  server.listen(PORT, () => {
    let summary = `⚡ ${POOL_SIZE} browser(s) | 🗂 ${TABS_EACH} tab(s) | ♻ auto-fresh @ ${FRESH_AFTER} tokens | ` +
      `🌐 proxies: ${PROXY_ON ? `ON (${PROXY_LIST.length})` : "off"} | 🫥 headless: ${HIDDEN ? "on" : "off"}` +
      (PRE_MADE ? ` | 💎 buffer: ${PRE_MADE}` : "");
    printBanner({ port: PORT, cfg: summary, debug: VERBOSE });
  });
}
