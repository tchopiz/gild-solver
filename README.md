# GILD — RECAPTCHA V3 SOLVER

A small local HTTP API that solves reCAPTCHA v3 challenges using a pool of real
Chrome browsers driven over the DevTools Protocol.

> ⚠️ Built for learning and testing on sites you own or are allowed to test.
> Bypassing anti-bot protection on third-party websites without permission is
> illegal in most places. Be reasonable.

**Author:** GILD — [t.me/gild_eng](https://t.me/gild_eng)
**License:** MIT

---

## How it works

When the server starts, it launches one or more headless Chrome instances.
Each browser opens a minimal page that loads the official reCAPTCHA script,
with a few patches applied so the browser doesn't scream "bot" (webdriver
flags hidden, consistent user-agent client hints, etc.).

When you request a token, the pool picks an idle tab and runs
`grecaptcha.execute(sitekey, { action })` inside that page. The token comes
back as JSON, usually in about a second. Browsers are quietly replaced after
N tokens so the pool stays fresh, and a watchdog restarts any browser that
silently died.

```
POST /gild/token
        │
        ▼
   token pool ── pick an idle tab ──► grecaptcha.execute()
        │                                     │
        │                              CDP over websocket
        ▼                                     ▼
   JSON response                        headless Chrome
```

## Requirements

- Google Chrome installed (or point `CHROME_BIN` to any Chromium binary)
- To run from source: Node.js 18+ (built and tested on Node 24)
- Or just use `GILD RECAPTCHA V3 SOLVER.exe` — no Node.js needed

## Install

```bash
git clone https://github.com/YOUR_NAME/gild-recaptcha-v3-solver.git
cd gild-recaptcha-v3-solver
npm install
copy .env.example .env   # Windows (use `cp` on Linux/macOS)
```

## Run

```bash
npm start
```

or on Windows, just double-click `bin/start-gild.bat`.

You should see the banner, a Chrome process appear in your task manager, and
the server listening on `http://localhost:47613`.

## Get a token

```bash
curl -X POST http://localhost:47613/gild/token \
  -H "Content-Type: application/json" \
  -d "{\"sitekey\":\"YOUR_SITEKEY\",\"target\":\"https://the-site.com\",\"action\":\"login\"}"
```

Response:

```json
{ "token": "03AFcW...", "ms": 1200, "browser": 1, "uses": 1 }
```

| Field | What it means |
|---|---|
| `sitekey` | The reCAPTCHA v3 sitekey of the target page |
| `target` | URL of that page — the domain must match the sitekey |
| `action` | The action the site expects (`login`, `verify`, ...) |
| `enterprise` | Set to `true` for reCAPTCHA Enterprise targets |

You can also pass these as `x-sitekey` / `x-target` / `x-action` headers, or
as query parameters — whatever is easier from your code.

**Important:** a token is only valid ~2 minutes and can be verified once.
The site verifies it server-side with *its* secret key; you can't check a
score yourself unless you own that secret.

## Other endpoints

| Endpoint | Description |
|---|---|
| `GET /health` | Quick fleet overview |
| `GET /stats` | Counters, average time, per-browser state |

## Generate tokens in bulk

With the server running:

```bash
# 20 tokens, 5 in parallel
SITEKEY=YOUR_SITEKEY TARGET=https://the-site.com node src/gild-batch.mjs 20 5
```

Tokens land in `tokens.txt`, one per line, with a live progress counter.
Keep parallelism around 3-4 without proxies, 8-10 with proxies.

## Configuration

Everything lives in `.env` (see `.env.example`). The useful bits:

| Variable | Default | Notes |
|---|---|---|
| `PORT` | 47613 | API port |
| `BROWSERS` | 4 | Chrome instances in the pool |
| `TABS` | 1 | Pre-warmed tabs per browser |
| `MINTS_PER_BROWSER` | 18 | Tokens before a browser is recycled |
| `HEADLESS` | 1 | Set `0` to watch Chrome work |
| `DEBUG` | 0 | Verbose step-by-step logs |
| `USE_PROXIES` | off | See below |
| `BUFFER_SIZE` | 0 | Pre-generate tokens for instant replies |

### Proxies

Set `USE_PROXIES=on` and provide a list, either inline:

```
PROXIES=host:port:user:pass,host:port:user:pass
```

or in a `proxies.txt` file (one per line). Proxies rotate round-robin, and one
that fails twice at launch is benched for two minutes. Note that with proxies
enabled the solver refuses to fall back to your real IP, and browsers recycle
more often (every 9 tokens instead of 18).

## Build a standalone .exe (Windows)

```bash
npm run build
```

Produces `GILD RECAPTCHA V3 SOLVER.exe` (~91 MB, embeds the Node runtime + the
whole app). No Node.js needed on the machine that runs it — Chrome is still
required. Re-run the command after any code change.

## Project layout

```
GILD RECAPTCHA V3 SOLVER.exe   standalone build (npm run build)
bin/
  start-gild.bat    one-click launcher (Windows)
docs/
  USAGE.fr.md       detailed French guide
src/
  gild-server.mjs   HTTP API, pool manager, browser lifecycle
  gild-solve.mjs    page warmup, stealth patches, token execution
  gild-cdp.mjs      tiny Chrome DevTools Protocol client
  gild-ui.mjs       animated banner, spinners, colored logs
  gild-batch.mjs    bulk generation CLI
```

## Troubleshooting

| Problem | Fix |
|---|---|
| `Chrome introuvable` | Set `CHROME_BIN` in `.env` |
| `le port 47613 est deja pris` | Another instance is running — kill it or change `PORT` |
| `no token returned` | Try `WARMUP=0` (a warm-up execute burns the first usable token) |
| Tokens rejected by the site | sitekey/domain mismatch, or low score — try `HEADLESS=0` |
| `invalid-input-response` on siteverify | Token expired (2 min), already used, or the key isn't a v3 key |

## License

MIT — see [LICENSE](LICENSE). Use responsibly.
