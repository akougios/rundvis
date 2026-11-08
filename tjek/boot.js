// Starter appen i en rigtig browser og fejler hvis den ikke monterer.
//
// HVORFOR DEN FINDES. En hvid side kostede en halv times nedetid: showTotalRef blev erklæret
// inde i en blok der blev slettet, men stadig skrevet til et andet sted. Babel oversatte filen
// uden at kny — det er gyldig JavaScript at røre en variabel der ikke findes, lige indtil den
// køres. React kastede under første render, og så stod siden tom.
//
// Et syntakstjek kan ikke fange det. Kun noget der faktisk starter appen kan.
//
// Containerens netværk når ikke CDN'erne, så React og Babel hentes fra npm og serveres lokalt,
// og script-tags skrives om undervejs. Tailwind droppes helt — den er udseende, ikke funktion.
//
//   node tjek/boot.js
//
// Afslutter med 0 hvis appen monterer og der ikke kastes noget, ellers 1.

const { chromium } = require("playwright");
const { execSync } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROD = path.join(__dirname, "..", "public");
const DEPS = path.join(__dirname, ".deps");
const PORT = 8123;

const PAKKER = {
  "/_dep/react.js": "react/umd/react.production.min.js",
  "/_dep/react-dom.js": "react-dom/umd/react-dom.production.min.js",
  "/_dep/babel.js": "@babel/standalone/babel.min.js",
};

function sikrDeps() {
  const mangler = Object.values(PAKKER).some(
    (f) => !fs.existsSync(path.join(DEPS, "node_modules", f))
  );
  if (!mangler) return;
  fs.mkdirSync(DEPS, { recursive: true });
  console.log("henter react, react-dom og babel (kun første gang)…");
  execSync(
    `npm i --no-save --prefix "${DEPS}" react@18.3.1 react-dom@18.3.1 @babel/standalone@7.24.7`,
    { stdio: "ignore" }
  );
}

function omskrivCdn(html) {
  return html
    .replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/react@18[^"]*"><\/script>/, '<script src="/_dep/react.js"></script>')
    .replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/react-dom@18[^"]*"><\/script>/, '<script src="/_dep/react-dom.js"></script>')
    .replace(/<script src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/babel-standalone[^"]*"><\/script>/, '<script src="/_dep/babel.js"></script>')
    .replace(/<script src="https:\/\/cdn\.tailwindcss\.com"><\/script>/, "");
}

(async () => {
  sikrDeps();

  const srv = http.createServer((req, res) => {
    let f = req.url.split("?")[0];
    if (f === "/") f = "/index.html";
    if (PAKKER[f]) {
      res.writeHead(200, { "Content-Type": "text/javascript" });
      return res.end(fs.readFileSync(path.join(DEPS, "node_modules", PAKKER[f])));
    }
    const p = path.join(ROD, f);
    if (!fs.existsSync(p)) { res.writeHead(404); return res.end(""); }
    let krop = fs.readFileSync(p);
    if (f.endsWith(".html")) krop = omskrivCdn(krop.toString());
    res.writeHead(200, { "Content-Type": f.endsWith(".css") ? "text/css" : "text/html" });
    res.end(krop);
  });
  await new Promise((r) => srv.listen(PORT, r));

  const browser = await chromium.launch();
  const side = await browser.newPage();
  const fejl = [];
  // 404 på /api/... er forventet: der er ingen serverless-funktioner bag den her statiske server.
  side.on("console", (m) => {
    const t = m.text();
    if (m.type() === "error" && !/404|Failed to load resource|favicon/.test(t)) fejl.push(t);
  });
  side.on("pageerror", (e) => fejl.push((e.stack || e.message).split("\n").slice(0, 3).join("\n   ")));

  await side.goto(`http://localhost:${PORT}/`, { waitUntil: "load", timeout: 30000 });
  await side.waitForTimeout(4000);

  const info = await side.evaluate(() => {
    const r = document.getElementById("root");
    return { boern: r ? r.children.length : -1, tekst: document.body.innerText.trim().slice(0, 80) };
  });

  await browser.close();
  srv.close();

  const monteret = info.boern > 0;
  console.log(monteret ? `MONTERET — "${info.tekst.split("\n")[0]}"` : "TOM SIDE — appen monterede ikke");
  if (fejl.length) {
    console.log("\nfejl under start:");
    fejl.slice(0, 5).forEach((f) => console.log("  " + f));
  }
  process.exit(monteret && fejl.length === 0 ? 0 : 1);
})().catch((e) => { console.error("tjekket kunne ikke køre:", e.message); process.exit(1); });
