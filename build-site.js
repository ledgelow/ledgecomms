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
  "pricing.html": "pricing/index.html",
  "sample-audit.html": "audit/sample/index.html",
  "sample-proposal.html": "proposal/sample/index.html",
  "sample-report.html": "report/sample/index.html",
  "favicon.svg": "favicon.svg",
  "robots.txt": "robots.txt",
  "_headers": "_headers",
};

// Every photo in the repo (any .jpg) goes to assets/. The build stops if a page uses a photo that isn't there.

fs.rmSync(out, { recursive: true, force: true });
const missing = [];
for (const [from, to] of Object.entries(FILES)) {
  const src = path.join(root, from);
  if (!fs.existsSync(src)) { missing.push(from); continue; }
  const dest = path.join(out, to);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}
fs.mkdirSync(path.join(out, "assets"), { recursive: true });
const photos = fs.readdirSync(root).filter((f) => f.toLowerCase().endsWith(".jpg"));
for (const f of photos) fs.copyFileSync(path.join(root, f), path.join(out, "assets", f));
for (const page of ["index.html", "pricing.html", "sample-audit.html", "sample-proposal.html", "sample-report.html"]) {
  if (!fs.existsSync(path.join(root, page))) continue;
  const used = fs.readFileSync(path.join(root, page), "utf8").match(/assets\/[\w.-]+\.jpg/g) || [];
  for (const u of used) {
    const f = u.slice("assets/".length);
    if (!photos.includes(f) && !missing.includes(f)) missing.push(f);
  }
}
if (missing.length) {
  console.error("Missing from the repo: " + missing.join(", "));
  process.exit(1);
}
console.log("Built site/ with " + Object.keys(FILES).length + " pages and files, and " + photos.length + " photos.");
