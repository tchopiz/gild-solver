// =============================================
//   GILD - RECAPTCHA V3 SOLVER
//   author  : GILD
//   contact : t.me/gild_eng
//   usage   : educational purposes only
// =============================================

const C = {
  end: "\x1b[0m",
  hot: "\x1b[1;36m",
  faint: "\x1b[2m",
  grey: "\x1b[90m",
  sky: "\x1b[96m",
  good: "\x1b[92m",
  bad: "\x1b[91m",
  warn: "\x1b[93m",
  pink: "\x1b[95m",
  sea: "\x1b[94m",
};

const ART = [
  '   ____              _      ____    ',
  'U /"""|u   ___     |"|    |  _"\\   ',
  '\\| |  _ /  |_"_|  U | | u /| | | |  ',
  ' | |_| |    | |    \\| |/ __U| |_| |\\ ',
  '  \\____|  U/| |\\u   |_____| \\___/ u ',
  '  _)(|_.-,_|___|_,-.//  \\\\  |||_    ',
  ' (__)__)\\_)-\\\' \\\'-(\\_/(_")("_)(__)__)   ',
];
const HEADLINE = "R E C A P T C H A   V 3   S O L V E R";
const RAINBOW = ["\x1b[38;5;213m", "\x1b[38;5;177m", "\x1b[38;5;141m", "\x1b[38;5;105m", "\x1b[38;5;75m", "\x1b[38;5;45m"];
const DISCLAIMER = ">> For educational purposes only <<";
const SIGNATURE = "Made by GILD  |  t.me/gild_eng";

function columns() {
  return process.stdout.columns || 100;
}

const EMOJI = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE10-\uFE19\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}\u{2190}-\u21FF\u{1F900}-\u{1F9FF}]/gu;

function realLen(s) {
  let bare = s.replace(/\x1b\[[0-9;]*m/g, "");
  let fat = (bare.match(EMOJI) || []).length;
  return bare.length + fat;
}

function indent(s, w) {
  return " ".repeat(Math.max(0, Math.floor((w - realLen(s)) / 2))) + s;
}

function tinted(s, color, w) {
  return indent(s, w).replace(s, color + s + C.end);
}

function squeeze(s, w) {
  let n = realLen(s);
  if (n >= w) return s;
  let left = Math.floor((w - n) / 2);
  return " ".repeat(left) + s + " ".repeat(w - n - left);
}

function clockNice() {
  let d = new Date(), z = (n) => String(n).padStart(2, "0");
  return `${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;
}

function clockFine() {
  let d = new Date();
  return `${clockNice()}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

function paintArt(shift) {
  let w = columns();
  let widest = Math.max(...ART.map((l) => l.length));
  let left = " ".repeat(Math.max(0, Math.floor((w - widest) / 2)));
  let buf = "";
  ART.forEach((row, n) => {
    buf += left + RAINBOW[(n + shift) % RAINBOW.length] + row + C.end + "\n";
  });
  return buf;
}

export function printBanner(opts = {}) {
  let { port, cfg = "", debug = false } = opts;
  let w = columns();
  let head = "\x1b[2J\x1b[H\n" + tinted(HEADLINE, "\x1b[1;96m", w) + "\n\n";

  if (process.stdout.isTTY) {
    process.stdout.write(head);
    for (let frame = 0; frame < 10; frame++) {
      process.stdout.write("\x1b[" + ART.length + "A\x1b[0J" + paintArt(frame % RAINBOW.length));
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 90);
    }
  } else {
    process.stdout.write(head + paintArt(0));
  }

  let body = "\n" + tinted(DISCLAIMER, C.warn, w) + "\n";
  body += tinted(SIGNATURE, "\x1b[1;95m", w) + "\n\n";

  let api = `http://localhost:${port}/gild/token`;
  let rows = [`API  : ${api}`];
  if (cfg) rows.push(`CONF : ${cfg}`);
  if (debug) rows.push(`MODE : DEBUG`);
  rows.push(`USE  : POST ${api}`);
  rows.push(`       body { "sitekey":"...", "target":"https://site.com", "action":"login" }`);
  rows.push(`PROXY: off -> nothing to do | on -> .env: USE_PROXIES=on + PROXIES=host:port:user:pass`);

  let fat = Math.max(...rows.map(realLen)) + 4;
  let rule = "\u2500".repeat(fat);
  body += indent("\u256d\u2500" + rule + "\u2500\u256e", w) + "\n";
  for (let row of rows) {
    let gap = Math.max(0, fat - 2 - realLen(row));
    body += indent("\u2502  " + "\x1b[96m" + row + C.end + " ".repeat(gap) + "  \u2502", w) + "\n";
  }
  body += indent("\u2570\u2500" + rule + "\u2500\u256f", w) + "\n\n";
  process.stdout.write(body);
}

let seq = 0;
export const nextId = () => ++seq;

export function step(on, id, label, tag, msg = "") {
  if (!on) return;
  let tone = { RECV: C.sky, ACQUIRE: C.sea, MINT: C.warn, EXEC: C.warn, TOKEN: C.good, SEND: C.pink, RETRY: C.warn }[tag] || C.grey;
  let bar = `${C.faint}|${C.end}`;
  console.log(
    `  ${C.sea}[${clockFine()}]${C.end} ${bar} ${C.faint}${squeeze("#" + id, 2)}${C.end} ${bar} ` +
    `${C.sky}${squeeze(label || "", 2)}${C.end} ${bar} ${tone}${tag.padEnd(7)}${C.end} ${bar} ${msg}`
  );
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function startSpinner(label = "working") {
  if (!process.stdout.isTTY) return () => {};
  let n = 0;
  let beat = setInterval(() => {
    process.stdout.write(`\r  ${C.sky}${SPINNER_FRAMES[n++ % SPINNER_FRAMES.length]}${C.end} ${C.faint}${label}${C.end}   `);
  }, 80);
  return (good = true, say2 = "") => {
    clearInterval(beat);
    let icon = good ? `${C.good}✔${C.end}` : `${C.bad}✖${C.end}`;
    process.stdout.write(`\r  ${icon} ${good ? C.good : C.bad}${say2 || label}${C.end}\x1b[K\n`);
  };
}

function clip(t) {
  t = String(t);
  return t.length <= 54 ? t : t.slice(0, 54) + "...";
}

export function result(r) {
  let { debug, id, ok, ms, token = "", err = "", tag = "" } = r;
  let tick = ok ? `${C.good}✔${C.end}` : `${C.bad}✖${C.end}`;
  let bar = `${C.faint}|${C.end}`;

  if (debug) {
    let tone = ok ? C.good : C.bad;
    console.log(
      `  ${C.sea}[${clockFine()}]${C.end} ${bar} ${C.faint}${squeeze("#" + id, 2)}${C.end} ${bar} ${C.sky}${squeeze("", 2)}${C.end} ${bar} ` +
      `${C.pink}${"SEND".padEnd(7)}${C.end} ${bar} ${tick} ${tone}${ok ? "OK" : "FAIL"}${C.end}` +
      `${tag ? " " + C.faint + tag + C.end : ""} ${C.faint}in${C.end} ${C.warn}${ms}ms${C.end}` +
      `${ok ? "" : "  " + C.bad + err + C.end}`
    );
    console.log("");
    return;
  }

  if (ok)
    console.log(`  ${tick} ${C.sea}[${clockNice()}]${C.end} ${bar} ${C.warn}${squeeze(ms + "ms", 7)}${C.end} ${bar} ${C.good}${clip(token)}${C.end}`);
  else
    console.log(`  ${tick} ${C.sea}[${clockNice()}]${C.end} ${bar} ${C.warn}${squeeze(ms + "ms", 7)}${C.end} ${bar} ${C.bad}${err}${C.end}`);
}
