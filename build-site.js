// Assembles the site/ folder from the flat GitHub repo. Cloudflare runs this on every deploy
// (see "build" in wrangler.jsonc), then serves site/ through worker.js.
// The repo is kept flat so uploading through GitHub's web page can never lose folders.

const fs = require("fs");
const path = require("path");

const root = __dirname;
const out = path.join(root, "site");

// file in the repo -> path on the site
const FILES = {
  "index.html": "index.html",
  "sample-audit.html": "audit/sample/index.html",
  "sample-proposal.html": "proposal/sample/index.html",
  "favicon.svg": "favicon.svg",
  "robots.txt": "robots.txt",
  "_headers": "_headers",
  "tower-1200.jpg": "assets/tower-1200.jpg",
  "tower-2000.jpg": "assets/tower-2000.jpg",
  "road-1200.jpg": "assets/road-1200.jpg",
  "road-2000.jpg": "assets/road-2000.jpg",
  "river-1200.jpg": "assets/river-1200.jpg",
  "river-2000.jpg": "assets/river-2000.jpg",
};

// Photo slots: a stock photo dropped into the repo as stock-N.jpg replaces Logan's photo in that spot.
const SLOTS = {
  "photo-1.jpg": ["stock-1.jpg", "road-2000.jpg"],
};

fs.rmSync(out, { recursive: true, force: true });
const missing = [];
for (const [from, to] of Object.entries(FILES)) {
  const src = path.join(root, from);
  if (!fs.existsSync(src)) { missing.push(from); continue; }
  const dest = path.join(out, to);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}
for (const [slot, choices] of Object.entries(SLOTS)) {
  const pick = choices.find((f) => fs.existsSync(path.join(root, f)));
  if (!pick) { missing.push(slot); continue; }
  fs.mkdirSync(path.join(out, "assets"), { recursive: true });
  fs.copyFileSync(path.join(root, pick), path.join(out, "assets", slot));
  console.log(slot + " <- " + pick);
}
if (missing.length) {
  console.error("Missing from the repo: " + missing.join(", "));
  process.exit(1);
}
console.log("Built site/ with " + (Object.keys(FILES).length + Object.keys(SLOTS).length) + " files.");
