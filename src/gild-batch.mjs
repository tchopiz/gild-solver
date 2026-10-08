// =============================================
//   GILD - RECAPTCHA V3 SOLVER
//   author  : GILD
//   contact : t.me/gild_eng
//   usage   : educational purposes only
// =============================================

import fs from "node:fs";

let wanted = Number(process.argv[2]) > 0 ? Number(process.argv[2]) : 10;
let atOnce = Number(process.argv[3]) > 0 ? Math.min(Number(process.argv[3]), 10) : 3;

let endpoint = process.env.URL || "http://localhost:47613/gild/token";
let sitekey = process.env.SITEKEY;
let pageUrl = process.env.TARGET;
let act = process.env.ACTION || "login";

if (!sitekey || !pageUrl) {
  console.log("il manque SITEKEY et TARGET, exemple :");
  console.log('  $env:SITEKEY="6L..."; $env:TARGET="https://site.com"; node src/gild-batch.mjs 10');
  process.exit(1);
}

console.log(`batch de ${wanted} tokens | ${atOnce} en parallele | action=${act}`);

let got = [];
let fails = [];
let asked = 0;
let begin = Date.now();

async function drain() {
  while (asked < wanted) {
    asked++;
    try {
      let reply = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sitekey, target: pageUrl, action: act }),
      });
      let data = await reply.json();
      if (data.token) {
        got.push(data.token);
        process.stdout.write(
          `\r  \u2714 ${got.length}/${wanted}  (${fails.length} rates)  ${Math.round((Date.now() - begin) / 1000)}s   `
        );
      } else {
        fails.push(data.error || "raison inconnue");
      }
    } catch (err) {
      fails.push(err.message);
    }
  }
}

await Promise.all(Array.from({ length: atOnce }, drain));

fs.writeFileSync("tokens.txt", got.length ? got.join("\n") + "\n" : "");
console.log(`\n\ntermine: ${got.length} ok / ${wanted} demandes en ${Math.round((Date.now() - begin) / 1000)}s`);
console.log(`sauvegarde: tokens.txt`);
if (fails.length) {
  console.log(`erreurs (${fails.length}), les 3 dernieres :`);
  fails.slice(-3).forEach((e) => console.log("  - " + e));
}
process.exit(got.length ? 0 : 2);
