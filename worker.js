// The Ledge site on Cloudflare Workers. One file on purpose: the GitHub repo is kept flat.
//
// Static files come from site/, which build-site.js assembles from the flat repo on every deploy.
// This script sits in front of them to:
//   - handle the form endpoints under /api/
//   - serve each shop's audit and proposal page, which the pipeline hub (Apps Script) renders
//   - fill in the booking link and the Turnstile spam check on every HTML page
//   - fill in the prices on the home and pricing pages from the hub's Settings tab (cached; built-in prices are the fallback)
//
// Settings live in Cloudflare (Worker > Settings > Variables and Secrets), not in the code:
//   HUB_URL             Apps Script web app URL (ends in /exec)
//   HUB_KEY             shared secret, same value as the hub's HUB_KEY script property
//   TURNSTILE_SITE_KEY  Turnstile site key (optional; the form works without it)
//   TURNSTILE_SECRET    Turnstile secret key (optional while testing)
//   BOOKING_URL         booking page link (optional; booking links are hidden when it's empty)

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (path.startsWith("/api/")) return handleApi(request, env, path);

    const page = path.match(/^\/(audit|proposal|report)\/([^/]+)$/);
    if (page && page[2] !== "sample" && request.method === "GET") {
      const res = await hubPage(env, page[1], page[2]);
      if (res) return fillPageValues(res, env);
    }

    const pricing = (path === "/" || path === "/pricing") && request.method === "GET" ? await livePricing(env, ctx) : null;
    return fillPageValues(await env.ASSETS.fetch(request), env, pricing);
  },
};

/* ───────────── live prices ───────────── */

// The hub's Settings tab is the one place prices live. A copy is kept for a day and refreshed in the background once
// it's 10 minutes old, so a price change shows up within minutes and no visitor waits on the hub.
const PRICING_CACHE_KEY = "https://pricing.ledgecommunications.com/v1";

async function livePricing(env, ctx) {
  if (!env.HUB_URL || !env.HUB_KEY) return null;
  const cache = caches.default;
  const refresh = async () => {
    const res = await fetch(`${env.HUB_URL}?page=pricing&key=${encodeURIComponent(env.HUB_KEY)}`, { redirect: "follow" }).catch(() => null);
    const data = res && res.ok ? await res.json().catch(() => null) : null;
    if (!validPricing(data)) return null;
    await cache.put(PRICING_CACHE_KEY, new Response(JSON.stringify(data), {
      headers: { "content-type": "application/json", "cache-control": "max-age=86400", "x-fetched": String(Date.now()) },
    })).catch(() => {});
    return data;
  };
  const hit = await cache.match(PRICING_CACHE_KEY).catch(() => null);
  if (!hit) { ctx.waitUntil(refresh()); return null; }
  if (Date.now() - Number(hit.headers.get("x-fetched") || 0) > 600e3) ctx.waitUntil(refresh());
  const data = await hit.json().catch(() => null);
  return validPricing(data) ? data : null;
}

function validPricing(d) {
  const num = (v) => typeof v === "string" && /^[\d,]{1,9}$/.test(v);
  const short = (v, n) => typeof v === "string" && v.length <= n;
  const optionalNum = (v) => v === undefined || num(v);
  return !!d && d.ok === true && num(d.price_audit) && num(d.credit_days) && num(d.min_fee) && num(d.min_budget) &&
    optionalNum(d.price_page_fixes) && optionalNum(d.price_landing_page) && optionalNum(d.price_full) && optionalNum(d.price_site_support) &&
    short(d.cap_line, 140) && short(d.setup_months, 20) && Array.isArray(d.rows) && d.rows.length >= 1 && d.rows.length <= 10 &&
    d.rows.every((r) => Array.isArray(r) && r.length === 2 && short(r[0], 40) && short(r[1], 40));
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* ───────────── /api/ routes ───────────── */

async function handleApi(request, env, path) {
  const routes = {
    "/api/audit-request": { POST: auditRequest },
    "/api/quote-request": { POST: quoteRequest },
    "/api/approve": { POST: approve },
    "/api/unsubscribe": { GET: unsubscribeGet, POST: unsubscribePost },
    "/api/viewed": { POST: viewed },
  };
  const route = routes[path];
  if (!route) return json({ ok: false, error: "not_found" }, 404);
  const handler = route[request.method];
  if (!handler) return json({ ok: false, error: "method_not_allowed" }, 405);
  try {
    return await handler(request, env);
  } catch (err) {
    console.error(path, err && err.stack ? err.stack : err);
    return json({ ok: false, error: "server" }, 500);
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function toHub(env, payload) {
  const res = await fetch(env.HUB_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...payload, key: env.HUB_KEY }),
    redirect: "follow",
  }).catch(() => null);
  const out = res ? await res.json().catch(() => ({})) : {};
  return { httpOk: !!(res && res.ok), ok: out.ok === true };
}

// POST /api/audit-request: the site form. Checks it's a real person (Turnstile + honeypot),
// then hands the lead to the hub, which records it, sends the confirmation and queues the audit.
const LIMITS = { name: 120, business: 160, website: 300, email: 200, phone: 40, trade: 60, area: 80, running_ads: 20, budget: 30, missed_calls: 60, tools: 300, tools_other: 120 };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(value, max) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

async function readBody(request) {
  const type = request.headers.get("content-type") || "";
  if (type.includes("application/json")) return await request.json();
  const form = await request.formData();
  const out = {};
  for (const key of new Set(form.keys())) out[key] = form.getAll(key).map(String).join(", "); // checkboxes send several values
  return out;
}

async function passesTurnstile(token, ip, secret) {
  if (!secret) return true; // not configured yet
  if (!token) return false;
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ secret, response: token, remoteip: ip, idempotency_key: crypto.randomUUID() }),
  });
  const out = await res.json().catch(() => ({}));
  return out.success === true;
}

async function auditRequest(request, env) {
  let data;
  try {
    data = await readBody(request);
  } catch {
    return json({ ok: false, error: "bad_request" }, 400);
  }

  // Bots fill the hidden field. Tell them it worked and drop it.
  if (clean(data.fax, 50)) return json({ ok: true });

  const lead = {};
  for (const [key, max] of Object.entries(LIMITS)) lead[key] = clean(data[key], max);
  lead.email = lead.email.toLowerCase();

  const missing = ["name", "business", "website", "email"].filter((k) => lead[k].length < 2);
  if (missing.length || !EMAIL.test(lead.email)) {
    return json({ ok: false, error: "invalid", fields: missing }, 400);
  }

  const ip = request.headers.get("cf-connecting-ip") || "";
  if (!(await passesTurnstile(data["cf-turnstile-response"], ip, env.TURNSTILE_SECRET))) {
    return json({ ok: false, error: "verification" }, 400);
  }

  if (!env.HUB_URL || !env.HUB_KEY) return json({ ok: false, error: "not_configured" }, 503);

  const out = await toHub(env, {
    type: "inbound",
    lead: { ...lead, submitted_at: new Date().toISOString(), page: request.headers.get("referer") || "" },
  });
  if (!out.httpOk || !out.ok) return json({ ok: false, error: "hub" }, 502);
  return json({ ok: true });
}

// POST /api/quote-request: the ask at the bottom of an audit page (account audit, starting plan, or details).
async function quoteRequest(request, env) {
  const form = await request.formData().catch(() => null);
  if (!form) return buttonReply(request, false, 400, QUOTE_MSG);
  const id = String(form.get("id") || "").slice(0, 40);
  const t = String(form.get("t") || "").slice(0, 64);
  const notes = String(form.get("notes") || "").replace(/\s+/g, " ").trim().slice(0, 1000);
  const pick = (name, allowed) => { const v = String(form.get(name) || ""); return allowed.includes(v) ? v : ""; };
  const offer = pick("offer", ["account_audit", "starting_plan", "details"]);
  const budget = pick("budget", ["not sure", "under 1000", "1000-2000", "2000-4000", "4000+"]);
  const running_ads = pick("running_ads", ["yes", "no", "not sure"]);
  const addons = [...new Set(form.getAll("addons").map(String))].filter((a) => ["site_audit"].includes(a)).join(",");
  if (!id || !t || !env.HUB_URL || !env.HUB_KEY) return buttonReply(request, false, 400, QUOTE_MSG);
  const out = await toHub(env, { type: "quote", id, t, notes, offer, budget, running_ads, addons });
  return buttonReply(request, out.ok, out.ok ? 200 : 502, QUOTE_MSG);
}

// POST /api/viewed: an audit page was on screen for a few seconds (a beacon from the page, so link scanners don't count).
async function viewed(request, env) {
  const form = await request.formData().catch(() => null);
  const id = form ? String(form.get("id") || "").slice(0, 40) : "";
  const t = form ? String(form.get("t") || "").slice(0, 64) : "";
  if (!id || !t || id === "sample" || !env.HUB_URL || !env.HUB_KEY) return json({ ok: false }, 400);
  const out = await toHub(env, { type: "viewed", id, t });
  return json({ ok: out.ok });
}

// POST /api/approve: the "Approve and get started" button on a proposal page.
async function approve(request, env) {
  const form = await request.formData().catch(() => null);
  if (!form) return buttonReply(request, false, 400, APPROVE_MSG);
  const id = String(form.get("id") || "").slice(0, 40);
  const t = String(form.get("t") || "").slice(0, 64);
  if (!id || !t || !env.HUB_URL || !env.HUB_KEY) return buttonReply(request, false, 400, APPROVE_MSG);
  const addons = [...new Set(form.getAll("addons").map(String))].filter((a) => ["page_fixes", "landing_page", "site_audit"].includes(a)).join(",");
  const out = await toHub(env, { type: "approve", id, t, addons });
  return buttonReply(request, out.ok, out.ok ? 200 : 502, APPROVE_MSG);
}

const QUOTE_MSG = {
  ok: "<h1>Got it</h1><p>You'll hear back by the end of the next business day.</p>",
  fail: "<h1>That didn't go through</h1><p>Reply to the email with \"yes\" and we'll take it from there.</p>",
};
const APPROVE_MSG = {
  ok: "<h1>Approved</h1><p>Thanks. Next steps are on their way to your inbox.</p>",
  fail: "<h1>That didn't go through</h1><p>Reply to the email with \"approved\" and we'll take it from there.</p>",
};

function buttonReply(request, ok, status, msg) {
  if ((request.headers.get("accept") || "").includes("application/json")) return json({ ok }, status);
  return new Response(simplePage("Ledge Communications", ok ? msg.ok : msg.fail), {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

// /api/unsubscribe?id=<lead id>&t=<token>
// GET: the unsubscribe link at the bottom of every email.
// POST: Gmail's and Apple Mail's one-click unsubscribe button (List-Unsubscribe-Post).
async function unsubscribe(request, env) {
  const url = new URL(request.url);
  const id = (url.searchParams.get("id") || "").slice(0, 40);
  const t = (url.searchParams.get("t") || "").slice(0, 64);
  if (!id || !t) return { ok: false, bad: true };
  if (!env.HUB_URL || !env.HUB_KEY) return { ok: false };
  const out = await toHub(env, { type: "unsubscribe", id, t });
  return { ok: out.ok };
}

async function unsubscribeGet(request, env) {
  const r = await unsubscribe(request, env);
  const html = (title, body, status) =>
    new Response(simplePage(`${title} | Ledge Communications`, `<h1>${title}</h1>${body}`), {
      status,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  if (r.bad) return html("Link not recognised", "<p>This unsubscribe link is incomplete. Reply to any of our emails with \"unsubscribe\" and you'll be taken off the list.</p>", 400);
  if (!r.ok) return html("Something went wrong", "<p>That didn't go through just now. Reply to any of our emails with \"unsubscribe\" and you'll be taken off the list within a day.</p>", 502);
  return html("You're unsubscribed", "<p>You won't get any more emails from Ledge Communications.</p><p><a href=\"/\">Back to the site</a></p>", 200);
}

async function unsubscribePost(request, env) {
  const r = await unsubscribe(request, env);
  return new Response(r.ok ? "ok" : "error", { status: r.ok ? 200 : 400 });
}

/* ───────────── /audit/<slug> and /proposal/<slug> ───────────── */

// Each shop's audit and fixed-price pages live in the hub, which renders the HTML.
// /audit/sample, /proposal/sample, and /report/sample are static files and never reach here.
const PAGE_CACHE = { audit: "public, max-age=300", proposal: "no-store", report: "no-store" };

async function hubPage(env, page, slug) {
  if (!/^[a-z0-9-]{4,80}$/.test(slug)) return null; // not a real slug: fall through to static files
  if (!env.HUB_URL || !env.HUB_KEY) return null;
  const url = `${env.HUB_URL}?page=${page}&slug=${encodeURIComponent(slug)}&key=${encodeURIComponent(env.HUB_KEY)}`;
  const res = await fetch(url, { redirect: "follow" }).catch(() => null);
  const body = res && res.ok ? await res.text() : "";
  if (!body.startsWith("<!doctype")) {
    return new Response(
      simplePage("Not found | Ledge Communications",
        "<h1>This page isn't here</h1><p>The link may be incomplete. Reply to the email it came in and we'll send it again.</p><p><a href=\"/\">Ledge Communications</a></p>"),
      { status: 404, headers: { "content-type": "text/html; charset=utf-8", "x-robots-tag": "noindex, nofollow" } },
    );
  }
  return new Response(body, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": PAGE_CACHE[page], "x-robots-tag": "noindex, nofollow" },
  });
}

function simplePage(title, inner) {
  return `<!doctype html><html lang="en-CA"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${title}</title>
<style>:root{--bg:#F5F7FA;--fg:#1B2A38;--muted:#566A7E}@media (prefers-color-scheme:dark){:root{--bg:#0F1820;--fg:#E8EEF3;--muted:#9AAFC2}}
body{margin:0;background:var(--bg);color:var(--fg);font:17px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:34rem;margin:0 auto;padding:72px max(16px,env(safe-area-inset-left,0px))}h1{font-size:1.6rem;margin:0 0 12px}p{color:var(--muted)}a{color:inherit}</style>
</head><body><main>${inner}</main></body></html>`;
}

/* ───────────── every HTML page ───────────── */

// Fills in values that live in Cloudflare settings, so changing the booking link or adding the
// spam check never needs a code change.
function fillPageValues(res, env, pricing) {
  const type = res.headers.get("content-type") || "";
  if (!type.includes("text/html")) return res;

  const booking = (env.BOOKING_URL || "").trim();
  const siteKey = (env.TURNSTILE_SITE_KEY || "").trim();
  const rows = pricing ? pricing.rows.map((r) => `<tr><td>${escapeHtml(r[0])}</td><td>${escapeHtml(r[1])}</td></tr>`).join("") : "";

  return new HTMLRewriter()
    .on("[data-price]", {
      element(el) {
        if (!pricing) return;
        const key = el.getAttribute("data-price");
        if (key === "rows") el.setInnerContent(rows, { html: true });
        else if (typeof pricing[key] === "string") el.setInnerContent(pricing[key]);
      },
    })
    .on("a[data-booking]", {
      element(el) {
        if (booking) {
          el.setAttribute("href", booking);
          el.setAttribute("target", "_blank");
          el.setAttribute("rel", "noopener");
        } else {
          el.remove();
        }
      },
    })
    .on("[data-booking-wrap]", {
      element(el) {
        if (!booking) el.remove();
      },
    })
    .on("div[data-turnstile]", {
      element(el) {
        if (siteKey) {
          el.setAttribute("class", "cf-turnstile");
          el.setAttribute("data-sitekey", siteKey);
          el.setAttribute("data-theme", "light"); // the site is light only
        } else {
          el.remove();
        }
      },
    })
    .on("head", {
      element(el) {
        if (siteKey) el.append('<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>', { html: true });
      },
    })
    .transform(res);
}
