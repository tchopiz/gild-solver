// =============================================
//   GILD - RECAPTCHA V3 SOLVER
//   author  : GILD
//   contact : t.me/gild_eng
//   usage   : educational purposes only
// =============================================

import { fileURLToPath } from "node:url";
import { connect } from "./gild-cdp.mjs";

const pause = (ms) => new Promise((go) => setTimeout(go, ms));
const here = import.meta;

const PAGE_SHELL = (sitekey, ent) =>
  `<!doctype html><html><head><meta charset=utf-8><title> </title>` +
  `<script src="https://www.google.com/recaptcha/${ent ? "enterprise" : "api"}.js?render=${sitekey}"></script>` +
  `</head><body></body></html>`;

const HIDE_BOT_SIGNS = `(function(){try{
Object.defineProperty(navigator,'webdriver',{get:function(){return undefined;}});
var pq=navigator.permissions&&navigator.permissions.query;
if(pq)navigator.permissions.query=function(p){return(p&&p.name==='notifications')?Promise.resolve({state:(window.Notification&&Notification.permission)||'prompt',onchange:null}):pq.call(navigator.permissions,p);};
if(!window.chrome)window.chrome={runtime:{},app:{isInstalled:false},csi:function(){},loadTimes:function(){}};
if(!window.outerWidth)Object.defineProperty(window,'outerWidth',{get:function(){return window.innerWidth||1280;}});
if(!window.outerHeight)Object.defineProperty(window,'outerHeight',{get:function(){return (window.innerHeight||720)+85;}});
}catch(e){}})();`;

async function fakeHumanMouse(cdp, sessionId) {
  let vw = Number(process.env.VIEWPORT_W) || 1280;
  let vh = Number(process.env.VIEWPORT_H) || 800;
  let spots = [[.28,.42],[.41,.55],[.56,.49],[.63,.6],[.48,.52],[.52,.46]];
  let x = Math.round(vw * .2), y = Math.round(vh * .3);
  for (let [fx, fy] of spots) {
    let tx = Math.round(vw * fx), ty = Math.round(vh * fy);
    for (let step = 1; step <= 4; step++) {
      await cdp.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: Math.round(x + (tx - x) * step / 4),
        y: Math.round(y + (ty - y) * step / 4),
      }, sessionId).catch(() => {});
      await pause(12 + (step * 7) % 19);
    }
    x = tx; y = ty;
  }
  if (process.env.INJECT_SCROLL === "1") {
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseWheel", x: Math.round(vw / 2), y: Math.round(vh / 2), deltaX: 0, deltaY: 180,
    }, sessionId).catch(() => {});
    await pause(80);
  }
}

async function dressUp(cdp, sessionId, ua) {
  let mobile = process.env.MOBILE === "1";
  if (ua) {
    let major = (ua.match(/Chrome\/(\d+)/) || [])[1] || "149";
    let onWin = /Windows/.test(ua);
    let onMac = /Macintosh|Mac OS/.test(ua);
    let onDroid = /Android/.test(ua);
    let isMobile = mobile || onDroid;
    let plat = isMobile ? "Android" : onWin ? "Windows" : onMac ? "macOS" : "Linux";
    let hint = {
      brands: [
        { brand: "Chromium", version: major },
        { brand: "Google Chrome", version: major },
        { brand: "Not.A/Brand", version: "99" },
      ],
    };
    hint.fullVersionList = hint.brands.map((b) => ({ brand: b.brand, version: b.version + ".0.0.0" }));
    await cdp.send("Emulation.setUserAgentOverride", {
      userAgent: ua,
      acceptLanguage: "en-US,en;q=0.9",
      userAgentMetadata: {
        brands: hint.brands,
        fullVersionList: hint.fullVersionList,
        fullVersion: major + ".0.0.0",
        platform: plat,
        platformVersion: isMobile ? "14.0.0" : onWin ? "15.0.0" : onMac ? "14.0.0" : "6.5.0",
        architecture: isMobile ? "" : "x86",
        model: isMobile ? "Pixel 7" : "",
        mobile: isMobile,
        bitness: isMobile ? "" : "64",
        wow64: false,
      },
    }, sessionId).catch(() => {});
  }

  if (mobile) {
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true,
      screenWidth: 412, screenHeight: 915,
      screenOrientation: { type: "portraitPrimary", angle: 0 },
    }, sessionId).catch(() => {});
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 }, sessionId).catch(() => {});
  } else {
    let vw = Number(process.env.VIEWPORT_W) || 1280;
    let vh = Number(process.env.VIEWPORT_H) || 800;
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: vw, height: vh, deviceScaleFactor: 1, mobile: false,
      screenWidth: Math.max(1920, vw), screenHeight: Math.max(1080, vh),
      screenOrientation: { type: "landscapePrimary", angle: 0 },
    }, sessionId).catch(() => {});
  }
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: HIDE_BOT_SIGNS }, sessionId).catch(() => {});
}

let captchaRoot = (ent) => ent ? "(window.grecaptcha&&window.grecaptcha.enterprise)" : "window.grecaptcha";

function waitForReadyJs(ent) {
  let g = captchaRoot(ent);
  return `new Promise((res,rej)=>{const d=Date.now()+25000;const iv=setInterval(()=>{const G=${g};` +
    `if(G&&G.execute){clearInterval(iv);G.ready(()=>res(true));}else if(Date.now()>d){clearInterval(iv);rej('grecaptcha never ready');}},120);});`;
}

function runTokenJs(sitekey, action, ent) {
  let g = captchaRoot(ent);
  return `new Promise((res,rej)=>{const G=${g};` +
    `G.execute(${JSON.stringify(sitekey)},{action:${JSON.stringify(action)}}).then(res).catch(e=>rej(String(e)));});`;
}

export async function warmPage(cdp, job) {
  let { sitekey, targetUrl, enterprise = false, proxyAuth = null, reuseInitialTab = false, log = () => {} } = job;

  let targetId = null;
  if (reuseInitialTab) {
    try {
      let found = await cdp.send("Target.getTargets");
      let blank = (found.targetInfos || []).find((t) => t.type === "page" && /^about:blank/.test(t.url || ""));
      if (blank) targetId = blank.targetId;
    } catch (err) {}
  }
  if (!targetId) {
    let made = await cdp.send("Target.createTarget", { url: "about:blank" });
    targetId = made.targetId;
  }
  let attached = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  let sessionId = attached.sessionId;

  let ua = ((cdp.version && cdp.version["User-Agent"]) || "").replace(/Headless/g, "");
  await dressUp(cdp, sessionId, ua);

  let servedYet = false;
  let html = PAGE_SHELL(sitekey, enterprise);

  cdp.on("Fetch.requestPaused", async (paused, sid) => {
    if (sid !== sessionId) return;
    try {
      if (!servedYet && paused.resourceType === "Document") {
        servedYet = true;
        await cdp.send("Fetch.fulfillRequest", {
          requestId: paused.requestId,
          responseCode: 200,
          responseHeaders: [{ name: "Content-Type", value: "text/html; charset=utf-8" }],
          body: Buffer.from(html).toString("base64"),
        }, sid);
      } else {
        await cdp.send("Fetch.continueRequest", { requestId: paused.requestId }, sid);
      }
    } catch (err) {}
  }, sessionId);

  if (proxyAuth) {
    cdp.on("Fetch.authRequired", async (paused, sid) => {
      if (sid !== sessionId) return;
      try {
        await cdp.send("Fetch.continueWithAuth", {
          requestId: paused.requestId,
          authChallengeResponse: {
            response: "ProvideCredentials",
            username: proxyAuth.username,
            password: proxyAuth.password,
          },
        }, sid);
      } catch (err) {}
    }, sessionId);
  }

  let watchRules = proxyAuth
    ? [{ urlPattern: "*", requestStage: "Request" }]
    : [{ urlPattern: "*", resourceType: "Document", requestStage: "Request" }];
  await cdp.send("Fetch.enable", { patterns: watchRules, handleAuthRequests: Boolean(proxyAuth) }, sessionId);
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);
  await cdp.send("Page.navigate", { url: targetUrl }, sessionId);
  log("page loaded (intercepted)");

  await cdp.send("Runtime.evaluate", {
    expression: waitForReadyJs(enterprise), awaitPromise: true, returnByValue: true,
  }, sessionId);
  log("grecaptcha ready");
  if (process.env.INJECT_BEHAVIOR === "1") await fakeHumanMouse(cdp, sessionId).catch(() => {});

  return { targetId, sessionId };
}

export async function executeOn(cdp, sessionId, job) {
  let { sitekey, action = "verify", enterprise = false, log = () => {} } = job;
  log(`execute(${action})`);
  let reply = await cdp.send("Runtime.evaluate", {
    expression: runTokenJs(sitekey, action, enterprise), awaitPromise: true, returnByValue: true,
  }, sessionId);
  if (reply.exceptionDetails)
    throw new Error(reply.exceptionDetails.exception?.description || reply.exceptionDetails.text || "execute a plante");
  let token = reply.result?.value;
  if (!token || typeof token !== "string") throw new Error("pas de token recu");
  return token;
}

export async function closePage(cdp, sessionId, targetId) {
  cdp.off("Fetch.requestPaused", sessionId);
  cdp.off("Fetch.authRequired", sessionId);
  try { await cdp.send("Target.closeTarget", { targetId }); } catch (err) {}
}

export async function mintOnce(cdp, job) {
  let opened = await warmPage(cdp, job);
  try {
    return await executeOn(cdp, opened.sessionId, job);
  } finally {
    await closePage(cdp, opened.sessionId, opened.targetId);
  }
}

export async function solve(job) {
  let cdp = await connect(job.browserURL || "http://localhost:9333");
  try {
    return await mintOnce(cdp, job);
  } finally {
    cdp.close();
  }
}

if (process.argv[1] && here.url && process.argv[1] === fileURLToPath(here.url)) {
  (async () => {
    let token = await solve({
      browserURL: process.env.CONNECT || "http://localhost:9333",
      sitekey: process.env.SITEKEY,
      targetUrl: process.env.TARGET_URL,
      action: process.env.ACTION || "verify",
      enterprise: process.env.ENTERPRISE === "1",
    });
    console.log(token);
  })();
}
