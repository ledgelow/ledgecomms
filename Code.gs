/**
 * Ledge lead hub, v2.
 *
 * Lives in the "Ledge Pipeline" Google Sheet owned by ledgecommunications@gmail.com
 * (Extensions > Apps Script). One Google account runs the whole system:
 *
 *   Site form ─────────> doPost(inbound) ─> lead, confirmation email, audit job queued
 *   Monday 5 am ───────> weeklyProspects ─> new shops from Google Maps for the next area (or a
 *                                          "find shops" job when search data isn't set up)
 *   Every hour ────────> runHourly:
 *       evidence:   for each queued audit, the searches a customer would run on a phone in the
 *                   shop's town (Local Services Ads, search ads, map, and websites), the shop's ads history
 *                   from Google's Ads Transparency Center, and a scan of its home page
 *       engine:     queued jobs go to the Claude API as one batch; finished batches become
 *                   Local Search Audits (and, for find jobs, new cold leads with their own audit jobs)
 *       review:     the first audits and proposals wait for Logan's one-click OK
 *       email:      cold sequence and site-lead emails go out from this Gmail account,
 *                   in one thread per lead, and stop the moment someone replies
 *       replies:    a clear yes gets a fixed-price proposal, a clear no is stopped and never
 *                   contacted again, anything else waits for Logan in a 5 pm email
 *       calendar:   a booking on the booking page stops every email and sends Logan a brief
 *   Audit page button ─> doPost(quote)   ─> proposal drafted and emailed
 *   Proposal approve ──> doPost(approve) ─> marked won, kickoff email, Logan told
 *   Monday 7 am ───────> sendDigest
 *
 * Pages: ledgecommunications.com/audit/<slug> and /proposal/<slug> are served by the Cloudflare Worker,
 * which asks this script for the HTML (doGet ?page=...).
 *
 * Settings live on the Settings tab. Secrets live in Project Settings > Script Properties:
 *   ANTHROPIC_API_KEY, WEB_APP_URL (and HUB_KEY, which setup() creates),
 *   DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD (search data; audits still build without them, with less in them).
 */

var TAB = {
  settings: 'Settings', leads: 'Leads', audits: 'Audits', proposals: 'Proposals',
  jobs: 'Engine jobs', events: 'Events', dnc: 'Do not contact', evidence: 'Evidence', volumes: 'Search volumes',
  exports: 'Ads exports', reports: 'Account reports', clients: 'Clients', invoices: 'Invoices'
};
// New columns only ever go on the end, so older sheets can be extended in place (see ensureSchema_).
var HEAD = {
  leads: ['id', 'created', 'source', 'status', 'attention', 'first_name', 'name', 'business', 'website', 'email',
    'phone', 'trade', 'area', 'consent_basis', 'consent_proof', 'audit_slug', 'top_finding', 'fix_1',
    'proposal_slug', 'thread_id', 'last_msg_id', 'last_reply_at', 'touches', 'next_touch', 'last_touch',
    'booked_at', 'notes', 'owner_says', 'segment', 'budget', 'ads_customer_id', 'report_slug',
    // audit_opened: first time the audit page was read after it went out (audit_opens counts every time).
    // check_back: the date a "try me later" lead gets its one note. personal_line: Logan's line atop a site-form audit email.
    'audit_opened', 'audit_opens', 'check_back', 'personal_line'],
  audits: ['slug', 'lead_id', 'created', 'business', 'spec_json'],
  // price_sprint is the one-time amount and price_care the monthly fee, whatever the offer.
  proposals: ['slug', 'lead_id', 'created', 'price_sprint', 'price_care', 'gst', 'status', 'sent_at', 'approved_at', 'kind', 'ad_spend', 'credit', 'addons',
    'invoice_id', 'invoice_number', 'paid_at'],
  jobs: ['job_id', 'kind', 'lead_id', 'area', 'status', 'batch_id', 'attempts', 'created', 'updated', 'est_cost_usd', 'detail'],
  events: ['timestamp', 'lead_id', 'email', 'event', 'detail'],
  dnc: ['email_or_domain', 'added', 'reason'],
  evidence: ['lead_id', 'created', 'segment', 'town', 'cost_usd', 'evidence_json'],
  volumes: ['keyword', 'location', 'volume', 'bid_low_usd', 'bid_high_usd', 'fetched', 'detail'],
  // One row per account audit export. The data itself is split across d1 to d8 (a cell holds 50,000 characters).
  exports: ['id', 'lead_id', 'customer_id', 'requested', 'status', 'updated', 'detail', 'report_slug', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8', 'site', 'site_json',
    'kind', 'month'],
  // One row per client we run ads for. Logan can edit status (active, paused, ended), bill_from, monthly_fee, and notes_for_report.
  clients: ['lead_id', 'business', 'email', 'customer_id', 'status', 'plan', 'started', 'bill_from', 'monthly_fee', 'ad_budget', 'notes_for_report',
    'last_report', 'last_invoice'],
  // Monthly management invoices. The first column is always filled (rows with an empty first cell are skipped).
  invoices: ['lead_id', 'month', 'item', 'amount', 'status', 'invoice_id', 'invoice_number', 'created', 'sent_at', 'paid_at'],
  reports: ['slug', 'lead_id', 'export_id', 'created', 'status', 'spec_json']
};
var SCHEMA_VERSION = '10';
// Settings whose default changed. On upgrade, a cell still holding an old default gets the new one; anything else is left alone.
var OLD_DEFAULTS = {
  MGMT_TIERS: ['1000:500, 2000:800, 4000:1200, 8000:15%'], MIN_AD_BUDGET: ['1000'],
  PRICE_PAGE_FIXES: ['400', '500'], PRICE_LANDING_PAGE: ['900', '1000'], PRICE_SITE_SUPPORT: ['100'],
  COLD_PER_DAY_MAX: ['20'], PROSPECTS_PER_WEEK: ['15'], REVIEW_PROPOSALS_FIRST: ['3'],
  TRADES: ['heating and cooling, plumbing, electrical, roofing and eavestroughs, garage doors, appliance repair']
};
var SETTINGS_DEFAULTS = [
  ['OWNER_EMAIL', '', 'Where your notifications go (your everyday inbox).'],
  ['SENDER_NAME', '', 'Your full name, as it appears on every email.'],
  ['MAILING_ADDRESS', '', 'Mailing address for email footers. Canada\'s anti-spam law requires one. Shown only in email footers.'],
  ['SITE_URL', 'https://ledgecommunications.com', 'Where the site lives. Links in emails point here. Use the workers.dev address while testing.'],
  ['BOOKING_URL', '', 'Your booking page link (Superhuman or Google Calendar). Optional.'],
  ['CALENDAR_ID', 'primary', 'Calendar the booking page books into. "primary" = this account\'s main calendar.'],
  ['BOOKING_EVENT_MATCH', 'Ledge', 'Bookings from new people are picked up when the event title contains this.'],
  ['PRICE_SPRINT', '1000', 'Old lead-handling offer. Only used for proposals made before the switch to Google Ads.'],
  ['PRICE_CARE', '250', 'Old lead-handling care plan. Only used for proposals made before the switch to Google Ads.'],
  ['GST_REGISTERED', 'yes', 'yes adds "+ GST" to prices.'],
  ['PAYMENT_URL', '', 'Optional payment link (Stripe or Wave) sent after a proposal is approved.'],
  ['REVIEW_AUDITS_FIRST', '5', 'Hold the first N audits for your one-click OK. 0 turns it off.'],
  ['REVIEW_PROPOSALS_FIRST', '10', 'Hold the first N proposals for your one-click OK. 0 turns it off.'],
  ['INBOUND_HOLD_HOURS', '3', 'Site-form audits wait this many hours for your OK, so you can add a personal line, then go out on their own. 0 sends them as soon as they\'re ready.'],
  ['COLD_EMAIL_ON', 'no', 'yes starts cold emails. Leave it at no until you\'re happy with the first audits.'],
  ['COLD_PER_DAY_START', '5', 'Cold emails per weekday in the first week.'],
  ['COLD_PER_DAY_MAX', '10', 'Ceiling after adding 5 a week. Raise it once replies look healthy.'],
  ['PROSPECTS_PER_WEEK', '40', 'New shops to look for each Monday. Keep it about one and a half times the week\'s cold emails: 40 at 5 a day, 75 at 10. Each one gets an audit, so engine spend rises with it.'],
  ['AREAS', 'Calgary NE, Calgary NW, Calgary SE, Calgary SW, Airdrie, Chestermere, Cochrane, Okotoks', 'Areas to work through, in order.'],
  ['TRADES', 'heating and cooling, plumbing, electrical, garage doors, appliance repair',
    'Kinds of business to look for, comma separated. Each one gets its own Google searches. Roofing and eavestroughs are off for the winter; add them back in March.'],
  ['MODEL', 'claude-opus-5-5', 'Claude model for finding shops and writing audits. claude-sonnet-5-5 costs about half.'],
  ['MONTHLY_ENGINE_BUDGET_USD', '60', 'The engine pauses for the rest of the month once estimated spend passes this (Claude and search data together).'],
  ['PRICE_ACCOUNT_AUDIT', '500', 'Paid Google Ads account audit, CAD before GST. Shown on audits for shops already running ads.'],
  ['ACCOUNT_AUDIT_CREDIT_DAYS', '30', 'The account audit fee comes off setup or management if they go ahead within this many days. 0 hides the line.'],
  ['MGMT_TIERS', '0:450, 1000:650, 2000:950, 4000:1450, 8000:20%',
    'Monthly management fee by monthly ad budget, CAD before GST. Each entry is budget-from:fee, or budget-from:percent of the budget (0 means "under the next one").'],
  ['MGMT_MIN_FEE', '500', 'The lowest fee on a percentage tier, CAD before GST. Fixed tiers charge exactly what MGMT_TIERS says.'],
  ['MIN_AD_BUDGET', '750', 'The smallest monthly ad budget a plan is built on, CAD. The site says plans start here.'],
  ['SETUP_MONTHS', '1', 'Setup fee, as months of the monthly fee (1 = setup costs the same as one month).'],
  ['ADS_MANAGER_ID', '871-805-0188', 'Ledge\'s Google Ads manager account. Clients link their accounts to it; the kickoff emails tell them how.'],
  ['PRICE_PAGE_FIXES', '750', 'Add-on: page fixes on their current site (tap-to-call near the top, a shorter form, a booking button, call tracking). CAD before GST, one time.'],
  ['PRICE_LANDING_PAGE', '1500', 'Add-on: a landing page built for their ads. CAD before GST, one time.'],
  ['PRICE_FULL_AUDIT', '1000', 'Account and site audit together, CAD before GST. Offered when a free audit finds things to fix in both the ads and the website. The site part costs this minus PRICE_ACCOUNT_AUDIT.'],
  ['MONTHLY_REVIEW', 'yes', 'yes holds each monthly report and the month\'s management invoices for your OK. no sends them as soon as they\'re ready.'],
  ['INVOICE_DUE_DAYS', '7', 'Once FreshBooks is connected: days until an invoice is due.'],
  ['PRICE_SITE_SUPPORT', '125', 'Site support, CAD per hour before GST: changes and fixes on their website beyond the page fixes add-on.'],
  ['VALUE_CLICK_RATE', '6', 'For the dollar estimate in audits: percent of searches that click an ad. Used for kinds of business without their own benchmark (most trades have one in the code).'],
  ['VALUE_LEAD_RATE', '7', 'For the dollar estimate: percent of ad clicks that call or send a form. Used for kinds of business without their own benchmark.'],
  ['VALUE_CPC', '12', 'For the dollar estimate: typical cost per click in CAD, for kinds of business without their own benchmark.'],
  ['VALUE_BOOK_RATE', '35', 'For the dollar estimate: percent of calls and forms that turn into booked jobs (trade surveys put it around 25 to 45). Change it to your own number once you know it.']
];
// Legacy (Lead Handling Audit) rows, still used to show audits built before the switch.
var STAGE_NAMES = ['Lead comes in', 'First response', 'Visit booked', 'Quote sent', 'Job done and paid', 'Customer comes back'];
// Local Search Audit: the six checks, always in this order.
var CHECK_NAMES = ['Map results', 'Local Services Ads', 'Search ads', 'Reviews', 'Call and form tracking', 'Where clicks land'];
var PILL = { good: 'Looks good', gap: 'Needs work', leak: 'Needs work', unknown: 'Couldn\'t check' };
var OFFERS = {
  free: 'Quick win, included in any Ledge plan',
  paid_audit: 'Part of the Google Ads audit',
  setup: 'Part of the starting plan',
  management: 'Part of monthly management',
  page_fixes: 'Page fixes add-on',
  landing_page: 'Landing page add-on',
  site_support: 'Site support'
};
// One-time add-ons a proposal can carry. The audit suggests them; the owner ticks them when approving.
var ADDONS = {
  page_fixes: { setting: 'PRICE_PAGE_FIXES', item: 'Page fixes on your website',
    blurb: 'A tap-to-call button near the top, a shorter form, a booking button if you use one, and call tracking, so more clicks turn into calls.' },
  landing_page: { setting: 'PRICE_LANDING_PAGE', item: 'A landing page for your ads',
    blurb: 'One page built around the searches you pay for, with your number, reviews, and service area up front.' },
  site_audit: { setting: 'PRICE_FULL_AUDIT', minus: 'PRICE_ACCOUNT_AUDIT', item: 'Site audit', only: 'account_audit',
    blurb: 'Your website, checked the way a customer on a phone sees it: speed, tap-to-call, forms, booking, service pages, and tracking. ' +
      'It comes in the same report, with each change priced, and we can make the changes or walk whoever runs your site through them.' }
};
// Add-ons a proposal of this kind always offers, whatever the audit suggested.
function standingAddons_(kind) { return Object.keys(ADDONS).filter(function (a) { return ADDONS[a].only === kind; }); }
// Every add-on price, plus site support (hourly), for the pages.
function addonPrices_() {
  var out = { site_support: Number(setting_('PRICE_SITE_SUPPORT') || 0) };
  Object.keys(ADDONS).forEach(function (k) { out[k] = addonPrice_(k); });
  return out;
}
function addonPrice_(key) {
  var a = ADDONS[key];
  return Math.max(0, Number(setting_(a.setting) || 0) - (a.minus ? Number(setting_(a.minus) || 0) : 0));
}
// The add-ons an audit suggested, in order.
function suggestedAddons_(aspec) {
  var out = [];
  (aspec.moves || []).forEach(function (m) { if (ADDONS[m.offer] && out.indexOf(m.offer) === -1) out.push(m.offer); });
  return out;
}
var SEGMENTS = ['running_ads', 'no_ads', 'unknown'];
var AUDIT_NAME = 'Local Search Audit';
var DONE_STATUSES = ['unsubscribed', 'bounced', 'not_interested', 'skipped', 'error', 'won', 'booked'];

var OPT_OUT = /\b(unsubscribe|remove me|take me off|stop (emailing|contacting|sending)|don'?t (email|contact)|do not (email|contact)|please stop|leave me alone)\b/i;
var NEGATIVE = /\b(not interested|no thanks|no thank you|we'?re (all )?(good|set)|we'?re not looking|pass on this|no need)\b/i;
var POSITIVE = /\b(yes|yeah|yep|sure|interested|sounds good|sounds great|let'?s (talk|chat|do it|go)|send (it|me|over)|go ahead|tell me more|more info|how much|what (does|would) (it|that) cost|price|pricing|quote)\b/i;
var AUTO_SUBJECT = /\b(out of (the )?office|automatic reply|auto.?reply|away from (the )?office|on vacation)\b/i;

var _settings = null;

/* ══════════════════════════ setup and menu ══════════════════════════ */

function setup() {
  ensureSchema_(true);
  var st = SpreadsheetApp.getActive().getSheetByName(TAB.settings);
  st.setFrozenRows(1);
  st.setColumnWidth(1, 220); st.setColumnWidth(2, 340); st.setColumnWidth(3, 520);

  var p = props_();
  if (!p.getProperty('HUB_KEY')) p.setProperty('HUB_KEY', Utilities.getUuid().replace(/-/g, ''));

  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['runHourly', 'weeklyProspects', 'sendDigest'].indexOf(t.getHandlerFunction()) > -1) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('runHourly').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('weeklyProspects').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(5).create();
  ScriptApp.newTrigger('sendDigest').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(7).create();

  Logger.log('HUB_KEY (paste into Cloudflare as HUB_KEY): ' + p.getProperty('HUB_KEY'));
  var missing = checkSettings_();
  Logger.log(missing.length ? 'Still to fill in: ' + missing.join(', ') : 'Settings look complete.');
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Ledge')
    .addItem('Run now', 'runHourly')
    .addItem('Find prospects now', 'weeklyProspects')
    .addItem('Check one shop', 'checkOneShop')
    .addItem('Make a management proposal', 'makeManagementProposal')
    .addItem('Run an account audit', 'runAccountAudit')
    .addItem('Rebuild audits that haven\'t gone out', 'rebuildWaitingAudits')
    .addItem('Connect FreshBooks', 'connectFreshBooks')
    .addItem('Send a test invoice to myself', 'testFreshBooksInvoice')
    .addItem('Send me the weekly digest now', 'sendDigest')
    .addItem('Check settings', 'showSettingsCheck')
    .addToUi();
}

// From the Sheet's Ledge menu this shows a pop-up; run from the script editor it writes to the Execution log instead.
function showSettingsCheck() {
  ensureSchema_();
  var missing = checkSettings_();
  var msg = missing.length ? 'Still to fill in:\n\n' + missing.join('\n') : 'Settings look complete.';
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Logger.log(msg); }
}

// Ledge menu > Check one shop: runs the audit searches on any website and shows what came back. Nothing is saved to Leads.
function checkOneShop() {
  ensureSchema_();
  var ui = SpreadsheetApp.getUi();
  var ask = function (q) { var r = ui.prompt('Check one shop', q, ui.ButtonSet.OK_CANCEL); return r.getSelectedButton() === ui.Button.OK ? r.getResponseText().trim() : null; };
  var site = ask('Website, for example bigspringsplumbing.ca');
  if (!site) return;
  var trade = ask('Kind of business, for example plumbing, or heating and cooling');
  if (trade === null) return;
  var area = ask('Town or area, for example Airdrie or Calgary NE. Leave it blank to use the town their site names most.');
  if (area === null) return;
  var ev = buildEvidence_({ website: site, trade: trade, area: area, business: '' });
  appendRow_(TAB.jobs, HEAD.jobs, { job_id: newId_('J'), kind: 'check', lead_id: '', area: ev.where, status: 'done', attempts: 1,
    created: new Date(), updated: new Date(), est_cost_usd: ev.cost, detail: 'Check one shop: ' + site });
  var text = evidenceText_(ev) + '\n\nSearch data cost: US$' + ev.cost.toFixed(3);
  ui.showModalDialog(HtmlService.createHtmlOutput('<pre style="white-space:pre-wrap;font:13px/1.5 monospace">' + esc_(text) + '</pre>')
    .setWidth(900).setHeight(620), 'What a customer sees: ' + site);
}

function checkSettings_() {
  _settings = null;
  var need = ['OWNER_EMAIL', 'SENDER_NAME', 'MAILING_ADDRESS'].filter(function (k) { return !setting_(k); });
  if (!prop_('ANTHROPIC_API_KEY')) need.push('ANTHROPIC_API_KEY (Script Properties)');
  if (!prop_('WEB_APP_URL')) need.push('WEB_APP_URL (Script Properties, after you deploy)');
  if (!dfsConfigured_()) need.push('DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD (Script Properties; audits build without them, but without the searches)');
  return need;
}

// Creates missing tabs, extends older tabs with new columns, and adds new settings rows.
// Runs once per schema version on the next hourly run, form post, or page view, so a code update needs no manual step.
function ensureSchema_(force) {
  if (!force && prop_('SCHEMA_VERSION') === SCHEMA_VERSION) return;
  var from = Number(prop_('SCHEMA_VERSION') || 0);
  var ss = SpreadsheetApp.getActive();
  Object.keys(TAB).forEach(function (k) {
    if (k !== 'settings') ensureSheet_(ss, TAB[k], HEAD[k]);
  });
  var st = ss.getSheetByName(TAB.settings) || ss.insertSheet(TAB.settings, 0);
  if (st.getLastRow() < 1) st.getRange(1, 1, 1, 3).setValues([['setting', 'value', 'what it does']]).setFontWeight('bold');
  var have = st.getLastRow() > 1 ? st.getRange(2, 1, st.getLastRow() - 1, 1).getValues().map(function (r) { return r[0]; }) : [];
  SETTINGS_DEFAULTS.forEach(function (row) { if (have.indexOf(row[0]) === -1) st.appendRow(row); });
  if (from > 0 && from < Number(SCHEMA_VERSION)) refreshSettingDefaults_(st);
  _settings = null;
  props_().setProperty('SCHEMA_VERSION', SCHEMA_VERSION);
  if (from > 0 && from < 4) rebuildLegacyAudits_();
}

function refreshSettingDefaults_(st) {
  var norm = function (v) { return /^[\d.]+$/.test(String(v).trim()) ? String(Number(v)) : String(v).replace(/\s+/g, ' ').trim(); };
  var defaults = {};
  SETTINGS_DEFAULTS.forEach(function (r) { defaults[r[0]] = r; });
  var vals = st.getRange(2, 1, st.getLastRow() - 1, 3).getValues();
  vals.forEach(function (r, i) {
    var d = defaults[String(r[0]).trim()];
    if (!d) return;
    var old = OLD_DEFAULTS[d[0]];
    if (old && old.map(norm).indexOf(norm(r[1])) > -1) st.getRange(i + 2, 2).setValue(d[1]);
    if (r[2] !== d[2]) st.getRange(i + 2, 3).setValue(d[2]); // descriptions are ours: keep them current
  });
}

// Audits written before the switch to Google Ads (lead handling) that nobody has been sent yet are rebuilt as
// Local Search Audits. The shops and the emails found for them stay; only the audit is redone.
function rebuildLegacyAudits_() {
  var n = 0;
  readRows_(TAB.leads, HEAD.leads).forEach(function (l) {
    if (['awaiting_review', 'audit_ready', 'audit_approved', 'ready_to_send'].indexOf(l.status) === -1 || Number(l.touches || 0) > 0 || !l.audit_slug) return;
    var row = findRow_(TAB.audits, HEAD.audits, 'slug', l.audit_slug);
    var spec = {};
    try { spec = row ? JSON.parse(row.spec_json) : {}; } catch (err) {}
    if (!spec.stages) return;
    updateLead_(l, { status: l.source === 'cold' ? 'researching' : 'requested', audit_slug: '' });
    queueJob_('audit', l.id, '');
    logEvent_(l.id, l.email, 'rebuild', 'switch to Local Search Audit');
    n++;
  });
  if (n) logEvent_('', '', 'rebuild', n + ' lead-handling audits queued again as Local Search Audits');
}

/* ══════════════════════════ web entry points ══════════════════════════ */

function doPost(e) {
  try {
    ensureSchema_();
    var body = {};
    try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { body = {}; }
    if (body.key !== prop_('HUB_KEY')) return json_({ ok: false, error: 'forbidden' });
    if (body.type === 'inbound') return json_(handleInbound_(body.lead || {}));
    if (body.type === 'quote') return json_(handleQuoteRequest_(body.id, body.t, body.notes, body.offer, body.budget, body.running_ads, body.addons));
    if (body.type === 'approve') return json_(handleApprove_(body.id, body.t, body.addons));
    if (body.type === 'unsubscribe') return json_(handleUnsubscribe_(body.id, body.t));
    if (body.type === 'viewed') return json_(handleViewed_(body.id, body.t));
    if (body.type === 'ads_queue') return json_(adsQueue_());
    if (body.type === 'ads_export') return json_(handleAdsExport_(body));
    return json_({ ok: false, error: 'unknown_type' });
  } catch (err) {
    logEvent_('', '', 'error', 'doPost: ' + (err && err.stack || err));
    return json_({ ok: false, error: 'server' });
  }
}

function doGet(e) {
  ensureSchema_();
  var p = (e && e.parameter) || {};
  if (p.code && p.state) return freshbooksCallback_(p);
  if (p.page) {
    if (p.key !== prop_('HUB_KEY')) return text_('forbidden');
    if (p.page === 'pricing') return json_(pricingSummary_());
    var html = p.page === 'audit' ? renderAudit_(p.slug) : p.page === 'proposal' ? renderProposal_(p.slug) : p.page === 'report' ? renderReport_(p.slug) : null;
    return text_(html || 'not_found');
  }
  if (!p.id || p.t !== token_(p.id)) return page_('Link not recognised', 'This link is incomplete or out of date.');
  if (p.action === 'approve_invoices' && /^invoices-\d{4}-\d{2}$/.test(p.id)) return ownerApproveInvoices_(p.id.slice(9));
  var lead = findLead_('id', p.id);
  if (!lead) return page_('Lead not found', 'That lead is no longer in the pipeline.');
  var res;
  if (p.action === 'audit_line') return auditLinePage_(lead);
  if (p.action === 'approve_audit') res = ownerApproveAudit_(lead);
  else if (p.action === 'approve_proposal') res = ownerApproveProposal_(lead);
  else if (p.action === 'skip') res = ownerSkip_(lead);
  else if (p.action === 'rebuild') res = ownerRebuild_(lead);
  else if (p.action === 'approve_report') res = ownerApproveReport_(lead);
  else if (p.action === 'rebuild_report') res = ownerRebuildReport_(lead);
  else if (p.action === 'approve_monthly') res = ownerApproveMonthly_(lead, p.slug);
  else if (p.action === 'check_back') res = ownerCheckBack_(lead, p.when);
  else if (p.action === 'handled') {
    updateLead_(lead, { attention: '' });
    logEvent_(lead.id, lead.email, 'handled', '');
    res = { title: 'Marked handled', message: (lead.business || lead.email) + ' is off your list.' };
  } else res = { title: 'Unknown action', message: '' };
  return page_(res.title, res.message);
}

/* ══════════════════════════ site leads ══════════════════════════ */

function handleInbound_(f) {
  var email = String(f.email || '').toLowerCase().trim();
  if (!email) return { ok: false, error: 'no_email' };
  var existing = findLead_('email', email);
  if (existing && DONE_STATUSES.indexOf(existing.status) === -1 && existing.source === 'inbound') {
    logEvent_(existing.id, email, 'duplicate_request', f.business || '');
    return { ok: true, id: existing.id, duplicate: true };
  }
  var lead = {
    id: newId_('L'), created: new Date(), source: 'inbound', status: 'requested', attention: '',
    first_name: firstName_(f.name), name: f.name || '', business: f.business || '', website: f.website || '',
    email: email, phone: f.phone || '', trade: f.trade || '', area: String(f.area || '').trim(), owner_says: ownerSays_(f),
    budget: { 'under 1000': 'under 1000', '1000-2000': '1000-2000', '2000-4000': '2000-4000', '4000+': '4000+' }[String(f.budget || '').toLowerCase()] || '',
    consent_basis: 'Inquiry through the site form (CASL implied consent, 6 months)',
    consent_proof: 'Form submitted ' + (f.submitted_at || new Date().toISOString()) + (f.page ? ' on ' + f.page : ''),
    touches: 0, last_reply_at: 0
  };
  appendRow_(TAB.leads, HEAD.leads, lead);
  logEvent_(lead.id, email, 'inbound_request', lead.business);
  if (isDnc_(email)) removeFromDnc_(email); // they asked us to get in touch
  lead = findLead_('id', lead.id);
  safeSend_(lead, 'inbound_confirm');
  queueJob_('audit', lead.id, '');
  return { ok: true, id: lead.id };
}

// The optional form questions, as one line for the Leads tab and the audit request.
function ownerSays_(f) {
  var parts = [];
  var ads = String(f.running_ads || '').toLowerCase();
  if (ads === 'yes' || ads === 'no' || ads === 'not sure') parts.push('running Google Ads: ' + ads);
  if (f.budget && String(f.budget).toLowerCase() !== 'not sure') parts.push('monthly ad budget: ' + f.budget);
  if (f.area) parts.push('serves: ' + f.area);
  if (f.missed_calls) parts.push('missed calls: ' + f.missed_calls);
  var tools = [f.tools, f.tools_other].filter(function (v) { return v; }).join(', ');
  if (tools) parts.push('schedules jobs with: ' + tools);
  return parts.join('; ');
}

var ASK_LABEL = { account_audit: 'the account audit', starting_plan: 'a starting plan', details: 'the details' };

function handleQuoteRequest_(id, t, notes, offer, budget, runningAds, addons) {
  if (!id || t !== token_(id)) return { ok: false, error: 'bad_token' };
  var lead = findLead_('id', id);
  if (!lead) return { ok: false, error: 'not_found' };
  notes = String(notes || '').trim().slice(0, 1000);
  budget = String(budget || '').trim().slice(0, 40);
  runningAds = String(runningAds || '').trim().slice(0, 20);
  var wantSite = offer === 'account_audit' && /\bsite_audit\b/.test(String(addons || ''));
  var asked = 'Asked for ' + (wantSite ? 'the account and site audit' : ASK_LABEL[offer] || 'a price') + (budget ? ', budget ' + budget : '') + (runningAds ? ', running Google Ads: ' + runningAds : '') + (notes ? ': ' + notes : '');
  var fields = { notes: appendNote_(lead.notes, asked) };
  if (budget) fields.budget = budget;
  if (/^yes/i.test(runningAds) && lead.segment !== 'running_ads') fields.segment = 'running_ads';
  if (/^no/i.test(runningAds) && lead.segment !== 'no_ads') fields.segment = 'no_ads';
  updateLead_(lead, fields);
  if (lead.proposal_slug || ['quote_requested', 'awaiting_proposal_review', 'proposal_sent', 'won'].indexOf(lead.status) > -1) {
    return { ok: true, duplicate: true };
  }
  queueProposal_(lead, 'audit page', offer, false, wantSite ? ['site_audit'] : []);
  safeSend_(findLead_('id', id), 'quote_ack');
  return { ok: true };
}

function handleApprove_(id, t, addons) {
  if (!id || t !== token_(id)) return { ok: false, error: 'bad_token' };
  var lead = findLead_('id', id);
  if (!lead || !lead.proposal_slug) return { ok: false, error: 'not_found' };
  if (lead.status === 'won' || lead.status === 'audit_access') return { ok: true, duplicate: true };
  var prop = findRow_(TAB.proposals, HEAD.proposals, 'slug', lead.proposal_slug);
  var picked = String(addons || '').split(',').map(function (a) { return a.trim(); }).filter(function (a, i, all) { return ADDONS[a] && all.indexOf(a) === i; });
  updateRow_(TAB.proposals, HEAD.proposals, prop, { status: 'approved', approved_at: new Date(), addons: picked.join(',') });
  // An account audit isn't finished when it's paid for: the lead waits for their customer ID, then the export.
  updateLead_(lead, { status: prop.kind === 'account_audit' ? 'audit_access' : 'won', next_touch: '' });
  logEvent_(lead.id, lead.email, 'won', (prop.kind || 'fixed price') + ' $' + prop.price_sprint);
  if (prop.kind === 'management' || prop.kind === 'starting_plan') addClient_(findLead_('id', id), prop);
  safeSend_(findLead_('id', id), 'kickoff');
  ownerMail_('Approved: ' + lead.business + ', ' + (OFFER_COPY[prop.kind] || OFFER_COPY.legacy).label.toLowerCase(),
    lead.business + ' approved the proposal.\n\n' +
    'Offer: ' + priceSummary_(prop) + '\n' +
    'Contact: ' + (lead.name || lead.first_name) + ' <' + lead.email + '>' + (lead.phone ? ', ' + lead.phone : '') + '\n' +
    'Proposal: ' + siteUrl_() + '/proposal/' + lead.proposal_slug + '\n' +
    'Audit: ' + auditUrl_(lead) + '\n\n' +
    'They were told: ' + paymentLine_() + ' Next from you: ' + (setting_('PAYMENT_URL') || fbConnected_() ? '' : 'the invoice, then ') +
    ({ account_audit: 'a link request from the manager account (' + (setting_('ADS_MANAGER_ID') || '') + ') once they reply with their customer ID.',
      starting_plan: 'their new account under the manager account (Accounts > + > Create new account), an admin invite to them, then your setup questions. ' +
        'Put the new account\'s customer ID in the Clients tab so the monthly reports can read it.',
      management: lead.ads_customer_id ? 'nothing for access, the account (' + lead.ads_customer_id + ') is already linked from the audit. Start the cleanup.'
        : 'a link request from the manager account (' + (setting_('ADS_MANAGER_ID') || '') + ') once they reply with their customer ID.' }[prop.kind] || 'the steps to add you as a user on their tools.') +
    '\n\n' + (fbConnected_() ? 'FreshBooks sends the invoice within the hour (you\'ll get a copy of what went out):\n' : '') + invoiceBlock_(lead, prop) +
    (lead.notes ? '\n\nNotes: ' + lead.notes : ''));
  return { ok: true };
}

function handleUnsubscribe_(id, t) {
  if (!id || t !== token_(id)) return { ok: false, error: 'bad_token' };
  var lead = findLead_('id', id);
  if (!lead) return { ok: false, error: 'not_found' };
  stopLead_(lead, 'unsubscribed', 'Unsubscribe link');
  return { ok: true };
}

/* ══════════════════════════ hourly run ══════════════════════════ */

function runHourly() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  _settings = null;
  try {
    ensureSchema_();
    step_('checkReplies', checkReplies_);
    step_('checkBounces', checkBounces_);
    step_('checkCalendar', checkCalendar_);
    step_('pollBatches', pollBatches_);
    step_('gatherEvidence', gatherEvidence_);
    step_('gatherSiteChecks', gatherSiteChecks_);
    step_('submitJobs', submitJobs_);
    step_('deliverAudits', deliverAudits_);
    step_('deliverProposals', deliverProposals_);
    step_('monthlyRun', monthlyRun_);
    step_('sendInvoices', sendInvoices_);
    step_('sendMonthlyInvoices', sendMonthlyInvoices_);
    step_('checkPayments', checkPayments_);
    step_('sendColdEmails', sendColdEmails_);
    step_('sendFollowUps', sendFollowUps_);
    step_('sendNeedsYou', sendNeedsYou_);
  } finally {
    lock.releaseLock();
  }
}

function step_(name, fn) {
  try { fn(); } catch (err) { logEvent_('', '', 'error', name + ': ' + (err && err.stack || err)); }
}

/* ── audits ready to go out ── */

function deliverAudits_() {
  var toReview = [], now = new Date();
  readRows_(TAB.leads, HEAD.leads).forEach(function (l) {
    // A site-form audit you didn't get to goes out on its own once its hold is up, so the promised day holds.
    if (l.status === 'awaiting_review' && l.source !== 'cold' && l.next_touch && new Date(l.next_touch) <= now) {
      updateLead_(l, { status: 'audit_approved', next_touch: '' });
      logEvent_(l.id, l.email, 'audit_auto_released', 'hold ran out');
      releaseAudit_(findLead_('id', l.id));
      return;
    }
    // Approved (or released) outside sending hours: it goes at the next chance, without being held again.
    if (l.status === 'audit_approved') { releaseAudit_(l); return; }
    if (l.status !== 'audit_ready') return;
    if (reviewsLeft_('audit') > 0 || inboundHoldHours_(l) > 0) { toReview.push(l); return; }
    releaseAudit_(l);
  });
  if (toReview.length === 1) requestAuditReview_(toReview[0]);
  else if (toReview.length > 1) requestAuditReviews_(toReview);
}

// Site-form audits wait this many hours for Logan (so he can add a personal line), then go out on their own.
function inboundHoldHours_(l) {
  return l && l.source !== 'cold' ? Math.max(0, Number(setting_('INBOUND_HOLD_HOURS') || 0)) : 0;
}

// Marks an audit as waiting for Logan. A site-form one gets a time it goes out on its own.
function holdAudit_(l) {
  var h = inboundHoldHours_(l);
  var until = h ? new Date(Date.now() + h * 3600e3) : null;
  updateLead_(l, { status: 'awaiting_review', next_touch: until || '' });
  return until;
}

function holdLines_(l, until) {
  if (l.source === 'cold') return '';
  return '   Add a personal line and send: ' + ownerLink_('audit_line', l) + '\n' +
    (until ? '   If you don\'t get to it, it goes out on its own around ' + Utilities.formatDate(until, tz_(), 'h:mm a') + '.\n' : '');
}

// Several audits ready in the same run: one email, one block per shop, and the full email wording for the first.
function requestAuditReviews_(list) {
  var adsLabel = { running_ads: 'running ads', no_ads: 'no ads found', unknown: 'not sure about ads' };
  var blocks = list.map(function (l, i) {
    var until = holdAudit_(l);
    logEvent_(l.id, l.email, 'review_requested', 'audit');
    return (i + 1) + '. ' + l.business + ' (' + (l.source === 'cold' ? 'cold prospect' : 'asked on the site') + ', ' + (l.area || '') + ', ' +
      (adsLabel[l.segment] || adsLabel.unknown) + ')\n' +
      '   Audit: ' + auditUrl_(l) + '\n' +
      '   Biggest finding: ' + l.top_finding + '\n' +
      (l.source === 'cold' ? '   Email found: ' + l.email + ' (' + String(l.consent_proof || '').split(' | ')[0] + ')\n' : '') +
      '   Looks right: ' + ownerLink_('approve_audit', l) + '\n' + holdLines_(l, until) +
      '   Rebuild: ' + ownerLink_('rebuild', l) + '\n' +
      '   Skip: ' + ownerLink_('skip', l);
  });
  var first = list[0];
  ownerMail_('Check these ' + list.length + ' audits',
    (reviewsLeft_('audit') > 0 ? 'These are among the first ' + setting_('REVIEW_AUDITS_FIRST') + ' audits, so each waits for your OK. '
      : 'Site-form audits wait a few hours in case you want to add a personal line. ') +
    (!list.some(function (l) { return l.source === 'cold'; }) ? '' :
      yes_(setting_('COLD_EMAIL_ON')) ? 'Approved cold prospects go into the next cold email slots.' : 'Approving a cold prospect sends nothing while COLD_EMAIL_ON is no.') + '\n\n' +
    blocks.join('\n\n') + '\n\n' +
    'The email ' + first.business + ' would get (the others follow the same wording):\n────────\n' +
    (first.source === 'cold' ? previewEmail_(first, 'cold_1') : previewEmail_(first, 'inbound_audit')) + '\n────────\n\n' +
    'Want a change to how audits are written? Tell Claude in the Ledge project and it\'ll update the instructions.');
}

function releaseAudit_(l) {
  if (l.source === 'cold') {
    updateLead_(l, { status: 'ready_to_send' });
    logEvent_(l.id, l.email, 'ready_to_send', '');
    return true;
  }
  if (!inWindow_(7, 21)) return false;
  sendLeadEmail_(l, 'inbound_audit');
  updateLead_(l, { status: 'audit_sent', touches: 1, next_touch: addBusinessDays_(new Date(), 2) });
  return true;
}

function requestAuditReview_(l) {
  var until = holdAudit_(l);
  var first = l.source === 'cold' ? previewEmail_(l, 'cold_1') : previewEmail_(l, 'inbound_audit');
  ownerMail_('Check this audit: ' + l.business,
    l.business + ' (' + (l.source === 'cold' ? 'cold prospect' : 'asked on the site') + ') is ready. ' +
    (reviewsLeft_('audit') > 0 ? 'It\'s one of the first ' + setting_('REVIEW_AUDITS_FIRST') + ' audits, so it waits for your OK (' + reviewsLeft_('audit') + ' left).\n\n'
      : 'It waits a few hours in case you want to add a personal line.\n\n') +
    'Audit: ' + auditUrl_(l) + '\n' +
    'Google Ads: ' + ({ running_ads: 'running ads, so the page offers the $' + money_(setting_('PRICE_ACCOUNT_AUDIT') || 500) + ' account audit',
      no_ads: 'no ads found, so the page offers a starting plan' }[l.segment] || 'couldn\'t tell, so the page asks where they are with ads') + '\n' +
    'Biggest finding: ' + l.top_finding + '\n' +
    (l.source === 'cold' ? 'Email found: ' + l.email + '\nWhere: ' + l.consent_proof + '\n' : '') +
    '\nThe email they\'ll get:\n────────\n' + first + '\n────────\n\n' +
    'Looks right, send it: ' + ownerLink_('approve_audit', l) + '\n' + holdLines_(l, until).replace(/^   /gm, '') +
    'Rebuild the audit: ' + ownerLink_('rebuild', l) + '\n' +
    'Skip this shop: ' + ownerLink_('skip', l) + '\n\n' +
    'Want a change to how audits are written? Tell Claude in the Ledge project and it\'ll update the instructions.');
  logEvent_(l.id, l.email, 'review_requested', 'audit');
}

function ownerApproveAudit_(l) {
  if (l.status !== 'awaiting_review') return { title: 'Already handled', message: 'Status is ' + l.status + '.' };
  logEvent_(l.id, l.email, 'audit_approved', '');
  updateLead_(l, { status: 'audit_approved', next_touch: '' });
  l = findLead_('id', l.id);
  var sent = releaseAudit_(l);
  return { title: 'Approved', message: l.source === 'cold' ? l.business + ' is queued for the next cold email slot.' :
    sent ? 'The audit went to ' + l.business + '.' : 'It goes out at 7 am, ' + l.business + ' included.' };
}

// The audit page reports it was on screen for a few seconds (worker /api/viewed). Before the audit goes out, the only
// person looking is Logan checking it, so those views don't count.
function handleViewed_(id, t) {
  if (!id || t !== token_(id)) return { ok: false, error: 'bad_token' };
  var l = findLead_('id', id);
  if (!l) return { ok: false, error: 'not_found' };
  if (!Number(l.touches || 0)) return { ok: true, counted: false };
  var fields = { audit_opens: Number(l.audit_opens || 0) + 1 };
  if (!l.audit_opened) { fields.audit_opened = new Date(); logEvent_(l.id, l.email, 'audit_opened', ''); }
  updateLead_(l, fields);
  return { ok: true, counted: true };
}

// "Try me later": one short note on the day Logan picks from the needs-you email, nothing before it.
function checkBackDate_(when, from) {
  var d = new Date(from.getTime());
  if (when === '1m') d.setMonth(d.getMonth() + 1);
  else if (when === '3m') d.setMonth(d.getMonth() + 3);
  else if (when === 'march') d = new Date(d.getFullYear() + (d.getMonth() >= 2 ? 1 : 0), 2, 2);
  else return null;
  while (Number(Utilities.formatDate(d, tz_(), 'u')) > 5) d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d;
}

function ownerCheckBack_(l, when) {
  var d = checkBackDate_(String(when || ''), new Date());
  if (!d) return { title: 'Link not recognised', message: 'That check-back link is incomplete.' };
  updateLead_(l, { status: 'check_back', check_back: d, next_touch: d, touches: 1, attention: '' });
  logEvent_(l.id, l.email, 'check_back_set', Utilities.formatDate(d, tz_(), 'yyyy-MM-dd'));
  return { title: 'Check-back set', message: (l.business || l.email) + ' gets one short note on ' + Utilities.formatDate(d, tz_(), 'EEEE, MMMM d') +
    ', and nothing before it. If they write first, it comes to you as usual.' };
}

// The "add a personal line" page for a site-form audit waiting on Logan. The button calls sendAuditWithLine.
function auditLinePage_(l) {
  if (l.status !== 'awaiting_review') return page_('Already handled', 'Status is ' + l.status + '.');
  var t = token_(l.id);
  var html = '<div style="font-family:Arial,sans-serif;max-width:560px;margin:40px auto;padding:0 16px;color:#1B2A38">' +
    '<h2 style="margin:0 0 6px">A line for ' + esc_(l.business || l.email) + '</h2>' +
    '<p style="color:#566A7E;margin:0 0 14px">It goes right under "Hi ' + esc_(l.first_name || 'there') + '," in the email with their audit. Leave it empty to send as is.</p>' +
    '<textarea id="line" rows="4" maxlength="600" style="width:100%;box-sizing:border-box;font:16px/1.5 Arial,sans-serif;padding:10px;border:1px solid #9AAFC2;border-radius:6px">' +
    esc_(l.personal_line || '') + '</textarea>' +
    '<p><button id="go" style="font:600 16px Arial,sans-serif;padding:10px 18px;border:0;border-radius:6px;background:#1B2A38;color:#fff">Send the audit</button></p>' +
    '<p id="out" style="color:#566A7E"></p></div>' +
    '<script>document.getElementById("go").onclick=function(){var b=this;b.disabled=true;b.textContent="Sending...";' +
    'google.script.run.withSuccessHandler(function(m){document.getElementById("out").textContent=m;b.textContent="Sent";})' +
    '.withFailureHandler(function(){b.disabled=false;b.textContent="Send the audit";document.getElementById("out").textContent="That didn\'t go through. Try again.";})' +
    '.sendAuditWithLine(' + JSON.stringify(l.id) + ',' + JSON.stringify(t) + ',document.getElementById("line").value);};</script>';
  return HtmlService.createHtmlOutput(html).setTitle('Add a line').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// Called from the page above (google.script.run). Public name on purpose: names ending in _ can't be called from a page.
function sendAuditWithLine(id, t, line) {
  if (!id || t !== token_(id)) return 'That link is out of date.';
  var l = findLead_('id', id);
  if (!l) return 'That lead is no longer in the pipeline.';
  if (l.status !== 'awaiting_review') return 'Already handled: status is ' + l.status + '.';
  updateLead_(l, { personal_line: String(line || '').replace(/\s+/g, ' ').trim().slice(0, 600) });
  return ownerApproveAudit_(findLead_('id', id)).message;
}

function ownerSkip_(l) {
  updateLead_(l, { status: 'skipped', next_touch: '' });
  logEvent_(l.id, l.email, 'skipped', 'by Logan');
  return { title: 'Skipped', message: (l.business || l.email) + ' won\'t get anything.' };
}

// Ledge menu > Rebuild audits that haven't gone out: every audit waiting for review or for cold email to start gets
// fresh searches and a new write-up (current wording, the dollar estimate, and the profile details).
function rebuildWaitingAudits() {
  ensureSchema_();
  var ui = SpreadsheetApp.getUi();
  var list = readRows_(TAB.leads, HEAD.leads).filter(function (l) {
    return ['awaiting_review', 'audit_ready', 'audit_approved', 'ready_to_send'].indexOf(l.status) > -1 && !Number(l.touches || 0) && l.audit_slug;
  });
  if (!list.length) { ui.alert('No audits are waiting. Nothing to rebuild.'); return; }
  var ok = ui.alert('Rebuild ' + list.length + ' audit' + (list.length > 1 ? 's' : '') + '?', 'None of these have gone out. Each gets fresh searches and a new write-up ' +
    '(roughly US$' + (list.length * 0.8).toFixed(0) + ' in Claude and search data all told). They come back for review over the next few hours.', ui.ButtonSet.OK_CANCEL);
  if (ok !== ui.Button.OK) return;
  list.forEach(function (l) {
    updateLead_(l, { status: l.source === 'cold' ? 'researching' : 'requested', audit_slug: '' });
    queueJob_('audit', l.id, '');
    logEvent_(l.id, l.email, 'rebuild', 'rebuild all waiting');
  });
  ui.alert('Queued ' + list.length + '. The hourly run gathers searches for 6 shops an hour, then Claude writes the audits.');
}

function ownerRebuild_(l) {
  updateLead_(l, { status: l.source === 'cold' ? 'researching' : 'requested', audit_slug: '' });
  queueJob_('audit', l.id, '');
  logEvent_(l.id, l.email, 'rebuild', '');
  return { title: 'Rebuilding', message: 'A fresh audit for ' + l.business + ' will come back for review in an hour or two.' };
}

/* ── proposals ── */

// Which offer a request leads to: what they asked for on the audit page, otherwise what fits their segment.
function proposalKind_(lead, offer) {
  if (offer === 'account_audit' || offer === 'starting_plan' || offer === 'management') return offer;
  return lead.segment === 'running_ads' ? 'account_audit' : 'starting_plan';
}

function queueProposal_(lead, via, offer, force, wanted) {
  if (lead.proposal_slug && !force) return;
  var kind = proposalKind_(lead, offer);
  var slug = slugify_(lead.business || 'proposal') + '-' + rand_(6);
  var row = { slug: slug, lead_id: lead.id, created: new Date(), gst: yes_(setting_('GST_REGISTERED')) ? 'yes' : 'no', status: 'draft', kind: kind, credit: 0 };
  if (kind === 'account_audit') {
    row.price_sprint = Number(setting_('PRICE_ACCOUNT_AUDIT') || 500);
    row.price_care = 0;
    // What they picked on the audit page, ticked for them on the proposal (they can still untick it).
    row.addons = (wanted || []).filter(function (a) { return ADDONS[a] && ADDONS[a].only === 'account_audit'; }).join(',');
  } else {
    var spend = plannedBudget_(lead.budget), fee = feeFor_(spend);
    row.ad_spend = spend;
    row.price_care = fee;
    row.price_sprint = Math.round(fee * Number(setting_('SETUP_MONTHS') || 1));
    if (kind === 'management') row.credit = Math.min(auditCredit_(lead), row.price_sprint);
  }
  appendRow_(TAB.proposals, HEAD.proposals, row);
  updateLead_(lead, { proposal_slug: slug, status: 'quote_requested', next_touch: '', attention: '' });
  logEvent_(lead.id, lead.email, 'quote_requested', via + ', ' + kind);
}

/* ── pricing ── */

// MGMT_TIERS "1000:500, 2000:800, 4000:1200, 8000:15%" -> [{from: 1000, fee: 500}, ..., {from: 8000, pct: 15}]
function tiers_() {
  var out = String(setting_('MGMT_TIERS') || '1000:500, 2000:800, 4000:1200, 8000:15%').split(',').map(function (t) {
    var m = t.trim().match(/^\$?([\d,]+)\s*:\s*\$?([\d,.]+)\s*(%?)$/);
    if (!m) return null;
    var from = Number(m[1].replace(/,/g, '')), v = Number(m[2].replace(/,/g, ''));
    return m[3] ? { from: from, pct: v } : { from: from, fee: v };
  }).filter(Boolean).sort(function (a, b) { return a.from - b.from; });
  return out.length ? out : [{ from: 1000, fee: 500 }];
}
function feeFor_(spend) {
  var pick = null;
  tiers_().forEach(function (t) { if (!pick || spend >= t.from) pick = t; });
  return pick.pct ? Math.max(Math.round(spend * pick.pct / 100), Number(setting_('MGMT_MIN_FEE') || 0)) : pick.fee;
}
// The budget picked on the audit page, as the monthly ad budget a plan is built on.
function plannedBudget_(budget) {
  var min = Number(setting_('MIN_AD_BUDGET') || 0);
  var b = String(budget || '').toLowerCase().replace(/[$,\s]/g, '');
  var plan = { 'under1000': min, '1000-2000': 1500, '2000-4000': 3000, '4000+': 5000 }[b];
  if (!plan && /^\d+$/.test(b)) plan = Number(b);
  return Math.max(plan || 1500, min);
}
// An approved account audit inside the credit window comes off setup.
function auditCredit_(lead) {
  var days = Number(setting_('ACCOUNT_AUDIT_CREDIT_DAYS') || 0);
  if (!days) return 0;
  // The window runs from the approval or from the report, whichever is later, so a slow link doesn't eat into it.
  var report = lead.report_slug ? findRow_(TAB.reports, HEAD.reports, 'slug', lead.report_slug) : null;
  var reportAt = report ? new Date(report.created).getTime() : 0;
  var hit = readRows_(TAB.proposals, HEAD.proposals).filter(function (p) {
    return p.lead_id === lead.id && p.kind === 'account_audit' && p.status === 'approved' && p.approved_at &&
      Date.now() - Math.max(new Date(p.approved_at).getTime(), reportAt) <= days * 864e5;
  })[0];
  return hit ? Number(hit.price_sprint || 0) : 0;
}

// Ledge menu > Make a management proposal: after an account audit, or for anyone already running ads.
function makeManagementProposal() {
  ensureSchema_();
  var ui = SpreadsheetApp.getUi();
  var ask = function (q) { var r = ui.prompt('Management proposal', q, ui.ButtonSet.OK_CANCEL); return r.getSelectedButton() === ui.Button.OK ? r.getResponseText().trim() : null; };
  var email = ask('Their email address (as it appears on the Leads tab)');
  if (!email) return;
  var lead = findLead_('email', email.toLowerCase());
  if (!lead) { ui.alert('No lead with that email.'); return; }
  var budget = ask('Their monthly ad budget in dollars, for example 2500');
  if (budget === null) return;
  updateLead_(lead, { budget: budget.replace(/[^\d]/g, '') || lead.budget });
  queueProposal_(findLead_('id', lead.id), 'menu', 'management', true);
  ui.alert('Done. It goes through the usual review and send on the next hourly run (or Ledge > Run now).');
}

function deliverProposals_() {
  readRows_(TAB.leads, HEAD.leads).forEach(function (l) {
    if (l.status !== 'quote_requested' || !l.proposal_slug) return;
    if (reviewsLeft_('proposal') > 0) { requestProposalReview_(l); return; }
    if (inWindow_(7, 21)) sendProposal_(l);
  });
}

function sendProposal_(l) {
  sendLeadEmail_(l, 'proposal');
  var prop = findRow_(TAB.proposals, HEAD.proposals, 'slug', l.proposal_slug);
  updateRow_(TAB.proposals, HEAD.proposals, prop, { status: 'sent', sent_at: new Date() });
  updateLead_(l, { status: 'proposal_sent', touches: 1, next_touch: addBusinessDays_(new Date(), 3) });
}

function requestProposalReview_(l) {
  updateLead_(l, { status: 'awaiting_proposal_review' });
  var prop = findRow_(TAB.proposals, HEAD.proposals, 'slug', l.proposal_slug);
  ownerMail_('Check this proposal: ' + l.business,
    l.business + ' asked for a price. It\'s one of the first ' + setting_('REVIEW_PROPOSALS_FIRST') + ' proposals, so it waits for your OK.\n\n' +
    'Proposal: ' + siteUrl_() + '/proposal/' + l.proposal_slug + '\n' +
    'Offer: ' + priceSummary_(prop) + '\n' +
    'Audit: ' + auditUrl_(l) + '\n' +
    (l.notes ? 'Notes from them: ' + l.notes + '\n' : '') +
    '\nTo change the price for this one, edit price_sprint (one time), price_care (monthly), or ad_spend on the Proposals tab before approving.\n\n' +
    'Looks right, send it: ' + ownerLink_('approve_proposal', l) + '\n' +
    'Don\'t send: ' + ownerLink_('skip', l));
  logEvent_(l.id, l.email, 'review_requested', 'proposal');
}

function priceSummary_(prop) {
  var g = yes_(prop.gst) ? ' + GST' : '';
  var extras = String(prop.addons || '').split(',').filter(function (a) { return ADDONS[a]; });
  if (extras.length) {
    var base = priceSummary_(Object.assign({}, prop, { addons: '' }));
    return base + '. Add-ons: ' + extras.map(function (a) { return ADDONS[a].item.toLowerCase() + ' $' + money_(addonPrice_(a)) + g; }).join(', ');
  }
  var c = (OFFER_COPY[prop.kind] || OFFER_COPY.legacy);
  if (prop.kind === 'account_audit') return c.item + ', $' + money_(prop.price_sprint) + g;
  if (prop.kind === 'starting_plan' || prop.kind === 'management') {
    return c.label + ': setup $' + money_(prop.price_sprint) + g + (Number(prop.credit) ? ' less $' + money_(prop.credit) + ' audit credit' : '') +
      ', then $' + money_(prop.price_care) + '/month' + g + ' on a $' + money_(prop.ad_spend) + '/month ad budget';
  }
  return 'Fixed price $' + money_(prop.price_sprint) + g + (Number(prop.price_care) ? ', care plan $' + money_(prop.price_care) + '/month' : '');
}

function ownerApproveProposal_(l) {
  if (l.status !== 'awaiting_proposal_review') return { title: 'Already handled', message: 'Status is ' + l.status + '.' };
  logEvent_(l.id, l.email, 'proposal_approved', '');
  sendProposal_(l);
  return { title: 'Sent', message: 'The proposal went to ' + l.business + '.' };
}

/* ── cold email ── */

function coldCapToday_() {
  var p = props_();
  if (!p.getProperty('COLD_START_DATE')) p.setProperty('COLD_START_DATE', new Date().toISOString());
  var weeks = Math.floor((Date.now() - new Date(p.getProperty('COLD_START_DATE')).getTime()) / (7 * 864e5));
  var start = Number(setting_('COLD_PER_DAY_START') || 5), max = Number(setting_('COLD_PER_DAY_MAX') || 20);
  return Math.min(max, start + 5 * weeks);
}

function sendColdEmails_() {
  if (!yes_(setting_('COLD_EMAIL_ON')) || !inWindow_(8, 17)) return;
  if (!setting_('MAILING_ADDRESS') || !setting_('SENDER_NAME')) return; // CASL: no cold email without name and mailing address
  var cap = coldCapToday_();
  var sentToday = countEvents_('sent_cold_1', startOfDay_());
  var perRun = Math.max(1, Math.ceil(cap / 9));
  var room = Math.min(cap - sentToday, perRun);
  if (room <= 0) return;
  readRows_(TAB.leads, HEAD.leads).filter(function (l) { return l.status === 'ready_to_send'; }).slice(0, room).forEach(function (l) {
    if (isDnc_(l.email)) { stopLead_(l, 'skipped', 'On do-not-contact list'); return; }
    sendLeadEmail_(l, 'cold_1');
    updateLead_(l, { status: 'in_sequence', touches: 1, next_touch: addBusinessDays_(new Date(), 3) });
  });
}

/* ── follow-ups for every sequence ── */

var SEQUENCES = {
  in_sequence: [null, { key: 'cold_2', gap: 4 }, { key: 'cold_3', gap: 5 }, { key: 'cold_4', gap: 0 }],
  check_back: [null, { key: 'check_back', gap: 0 }],
  audit_sent: [null, { key: 'inbound_nudge1', gap: 3 }, { key: 'inbound_nudge2', gap: 0 }],
  proposal_sent: [null, { key: 'proposal_nudge', gap: 0 }]
};

function sendFollowUps_() {
  if (!inWindow_(8, 18)) return;
  var now = new Date();
  readRows_(TAB.leads, HEAD.leads).forEach(function (l) {
    var seq = SEQUENCES[l.status];
    if (!seq || !l.next_touch || new Date(l.next_touch) > now || l.attention) return;
    var t = Number(l.touches || 1);
    var stepDef = seq[t];
    if (!stepDef) { updateLead_(l, { next_touch: '' }); return; }
    sendLeadEmail_(l, stepDef.key);
    var last = t + 1 >= seq.length;
    var fields = { touches: t + 1, next_touch: last ? '' : addBusinessDays_(now, stepDef.gap) };
    if (last && l.status !== 'proposal_sent') fields.status = 'sequence_done';
    updateLead_(l, fields);
  });
}

/* ── replies ── */

function checkReplies_() {
  var me = myEmail_();
  // Clients are done as leads, but a management client's reply with their customer ID still needs reading.
  var waiting = {};
  readRows_(TAB.clients, HEAD.clients).forEach(function (c) { if (c.plan === 'management' && !c.customer_id) waiting[c.lead_id] = true; });
  readRows_(TAB.leads, HEAD.leads).forEach(function (l) {
    if (!l.thread_id || (DONE_STATUSES.indexOf(l.status) > -1 && !(l.status === 'won' && waiting[l.id]))) return;
    if (l.last_touch && Date.now() - new Date(l.last_touch).getTime() > 60 * 864e5) return;
    var thread;
    try { thread = GmailApp.getThreadById(l.thread_id); } catch (err) { return; }
    if (!thread) return;
    var since = Number(l.last_reply_at || 0);
    var fresh = thread.getMessages().filter(function (m) {
      return m.getDate().getTime() > since && String(m.getFrom()).toLowerCase().indexOf(me) === -1;
    });
    if (!fresh.length) return;
    var latest = fresh[fresh.length - 1];
    updateLead_(l, { last_reply_at: latest.getDate().getTime() });
    handleReply_(findLead_('id', l.id), latest);
  });
}

function handleReply_(l, msg) {
  if (/mailer-daemon|postmaster/i.test(String(msg.getFrom()))) { stopLead_(l, 'bounced', 'Delivery failed'); return; }
  var subject = String(msg.getSubject() || '');
  var auto = String(msg.getHeader('Auto-Submitted') || '').toLowerCase();
  if ((auto && auto !== 'no') || AUTO_SUBJECT.test(subject)) { logEvent_(l.id, l.email, 'auto_reply', subject); return; }

  var text = topOfReply_(msg.getPlainBody() || '');
  var kind = OPT_OUT.test(text) ? 'unsubscribe' : NEGATIVE.test(text) ? 'negative' : POSITIVE.test(text) ? 'positive' : 'unclear';
  logEvent_(l.id, l.email, 'reply_' + kind, text.slice(0, 200));

  if (kind === 'unsubscribe') { stopLead_(l, 'unsubscribed', text.slice(0, 200)); return; }
  var client = l.status === 'won' ? clientOf_(l.id) : null;
  if (client && !client.customer_id && client.plan === 'management') {
    var rawC = String(msg.getPlainBody() || '').split(/\r?\n\s*(On .{4,200}wrote:|-{2,}\s*Original Message|From: .+@)/)[0];
    var cidC = customerIdFrom_(rawC, l);
    if (cidC) { linkClient_(l, client, cidC); return; }
  }
  if (l.status === 'audit_access') {
    var raw = String(msg.getPlainBody() || '').split(/\r?\n\s*(On .{4,200}wrote:|-{2,}\s*Original Message|From: .+@)/)[0];
    var cid = customerIdFrom_(raw, l);
    if (cid) { startAccountAudit_(l, cid, 'reply'); return; }
    updateLead_(l, { attention: 'reply', notes: appendNote_(l.notes, 'Reply (waiting for their customer ID): ' + text.slice(0, 300)) });
    return;
  }
  if (kind === 'negative') { stopLead_(l, 'not_interested', text.slice(0, 200)); return; }

  var preAudit = ['requested', 'researching', 'audit_ready', 'audit_approved', 'awaiting_review', 'ready_to_send'].indexOf(l.status) > -1;
  var proposalStage = ['quote_requested', 'awaiting_proposal_review', 'proposal_sent'].indexOf(l.status) > -1;
  if (kind === 'positive' && !preAudit && !proposalStage) {
    queueProposal_(l, 'reply');
    sendLeadEmail_(findLead_('id', l.id), 'positive_ack');
    return;
  }
  var fields = { attention: 'reply', notes: appendNote_(l.notes, 'Reply: ' + text.slice(0, 300)) };
  if (!preAudit && !proposalStage) fields.status = 'replied';
  if (l.status === 'proposal_sent') fields.next_touch = '';
  updateLead_(l, fields);
}

function topOfReply_(body) {
  var cut = body.split(/\r?\n\s*(On .{4,200}wrote:|-{2,}\s*Original Message|From: .+@|>)/)[0];
  return cut.replace(/\s+/g, ' ').trim().slice(0, 1500);
}

function checkBounces_() {
  var seen = JSON.parse(prop_('BOUNCES_SEEN') || '[]');
  var threads = GmailApp.search('from:(mailer-daemon OR postmaster) newer_than:3d', 0, 20);
  var active = readRows_(TAB.leads, HEAD.leads).filter(function (l) { return l.email && DONE_STATUSES.indexOf(l.status) === -1; });
  threads.forEach(function (th) {
    th.getMessages().forEach(function (m) {
      var id = m.getId();
      if (seen.indexOf(id) > -1) return;
      seen.push(id);
      var body = String(m.getPlainBody() || '').toLowerCase();
      active.forEach(function (l) {
        if (body.indexOf(String(l.email).toLowerCase()) > -1) stopLead_(l, 'bounced', 'Delivery failed');
      });
    });
  });
  props_().setProperty('BOUNCES_SEEN', JSON.stringify(seen.slice(-300)));
}

/* ── bookings ── */

function checkCalendar_() {
  var id = setting_('CALENDAR_ID') || 'primary';
  var cal = id === 'primary' ? CalendarApp.getDefaultCalendar() : CalendarApp.getCalendarById(id);
  if (!cal) return;
  var me = myEmail_(), owner = String(setting_('OWNER_EMAIL') || '').toLowerCase();
  var match = String(setting_('BOOKING_EVENT_MATCH') || '').toLowerCase();
  var seen = JSON.parse(prop_('EVENTS_SEEN') || '[]');
  cal.getEvents(new Date(Date.now() - 864e5), new Date(Date.now() + 60 * 864e5)).forEach(function (ev) {
    var key = ev.getId() + '|' + ev.getStartTime().getTime();
    if (seen.indexOf(key) > -1) return;
    var guests = ev.getGuestList().map(function (g) { return String(g.getEmail()).toLowerCase(); })
      .filter(function (g) { return g && g !== me && g !== owner; });
    if (!guests.length) return;
    seen.push(key);
    guests.forEach(function (g) {
      var lead = findLead_('email', g);
      if (!lead) {
        if (!match || String(ev.getTitle()).toLowerCase().indexOf(match) === -1) return;
        appendRow_(TAB.leads, HEAD.leads, {
          id: newId_('B'), created: new Date(), source: 'booking', status: 'booked', email: g, touches: 0,
          consent_basis: 'Booked a call (CASL implied consent, 6 months)', consent_proof: 'Calendar booking ' + ev.getId()
        });
        lead = findLead_('email', g);
      }
      updateLead_(lead, { status: 'booked', booked_at: ev.getStartTime(), next_touch: '', attention: '' });
      logEvent_(lead.id, g, 'booked', fmt_(ev.getStartTime()));
      ownerMail_('Booked: ' + (lead.business || g) + ', ' + fmt_(ev.getStartTime()),
        'Call: ' + fmt_(ev.getStartTime()) + '\n' +
        'Who: ' + (lead.name || lead.first_name || '') + ' <' + g + '>\n' +
        'Shop: ' + (lead.business || 'not given') + (lead.website ? ', ' + lead.website : '') + '\n' +
        'Came from: ' + lead.source + '\n' +
        'Audit: ' + (lead.audit_slug ? auditUrl_(lead) : 'none yet') + '\n' +
        (lead.proposal_slug ? 'Proposal: ' + siteUrl_() + '/proposal/' + lead.proposal_slug + '\n' : '') +
        (lead.top_finding ? 'Biggest finding: ' + lead.top_finding + '\n' : '') +
        (lead.fix_1 ? 'Quick win: ' + lead.fix_1 + '\n' : '') +
        (lead.notes ? '\nNotes: ' + lead.notes : ''));
    });
  });
  props_().setProperty('EVENTS_SEEN', JSON.stringify(seen.slice(-300)));
}

/* ══════════════════════════ evidence: what a customer sees on Google ══════════════════════════ */
/*
 * Before an audit is written, the hub runs the searches a customer would run on a phone in the shop's town,
 * through DataForSEO (pay as you go, about 1 to 2 cents a shop):
 *   - two Google searches, mobile: Local Services Ads (Google Verified), sponsored results, the map pack, websites
 *   - the same two searches in Google Maps, to find the shop's map position past the top 3
 *   - Google's monthly search estimate for both
 *   - the shop's ads in Google's Ads Transparency Center over the last 30 days (this sets the segment)
 * plus a scan of the shop's home page for the Google Ads tag, analytics, call tracking, tap-to-call, forms, and booking.
 * It all goes on the Evidence tab and into the audit request, and the audit page shows the searches as they were.
 */

// Towns we can search from: [latitude, longitude, the name people type]. Calgary areas search "calgary" from that quadrant.
var TOWNS = {
  'calgary ne': [51.0950, -113.9800, 'Calgary'], 'calgary nw': [51.1200, -114.1500, 'Calgary'],
  'calgary se': [50.9300, -113.9700, 'Calgary'], 'calgary sw': [50.9800, -114.1300, 'Calgary'],
  'calgary': [51.0447, -114.0719, 'Calgary'], 'airdrie': [51.2917, -114.0144, 'Airdrie'],
  'chestermere': [51.0506, -113.8225, 'Chestermere'], 'cochrane': [51.1894, -114.4681, 'Cochrane'],
  'okotoks': [50.7256, -113.9749, 'Okotoks'], 'strathmore': [51.0378, -113.4003, 'Strathmore'],
  'high river': [50.5806, -113.8712, 'High River'], 'canmore': [51.0884, -115.3479, 'Canmore'],
  'olds': [51.7928, -114.1067, 'Olds'], 'red deer': [52.2681, -113.8112, 'Red Deer'],
  'sylvan lake': [52.3083, -114.0964, 'Sylvan Lake'], 'lacombe': [52.4683, -113.7372, 'Lacombe'],
  'edmonton': [53.5461, -113.4938, 'Edmonton'], 'st. albert': [53.6305, -113.6256, 'St. Albert'],
  'sherwood park': [53.5413, -113.2958, 'Sherwood Park'], 'spruce grove': [53.5450, -113.9008, 'Spruce Grove'],
  'leduc': [53.2594, -113.5492, 'Leduc'], 'fort saskatchewan': [53.7128, -113.2133, 'Fort Saskatchewan'],
  'camrose': [53.0167, -112.8333, 'Camrose'], 'lethbridge': [49.6956, -112.8451, 'Lethbridge'],
  'medicine hat': [50.0405, -110.6766, 'Medicine Hat'], 'brooks': [50.5642, -111.8989, 'Brooks'],
  'grande prairie': [55.1707, -118.7947, 'Grande Prairie'], 'fort mcmurray': [56.7268, -111.3790, 'Fort McMurray'],
  'lloydminster': [53.2783, -110.0050, 'Lloydminster']
};

// What a customer types, by kind of business: [pattern, winter searches, summer searches (optional)].
// The first search adds the town ("furnace repair airdrie"), the second is a "near me" search from the same spot.
var SEARCH_TERMS = [
  [/furnace|heat|hvac|cool|air con|a\/c|mechanical/, ['furnace repair', 'furnace replacement'], ['air conditioning installation', 'furnace repair']],
  [/plumb|drain|sewer|water heater/, ['plumber', 'drain cleaning']],
  [/electric/, ['electrician', 'electrical contractor']],
  [/roof/, ['roofing company', 'roof repair']],
  [/eavestrough|gutter/, ['eavestrough repair', 'eavestrough installation']],
  [/garage door/, ['garage door repair', 'garage door installation']],
  [/appliance/, ['appliance repair', 'fridge repair']],
  [/snow|landscap|lawn/, ['snow removal', 'landscaping'], ['landscaping', 'lawn care']],
  [/pest|extermin/, ['pest control', 'exterminator']],
  [/paint/, ['house painters', 'interior painting']],
  [/window|door/, ['window replacement', 'door installation']],
  [/floor/, ['flooring installation', 'flooring store']],
  [/basement|renovat|remodel/, ['basement development', 'home renovation']],
  [/concrete/, ['concrete contractor', 'concrete driveway']],
  [/fence|deck/, ['fence builder', 'deck builder']],
  [/movers|moving/, ['movers', 'moving company']],
  [/locksmith/, ['locksmith', 'emergency locksmith']],
  [/carpet|clean/, ['carpet cleaning', 'house cleaning']],
  [/auto|mechanic|car repair/, ['auto repair', 'mechanic']],
  [/dent/, ['dentist', 'emergency dentist']],
  [/physio/, ['physiotherapy', 'physiotherapist']],
  [/chiro/, ['chiropractor', 'chiropractic']],
  [/massage/, ['massage therapy', 'registered massage therapist']],
  [/veterin|\bvet\b|animal/, ['veterinarian', 'emergency vet']],
  [/lawyer|legal|law firm/, ['lawyer', 'law firm']]
];
// Chains and directories are never prospects.
var NOT_PROSPECTS = /reliance|enercare|directenergy|mrrooter|mr-rooter|mrelectric|mrappliance|onehour|benjaminfranklin|aireserv|servicemaster|homedepot|lowes|costco|sears|canadiantire|bestbuy|facebook\.com|instagram\.com|yelp\.|homestars|houzz|google\.|yellowpages|kijiji/;

/* ── what the searches are worth ── */
// Typical Calgary-area prices in CAD: the everyday job most of these searches turn into, and the big job that comes up,
// plus the trade's own Google Ads rates where there's a published benchmark: [percent who click an ad, percent of clicks
// that call or send a form, cost per click in CAD] (LocaliQ/WordStream 2025-2026, US home services, converted at 1.40).
// Middle of the market on purpose.
// Sources: engine/value-sources.md. The first row that matches the trade wins.
var JOB_VALUES = [
  [/furnace|heat|hvac|cool|air con|a\/c|mechanical/, 'heating and cooling', ['a furnace repair', 250, 700], ['a furnace replacement', 5000, 8000], [6, 7, 13]],
  [/plumb|water heater/, 'plumbing', ['a plumbing repair', 300, 700], ['a water heater replacement', 2000, 3000], [5, 8, 15]],
  [/drain|sewer/, 'drain work', ['a drain clearing', 250, 500], ['a sewer line repair', 2000, 7500], [5, 8, 15]],
  [/electric/, 'electrical work', ['an electrical repair', 200, 500], ['a panel upgrade', 2500, 5000], [5, 9, 17]],
  [/eavestrough|gutter/, 'eavestrough work', ['an eavestrough repair', 200, 500], ['new eavestroughs', 1500, 3000], [6, 4, 15]],
  [/roof/, 'roofing', ['a roof repair', 500, 1500], ['a roof replacement', 10000, 16000], [6, 4, 15]],
  [/garage door/, 'garage door work', ['a garage door repair', 380, 580], ['a new garage door', 2400, 3300], [7, 6, 8]],
  [/appliance/, 'appliance repair', ['an appliance repair', 200, 450], null, null],
  [/pest|extermin/, 'pest control', ['a pest control treatment', 150, 400], ['an annual pest control plan', 500, 1200], null],
  [/carpet/, 'carpet cleaning', ['a carpet cleaning', 250, 400], null, [9, 18, 12]],
  [/clean|maid/, 'house cleaning', ['a house cleaning', 230, 300], ['a deep or move-out clean', 400, 550], [9, 18, 12]],
  [/paint/, 'painting', ['painting a room', 400, 800], ['a full interior or exterior repaint', 3000, 6000], [6, 11, 19]],
  [/window|door/, 'window and door work', ['a foggy window glass replacement', 700, 1200], ['new windows for a whole house', 10000, 16000], [6, 4, 12]],
  [/concrete/, 'concrete work', ['a concrete repair', 1000, 3000], ['a new driveway', 6000, 10000], [6, 3, 7]],
  [/fence|deck/, 'fence and deck work', ['a fence repair', 430, 1300], ['a new fence', 4000, 8000], [6, 3, 7]],
  [/snow/, 'snow removal', ['a season of snow removal', 500, 1000], null, [5, 6, 12]],
  [/landscap|lawn|yard/, 'yard work', ['a season of lawn care', 700, 1100], ['a yard update', 5000, 12000], [5, 6, 12]]
];
function jobValueFor_(trade, siteHint) {
  var t = String(trade || '').toLowerCase();
  var text = !t || /^(another|other)\b/.test(t) ? String(siteHint || '').toLowerCase() : t;
  for (var i = 0; i < JOB_VALUES.length; i++) if (JOB_VALUES[i][0].test(text)) return JOB_VALUES[i];
  return null;
}
function valueRates_() {
  var r = function (k) { return Number(String(setting_(k) || '').replace(/[^\d.]/g, '')) || 0; };
  return { click: r('VALUE_CLICK_RATE'), lead: r('VALUE_LEAD_RATE'), cpc: r('VALUE_CPC'), book: r('VALUE_BOOK_RATE') };
}
// "6 in 100", "1 in 10", "4 in 10"
function inN_(pct) {
  pct = Math.round(pct);
  if (pct === 25) return '1 in 4';
  if (pct === 50) return '1 in 2';
  if (pct >= 32 && pct <= 35) return 'about 1 in 3';
  return pct % 10 === 0 ? pct / 10 + ' in 10' : pct + ' in 100';
}
// Small counts as words: "two jobs", "three months".
function word_(n) { return ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'][n] || money_(n); }

// Searches a month → booked jobs → dollars, at typical rates. Only arithmetic: no number here is a promise.
// In a big market a starting budget can't show up on every search, so the estimate stops at what that budget buys.
function valueEstimate_(trade, searches, where, siteHint, budget) {
  var jv = jobValueFor_(trade, siteHint), r = valueRates_();
  if (jv && jv[4]) { r.click = jv[4][0]; r.lead = jv[4][1]; r.cpc = jv[4][2]; }
  if (!jv || !searches || !(r.click && r.lead && r.book)) return null;
  budget = budget || plannedBudget_('1000-2000');
  var market = searches * r.click / 100 * r.lead / 100 * r.book / 100;
  var bought = r.cpc ? budget / r.cpc * r.lead / 100 * r.book / 100 : market;
  var exact = Math.min(market, bought);
  var jobs = exact >= 0.75 ? Math.max(1, Math.round(exact)) : 0;
  var planCost = budget + feeFor_(budget);
  var big = jv[3] || null;
  return {
    searches: searches, where: where, work: jv[1], job: jv[2][0], job_low: jv[2][1], job_high: jv[2][2],
    big: big ? big[0] : '', big_low: big ? big[1] : 0, big_high: big ? big[2] : 0,
    click: r.click, lead: r.lead, cpc: r.cpc, book: r.book, jobs: jobs, by_budget: bought < market,
    low: jobs * jv[2][1], high: jobs * jv[2][2], year_low: jobs * jv[2][1] * 12, year_high: jobs * jv[2][2] * 12,
    plan_budget: budget, plan_cost: planCost, big_months: big ? Math.floor((big[1] + big[2]) / 2 / planCost) : 0
  };
}
// The estimate in words, for the audit page, the emails, and the audit request. Empty strings when there's no estimate.
function valueWords_(v) {
  var out = { headline: '', line: '', big_line: '', email: '', footnote: '' };
  if (!v) return out;
  var jobsText = v.jobs === 1 ? 'one job' : word_(v.jobs) + ' jobs';
  out.line = 'Google estimates about ' + money_(v.searches) + ' searches a month in ' + v.where + ' for ' + v.work + '. ' +
    (!v.jobs ? 'That\'s a small number for ads alone.' : v.by_budget ?
      'On a $' + money_(v.plan_budget) + ' a month ad budget, at typical rates for Google Ads, a business could book about ' + jobsText + ' a month from them, at $' +
        money_(v.job_low) + ' to $' + money_(v.job_high) + ' for ' + v.job + '. Showing up on more of them takes a bigger budget.' :
      'At typical rates for Google Ads, a business showing up on them could book about ' + jobsText + ' a month from them, at $' +
        money_(v.job_low) + ' to $' + money_(v.job_high) + ' for ' + v.job + '.');
  if (v.jobs) out.headline = '$' + money_(v.year_low) + ' to $' + money_(v.year_high) + ' a year';
  if (v.big) out.big_line = 'One ' + v.big.replace(/^(a|an) /, '') + ' runs $' + money_(v.big_low) + ' to $' + money_(v.big_high) +
    (v.big_months >= 2 ? ', which covers about ' + word_(v.big_months) + ' months of a $' + money_(v.plan_budget) + ' ad budget and our fee.' :
      v.big_months === 1 ? ', which covers about a month of a $' + money_(v.plan_budget) + ' ad budget and our fee.' : '.');
  if (v.jobs) out.email = 'Going by Google\'s search estimates and typical rates, those searches are worth roughly $' + money_(v.year_low) + ' to $' +
    money_(v.year_high) + ' a year in work to a business that shows up on them' + (v.by_budget ? ' with a $' + money_(v.plan_budget) + ' a month ad budget.' : '.');
  out.footnote = 'An estimate, not a promise: Google\'s monthly search estimates in ' + v.where + ', times typical Google Ads rates for ' + v.work + ' (' +
    inN_(v.click) + ' searches click an ad' + (v.cpc ? ' at about $' + money_(v.cpc) + ' a click' : '') + ', and ' + inN_(v.lead) + ' clicks call or send a form), times ' + inN_(v.book) +
    ' of those booked, at typical Calgary-area prices. ' + (v.by_budget ? 'It stops at what a $' + money_(v.plan_budget) + ' a month budget buys. '
      : 'It assumes your ads show on these searches. ') +
    'Your prices, service area, and how fast you answer the phone will change it.';
  return out;
}

// The whole search market for a kind of business in a town: Google's related searches with their monthly estimates,
// keeping only ones about the work (not jobs, how-tos, stores, or other towns). One call per town and trade, kept 60 days.
var MARKET_SKIP = /\b(jobs?|hiring|salary|salaries|wages?|careers?|courses?|schools?|training|apprentic\w*|certificat\w*|union|how to|how do|diy|do it yourself|youtube|reddit|wiki\w*|meaning|definition|parts?|supply|supplies|store|depot|rona|lowes|canadian tire|costco|walmart|amazon|kijiji|marketplace|used|for sale|rentals?|rent|manual|reviews?|complaints?|login|portal|tool|tools)\b/;
var MARKET_PLACES = ['calgary', 'edmonton', 'red deer', 'lethbridge', 'medicine hat', 'grande prairie', 'fort mcmurray', 'st albert', 'st. albert',
  'sherwood park', 'spruce grove', 'leduc', 'camrose', 'brooks', 'lloydminster', 'vancouver', 'victoria', 'kelowna', 'kamloops', 'regina',
  'saskatoon', 'winnipeg', 'toronto', 'ottawa', 'montreal', 'halifax'];
function marketFor_(trade, siteHint, townName) {
  var row = tradeRow_(trade, siteHint);
  if (row < 0) return null;
  var seeds = SEARCH_TERMS[row][1].concat(SEARCH_TERMS[row][2] || []).filter(function (k, i, all) { return all.indexOf(k) === i; });
  var loc = townName + ',Alberta,Canada', key = 'market: ' + seeds.join(' + ');
  var hit = readRows_(TAB.volumes, HEAD.volumes).filter(function (r) {
    return r.keyword === key && r.location === loc && Date.now() - new Date(r.fetched).getTime() < 60 * 864e5;
  }).pop();
  if (hit) {
    var dt = {};
    try { dt = JSON.parse(hit.detail || '{}'); } catch (err) {}
    return { total: Number(hit.volume || 0), count: dt.count || 0, top: dt.top || [], where: townName, cost: 0 };
  }
  var d = dfsRead_(UrlFetchApp.fetch('https://api.dataforseo.com/v3/keywords_data/google_ads/keywords_for_keywords/live',
    dfsReq_('keywords_data/google_ads/keywords_for_keywords/live', { keywords: seeds, location_name: loc, language_code: 'en', sort_by: 'search_volume' })));
  if (!d.ok) return { error: d.error, cost: d.cost };
  var town = townName.toLowerCase();
  var places = MARKET_PLACES.concat(Object.keys(TOWNS).map(function (k) { return TOWNS[k][2].toLowerCase(); }))
    .filter(function (p, i, all) { return p !== town && all.indexOf(p) === i; });
  var other = new RegExp('\\b(' + places.map(function (p) { return p.replace('.', '\\.'); }).join('|') + ')\\b');
  var seen = {};
  var hits = d.result.filter(function (v) {
    var k = String(v && v.keyword || '').toLowerCase();
    if (!k || seen[k] || !(Number(v.search_volume) > 0)) return false;
    seen[k] = true;
    return SEARCH_TERMS[row][0].test(k) && !MARKET_SKIP.test(k) && !other.test(k);
  }).sort(function (a, b) { return b.search_volume - a.search_volume; }).slice(0, 60);
  var total = hits.reduce(function (n, v) { return n + Number(v.search_volume); }, 0);
  var top = hits.slice(0, 6).map(function (v) { return [String(v.keyword).toLowerCase(), Number(v.search_volume)]; });
  appendRow_(TAB.volumes, HEAD.volumes, { keyword: key, location: loc, volume: total, fetched: new Date(), detail: JSON.stringify({ count: hits.length, top: top }) });
  return { total: total, count: hits.length, top: top, where: townName, cost: d.cost };
}

function dfsConfigured_() { return !!(prop_('DATAFORSEO_LOGIN') && prop_('DATAFORSEO_PASSWORD')); }

function dfsReq_(path, task) {
  return {
    url: 'https://api.dataforseo.com/v3/' + path, method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Basic ' + Utilities.base64Encode(prop_('DATAFORSEO_LOGIN') + ':' + prop_('DATAFORSEO_PASSWORD')) },
    payload: JSON.stringify([task])
  };
}

function dfsRead_(resp) {
  var out = { ok: false, result: [], items: [], cost: 0, error: '' };
  try {
    if (resp.getResponseCode() !== 200) { out.error = 'HTTP ' + resp.getResponseCode(); return out; }
    var j = JSON.parse(resp.getContentText());
    out.cost = Number(j.cost || 0);
    var t = (j.tasks || [])[0] || {};
    // 40102 "No Search Results" is an answer, not a failure: nothing to show (for the ads check, no ads).
    if (j.status_code === 20000 && (t.status_code === 40102 || /no search results/i.test(String(t.status_message || '')))) { out.ok = true; out.empty = true; return out; }
    if (j.status_code !== 20000 || t.status_code !== 20000) { out.error = String(t.status_message || j.status_message || 'error').slice(0, 120); return out; }
    out.ok = true;
    out.result = t.result || [];
    out.items = (out.result[0] && out.result[0].items) || [];
  } catch (err) { out.error = 'unreadable reply'; }
  return out;
}

function townFor_(lead, siteText) {
  var key = String(lead.area || '').toLowerCase().replace(/,.*$/, '').replace(/\b(alberta|ab)\b/g, '').trim();
  if (TOWNS[key]) return town_(key, lead.area);
  // "Calgary and area", "Airdrie and Crossfield": the first town we know in what they typed.
  var typed = String(lead.area || '').toLowerCase(), first = null, at = 1e9;
  Object.keys(TOWNS).forEach(function (k) {
    var m = typed.search(new RegExp('\\b' + k.replace('.', '\\.') + '\\b'));
    if (m > -1 && (m < at || (m === at && k.length > first.length))) { first = k; at = m; }
  });
  if (first) return town_(first, TOWNS[first][2]);
  // Site leads don't pick an area: use the town their home page names most, Calgary on a tie or when none is named.
  var low = String(siteText || '').toLowerCase(), best = 'calgary', bestN = 0;
  Object.keys(TOWNS).forEach(function (k) {
    if (/^calgary /.test(k)) return;
    var n = (low.match(new RegExp('\\b' + k.replace('.', '\\.') + '\\b', 'g')) || []).length;
    if (n > bestN) { best = k; bestN = n; }
  });
  return town_(best, TOWNS[best][2]);
}
function town_(key, label) { var t = TOWNS[key]; return { key: key, lat: t[0], lng: t[1], name: t[2], label: label || t[2] }; }

// The two searches for a kind of business. When the form says "Another trade" or "Another local business", the shop's
// own page title and wording pick the searches instead; if nothing fits, there are no searches (the audit still builds).
// Which SEARCH_TERMS row fits the business: its trade, or for "Another..." its own home page. -1 when nothing fits.
function tradeRow_(trade, siteHint) {
  var t = String(trade || '').toLowerCase();
  var text = !t || /^(another|other)\b/.test(t) ? String(siteHint || '').toLowerCase() : t;
  for (var i = 0; i < SEARCH_TERMS.length; i++) if (SEARCH_TERMS[i][0].test(text)) return i;
  return -1;
}
function keywordsFor_(trade, townName, siteHint) {
  var t = String(trade || '').toLowerCase();
  var generic = !t || /^(another|other)\b/.test(t);
  var month = Number(Utilities.formatDate(new Date(), tz_(), 'M'));
  var winter = month >= 10 || month <= 3;
  var row = tradeRow_(trade, siteHint);
  var terms = row > -1 ? (!winter && SEARCH_TERMS[row][2] ? SEARCH_TERMS[row][2] : SEARCH_TERMS[row][1]) : null;
  if (!terms && generic) return [];
  if (!terms) { var plain = t.split(/,| and | or /)[0].trim(); terms = [plain, plain]; }
  return [terms[0] + ' ' + String(townName).toLowerCase(), terms[1] + ' near me'];
}

// The searches Google's monthly estimates are fetched for: both services, with the town and with "near me".
// One call covers them all, so the audit can give a fuller number than a single "near me" search in a small town.
function relatedKeywords_(kws, townName) {
  if (!kws.length) return [];
  var town = ' ' + String(townName).toLowerCase();
  var a = kws[0].slice(-town.length) === town ? kws[0].slice(0, -town.length) : kws[0];
  var b = kws[1].replace(/ near me$/, '');
  return [a + town, a + ' near me', b + town, b + ' near me'].filter(function (k, i, all) { return all.indexOf(k) === i; });
}

// The step: up to 6 shops an hour, so a run stays well inside Apps Script's time limit.
function gatherEvidence_() {
  var started = Date.now();
  if (monthSpend_() >= Number(setting_('MONTHLY_ENGINE_BUDGET_USD') || 20)) return;
  var jobs = readRows_(TAB.jobs, HEAD.jobs).filter(function (j) { return j.kind === 'audit' && j.status === 'queued'; });
  var done = 0;
  for (var i = 0; i < jobs.length && done < 6 && Date.now() - started < 150000; i++) {
    var j = jobs[i], lead = findLead_('id', j.lead_id);
    if (!lead) { updateRow_(TAB.jobs, HEAD.jobs, j, { status: 'error', detail: 'Lead missing', updated: new Date() }); continue; }
    if (freshEvidence_(lead.id)) continue;
    var ev = buildEvidence_(lead);
    saveEvidence_(lead, ev);
    updateRow_(TAB.jobs, HEAD.jobs, j, { est_cost_usd: Number(j.est_cost_usd || 0) + ev.cost, updated: new Date() });
    done++;
  }
}

function buildEvidence_(lead) {
  // v3: adds the search market, the value estimate, and the Business Profile details. Older evidence is gathered again.
  var ev = { v: 3, checked: Utilities.formatDate(new Date(), tz_(), 'MMM d, yyyy'), site: { url: siteUrlOf_(lead.website) },
    searches: [], ads: null, profile: null, segment: 'unknown', errors: [], cost: 0 };
  var domain = domainOf_(ev.site.url), text = '';
  if (ev.site.url) {
    try {
      var scan = scanSite_(UrlFetchApp.fetch(ev.site.url, { muteHttpExceptions: true, followRedirects: true }));
      text = scan.text; delete scan.text;
      Object.keys(scan).forEach(function (k) { ev.site[k] = scan[k]; });
    } catch (err) { ev.site.ok = false; ev.site.error = String(err && err.message || err).slice(0, 120); }
  }
  var town = townFor_(lead, text);
  ev.town = town.name; ev.where = town.label;
  var name = lead.business || String(ev.site.title || '').split(/\s[|\-\u2013\u2014:]\s/)[0];
  if (!dfsConfigured_()) { ev.errors.push('search data isn\'t set up yet (DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD)'); return ev; }

  var kws = keywordsFor_(lead.trade, town.name, (ev.site.title || '') + ' ' + text.slice(0, 3000)), reqs = [], kinds = [];
  if (!kws.length) ev.errors.push('couldn\'t tell what to search for from "' + (lead.trade || 'no trade') + '" or the home page');
  kws.forEach(function (kw, i) {
    reqs.push(dfsReq_('serp/google/organic/live/advanced', { keyword: kw, location_coordinate: town.lat + ',' + town.lng + ',10000',
      language_code: 'en', device: 'mobile', os: 'android', depth: 20 }));
    kinds.push(['search', i]);
    reqs.push(dfsReq_('serp/google/maps/live/advanced', { keyword: kw, location_coordinate: town.lat + ',' + town.lng + ',13z',
      language_code: 'en', device: 'mobile', os: 'android', depth: 40 }));
    kinds.push(['maps', i]);
  });
  if (domain) {
    reqs.push(dfsReq_('serp/google/ads_search/live/advanced', { target: domain, location_code: 2124, platform: 'google_search',
      date_from: ymd_(-30), date_to: ymd_(0), depth: 40 }));
    kinds.push(['ads']);
  }
  if (!reqs.length) return ev;
  var resps;
  try { resps = UrlFetchApp.fetchAll(reqs); } catch (err) { ev.errors.push('search data request failed: ' + String(err && err.message || err).slice(0, 120)); return ev; }

  var searches = kws.map(function (kw) { return { keyword: kw, where: town.label, ran: false, lsa: [], ads: [], map_pack: [], organic: [], maps_top: [], maps_ads: [], maps_total: 0, you: {} }; });
  resps.forEach(function (resp, n) {
    var k = kinds[n], d = dfsRead_(resp);
    ev.cost += d.cost;
    if (!d.ok) { ev.errors.push(k[0] + (k.length > 1 ? ' ' + (k[1] + 1) : '') + ': ' + d.error); return; }
    if (k[0] === 'search') readSerp_(searches[k[1]], d.items, domain, name);
    else if (k[0] === 'maps') readMaps_(searches[k[1]], d.items, domain, name, ev);
    else if (k[0] === 'ads') ev.ads = readAds_(d.items, domain);
  });
  // Google's monthly search estimates, from the Search volumes tab when we already have them (most shops in a town
  // share searches), otherwise one call for the town, falling back to Alberta when Google has no figure for the town.
  var vol = volumesFor_(relatedKeywords_(kws, town.name), town.name);
  ev.cost += vol.cost;
  if (vol.error) ev.errors.push('search estimates: ' + vol.error);
  searches.forEach(function (s) {
    var v = vol.map[s.keyword];
    if (v) { s.volume = v.volume; s.volume_where = v.where; s.bid_low_usd = v.bid_low_usd; s.bid_high_usd = v.bid_high_usd; }
  });
  // The total across related searches, counting only figures for the same place (the town, or Alberta when that's all there is).
  var est = relatedKeywords_(kws, town.name).map(function (k) { var v = vol.map[k]; return v && v.volume != null ? { keyword: k, volume: v.volume, where: v.where } : null; }).filter(Boolean);
  var where = est.some(function (e) { return e.where === town.name; }) ? town.name : est.length ? est[0].where : '';
  ev.estimates = est.filter(function (e) { return e.where === where; });
  ev.estimate_where = where;
  ev.estimate_total = ev.estimates.reduce(function (n, e) { return n + e.volume; }, 0);
  // The fuller market (all the related searches about the work), and what it's worth at typical rates.
  var hint = (ev.site.title || '') + ' ' + text.slice(0, 3000);
  var mk = null;
  try { mk = kws.length ? marketFor_(lead.trade, hint, town.name) : null; } catch (err) { mk = { error: String(err && err.message || err).slice(0, 120), cost: 0 }; }
  if (mk) {
    ev.cost += mk.cost || 0;
    if (mk.error) ev.errors.push('search market: ' + mk.error);
    else if (mk.total) ev.market = { total: mk.total, count: mk.count, top: mk.top, where: mk.where };
  }
  var local = where === town.name ? ev.estimate_total : 0;
  var base = Math.max(ev.market ? ev.market.total : 0, local);
  ev.value = base ? valueEstimate_(lead.trade, base, town.name, hint) : null;
  ev.searches = searches;
  var seenInAds = searches.some(function (s) { return s.you.ads; });
  if (ev.ads) ev.segment = ev.ads.count > 0 || seenInAds ? 'running_ads' : 'no_ads';
  else if (seenInAds) ev.segment = 'running_ads';
  return ev;
}

function volumesFor_(kws, townName) {
  var out = { map: {}, cost: 0, error: '' };
  if (!kws.length) return out;
  var places = [[townName + ',Alberta,Canada', townName], ['Alberta,Canada', 'Alberta']];
  var rows = readRows_(TAB.volumes, HEAD.volumes).filter(function (r) { return Date.now() - new Date(r.fetched).getTime() < 60 * 864e5; });
  var need = places.map(function () { return []; });
  var asRow = function (r, where) {
    var n = function (v) { return v === '' || v == null ? null : Number(v); };
    return { volume: n(r.volume), where: where, bid_low_usd: n(r.bid_low_usd), bid_high_usd: n(r.bid_high_usd) };
  };
  // From the tab where we can: the town's figure, or Alberta's when Google has none for the town.
  var settle = function (k, from) {
    for (var i = from; i < places.length; i++) {
      var hit = rows.filter(function (r) { return r.keyword === k && r.location === places[i][0]; }).pop();
      if (!hit) { need[i].push(k); return; }
      if (hit.volume !== '' || i === places.length - 1) { out.map[k] = asRow(hit, places[i][1]); return; }
    }
  };
  kws.forEach(function (k) { settle(k, 0); });
  for (var i = 0; i < places.length; i++) {
    if (!need[i].length) continue;
    var d = dfsRead_(UrlFetchApp.fetch('https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live',
      dfsReq_('keywords_data/google_ads/search_volume/live', { keywords: need[i], location_name: places[i][0], language_code: 'en' })));
    out.cost += d.cost;
    if (!d.ok) { out.error = d.error; need[i].forEach(function (k) { settle(k, i + 1); }); continue; }
    out.error = '';
    var got = {};
    d.result.forEach(function (v) { if (v && v.keyword) got[String(v.keyword).toLowerCase()] = v; });
    need[i].forEach(function (k) {
      var v = got[k] || {}, blank = function (x) { return x == null ? '' : x; };
      var row = { keyword: k, location: places[i][0], volume: blank(v.search_volume), bid_low_usd: blank(v.low_top_of_page_bid),
        bid_high_usd: blank(v.high_top_of_page_bid), fetched: new Date() };
      appendRow_(TAB.volumes, HEAD.volumes, row);
      rows.push(row);
      if (row.volume === '' && i < places.length - 1) settle(k, i + 1);
      else out.map[k] = asRow(row, places[i][1]);
    });
  }
  return out;
}

function readSerp_(s, items, domain, name) {
  s.ran = true;
  items.forEach(function (it) {
    if (it.type === 'local_services') (it.items || []).forEach(function (x) { s.lsa.push(entry_(x.title, '', x.rating)); });
    else if (it.type === 'paid') { var d = domainOf_(it.domain || it.url); s.ads.push({ name: d || String(it.title || '').slice(0, 80), domain: d }); }
    else if (it.type === 'local_pack') s.map_pack.push(entry_(it.title, it.domain || it.url, it.rating, it.is_paid));
    else if (it.type === 'organic') { var o = domainOf_(it.domain || it.url); if (o) s.organic.push({ name: o, domain: o }); }
  });
  ['lsa', 'ads', 'map_pack', 'organic'].forEach(function (k) {
    s[k].forEach(function (e, i) { e.rank = i + 1; if (!s.you[k] && isShop_(e, domain, name)) { e.you = true; s.you[k] = i + 1; } });
  });
  var mine = s.you.organic > 5 ? s.organic[s.you.organic - 1] : null;
  s.lsa = s.lsa.slice(0, 5); s.ads = s.ads.slice(0, 6); s.map_pack = s.map_pack.slice(0, 3);
  s.organic = s.organic.slice(0, 5).concat(mine ? [mine] : []);
}

function readMaps_(s, items, domain, name, ev) {
  var list = items.filter(function (it) { return it.type === 'maps_search'; });
  s.maps_total = list.length;
  s.maps_ads = items.filter(function (it) { return it.type === 'maps_paid_item'; }).slice(0, 3).map(function (it) { return entry_(it.title, it.domain || it.url, it.rating); });
  for (var i = 0; i < list.length; i++) {
    var e = entry_(list[i].title, list[i].domain || list[i].url, list[i].rating);
    if (!isShop_(e, domain, name)) continue;
    s.you.maps = i + 1;
    if (!ev.profile) ev.profile = profileOf_(list[i], e);
    break;
  }
  s.maps_top = list.slice(0, 5).map(function (it, i) {
    var e = entry_(it.title, it.domain || it.url, it.rating);
    e.rank = i + 1;
    if (it.total_photos != null) e.photos = Number(it.total_photos);
    if (s.you.maps === i + 1) e.you = true;
    return e;
  });
}

// What the shop's Google Business Profile shows, from the same Maps result: claimed, categories, photos, hours, booking link.
function profileOf_(it, e) {
  var p = { name: e.name, rating: e.rating, reviews: e.reviews, category: String(it.category || '').slice(0, 60),
    extra_categories: (it.additional_categories || []).map(String).slice(0, 8), claimed: it.is_claimed == null ? null : !!it.is_claimed,
    photos: it.total_photos == null ? null : Number(it.total_photos), phone: !!it.phone, website: !!it.url, booking: !!it.book_online_url, hours: '' };
  var t = (it.work_hours || {}).timetable;
  if (t) {
    var pad = function (x) { return (x.hour < 10 ? '0' : '') + x.hour + ':' + (x.minute < 10 ? '0' : '') + (x.minute || 0); };
    p.hours = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map(function (d) {
      var slots = t[d];
      if (!slots || !slots.length) return d.slice(0, 3) + ' closed';
      return d.slice(0, 3) + ' ' + slots.map(function (x) {
        return x.open && x.close && x.open.hour === 0 && x.open.minute === 0 && x.close.hour === 0 && x.close.minute === 0 ? 'open 24 hours' : pad(x.open || {}) + '-' + pad(x.close || {});
      }).join(', ');
    }).join('; ');
  }
  return p;
}

function readAds_(items, domain) {
  var list = items.filter(function (it) { return it.type === 'ads_search'; });
  var a = { domain: domain, count: list.length, capped: list.length >= 40, formats: {}, advertiser: '', verified: false, first_shown: '', last_shown: '' };
  list.forEach(function (it) {
    var f = it.format || 'other';
    a.formats[f] = (a.formats[f] || 0) + 1;
    if (!a.advertiser && it.title) { a.advertiser = String(it.title).slice(0, 80); a.verified = !!it.verified; }
    var last = String(it.last_shown || '').slice(0, 10), first = String(it.first_shown || '').slice(0, 10);
    if (last > a.last_shown) a.last_shown = last;
    if (first && (!a.first_shown || first < a.first_shown)) a.first_shown = first;
  });
  return a;
}

function entry_(title, where, rating, paid) {
  var r = rating || {}, e = { name: String(title || '').replace(/\s+/g, ' ').trim().slice(0, 80) };
  var d = domainOf_(where);
  if (d && !/(^|\.)google\./.test(d)) e.domain = d;
  if (r.value != null && r.value !== '') e.rating = Number(r.value);
  if (r.votes_count != null && r.votes_count !== '') e.reviews = Number(r.votes_count);
  if (paid) e.paid = true;
  return e;
}

function isShop_(e, domain, name) {
  if (domain && e.domain && (e.domain === domain || e.domain.slice(-domain.length - 1) === '.' + domain)) return true;
  return sameName_(e.name, name);
}
function nameKey_(s) {
  return String(s || '').toLowerCase().replace(/['’]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(ltd|inc|corp|co|company|the|and|services?|limited|calgary|alberta|ab)\b/g, ' ').replace(/\s+/g, ' ').trim();
}
function sameName_(a, b) {
  var x = nameKey_(a), y = nameKey_(b);
  if (x.length < 4 || y.length < 4) return false;
  return x === y || x.indexOf(y + ' ') === 0 || y.indexOf(x + ' ') === 0;
}

function scanSite_(resp) {
  var code = resp.getResponseCode();
  var html = code >= 200 && code < 400 ? String(resp.getContentText() || '').slice(0, 800000) : '';
  var low = html.toLowerCase();
  var text = low.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
  return {
    status: code, ok: !!html,
    title: ((html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '').replace(/\s+/g, ' ').trim().slice(0, 120),
    platform: /wp-content|wp-includes/.test(low) ? 'WordPress' : /wixstatic|static\.parastorage/.test(low) ? 'Wix' : /static1\.squarespace|squarespace-cdn/.test(low) ? 'Squarespace' :
      /cdn\.shopify|myshopify/.test(low) ? 'Shopify' : /webflow\.com|wf-page/.test(low) ? 'Webflow' : /img1\.wsimg\.com/.test(low) ? 'GoDaddy' : /multiscreensite|dmcdn|irp\.cdn-website/.test(low) ? 'Duda' : '',
    ads_tag: (html.match(/\bAW-\d{6,12}\b/) || [''])[0],
    ga4: /gtag\/js\?id=G-|['"]G-[A-Z0-9]{6,12}['"]/.test(html),
    gtm: (html.match(/\bGTM-[A-Z0-9]{4,9}\b/) || [''])[0],
    call_tracking: /gstatic\.com\/wcm\/loader|_googwcmget|phone_conversion_number/.test(low) ? 'Google forwarding numbers' : /callrail/.test(low) ? 'CallRail' :
      /calltrackingmetrics|tctm\.co/.test(low) ? 'CallTrackingMetrics' : /whatconverts/.test(low) ? 'WhatConverts' : '',
    meta_pixel: /fbevents\.js|fbq\(\s*['"]init/.test(html),
    tel_links: (low.match(/href\s*=\s*["']?tel:/g) || []).length,
    forms: (low.match(/<form[\s>]/g) || []).length,
    booking: /getjobber\.com|clienthub\.getjobber/.test(low) ? 'Jobber' : /housecallpro/.test(low) ? 'Housecall Pro' : /servicetitan/.test(low) ? 'ServiceTitan' :
      /calendly\.com/.test(low) ? 'Calendly' : /book online|book now|schedule online|book a service|book service/.test(text) ? 'a booking button' : '',
    emergency: /\b24\/7\b|24 hours|24-hour|emergency/.test(text),
    text: text.slice(0, 40000)
  };
}

function saveEvidence_(lead, ev) {
  // What the owner told us on the form wins over a search snapshot (their ads may point at another website).
  var said = (String(lead.owner_says || '').match(/running Google Ads: (yes|no)\b/) || [])[1];
  if (said === 'yes') ev.segment = 'running_ads';
  else if (said === 'no' && ev.segment === 'unknown') ev.segment = 'no_ads';
  var json = JSON.stringify(ev);
  if (json.length > 45000) { ev.searches.forEach(function (s) { s.organic = s.organic.slice(0, 3); s.maps_top = s.maps_top.slice(0, 3); }); json = JSON.stringify(ev); }
  appendRow_(TAB.evidence, HEAD.evidence, { lead_id: lead.id, created: new Date(), segment: ev.segment, town: ev.where, cost_usd: ev.cost, evidence_json: json });
  var fields = { segment: ev.segment };
  if (!lead.area || !TOWNS[String(lead.area).toLowerCase()]) fields.area = ev.where;
  updateLead_(lead, fields);
  logEvent_(lead.id, lead.email, 'evidence', ev.segment + ', ' + ev.where + (ev.errors.length ? ' | couldn\'t check: ' + ev.errors.join('; ') : ''));
}

function evidenceFor_(leadId) {
  var r = leadId ? readRows_(TAB.evidence, HEAD.evidence).filter(function (x) { return x.lead_id === leadId; }).pop() : null;
  if (!r) return null;
  try { var e = JSON.parse(r.evidence_json); e._created = r.created; return e; } catch (err) { return null; }
}
function freshEvidence_(leadId) {
  var e = evidenceFor_(leadId);
  return e && Number(e.v || 0) >= 3 && Date.now() - new Date(e._created).getTime() < 7 * 864e5 ? e : null;
}

// The evidence as plain text for the audit request.
function evidenceText_(ev) {
  var L = [], s = ev.site || {};
  var list = function (arr) {
    return arr.length ? arr.map(function (e) {
      return (e.rank || '') + '. ' + e.name + (e.domain && e.domain !== e.name ? ' (' + e.domain + ')' : '') +
        (e.rating != null ? ', ' + e.rating + ' stars' : '') + (e.reviews != null ? ', ' + e.reviews + ' reviews' : '') +
        (e.paid ? ', sponsored' : '') + (e.you ? ' [THIS SHOP]' : '');
    }).join('; ') : 'none shown';
  };
  L.push('EVIDENCE, gathered by our tools on ' + ev.checked + '. Treat it as something you saw yourself.');
  L.push('Segment: ' + ev.segment + (ev.segment === 'running_ads' ? ' (they are running Google Ads)' : ev.segment === 'no_ads' ? ' (no Google Ads found)' : ' (couldn\'t tell whether they run Google Ads)'));
  if (!s.url) L.push('Home page scan: no website given.');
  else if (!s.ok) L.push('Home page scan: ' + s.url + ' did not load' + (s.status ? ' (HTTP ' + s.status + ')' : '') + (s.error ? ' (' + s.error + ')' : '') + '.');
  else L.push('Home page scan of ' + s.url + (s.platform ? ' (' + s.platform + ')' : '') + ': Google Ads tag ' +
    (s.ads_tag || 'none visible' + (s.gtm ? ' (Google Tag Manager ' + s.gtm + ' is installed, so it may be inside that)' : '')) +
    '. Google Analytics 4: ' + (s.ga4 ? 'yes' : s.gtm ? 'not visible, may be inside Tag Manager' : 'none visible') +
    '. Call tracking: ' + (s.call_tracking || 'none seen') + '. Meta pixel: ' + (s.meta_pixel ? 'yes' : 'no') +
    '. Tap-to-call links: ' + s.tel_links + '. Forms: ' + s.forms + '. Online booking: ' + (s.booking || 'none seen') +
    '. Mentions 24/7 or emergency service: ' + (s.emergency ? 'yes' : 'no') + '.');
  if (ev.profile) {
    var pr = ev.profile;
    var others = [];
    (ev.searches || []).forEach(function (q) { (q.maps_top || []).forEach(function (m) { if (!m.you && m.photos != null && m.rank <= 3) others.push(m.photos); }); });
    L.push('Their Google Business Profile (from Maps): ' + pr.name + (pr.rating != null ? ', ' + pr.rating + ' stars' : '') +
      (pr.reviews != null ? ' from ' + pr.reviews + ' reviews' : '') + (pr.category ? ', main category ' + pr.category : '') +
      (pr.extra_categories && pr.extra_categories.length ? ', other categories: ' + pr.extra_categories.join(', ') : pr.extra_categories ? ', no other categories' : '') +
      (pr.claimed === false ? '. NOT claimed by the owner' : pr.claimed ? '. Claimed by the owner' : '') +
      (pr.photos != null ? '. ' + pr.photos + ' photos' + (others.length ? ' (the top three shops on these searches have ' + Math.round(others.reduce(function (a, b) { return a + b; }, 0) / others.length) + ' on average)' : '') : '') +
      (pr.hours ? '. Hours: ' + pr.hours : '. No hours listed') + '. Phone on the profile: ' + (pr.phone ? 'yes' : 'no') + '. Website on the profile: ' + (pr.website ? 'yes' : 'no') +
      '. Booking link on the profile: ' + (pr.booking ? 'yes' : 'no') + '.');
  }
  if (ev.ads) L.push('Google Ads Transparency Center, Google Search ads in Canada over the last 30 days for ' + ev.ads.domain + ': ' +
    (ev.ads.count ? ev.ads.count + (ev.ads.capped ? ' or more' : '') + ' ads (' + Object.keys(ev.ads.formats).map(function (f) { return ev.ads.formats[f] + ' ' + f; }).join(', ') +
      '), last shown ' + ev.ads.last_shown + (ev.ads.advertiser ? ', advertiser "' + ev.ads.advertiser + '"' + (ev.ads.verified ? ' (verified)' : '') : '') : 'none') + '.');
  else L.push('Google Ads Transparency Center: not checked.');
  if ((ev.estimates || []).length) L.push('Google\'s monthly search estimates in ' + ev.estimate_where + ': ' +
    ev.estimates.map(function (e) { return '"' + e.keyword + '" about ' + e.volume; }).join(', ') + '. Together about ' + ev.estimate_total + ' a month.');
  if (ev.market) L.push('The wider market in ' + ev.market.where + ': about ' + ev.market.total + ' searches a month across ' + ev.market.count +
    ' related searches about this work (biggest: ' + ev.market.top.map(function (t) { return '"' + t[0] + '" ' + t[1]; }).join(', ') + ').');
  if (ev.value) {
    var vw = valueWords_(ev.value);
    L.push('VALUE ESTIMATE, worked out by our tools. Use these figures exactly as written, always as an estimate, never as a promise or as money they are losing: ' +
      vw.line + (vw.headline ? ' That is about $' + money_(ev.value.low) + ' to $' + money_(ev.value.high) + ' a month, or ' + vw.headline + '.' : '') +
      (vw.big_line ? ' ' + vw.big_line : '') + ' (How it\'s worked out, shown on the page as a footnote: ' + vw.footnote + ')');
  } else L.push('VALUE ESTIMATE: none (no search estimate for the town, or no typical price for this kind of business). Don\'t give dollar figures.');
  ev.searches.forEach(function (q, i) {
    L.push('');
    L.push('Search ' + (i + 1) + ': "' + q.keyword + '", on a phone in ' + q.where +
      (q.volume != null ? '. Google estimates about ' + q.volume + ' searches a month for this in ' + (q.volume_where || q.where) : '') +
      (q.bid_low_usd != null ? ', with top-of-page bids around US$' + Number(q.bid_low_usd).toFixed(2) + ' to US$' + Number(q.bid_high_usd || q.bid_low_usd).toFixed(2) + ' a click' : '') + '.');
    if (!q.ran) { L.push('  This search did not run.'); return; }
    L.push('  Local Services Ads (Google Verified badge): ' + list(q.lsa));
    L.push('  Sponsored: ' + list(q.ads));
    L.push('  Map pack: ' + list(q.map_pack));
    L.push('  Google Maps: ' + (q.you.maps ? 'this shop is #' + q.you.maps + ' of ' + q.maps_total : 'this shop is not in the first ' + q.maps_total) +
      '. Top: ' + list(q.maps_top) + (q.maps_ads.length ? '. Sponsored in Maps: ' + list(q.maps_ads) : ''));
    L.push('  Websites: ' + list(q.organic) + (q.you.organic ? '' : ' (this shop is not in the first 20)'));
  });
  if (ev.errors.length) L.push('', 'Could not check: ' + ev.errors.join('; ') + '.');
  return L.join('\n');
}

/* ══════════════════════════ the engine (Claude API, batch) ══════════════════════════ */

function weeklyProspects() {
  ensureSchema_();
  _settings = null;
  var areas = String(setting_('AREAS') || '').split(',').map(function (s) { return s.trim(); }).filter(String);
  if (!areas.length) return;
  var i = (Number(prop_('AREA_INDEX') || -1) + 1) % areas.length;
  props_().setProperty('AREA_INDEX', String(i));
  if (dfsConfigured_()) findFromMaps_(areas[i]);
  else queueJob_('find', '', areas[i]);
}

// New shops from Google Maps: one search per trade in the area, independent shops with a website and 10+ reviews.
function findFromMaps_(area) {
  var town = townFor_({ area: area }, '');
  var trades = String(setting_('TRADES') || '').split(',').map(function (s) { return s.trim(); }).filter(String);
  if (!trades.length) return;
  var resps = UrlFetchApp.fetchAll(trades.map(function (t) {
    return dfsReq_('serp/google/maps/live/advanced', { keyword: keywordsFor_(t, town.name)[0], location_coordinate: town.lat + ',' + town.lng + ',13z', language_code: 'en', depth: 40 });
  }));
  var cost = 0, errors = [];
  var pools = resps.map(function (r, k) {
    var d = dfsRead_(r);
    cost += d.cost;
    if (!d.ok) errors.push(trades[k] + ': ' + d.error);
    var list = d.items.filter(function (it) { return it.type === 'maps_search'; }).map(function (it, i) {
      var e = entry_(it.title, it.domain || it.url, it.rating);
      return { business: e.name, website: it.url || (e.domain ? 'https://' + e.domain : ''), domain: e.domain || '', reviews: e.reviews || 0, trade: trades[k], rank: i + 1 };
    });
    // Best prospects first: established shops (20+ reviews) that sit below the top 3 on the map, then the rest by rank.
    // Shops already at the top of the map have the least to gain.
    var tier = function (s) { return s.reviews >= 20 && s.rank > 3 ? 0 : s.rank > 3 ? 1 : 2; };
    return list.sort(function (a, b) { return tier(a) - tier(b) || a.rank - b.rank; });
  });
  // One search-estimate call for every trade's searches in this town, so the audits that follow read them from the tab.
  var vol = volumesFor_([].concat.apply([], trades.map(function (t) { return relatedKeywords_(keywordsFor_(t, town.name), town.name); })), town.name);
  cost += vol.cost;
  if (vol.error) errors.push('search estimates: ' + vol.error);
  var known = knownDomains_(), limit = Number(setting_('PROSPECTS_PER_WEEK') || 15), added = 0, seen = 0;
  for (var round = 0; added < limit && pools.some(function (p) { return p.length > round; }); round++) {
    pools.forEach(function (p) {
      var s = p[round];
      if (!s || added >= limit) return;
      seen++;
      if (!s.domain || NOT_PROSPECTS.test(s.domain) || known.indexOf(s.domain) > -1 || isDnc_(s.domain) || s.reviews < 10) return;
      known.push(s.domain);
      addProspect_(s, area);
      added++;
    });
  }
  appendRow_(TAB.jobs, HEAD.jobs, { job_id: newId_('J'), kind: 'find', lead_id: '', area: area, status: 'done', attempts: 1, created: new Date(), updated: new Date(),
    est_cost_usd: cost, detail: 'Google Maps: ' + added + ' new' + (errors.length ? ' | ' + errors.join('; ') : '') });
  logEvent_('', '', 'prospects_found', area + ': ' + added + ' new of ' + seen + ' on Google Maps');
}

function addProspect_(s, area) {
  var lead = {
    id: newId_('P'), created: new Date(), source: 'cold', status: 'researching', business: s.business || '',
    website: s.website, trade: s.trade || '', area: s.area || area, touches: 0, last_reply_at: 0,
    consent_basis: 'Conspicuous publication (CASL s.10(9)(b)): address published by the business, message relevant to its role'
  };
  appendRow_(TAB.leads, HEAD.leads, lead);
  queueJob_('audit', lead.id, '');
}

function queueJob_(kind, leadId, area) {
  var open = readRows_(TAB.jobs, HEAD.jobs).some(function (j) {
    return j.kind === kind && j.lead_id === leadId && ((kind !== 'find' && kind !== 'monthly_report') || j.area === area) && ['queued', 'submitted'].indexOf(j.status) > -1;
  });
  if (open) return;
  appendRow_(TAB.jobs, HEAD.jobs, {
    job_id: newId_('J'), kind: kind, lead_id: leadId || '', area: area || '', status: 'queued', attempts: 0,
    created: new Date(), updated: new Date(), est_cost_usd: 0
  });
}

function submitJobs_() {
  if (!prop_('ANTHROPIC_API_KEY')) return;
  if (monthSpend_() >= Number(setting_('MONTHLY_ENGINE_BUDGET_USD') || 20)) {
    if (prop_('BUDGET_WARNED') !== monthKey_()) {
      props_().setProperty('BUDGET_WARNED', monthKey_());
      ownerMail_('Engine paused for the month', 'Estimated engine spend this month reached $' + monthSpend_().toFixed(2) +
        ' (budget $' + setting_('MONTHLY_ENGINE_BUDGET_USD') + '). New audits wait until next month, or raise MONTHLY_ENGINE_BUDGET_USD on the Settings tab.');
    }
    return;
  }
  // Audits wait for current evidence (gatherEvidence_ runs just before this).
  var withEvidence = {};
  readRows_(TAB.jobs, HEAD.jobs).forEach(function (j) { if (j.kind === 'audit' && j.status === 'queued' && freshEvidence_(j.lead_id)) withEvidence[j.lead_id] = true; });
  // Account reports with a site audit wait for the site checks (gatherSiteChecks_ runs just before this too).
  var siteWaiting = {};
  readRows_(TAB.exports, HEAD.exports).forEach(function (e) { if (e.status === 'report_queued' && yes_(e.site) && !e.site_json) siteWaiting[e.lead_id] = true; });
  var jobs = readRows_(TAB.jobs, HEAD.jobs).filter(function (j) {
    return j.status === 'queued' && (j.kind !== 'audit' || withEvidence[j.lead_id] || !findLead_('id', j.lead_id)) &&
      (j.kind !== 'account_report' || !siteWaiting[j.lead_id]);
  }).slice(0, 25);
  if (!jobs.length) return;
  var requests = [];
  jobs.forEach(function (j) {
    var params = jobParams_(j);
    if (params) requests.push({ custom_id: j.job_id, params: params });
    else updateRow_(TAB.jobs, HEAD.jobs, j, { status: 'error', detail: j.kind === 'account_report' ? 'Lead or export missing' : 'Lead missing', updated: new Date() });
  });
  if (!requests.length) return;
  var res = anthropic_('post', '/v1/messages/batches', { requests: requests });
  if (!res.ok) { logEvent_('', '', 'error', 'Batch submit failed: ' + res.code + ' ' + res.text.slice(0, 300)); return; }
  var batch = JSON.parse(res.text);
  jobs.forEach(function (j) {
    if (requests.some(function (r) { return r.custom_id === j.job_id; })) {
      updateRow_(TAB.jobs, HEAD.jobs, j, { status: 'submitted', batch_id: batch.id, updated: new Date() });
    }
  });
  logEvent_('', '', 'batch_submitted', batch.id + ' (' + requests.length + ' jobs)');
}

function jobParams_(job) {
  if (job.kind === 'account_report') return reportParams_(job);
  if (job.kind === 'monthly_report') return monthlyParams_(job);
  var model = setting_('MODEL') || 'claude-opus-5-5';
  var loc = { type: 'approximate', city: 'Calgary', region: 'Alberta', country: 'CA', timezone: 'America/Edmonton' };
  var today = Utilities.formatDate(new Date(), tz_(), 'EEEE, MMMM d, yyyy');
  if (job.kind === 'find') {
    var exclude = knownDomains_().slice(0, 200);
    return {
      model: model, max_tokens: 4000, system: PROMPT_FIND,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 8, user_location: loc }],
      messages: [{ role: 'user', content:
        'Today is ' + today + '.\nArea: ' + job.area + ', Alberta\nTrades: ' + setting_('TRADES') +
        '\nHow many: up to ' + setting_('PROSPECTS_PER_WEEK') +
        '\nExclusion list (website domains to skip): ' + (exclude.join(', ') || 'none') }]
    };
  }
  var lead = findLead_('id', job.lead_id);
  if (!lead) return null;
  var site = siteUrlOf_(lead.website);
  var ev = evidenceFor_(lead.id) || { checked: today, segment: 'unknown', site: {}, searches: [], errors: ['no evidence was gathered'] };
  return {
    model: model, max_tokens: 6000, system: PROMPT_AUDIT,
    tools: [
      { type: 'web_search_20250305', name: 'web_search', max_uses: 4, user_location: loc },
      { type: 'web_fetch_20250910', name: 'web_fetch', max_uses: 5, max_content_tokens: 12000 }
    ],
    messages: [{ role: 'user', content:
      'Today is ' + today + '. Build a ' + AUDIT_NAME + ' for this business.\n\n' +
      'Business: ' + (lead.business || 'unknown') + '\n' +
      'Website: ' + (site || 'not given, search for it') + '\n' +
      'Kind of business: ' + (lead.trade || 'local service business') + '\n' +
      'Town: ' + (ev.where || lead.area || 'Calgary') + ', Alberta\n' +
      (lead.owner_says ? 'What the owner told us on the form: ' + lead.owner_says + '\n' : '') +
      'Purpose: ' + (lead.source === 'cold' ? 'cold' : 'inbound (they asked for it, no contact details needed)') + '\n\n' +
      evidenceText_(ev) }]
  };
}

function pollBatches_() {
  if (!prop_('ANTHROPIC_API_KEY')) return;
  var jobs = readRows_(TAB.jobs, HEAD.jobs).filter(function (j) { return j.status === 'submitted' && j.batch_id; });
  var ids = jobs.map(function (j) { return j.batch_id; }).filter(function (v, i, a) { return a.indexOf(v) === i; });
  ids.forEach(function (id) {
    var r = anthropic_('get', '/v1/messages/batches/' + id);
    if (!r.ok) return;
    var b = JSON.parse(r.text);
    if (b.processing_status !== 'ended' || !b.results_url) return;
    var rr = UrlFetchApp.fetch(b.results_url, { headers: anthropicHeaders_(), muteHttpExceptions: true });
    if (rr.getResponseCode() !== 200) return;
    rr.getContentText().split('\n').forEach(function (line) {
      if (!line.trim()) return;
      var item = JSON.parse(line);
      var job = jobs.filter(function (j) { return j.job_id === item.custom_id; })[0];
      if (job) handleResult_(job, item.result || {});
    });
  });
}

function handleResult_(job, result) {
  var cost = 0, data = null, why = '';
  if (result.type === 'succeeded') {
    var msg = result.message || {};
    cost = estimateCost_(msg.model, msg.usage || {});
    if (msg.stop_reason === 'end_turn') data = extractJson_(msg.content || []);
    why = data ? '' : 'No usable JSON (stop: ' + msg.stop_reason + ')';
  } else {
    why = 'Batch result ' + result.type + (result.error ? ': ' + JSON.stringify(result.error).slice(0, 200) : '');
  }
  var attempts = Number(job.attempts || 0) + 1;
  var totalCost = Number(job.est_cost_usd || 0) + cost;
  if (!data) {
    var retry = attempts < 3;
    updateRow_(TAB.jobs, HEAD.jobs, job, { status: retry ? 'queued' : 'error', attempts: attempts, est_cost_usd: totalCost, detail: why, updated: new Date() });
    if (!retry && (job.kind === 'account_report' || job.kind === 'monthly_report')) {
      var rl = findLead_('id', job.lead_id) || {};
      ownerMail_((job.kind === 'monthly_report' ? 'Monthly report failed: ' : 'Account audit report failed: ') + (rl.business || job.lead_id),
        'The report for ' + (rl.business || job.lead_id) + ' failed three times: ' + why + '\n\nThe export is saved. ' +
        (job.kind === 'monthly_report' ? 'Tell Claude in the Ledge project what came back.' : 'To try again: ' + (rl.id ? ownerLink_('rebuild_report', rl) : 'the lead is gone') +
          '\nOr tell Claude in the Ledge project what came back.'));
      logEvent_(job.lead_id, '', 'error', 'Job ' + job.job_id + ' gave up: ' + why);
    } else if (!retry) {
      var l = findLead_('id', job.lead_id);
      if (l) updateLead_(l, { status: 'error', notes: appendNote_(l.notes, 'Audit failed: ' + why) });
      logEvent_(job.lead_id, '', 'error', 'Job ' + job.job_id + ' gave up: ' + why);
    }
    return;
  }
  var outcome = job.kind === 'find' ? applyFind_(job, data) : job.kind === 'account_report' ? applyAccountReport_(job, data) :
    job.kind === 'monthly_report' ? applyMonthlyReport_(job, data) : applyAudit_(job, data);
  if (outcome === 'retry' && attempts < 3) {
    updateRow_(TAB.jobs, HEAD.jobs, job, { status: 'queued', attempts: attempts, est_cost_usd: totalCost, detail: 'Incomplete ' + (job.kind === 'account_report' ? 'report' : 'audit') + ', retrying', updated: new Date() });
    return;
  }
  updateRow_(TAB.jobs, HEAD.jobs, job, { status: 'done', attempts: attempts, est_cost_usd: totalCost, detail: String(outcome || ''), updated: new Date() });
}

function applyAudit_(job, a) {
  var l = findLead_('id', job.lead_id);
  if (!l) return 'lead gone';
  if (a.build === false) {
    updateLead_(l, { status: 'skipped', notes: appendNote_(l.notes, 'Not enough to audit: ' + (a.skip_reason || '')) });
    logEvent_(l.id, l.email, 'skipped', a.skip_reason || 'thin audit');
    if (l.source === 'inbound') ownerMail_('Couldn\'t audit: ' + l.business,
      l.business + ' asked for an audit but there wasn\'t enough public information to build one.\n\nReason: ' + (a.skip_reason || 'not given') +
      '\nWebsite they gave: ' + l.website + '\nEmail: ' + l.email + '\n\nThey were told to expect it by end of the next business day, so a personal note from you would land well.');
    return 'skipped';
  }
  var okChecks = Array.isArray(a.checks) && a.checks.length === CHECK_NAMES.length &&
    a.checks.every(function (c) { return c && ['good', 'gap', 'unknown'].indexOf(c.status) > -1 && c.note; });
  var okMoves = Array.isArray(a.moves) && a.moves.length === 3 && a.moves.every(function (m) { return m && m.title && m.why && OFFERS[m.offer]; });
  if (!okChecks || !okMoves || !a.summary || !a.top_finding || !a.fix_1) return 'retry';

  var fields = {};
  if (l.source === 'cold') {
    var c = a.contact || {};
    var email = String(c.email || '').toLowerCase().trim();
    var reason = !email ? 'No published email' : c.no_solicitation_notice ? 'No-solicitation notice' : !c.proof_url ? 'No proof of where the email was published' :
      isDnc_(email) ? 'On do-not-contact list' : (findLead_('email', email) && findLead_('email', email).id !== l.id) ? 'Already in pipeline' : '';
    if (reason) {
      updateLead_(l, { status: 'skipped', notes: appendNote_(l.notes, reason) });
      logEvent_(l.id, email, 'skipped', reason);
      return 'skipped: ' + reason;
    }
    fields.email = email;
    fields.first_name = c.first_name || '';
    fields.name = c.contact_name || '';
    fields.phone = c.phone || '';
    fields.consent_proof = c.proof_url + ' | found ' + new Date().toISOString() + ' | "' + String(c.proof_excerpt || '').slice(0, 200) + '"';
  }
  var slug = slugify_(a.business || l.business) + '-' + rand_(6);
  var ev = evidenceFor_(l.id) || { searches: [] };
  var segment = SEGMENTS.indexOf(l.segment) > -1 ? l.segment : (SEGMENTS.indexOf(ev.segment) > -1 ? ev.segment : 'unknown');
  var spec = {
    v: 2, business: a.business || l.business, area: ev.where || a.area || l.area || 'Calgary', segment: segment,
    date: Utilities.formatDate(new Date(), tz_(), 'MMM d, yyyy'), checked: ev.checked || '', summary: a.summary,
    searches: (ev.searches || []).filter(function (s) { return s.ran; }).map(function (s) {
      return { keyword: s.keyword, where: s.where, volume: s.volume, volume_where: s.volume_where, lsa: s.lsa, ads: s.ads, map_pack: s.map_pack, organic: s.organic,
        maps_total: s.maps_total, you: s.you };
    }),
    estimates: ev.estimates || [], estimate_where: ev.estimate_where || '', estimate_total: ev.estimate_total || 0,
    market: ev.market || null, value: ev.value || null,
    checks: a.checks.map(function (c) { return { status: c.status, note: String(c.note) }; }),
    moves: a.moves.map(function (m) { return { title: String(m.title), why: String(m.why), offer: fitOffer_(m.offer, segment), effort: String(m.effort || '') }; }),
    later: (Array.isArray(a.later) ? a.later : []).map(String).filter(String).slice(0, 2),
    sources: (a.sources || []).filter(function (s) { return s && /^https?:\/\//i.test(s.url); }).slice(0, 8)
  };
  appendRow_(TAB.audits, HEAD.audits, { slug: slug, lead_id: l.id, created: new Date(), business: spec.business, spec_json: JSON.stringify(spec) });
  fields.audit_slug = slug;
  fields.top_finding = a.top_finding;
  fields.fix_1 = String(a.fix_1).replace(/\.$/, '');
  // A lead that has moved on (booked the account audit, signed up) keeps its status; the audit is just stored.
  if (['', 'requested', 'researching', 'audit_ready', 'audit_approved', 'awaiting_review', 'ready_to_send', 'error'].indexOf(String(l.status || '')) > -1) fields.status = 'audit_ready';
  if (!l.business) fields.business = spec.business;
  updateLead_(l, fields);
  logEvent_(l.id, fields.email || l.email, 'audit_built', slug);
  return 'audit ' + slug;
}

// Keeps each move's offer in line with what the shop can buy: a shop with no ads account can't have it audited or managed yet,
// and a shop already running ads needs management rather than a fresh setup.
function fitOffer_(offer, segment) {
  if (segment === 'no_ads' && (offer === 'paid_audit' || offer === 'management')) return 'setup';
  if (segment === 'running_ads' && offer === 'setup') return 'management';
  return offer;
}

function applyFind_(job, data) {
  var shops = Array.isArray(data.shops) ? data.shops : [];
  var known = knownDomains_();
  var limit = Number(setting_('PROSPECTS_PER_WEEK') || 15), added = 0;
  shops.forEach(function (s) {
    if (added >= limit || !s || !s.website) return;
    var d = domainOf_(s.website);
    if (!d || NOT_PROSPECTS.test(d) || known.indexOf(d) > -1 || isDnc_(d)) return;
    known.push(d);
    addProspect_(s, job.area);
    added++;
  });
  logEvent_('', '', 'prospects_found', job.area + ': ' + added + ' new of ' + shops.length);
  return added + ' new shops';
}

function anthropicHeaders_() {
  return { 'x-api-key': prop_('ANTHROPIC_API_KEY'), 'anthropic-version': '2023-06-01' };
}

function anthropic_(method, path, payload) {
  var res = UrlFetchApp.fetch('https://api.anthropic.com' + path, {
    method: method, contentType: 'application/json', headers: anthropicHeaders_(),
    payload: payload ? JSON.stringify(payload) : undefined, muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  return { ok: code >= 200 && code < 300, code: code, text: res.getContentText() || '' };
}

function extractJson_(content) {
  var text = content.filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('\n');
  var blocks = text.match(/```json\s*([\s\S]*?)```/g);
  var candidates = blocks ? blocks.map(function (b) { return b.replace(/^```json\s*|```$/g, ''); }).reverse() : [];
  var brace = text.lastIndexOf('{') > -1 ? text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1) : '';
  if (brace) candidates.push(brace);
  for (var i = 0; i < candidates.length; i++) {
    try { return JSON.parse(candidates[i]); } catch (err) {}
  }
  return null;
}

// Batch prices per million tokens (50% of standard) plus $0.01 per web search.
function estimateCost_(model, usage) {
  var m = model || '';
  var rates = /haiku/i.test(m) ? [0.05, 0.25] : /opus/i.test(m) ? [2, 10] : /fable|mythos/i.test(m) ? [5, 25] : [1, 5]; // Batch API rates per million tokens (Oct 2026)
  var input = Number(usage.input_tokens || 0) + Number(usage.cache_creation_input_tokens || 0) + Number(usage.cache_read_input_tokens || 0) * 0.1;
  var searches = Number((usage.server_tool_use || {}).web_search_requests || 0);
  return input / 1e6 * rates[0] + Number(usage.output_tokens || 0) / 1e6 * rates[1] + searches * 0.01;
}

function monthSpend_() {
  var key = monthKey_();
  return readRows_(TAB.jobs, HEAD.jobs).reduce(function (sum, j) {
    return sum + (j.updated && Utilities.formatDate(new Date(j.updated), tz_(), 'yyyy-MM') === key ? Number(j.est_cost_usd || 0) : 0);
  }, 0);
}

function knownDomains_() {
  var out = [];
  readRows_(TAB.leads, HEAD.leads).forEach(function (l) { var d = domainOf_(l.website); if (d && out.indexOf(d) === -1) out.push(d); });
  readRows_(TAB.dnc, HEAD.dnc).forEach(function (r) { var v = String(r.email_or_domain || '').toLowerCase(); if (v.indexOf('@') === -1 && v && out.indexOf(v) === -1) out.push(v); });
  return out;
}

/* ══════════════════════════ clients: monthly reports and invoices ══════════════════════════ */
/*
 * Every management or starting plan approval adds a row to the Clients tab. Between the 2nd and the 7th of each month:
 *   1. The hub asks the export script for last month's numbers and change history for each active client with a customer ID.
 *   2. Claude writes a short report around the numbers (worked out here) and Logan's notes_for_report; Logan checks it
 *      (MONTHLY_REVIEW) and approving emails it to the client.
 *   3. Each active client billed from this month on gets a management fee invoice (through FreshBooks when connected),
 *      held for one OK covering the month.
 */
function clientOf_(leadId) { return findRow_(TAB.clients, HEAD.clients, 'lead_id', leadId); }
function ym_(d) { return Utilities.formatDate(d, tz_(), 'yyyy-MM'); }
function addMonths_(month, n) { var p = month.split('-'); var d = new Date(Number(p[0]), Number(p[1]) - 1 + n, 15); return Utilities.formatDate(d, tz_(), 'yyyy-MM'); }
function monthName_(month) { var p = String(month || '').split('-'); return p.length === 2 ? Utilities.formatDate(new Date(Number(p[0]), Number(p[1]) - 1, 15), tz_(), 'MMMM yyyy') : ''; }
function monthRange_(month) {
  var p = month.split('-'), y = Number(p[0]), m = Number(p[1]);
  var last = new Date(y, m, 0).getDate();
  return { start: month + '-01', end: month + '-' + (last < 10 ? '0' : '') + last, days: last };
}

function addClient_(l, prop) {
  if (!l || clientOf_(l.id)) return;
  appendRow_(TAB.clients, HEAD.clients, {
    lead_id: l.id, business: l.business, email: l.email, customer_id: prop.kind === 'management' ? (l.ads_customer_id || '') : '', status: 'active', plan: prop.kind,
    started: new Date(), monthly_fee: Number(prop.price_care || 0), ad_budget: Number(prop.ad_spend || 0), notes_for_report: '', last_report: '', last_invoice: '',
    // Management bills from next month (setup covers this one). A starting plan bills from the first full month after its ads start spending.
    bill_from: prop.kind === 'management' ? addMonths_(ym_(new Date()), 1) : ''
  });
}

// A management client replied with their customer ID: same one manual step as the account audit.
function linkClient_(l, client, cid) {
  cid = formatCid_(cid);
  updateRow_(TAB.clients, HEAD.clients, client, { customer_id: cid });
  updateLead_(l, { ads_customer_id: cid, attention: '' });
  logEvent_(l.id, l.email, 'client_linked', cid);
  var mgr = setting_('ADS_MANAGER_ID') || 'your manager account';
  ownerMail_('Send a link request: ' + l.business + ' (' + cid + ')', l.business + ' replied with their Google Ads customer ID: ' + cid + '.\n\n' +
    'In Google Ads, open your manager account (' + mgr + ') > Accounts > the blue + > Link existing account > enter ' + cid + ' > Send request.\n\n' +
    'They\'ve been told it\'s coming. Their monthly report reads the account from next month on.');
  safeSend_(findLead_('id', l.id), 'link_ack');
}

function monthlyRun_() {
  var now = new Date(), day = Number(Utilities.formatDate(now, tz_(), 'd')), month = ym_(now);
  if (day < 2 || day > 7 || prop_('MONTHLY_RUN') === month) return;
  props_().setProperty('MONTHLY_RUN', month);
  var last = addMonths_(month, -1), lastEnd = new Date(monthRange_(last).end + 'T23:59:59');
  var clients = readRows_(TAB.clients, HEAD.clients).filter(function (c) { return String(c.status || 'active').toLowerCase() === 'active'; });
  var queued = 0;
  clients.forEach(function (c) {
    if (!formatCid_(c.customer_id) || new Date(c.started).getTime() > lastEnd.getTime()) return;
    var have = readRows_(TAB.exports, HEAD.exports).some(function (e) { return e.lead_id === c.lead_id && e.kind === 'monthly' && e.month === last; });
    if (have) return;
    appendRow_(TAB.exports, HEAD.exports, { id: newId_('X'), lead_id: c.lead_id, customer_id: formatCid_(c.customer_id), requested: new Date(), status: 'requested',
      updated: new Date(), detail: 'Waiting for the export script', kind: 'monthly', month: last });
    queued++;
  });
  logEvent_('', '', 'monthly_run', month + ': ' + queued + ' reports queued');
  monthlyInvoices_(month, clients);
}

function monthlyExport_(e, l, data) {
  var json = packExport_(data);
  var fields = { status: 'report_queued', updated: new Date(), detail: 'Read ' + data.start + ' to ' + data.end };
  for (var i = 0; i < 8; i++) fields['d' + (i + 1)] = json.slice(i * 45000, (i + 1) * 45000);
  updateRow_(TAB.exports, HEAD.exports, e, fields);
  // A starting plan's billing starts with the first full month after its ads start spending.
  var c = clientOf_(e.lead_id), f = accountFacts_(data);
  if (c && !c.bill_from && f.cost > 0) updateRow_(TAB.clients, HEAD.clients, c, { bill_from: addMonths_(e.month, 2) });
  queueJob_('monthly_report', e.lead_id, e.month);
  logEvent_(e.lead_id, l.email || '', 'ads_export', 'monthly ' + e.month + ': $' + money_(f.cost));
  return { ok: true };
}
function monthlyExportOf_(leadId, month) {
  return readRows_(TAB.exports, HEAD.exports).filter(function (e) { return e.lead_id === leadId && e.kind === 'monthly' && e.month === month && e.d1; }).pop() || null;
}

// The month's numbers, with last month's beside them when we have it.
function monthFacts_(data, prev, trade, hint) {
  var f = accountFacts_(data, trade, hint), p = prev ? accountFacts_(prev, trade, hint) : null;
  var r2 = function (x) { return Math.round(x * 100) / 100; };
  var m = { cost: f.cost, clicks: f.clicks, leads: Math.round(f.leads), cost_per_lead: f.leads ? r2(f.cost / f.leads) : null, conversions: f.conversions,
    prev: p ? { cost: p.cost, clicks: p.clicks, leads: Math.round(p.leads), cost_per_lead: p.leads ? r2(p.cost / p.leads) : null } : null,
    converting_top: f.converting_top.slice(0, 6), wasted: f.wasted, wasted_top: f.wasted_top.slice(0, 6), lost_to_budget: f.lost_to_budget,
    impression_share: f.impression_share, campaigns: f.campaigns, calls: f.calls, value: null };
  var jv = jobValueFor_(trade, hint), book = valueRates_().book;
  if (jv && m.leads && book) {
    var jobs = Math.round(m.leads * book / 100);
    m.value = { work: jv[1], job: jv[2][0], job_low: jv[2][1], job_high: jv[2][2], big: '', book: book, leads_month: m.leads, jobs: jobs,
      low: jobs * jv[2][1], high: jobs * jv[2][2], spend: f.cost, wasted_month: 0, extra_leads: 0 };
  }
  // What changed in the account, grouped, from Google's change history.
  var groups = {};
  (data.changes || []).forEach(function (c) {
    var k = String(c.type || 'OTHER') + ' ' + String(c.op || '');
    groups[k] = groups[k] || { type: c.type, op: c.op, count: 0, campaigns: {}, fields: {} };
    groups[k].count++;
    if (c.campaign) groups[k].campaigns[c.campaign] = true;
    String(c.fields || '').split(',').forEach(function (x) { x = x.trim(); if (x) groups[k].fields[x.replace(/^[a-z_]+\./, '')] = true; });
  });
  m.changes = Object.keys(groups).map(function (k) {
    var g = groups[k];
    return { type: g.type, op: g.op, count: g.count, campaigns: Object.keys(g.campaigns).slice(0, 4), fields: Object.keys(g.fields).slice(0, 6) };
  }).sort(function (a, b) { return b.count - a.count; });
  m.change_count = (data.changes || []).length;
  return m;
}

function monthlyFactsText_(m, month, notes) {
  var L = [], d = function (cur, prev, money) {
    if (prev == null || cur == null) return '';
    var diff = cur - prev;
    return ' (' + (diff >= 0 ? 'up ' : 'down ') + (money ? dollars_(Math.abs(diff)) : Math.abs(Math.round(diff))) + ' from last month)';
  };
  L.push('MONTH: ' + monthName_(month) + '. Every number here was worked out for you; use them as given.');
  L.push('Spend ' + dollars_(m.cost) + d(m.cost, m.prev && m.prev.cost, true) + ', ' + m.clicks + ' clicks' + d(m.clicks, m.prev && m.prev.clicks) +
    ', ' + m.leads + ' calls and forms' + d(m.leads, m.prev && m.prev.leads) + (m.cost_per_lead != null ? ', ' + dollars_(m.cost_per_lead) + ' each' +
    (m.prev && m.prev.cost_per_lead != null ? ' (' + dollars_(m.prev.cost_per_lead) + ' last month)' : '') : '') + '.' + (m.prev ? '' : ' No earlier month to compare with.'));
  L.push('Calls from ads: ' + (m.calls.total || 0) + ' (' + (m.calls.missed || 0) + ' missed).');
  L.push('Searches that brought calls or forms: ' + (m.converting_top.map(function (t) { return '"' + t.term + '" ' + t.conversions + ' for ' + dollars_(t.cost); }).join('; ') || 'none recorded') + '.');
  L.push('Spend on searches with no conversions: ' + dollars_(m.wasted) + '. Biggest: ' + (m.wasted_top.map(function (t) { return '"' + t.term + '" ' + dollars_(t.cost); }).join('; ') || 'none') + '.');
  if (m.lost_to_budget != null) L.push('Search campaigns showed on ' + m.impression_share + '% of eligible searches; ' + m.lost_to_budget + '% missed because the budget ran out.');
  L.push('Changes made in the account this month (Google\'s change history): ' + (m.change_count ? m.changes.map(function (c) {
    return c.count + ' ' + String(c.type).toLowerCase().replace(/_/g, ' ') + ' ' + String(c.op).toLowerCase() + (c.campaigns.length ? ' in ' + c.campaigns.join(', ') : '') +
      (c.fields.length ? ' (' + c.fields.join(', ') + ')' : '');
  }).join('; ') : 'none recorded') + '.');
  L.push('Logan\'s notes for this report: ' + (String(notes || '').trim() || 'none') + '.');
  if (m.value) {
    var rv = reportValueWords_(m.value);
    L.push('VALUE ESTIMATE, worked out by our tools. Use these figures exactly as written, always as an estimate: about ' + rv.headline + ' in work from about ' + m.leads +
      ' calls and forms, if ' + inN_(m.value.book) + ' are booked at typical prices.');
  }
  return L.join('\n');
}

function monthlyParams_(job) {
  var lead = findLead_('id', job.lead_id), ex = lead ? monthlyExportOf_(lead.id, job.area) : null;
  var data = ex ? readExport_(ex) : null;
  if (!lead || !data) return null;
  var prevEx = monthlyExportOf_(lead.id, addMonths_(job.area, -1)), prev = prevEx ? readExport_(prevEx) : null;
  var c = clientOf_(lead.id) || {};
  return {
    model: setting_('MODEL') || 'claude-opus-5-5', max_tokens: 3000, system: PROMPT_MONTHLY_REPORT,
    messages: [{ role: 'user', content: 'Write the ' + monthName_(job.area) + ' report for this client.\n\nBusiness: ' + lead.business + '\nKind of business: ' +
      (lead.trade || 'local service business') + '\nTown: ' + (lead.area || 'Alberta') + '\nPlan: ' + (c.plan === 'starting_plan' ? 'starting plan' : 'monthly management') + '\n\n' +
      monthlyFactsText_(monthFacts_(data, prev, lead.trade, reportHint_(lead)), job.area, c.notes_for_report) }]
  };
}

function applyMonthlyReport_(job, a) {
  var l = findLead_('id', job.lead_id);
  if (!l) return 'lead gone';
  var ex = monthlyExportOf_(l.id, job.area), data = ex ? readExport_(ex) : null;
  if (!data) return 'no export';
  var list = function (x, lo, hi) { return Array.isArray(x) && x.length >= lo && x.length <= hi && x.every(function (t) { return t && String(t).trim(); }); };
  if (!a.headline || !a.summary || !list(a.changes, 1, 6) || !list(a.next, 1, 4)) return 'retry';
  var prevEx = monthlyExportOf_(l.id, addMonths_(job.area, -1));
  var m = monthFacts_(data, prevEx ? readExport_(prevEx) : null, l.trade, reportHint_(l));
  var spec = { v: 1, type: 'monthly', business: l.business, month: job.area, month_name: monthName_(job.area), date: Utilities.formatDate(new Date(), tz_(), 'MMM d, yyyy'),
    totals: { cost: m.cost, clicks: m.clicks, leads: m.leads, cost_per_lead: m.cost_per_lead }, prev: m.prev, value: m.value,
    converting_top: m.converting_top, headline: String(a.headline), summary: String(a.summary), changes: a.changes.map(String), next: a.next.map(String) };
  var slug = slugify_(l.business) + '-' + job.area + '-' + rand_(5);
  appendRow_(TAB.reports, HEAD.reports, { slug: slug, lead_id: l.id, export_id: ex.id, created: new Date(), status: 'draft', spec_json: JSON.stringify(spec) });
  updateRow_(TAB.exports, HEAD.exports, ex, { status: 'report_ready', report_slug: slug, updated: new Date() });
  if (yes_(setting_('MONTHLY_REVIEW'))) requestMonthlyReview_(l, slug, spec);
  else sendMonthly_(l, slug, spec);
  return 'monthly ' + slug;
}

function requestMonthlyReview_(l, slug, spec) {
  var c = clientOf_(l.id) || {}, fee = Number(c.monthly_fee || 0), tierFee = feeFor_(spec.totals.cost);
  ownerMail_('Check ' + l.business + '\'s ' + spec.month_name + ' report', l.business + '\'s ' + spec.month_name + ' report is ready.\n\n' +
    'Report: ' + siteUrl_() + '/report/' + slug + '\n' + spec.headline + '\n\n' +
    'Spend ' + dollars_(spec.totals.cost) + ', ' + spec.totals.leads + ' calls and forms' + (spec.totals.cost_per_lead != null ? ' at ' + dollars_(spec.totals.cost_per_lead) + ' each' : '') + '.' +
    (fee && Math.abs(tierFee - fee) >= 1 && spec.totals.cost >= Number(setting_('MIN_AD_BUDGET') || 0) ?
      '\n\nHeads-up: last month\'s spend sits in the $' + money_(tierFee) + ' fee tier, and their fee is $' + money_(fee) + '. To change it, edit monthly_fee in the Clients tab.' : '') +
    '\n\nLooks right, send it: ' + ownerLink_('approve_monthly', l) + '&slug=' + encodeURIComponent(slug) + '\n\n' +
    'Want something different in it? Tell Claude in the Ledge project.');
  logEvent_(l.id, l.email, 'review_requested', 'monthly ' + spec.month);
}

function ownerApproveMonthly_(l, slug) {
  var rep = slug ? findRow_(TAB.reports, HEAD.reports, 'slug', slug) : null;
  if (!rep || rep.lead_id !== l.id) return { title: 'Report not found', message: 'That report isn\'t in the Account reports tab.' };
  if (rep.status === 'sent') return { title: 'Already sent', message: 'This report went to ' + l.business + ' already.' };
  sendMonthly_(l, slug, JSON.parse(rep.spec_json));
  return { title: 'Sent', message: l.business + ' has their ' + JSON.parse(rep.spec_json).month_name + ' report.' };
}

function sendMonthly_(l, slug, spec) {
  var v = spec.value;
  sendLeadEmail_(l, 'monthly_report', {
    report_month: spec.month_name.replace(/ \d{4}$/, ''), monthly_url: siteUrl_() + '/report/' + slug, monthly_headline: spec.headline,
    monthly_value_para: v ? 'Going by the calls and forms your ads brought in, that\'s roughly $' + money_(v.low) + ' to $' + money_(v.high) + ' in work. The report shows how that\'s worked out.\n\n' : ''
  });
  var rep = findRow_(TAB.reports, HEAD.reports, 'slug', slug);
  updateRow_(TAB.reports, HEAD.reports, rep, { status: 'sent' });
  var c = clientOf_(l.id);
  if (c) updateRow_(TAB.clients, HEAD.clients, c, { last_report: spec.month });
  logEvent_(l.id, l.email, 'monthly_sent', spec.month);
}

// Spec in, HTML out, with no Sheet access (build.py renders the sample through this).
function renderMonthlySpec_(spec, o) {
  var t = spec.totals || {}, p = spec.prev || null;
  var delta = function (cur, prev, money, lowerIsBetter) {
    if (!p || prev == null || cur == null || cur === prev) return '';
    var up = cur > prev, good = lowerIsBetter === null ? null : lowerIsBetter ? !up : up;
    return '<span class="delta ' + (good === null ? 'neutral' : good ? 'good' : 'gap') + '">' + (up ? '↑ ' : '↓ ') + esc_(money ? dollars_(Math.abs(cur - prev)) : String(Math.abs(Math.round(cur - prev)))) + '</span>';
  };
  var tile = function (label, value, d) { return '      <div class="tile"><span class="tile-label">' + esc_(label) + '</span><span class="tile-value">' + esc_(value) + '</span>' + d + '</div>'; };
  var rv = reportValueWords_(spec.value);
  return fill_(MONTHLY_TEMPLATE, {
    business: spec.business, month_name: spec.month_name, date: spec.date, headline: spec.headline, summary: spec.summary, sender_name: o.sender_name,
    value_headline: rv.headline, value_footnote: rv.footnote,
    value_line: spec.value ? 'About ' + spec.value.leads_month + ' calls and forms came in from your ads. If ' + inN_(spec.value.book) + ' turned into booked jobs at $' +
      money_(spec.value.job_low) + ' to $' + money_(spec.value.job_high) + ' for ' + spec.value.job + ', that\'s about ' + (spec.value.jobs === 1 ? 'one job' : word_(spec.value.jobs) + ' jobs') +
      ', for ' + dollars_(spec.value.spend) + ' in ad spend.' : '',
    compare_note: p ? 'Arrows compare with the month before.' : 'Next month\'s report compares with this one.'
  }, {
    tiles: [tile('Ad spend', dollars_(t.cost), delta(t.cost, p && p.cost, true, null)), tile('Calls and forms', String(t.leads || 0), delta(t.leads, p && p.leads, false, false)),
      tile('Each call or form', t.cost_per_lead != null ? dollars_(t.cost_per_lead) : 'n/a', delta(t.cost_per_lead, p && p.cost_per_lead, true, true)),
      tile('Clicks', money_(t.clicks), delta(t.clicks, p && p.clicks, false, false))].join('\n'),
    value_hidden: spec.value ? '' : 'hidden',
    changes: (spec.changes || []).map(function (x) { return '      <li>' + esc_(x) + '</li>'; }).join('\n'),
    next: (spec.next || []).map(function (x) { return '      <li>' + esc_(x) + '</li>'; }).join('\n'),
    searches: (spec.converting_top || []).map(function (x) {
      return '          <tr><td>' + esc_(x.term) + '</td><td>' + esc_(String(x.conversions)) + '</td><td>' + esc_(dollars_(x.cost)) + '</td></tr>';
    }).join('\n'),
    searches_hidden: (spec.converting_top || []).length ? '' : 'hidden'
  });
}

// The month's management fee invoices: drafted between the 2nd and the 7th, held for one OK when MONTHLY_REVIEW is yes.
function monthlyInvoices_(month, clients) {
  var made = [];
  clients.forEach(function (c) {
    if (!c.bill_from || String(c.bill_from) > month || c.last_invoice === month || !(Number(c.monthly_fee) > 0)) return;
    var item = 'Google Ads management, ' + monthName_(month);
    appendRow_(TAB.invoices, HEAD.invoices, { lead_id: c.lead_id, month: month, item: item, amount: Number(c.monthly_fee), status: 'draft', created: new Date() });
    updateRow_(TAB.clients, HEAD.clients, c, { last_invoice: month });
    made.push(c.business + ': $' + money_(c.monthly_fee));
  });
  if (!made.length) return;
  var gst = yes_(setting_('GST_REGISTERED'));
  if (!fbConnected_()) {
    readRows_(TAB.invoices, HEAD.invoices).forEach(function (r) { if (r.month === month && r.status === 'draft') updateRow_(TAB.invoices, HEAD.invoices, r, { status: 'manual' }); });
    ownerMail_('Management invoices for ' + monthName_(month), 'Send these from FreshBooks (it isn\'t connected to the hub):\n\n' + made.join('\n') + (gst ? '\n\nEach + 5% GST.' : ''));
    return;
  }
  if (!yes_(setting_('MONTHLY_REVIEW'))) { ownerApproveInvoices_(month); return; }
  var id = 'invoices-' + month;
  ownerMail_('Check ' + monthName_(month) + ' management invoices', made.length + ' management invoice' + (made.length > 1 ? 's' : '') + ' for ' + monthName_(month) + ':\n\n' +
    made.join('\n') + (gst ? '\n\nEach + 5% GST.' : '') + '\n\nTo change one, edit monthly_fee in the Clients tab and tell Claude in the Ledge project first.\n\n' +
    'Send them all from FreshBooks: ' + prop_('WEB_APP_URL') + '?action=approve_invoices&id=' + id + '&t=' + token_(id));
}
function ownerApproveInvoices_(month) {
  var n = 0;
  readRows_(TAB.invoices, HEAD.invoices).forEach(function (r) { if (r.month === month && r.status === 'draft') { updateRow_(TAB.invoices, HEAD.invoices, r, { status: 'approved' }); n++; } });
  logEvent_('', '', 'invoices_approved', month + ': ' + n);
  return page_(n ? 'On their way' : 'Nothing to send', n ? n + ' invoice' + (n > 1 ? 's go' : ' goes') + ' out from FreshBooks within the hour.' : 'These invoices were already approved.');
}
// Hourly, inside the lock: approved monthly invoices go out from FreshBooks.
function sendMonthlyInvoices_() {
  if (!fbConnected_()) return;
  readRows_(TAB.invoices, HEAD.invoices).filter(function (r) { return r.status === 'approved' && !r.invoice_id; }).slice(0, 15).forEach(function (r) {
    var l = findLead_('id', r.lead_id);
    if (!l || !l.email) return;
    try {
      var inv = fbSendInvoice_(fbClientFor_(l), l.email, [{ name: r.item, description: '', amount: Number(r.amount) }], yes_(setting_('GST_REGISTERED')),
        'Invoice from Ledge Communications', 'Hi ' + (l.first_name || firstName_(l.name) || 'there') + ',\n\nHere\'s the invoice for ' + String(r.item).replace(/^Google Ads management/, 'managing your Google Ads') +
          '. You can pay it online by card or bank transfer.\n\nThanks,\n' + firstName_(setting_('SENDER_NAME')));
      updateRow_(TAB.invoices, HEAD.invoices, r, { invoice_id: String(inv.id), invoice_number: String(inv.invoice_number || ''), status: 'sent', sent_at: new Date() });
      logEvent_(l.id, l.email, 'invoice_sent', 'FreshBooks #' + (inv.invoice_number || inv.id) + ', ' + r.month);
    } catch (err) {
      logEvent_(l.id, l.email, 'error', 'FreshBooks monthly invoice: ' + String(err && err.message || err).slice(0, 300));
    }
  });
}

/* ══════════════════════════ paid account audits ══════════════════════════ */
/*
 * After someone approves the $500 account audit:
 *   1. The kickoff email asks for their 10-digit Google Ads customer ID. Their reply is read for it (or Logan uses
 *      Ledge > Run an account audit), Logan gets the one manual step (send the link request from the manager account),
 *      and they get a note saying the request is coming.
 *   2. The export script in the manager account (ads/ledge-ads-export.js) asks the hub every hour which accounts to read
 *      (ads_queue). Until they accept the link it reports "not linked" and tries again the next hour.
 *   3. Once linked, it sends 90 days of data (ads_export). The hub works out the hard numbers itself (spend on searches
 *      that brought nothing, what's tracked, location settings, budget limits), and Claude writes the report around them.
 *   4. Logan checks the report. Approving sends it, together with a management proposal priced on what they spend now,
 *      with the $500 coming off setup.
 */
var REPORT_SECTIONS = ['Budget and bidding', 'Searches you pay for', 'Call and form tracking', 'Location and schedule', 'Ads and extras',
  'Where clicks land', 'Local Services Ads and the map'];
var REPORT_OFFERS = ['management', 'page_fixes', 'landing_page', 'site_support', 'free'];

// Their customer ID from a reply: a 10-digit number that isn't their phone number, preferring one on a line about the account.
function customerIdFrom_(text, lead) {
  var phone = String(lead.phone || '').replace(/\D/g, '').slice(-10);
  var hits = [];
  var ACCOUNT = /customer|account|google ads|\bid\b|\bcid\b/ig, PHONE = /\b(phone|cell|mobile|tel|office|fax|call|text)\b/ig;
  var last = function (re, s) { var at = -1, x; re.lastIndex = 0; while ((x = re.exec(s))) at = x.index; return at; };
  String(text || '').split(/\r?\n/).forEach(function (line) {
    var re = /(^|[^\d])(\d{3})[-\s.]?(\d{3})[-\s.]?(\d{4})(?!\d)/g, m;
    while ((m = re.exec(line))) {
      var digits = m[2] + m[3] + m[4];
      if (digits === phone) continue;
      // Whichever word comes closest before the number says what it is; with neither nearby, the line decides.
      var near = line.slice(Math.max(0, m.index - 40), m.index + 1);
      var a = last(ACCOUNT, near), p = last(PHONE, near);
      if (a === -1 && p === -1) { a = last(ACCOUNT, line); p = last(PHONE, line); }
      if (p > a) continue;
      hits.push({ cid: m[2] + '-' + m[3] + '-' + m[4], about: a > -1 });
    }
  });
  var about = hits.filter(function (h) { return h.about; });
  if (about.length) return about[0].cid;
  var unique = hits.map(function (h) { return h.cid; }).filter(function (c, i, all) { return all.indexOf(c) === i; });
  if (unique.length === 1) return unique[0];
  // Several numbers (a phone number in the signature, say): take the one on the first line, if only one is there.
  var first = (String(text || '').split(/\r?\n/).filter(function (x) { return x.trim(); })[0] || '').replace(/\D+/g, ' ');
  var onFirst = unique.filter(function (c) { return (' ' + first + ' ').replace(/(\d{3}) (\d{3}) (\d{4})/g, '$1$2$3').indexOf(c.replace(/-/g, '')) > -1; });
  return onFirst.length === 1 ? onFirst[0] : '';
}
function formatCid_(cid) {
  var d = String(cid || '').replace(/\D/g, '');
  return d.length === 10 ? d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6) : '';
}

// They approved the account audit with the site audit added.
function wantsSiteAudit_(l) {
  return readRows_(TAB.proposals, HEAD.proposals).some(function (p) {
    return p.lead_id === l.id && p.kind === 'account_audit' && p.status === 'approved' && /\bsite_audit\b/.test(String(p.addons || ''));
  });
}

function startAccountAudit_(l, cid, via, siteAudit) {
  cid = formatCid_(cid);
  if (!cid) return false;
  updateLead_(l, { ads_customer_id: cid, attention: '' });
  var open = readRows_(TAB.exports, HEAD.exports).filter(function (e) { return e.lead_id === l.id && e.status === 'requested'; })[0];
  if (open) updateRow_(TAB.exports, HEAD.exports, open, { customer_id: cid, updated: new Date() });
  else appendRow_(TAB.exports, HEAD.exports, { id: newId_('X'), lead_id: l.id, customer_id: cid, requested: new Date(), status: 'requested',
    updated: new Date(), detail: 'Waiting for them to accept the link', site: siteAudit === undefined ? (wantsSiteAudit_(l) ? 'yes' : 'no') : siteAudit ? 'yes' : 'no' });
  logEvent_(l.id, l.email, 'account_audit_requested', cid + ' (' + via + ')');
  var mgr = setting_('ADS_MANAGER_ID') || 'your manager account';
  ownerMail_('Send a link request: ' + l.business + ' (' + cid + ')',
    (via === 'reply' ? l.business + ' replied with their Google Ads customer ID: ' + cid + '.\n\n' : 'Account audit started for ' + l.business + ' (' + cid + ').\n\n') +
    'The one step for you: in Google Ads, open your manager account (' + mgr + ') > Accounts > the blue + > Link existing account > enter ' + cid +
    ' > Send request.\n\nThey approve it under Admin > Access and security > Managers' + (via === 'reply' ? ' (they\'ve been told it\'s coming)' : '') +
    '. Within an hour of that, the export script reads the account and the report comes to you to check.' +
    (via === 'reply' ? '\n\nIf ' + cid + ' isn\'t their customer ID, use Ledge > Run an account audit with the right one.' : ''));
  if (via === 'reply') safeSend_(findLead_('id', l.id), 'access_ack');
  return true;
}

// Ledge menu > Run an account audit: start one by hand, for a lead or anyone else.
function runAccountAudit() {
  ensureSchema_();
  var ui = SpreadsheetApp.getUi();
  var ask = function (q) { var r = ui.prompt('Account audit', q, ui.ButtonSet.OK_CANCEL); return r.getSelectedButton() === ui.Button.OK ? r.getResponseText().trim() : null; };
  var email = ask('Their email address');
  if (!email) return;
  var cid = formatCid_(ask('Their 10-digit Google Ads customer ID, for example 123-456-7890') || '');
  if (!cid) { ui.alert('That doesn\'t look like a 10-digit customer ID.'); return; }
  var site = ask('Include the site audit? yes or no');
  if (site === null) return;
  var lead = findLead_('email', email.toLowerCase());
  if (!lead) {
    var business = ask('Business name');
    if (!business) return;
    var website = ask('Website') || '';
    appendRow_(TAB.leads, HEAD.leads, { id: newId_('L'), created: new Date(), source: 'manual', status: 'audit_access', business: business, website: website,
      email: email.toLowerCase(), first_name: '', segment: 'running_ads', touches: 0, last_reply_at: 0, consent_basis: 'Existing business relationship (account audit)' });
    lead = findLead_('email', email.toLowerCase());
  } else if (['won', 'audit_access'].indexOf(lead.status) === -1) {
    updateLead_(lead, { status: 'audit_access' });
  }
  startAccountAudit_(lead, cid, 'menu', yes_(site) || wantsSiteAudit_(lead));
  ui.alert('Started. Check your email for the link request step.');
}

/* ── the site audit: the same report, plus the website ── */
var SITE_SECTIONS = ['First look on a phone', 'Speed', 'Calls, forms, and booking', 'Service and area pages', 'Reasons to trust you', 'Tracking on the site'];

// Before a report with a site audit is written: the home page scan, and Google's PageSpeed test (phone) on the home page
// and the page ads send the most clicks to. Two reports a run; PageSpeed takes 10 to 30 seconds a page.
function gatherSiteChecks_() {
  var started = Date.now(), done = 0;
  readRows_(TAB.exports, HEAD.exports).filter(function (e) { return e.status === 'report_queued' && yes_(e.site) && !e.site_json; }).forEach(function (e) {
    if (done >= 2 || Date.now() - started > 150000) return;
    var l = findLead_('id', e.lead_id) || {}, data = readExport_(e) || {};
    var home = siteUrlOf_(l.website) || '', site = { home: home, errors: [], pages: [] };
    if (home) {
      try {
        var scan = scanSite_(UrlFetchApp.fetch(home, { muteHttpExceptions: true, followRedirects: true }));
        delete scan.text;
        site.scan = scan;
      } catch (err) { site.errors.push('home page: ' + String(err && err.message || err).slice(0, 120)); }
    }
    var top = ((data.landing_pages || [])[0] || {}).url || '';
    [home, top].filter(function (u, i, all) { return u && all.indexOf(u) === i; }).forEach(function (u) {
      var ps = pagespeed_(u);
      if (ps.error) site.errors.push('PageSpeed for ' + u + ': ' + ps.error);
      else site.pages.push(ps);
    });
    updateRow_(TAB.exports, HEAD.exports, e, { site_json: JSON.stringify(site), updated: new Date() });
    done++;
  });
}

function pagespeed_(url) {
  var key = prop_('PAGESPEED_API_KEY');
  try {
    var r = UrlFetchApp.fetch('https://www.googleapis.com/pagespeedonline/v5/runPagespeed?strategy=mobile&category=performance&category=seo&category=accessibility&url=' + encodeURIComponent(url) +
      (key ? '&key=' + encodeURIComponent(key) : ''), { muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) return { error: 'HTTP ' + r.getResponseCode() + (r.getResponseCode() === 429 ? ' (add a PAGESPEED_API_KEY)' : '') };
    var j = JSON.parse(r.getContentText()), lh = j.lighthouseResult || {}, au = lh.audits || {};
    var shown = function (k) { return (au[k] || {}).displayValue || ''; };
    var field = (j.loadingExperience || {}).metrics || {};
    var lcpField = field.LARGEST_CONTENTFUL_PAINT_MS || null;
    var cats = lh.categories || {};
    var score = function (c) { return cats[c] && cats[c].score != null ? Math.round(cats[c].score * 100) : null; };
    // The SEO and accessibility checks it failed, in Google's words (Claude puts them in plain ones).
    var failed = function (c) {
      return ((cats[c] || {}).auditRefs || []).filter(function (a) { return a.weight > 0 && au[a.id] && au[a.id].score === 0; })
        .map(function (a) { return String(au[a.id].title || a.id).replace(/`/g, '').slice(0, 120); }).slice(0, 8);
    };
    return {
      seo: score('seo'), accessibility: score('accessibility'), seo_failed: failed('seo'), accessibility_failed: failed('accessibility'),
      url: url, score: lh.categories && lh.categories.performance && lh.categories.performance.score != null ? Math.round(lh.categories.performance.score * 100) : null,
      lcp: shown('largest-contentful-paint'), fcp: shown('first-contentful-paint'), tbt: shown('total-blocking-time'), cls: shown('cumulative-layout-shift'),
      field_lcp: lcpField ? (lcpField.percentile / 1000).toFixed(1) + ' s (' + String(lcpField.category || '').toLowerCase() + ')' : ''
    };
  } catch (err) { return { error: String(err && err.message || err).slice(0, 120) }; }
}

function siteText_(site) {
  if (!site) return '';
  var L = ['', 'SITE AUDIT: included. They paid for the site audit too, so the report also covers their website (see the instructions for site_sections).'];
  var s = site.scan;
  if (!site.home) L.push('Website: none on file. Use the landing pages from the account data.');
  else if (!s || !s.ok) L.push('Home page ' + site.home + ' did not load' + (s && s.status ? ' (HTTP ' + s.status + ')' : '') + '.');
  else L.push('Home page ' + site.home + ': built on ' + (s.platform || 'a platform we could not identify') + '. Google Ads tag: ' + (s.ads_tag || 'none visible') +
    '. Google Tag Manager: ' + (s.gtm || 'no') + '. Google Analytics 4: ' + (s.ga4 ? 'yes' : 'none visible') + '. Call tracking: ' + (s.call_tracking || 'none seen') +
    '. Tap-to-call links: ' + s.tel_links + '. Forms: ' + s.forms + '. Online booking: ' + (s.booking || 'none seen') + '. Mentions 24/7 or emergency: ' + (s.emergency ? 'yes' : 'no') + '.');
  (site.pages || []).forEach(function (p) {
    L.push('Google PageSpeed on a phone, ' + p.url + ': performance ' + (p.score != null ? p.score + '/100' : 'unknown') + ', largest content shows at ' + (p.lcp || '?') +
      ', first content at ' + (p.fcp || '?') + ', blocking time ' + (p.tbt || '?') + ', layout shift ' + (p.cls || '?') +
      (p.field_lcp ? '. Real visitors (Chrome data): largest content at ' + p.field_lcp : '') + '.' +
      (p.seo != null ? ' Search basics (SEO) ' + p.seo + '/100' + ((p.seo_failed || []).length ? ', failed: ' + p.seo_failed.join('; ') : '') + '.' : '') +
      (p.accessibility != null ? ' Accessibility ' + p.accessibility + '/100' + ((p.accessibility_failed || []).length ? ', failed: ' + p.accessibility_failed.join('; ') : '') + '.' : ''));
  });
  if ((site.errors || []).length) L.push('Site checks that could not run: ' + site.errors.join('; ') + '.');
  return L.join('\n');
}

function adsQueue_() {
  var rows = readRows_(TAB.exports, HEAD.exports).filter(function (e) { return e.status === 'requested'; });
  rows.forEach(function (e) {
    if (e.kind === 'monthly') {
      if (Date.now() - new Date(e.requested).getTime() <= 7 * 864e5) return;
      updateRow_(TAB.exports, HEAD.exports, e, { status: 'expired', updated: new Date(), detail: 'Not linked for a week' });
      var c = findLead_('id', e.lead_id) || {};
      ownerMail_('Monthly report stalled: ' + (c.business || e.customer_id), 'The export script couldn\'t read ' + e.customer_id + ' for the ' + monthName_(e.month) +
        ' report: the account isn\'t linked to the manager account any more. Once it\'s linked again, tell Claude in the Ledge project and it can be rerun.');
      return;
    }
    if (Date.now() - new Date(e.requested).getTime() <= 21 * 864e5) return;
    updateRow_(TAB.exports, HEAD.exports, e, { status: 'expired', updated: new Date(), detail: 'The link was never accepted' });
    var l = findLead_('id', e.lead_id) || {};
    ownerMail_('Account audit stalled: ' + (l.business || e.customer_id), 'The link to ' + e.customer_id + ' still wasn\'t accepted after three weeks, so the export ' +
      'stopped trying. Once they accept it, start it again with Ledge > Run an account audit.');
  });
  return { ok: true, requests: rows.filter(function (e) { return e.status === 'requested'; }).map(function (e) {
    if (e.kind !== 'monthly') return { id: e.id, customer_id: e.customer_id };
    var r = monthRange_(e.month);
    return { id: e.id, customer_id: e.customer_id, kind: 'monthly', start: r.start, end: r.end };
  }) };
}

function handleAdsExport_(b) {
  var e = b.request_id ? findRow_(TAB.exports, HEAD.exports, 'id', b.request_id) : null;
  if (!e) return { ok: false, error: 'unknown_request' };
  if (e.status !== 'requested') return { ok: true, duplicate: true };
  if (b.status === 'not_linked') {
    updateRow_(TAB.exports, HEAD.exports, e, { updated: new Date(), detail: 'Waiting for them to accept the link (last checked ' + fmt_(new Date()) + ')' });
    return { ok: true };
  }
  var l = findLead_('id', e.lead_id) || {};
  if (b.status !== 'ok' || !b.data) {
    updateRow_(TAB.exports, HEAD.exports, e, { status: 'error', updated: new Date(), detail: 'Export failed: ' + String(b.detail || '').slice(0, 300) });
    ownerMail_('Account audit export failed: ' + (l.business || e.customer_id), 'The export script couldn\'t read ' + e.customer_id + ': ' + (b.detail || 'no detail') +
      '\n\nOnce it\'s sorted, start it again with Ledge > Run an account audit.');
    return { ok: true };
  }
  if (e.kind === 'monthly') return monthlyExport_(e, l, b.data);
  var json = packExport_(b.data);
  var f = accountFacts_(b.data);
  var fields = { status: 'report_queued', updated: new Date(),
    detail: 'Read ' + b.data.start + ' to ' + b.data.end + ': $' + money_(f.cost) + ' spent, ' + f.conversions + ' conversions' + (f.errors.length ? ' (' + f.errors.length + ' parts unreadable)' : '') };
  for (var i = 0; i < 8; i++) fields['d' + (i + 1)] = json.slice(i * 45000, (i + 1) * 45000);
  updateRow_(TAB.exports, HEAD.exports, e, fields);
  queueJob_('account_report', e.lead_id, '');
  logEvent_(e.lead_id, l.email || '', 'ads_export', fields.detail);
  return { ok: true };
}

// Fits the export into eight cells, trimming the longest lists if it has to.
function packExport_(data) {
  var json = JSON.stringify(data);
  var caps = [[150, 100, 100], [80, 60, 50], [40, 30, 20]];
  for (var i = 0; json.length > 8 * 45000 && i < caps.length; i++) {
    data.search_terms = (data.search_terms || []).slice(0, caps[i][0]);
    data.keywords = (data.keywords || []).slice(0, caps[i][1]);
    data.ads = (data.ads || []).slice(0, caps[i][2]);
    json = JSON.stringify(data);
  }
  return json;
}
function readExport_(e) {
  var s = '';
  for (var i = 1; i <= 8; i++) s += String(e['d' + i] || '');
  try { return JSON.parse(s); } catch (err) { return null; }
}
// The account audit's export (monthly exports are kept apart).
function latestExport_(leadId) {
  return readRows_(TAB.exports, HEAD.exports).filter(function (e) { return e.lead_id === leadId && e.kind !== 'monthly'; }).pop() || null;
}

// The numbers the report stands on, worked out here so Claude never has to do arithmetic.
function accountFacts_(d, trade, siteHint) {
  d = d || {};
  var sum = function (rows, k) { return (rows || []).reduce(function (s, r) { return s + Number(r[k] || 0); }, 0); };
  var r2 = function (x) { return Math.round(x * 100) / 100; };
  var pct = function (x) { return x == null || x === '' ? null : Math.round(Number(x) * 100); };
  var camps = d.campaigns || [];
  var live = camps.filter(function (c) { return c.status === 'ENABLED'; });
  var f = { currency: d.currency || 'CAD', start: d.start || '', end: d.end || '', days: d.days || 90, read_at: d.read_at || '', errors: d.errors || [] };
  f.cost = r2(sum(camps, 'cost')); f.clicks = sum(camps, 'clicks'); f.impressions = sum(camps, 'impressions'); f.conversions = r2(sum(camps, 'conversions'));
  f.cpa = f.conversions ? r2(f.cost / f.conversions) : null;
  f.monthly = r2(Number(((d.last30 || [])[0] || {}).cost || 0));
  var terms = d.search_terms || [];
  f.term_cost = r2(sum(terms, 'cost'));
  var zero = terms.filter(function (t) { return !Number(t.conversions) && Number(t.cost) > 0; }).sort(function (a, b) { return b.cost - a.cost; });
  f.wasted = r2(sum(zero, 'cost'));
  f.wasted_share = f.term_cost ? Math.round(f.wasted / f.term_cost * 100) : null;
  f.wasted_top = zero.slice(0, 12).map(function (t) { return { term: t.term, cost: t.cost, clicks: t.clicks, campaign: t.campaign }; });
  f.converting_top = terms.filter(function (t) { return Number(t.conversions) > 0; }).sort(function (a, b) { return b.conversions - a.conversions; })
    .slice(0, 8).map(function (t) { return { term: t.term, cost: t.cost, conversions: t.conversions }; });
  var acts = d.conversion_actions || [];
  var primary = acts.filter(function (a) { return a.primary; });
  f.primary_actions = primary.map(function (a) { return a.name + ' (' + String(a.category || '').toLowerCase().replace(/_/g, ' ') + ')'; });
  f.other_actions = acts.filter(function (a) { return !a.primary; }).map(function (a) { return a.name; });
  // Counted means it's in "conversions", the number Google bids toward. Set up but not counted shows separately.
  var isCall = function (a) { return /CALL/.test(String(a.type)) || /PHONE_CALL/.test(String(a.category)); };
  var isForm = function (a) { return /SUBMIT_LEAD_FORM|CONTACT|BOOK_APPOINTMENT|REQUEST_QUOTE|QUALIFIED_LEAD|IMPORTED_LEAD/.test(String(a.category)); };
  f.tracks_calls = primary.some(isCall); f.tracks_forms = primary.some(isForm);
  f.calls_set_up = acts.some(isCall); f.forms_set_up = acts.some(isForm);
  f.page_view_only = primary.length > 0 && primary.every(function (a) { return /PAGE_VIEW|DEFAULT/.test(String(a.category)); });
  f.auto_tagging = !!((d.account || [])[0] || {}).auto_tagging;
  f.conversions_by_action = (d.conversions_by_action || []).filter(function (c) { return c.all_conversions > 0; }).slice(0, 10);
  f.presence_or_interest = live.filter(function (c) { return c.location_option === 'PRESENCE_OR_INTEREST'; }).map(function (c) { return c.name; });
  f.partners = live.filter(function (c) { return c.type === 'SEARCH' && (c.search_partners || c.display); })
    .map(function (c) { return c.name + (c.display ? ' (Display Network)' : ' (search partners)'); });
  var seen = {};
  var place = function (p) { return String(p || '').replace(/,(?=\S)/g, ', ').replace(/, Canada$/, ''); };
  f.locations = (d.locations || []).filter(function (x) { return !x.negative; }).map(function (x) {
    return x.place ? place(x.place) : x.radius ? x.radius + ' around ' + (x.near || 'an address') : x.geo;
  }).filter(function (x) { if (!x || seen[x]) return false; seen[x] = true; return true; }).slice(0, 15);
  f.geo_top = (d.geo || []).slice(0, 10).map(function (g) { return { place: place(g.place || g.geo), cost: g.cost, conversions: g.conversions }; });
  var search = live.filter(function (c) { return c.type === 'SEARCH' && c.impressions > 0; });
  var den = sum(search, 'impressions');
  var w = function (k) { return den ? Math.round(search.reduce(function (s, c) { return s + Number(c[k] || 0) * c.impressions; }, 0) / den * 100) : null; };
  f.impression_share = w('impression_share'); f.lost_to_budget = w('lost_to_budget'); f.lost_to_rank = w('lost_to_rank');
  var kws = d.keywords || [];
  var kwCost = sum(kws, 'cost');
  f.broad_share = kwCost ? Math.round(sum(kws.filter(function (k) { return k.match === 'BROAD'; }), 'cost') / kwCost * 100) : null;
  f.low_quality = kws.filter(function (k) { return k.quality && k.quality <= 4 && k.cost > 0; }).slice(0, 8).map(function (k) { return k.text + ' (' + k.quality + '/10)'; });
  f.negatives = Number(d.negatives || 0) + sum(d.negative_lists, 'count');
  var types = {};
  (d.campaign_assets || []).forEach(function (a) { types[a.type] = true; });
  (d.account_assets || []).forEach(function (t) { types[t] = true; });
  (d.asset_sets || []).concat(d.campaign_asset_sets || []).forEach(function (t) { if (/LOCATION/.test(String(t))) types.LOCATION = true; });
  f.assets = Object.keys(types);
  f.missing_assets = ['CALL', 'SITELINK', 'CALLOUT', 'LOCATION'].filter(function (t) { return !types[t]; });
  var ads = d.ads || [];
  f.ads = ads.length;
  f.weak_ads = ads.filter(function (a) { return a.strength === 'POOR' || a.strength === 'AVERAGE'; }).length;
  f.landing_pages = (d.landing_pages || []).slice(0, 8).map(function (p) {
    return { url: p.url, clicks: p.clicks, conversions: p.conversions, speed: p.speed_score, mobile: p.mobile_friendly == null ? null : Math.round(p.mobile_friendly * 100) };
  });
  f.has_schedule = (d.schedule || []).length > 0;
  var night = (d.hours || []).filter(function (h) { return h.hour >= 21 || h.hour < 6; });
  f.night_cost = r2(sum(night, 'cost')); f.night_conversions = r2(sum(night, 'conversions'));
  var dev = d.devices || [];
  var devCost = sum(dev, 'cost');
  f.mobile_share = devCost ? Math.round(sum(dev.filter(function (x) { return x.device === 'MOBILE'; }), 'cost') / devCost * 100) : null;
  f.calls = d.calls || { total: 0, missed: 0, average_seconds: 0 };
  // Real enquiries: calls and forms the account recorded, counted in "conversions" or not. Page views aren't enquiries.
  var byName = {};
  acts.forEach(function (a) { byName[a.name] = a; });
  var leads = (d.conversions_by_action || []).reduce(function (n, c) {
    var a = byName[c.name];
    return a && (isCall(a) || isForm(a)) ? n + Number(c.all_conversions || 0) : n;
  }, 0);
  f.leads = r2(leads);
  f.leads_month = Math.round(leads * 30 / (f.days || 90));
  f.cost_per_lead = leads ? r2(f.cost / leads) : null;
  var jv = jobValueFor_(trade, siteHint), rates = valueRates_();
  if (jv && f.leads_month && rates.book) {
    var jobs = Math.round(f.leads_month * rates.book / 100);
    var wastedMonth = f.wasted * 30 / (f.days || 90);
    var extra = f.cost_per_lead ? Math.round(wastedMonth / f.cost_per_lead) : 0;
    f.value = { work: jv[1], job: jv[2][0], job_low: jv[2][1], job_high: jv[2][2], big: jv[3] ? jv[3][0] : '', big_low: jv[3] ? jv[3][1] : 0,
      big_high: jv[3] ? jv[3][2] : 0, book: rates.book, leads_month: f.leads_month, jobs: jobs, low: jobs * jv[2][1], high: jobs * jv[2][2],
      spend: f.monthly, wasted_month: Math.round(wastedMonth / 10) * 10, extra_leads: extra };
  } else f.value = null;
  f.campaigns = camps.slice(0, 12).map(function (c) {
    return { name: c.name, type: String(c.type || '').toLowerCase().replace(/_/g, ' '), status: c.status, bidding: String(c.bidding || '').toLowerCase().replace(/_/g, ' '),
      daily_budget: c.daily_budget, cost: c.cost, clicks: c.clicks, conversions: c.conversions, cpa: c.conversions ? r2(c.cost / c.conversions) : null,
      lost_to_budget: pct(c.lost_to_budget), lost_to_rank: pct(c.lost_to_rank) };
  });
  return f;
}

function dollars_(n) { n = Number(n || 0); return '$' + (Math.abs(n) >= 100 ? money_(n) : cents_(n)); }

// The facts as plain text for the report request.
function factsText_(f) {
  var L = [], list = function (a) { return a && a.length ? a.join('; ') : 'none'; };
  L.push('ACCOUNT DATA, read from their Google Ads account (' + f.currency + '), ' + f.start + ' to ' + f.end + ' (' + f.days + ' days). Every number here was worked out for you; use them as given.');
  L.push('Spend ' + dollars_(f.cost) + ', ' + f.clicks + ' clicks, ' + f.impressions + ' impressions, ' + f.conversions + ' conversions' +
    (f.cpa != null ? ', ' + dollars_(f.cpa) + ' per conversion' : '') + '. Last 30 days: ' + dollars_(f.monthly) + '.');
  L.push('Campaigns: ' + (f.campaigns.length ? f.campaigns.map(function (c) {
    return c.name + ' (' + c.type + ', ' + c.status.toLowerCase() + ', bidding: ' + c.bidding + (c.daily_budget ? ', budget ' + dollars_(c.daily_budget) + '/day' : '') + '): ' +
      dollars_(c.cost) + ', ' + c.clicks + ' clicks, ' + c.conversions + ' conversions' + (c.lost_to_budget != null ? ', ' + c.lost_to_budget + '% of searches missed for budget' : '') +
      (c.lost_to_rank != null ? ', ' + c.lost_to_rank + '% missed for rank' : '');
  }).join(' | ') : 'none with spend'));
  L.push('Search campaigns overall: showed for ' + (f.impression_share != null ? f.impression_share + '%' : 'unknown') + ' of eligible searches; ' +
    (f.lost_to_budget != null ? f.lost_to_budget + '% missed because the budget ran out; ' : '') + (f.lost_to_rank != null ? f.lost_to_rank + '% missed on ad rank.' : ''));
  L.push('Search terms: ' + dollars_(f.term_cost) + ' spent on the search terms listed. ' + dollars_(f.wasted) + (f.wasted_share != null ? ' (' + f.wasted_share + '%)' : '') +
    ' went to searches with no conversions. Top ones: ' + list(f.wasted_top.map(function (t) { return '"' + t.term + '" ' + dollars_(t.cost) + ', ' + t.clicks + ' clicks'; })) + '.');
  L.push('Searches that did convert: ' + list(f.converting_top.map(function (t) { return '"' + t.term + '" ' + t.conversions + ' conversions for ' + dollars_(t.cost); })) + '.');
  L.push('Keywords: ' + (f.broad_share != null ? f.broad_share + '% of keyword spend is on broad match. ' : '') + 'Low quality scores: ' + list(f.low_quality) +
    '. Negative keywords: ' + f.negatives + '.');
  L.push('Conversion tracking: counted in "conversions": ' + list(f.primary_actions) + '. Also set up but not counted: ' + list(f.other_actions) +
    '. Phone calls counted: ' + (f.tracks_calls ? 'yes' : f.calls_set_up ? 'no (set up but not counted)' : 'no') +
    '. Forms or bookings counted: ' + (f.tracks_forms ? 'yes' : f.forms_set_up ? 'no (set up but not counted)' : 'no') +
    '. Only page views counted: ' + (f.page_view_only ? 'yes' : 'no') + '. Auto-tagging: ' + (f.auto_tagging ? 'on' : 'off') + '.');
  L.push('Conversions by action: ' + list(f.conversions_by_action.map(function (c) { return c.name + ' ' + c.conversions + ' counted (' + c.all_conversions + ' in all)'; })) + '.');
  L.push('Calls from ads: ' + (f.calls.total || 0) + ' (' + (f.calls.missed || 0) + ' missed' + (f.calls.average_seconds ? ', average ' + f.calls.average_seconds + ' seconds' : '') + ').');
  L.push('Locations targeted: ' + list(f.locations) + '. Campaigns set to "presence or interest" (shows ads to people outside the area who search about it): ' +
    list(f.presence_or_interest) + '. Where the spend went: ' + list(f.geo_top.map(function (g) { return g.place + ' ' + dollars_(g.cost) + ', ' + g.conversions + ' conversions'; })) + '.');
  L.push('Ad schedule set: ' + (f.has_schedule ? 'yes' : 'no, ads run around the clock') + '. Spend 9 pm to 6 am: ' + dollars_(f.night_cost) + ' for ' + f.night_conversions +
    ' conversions. Mobile share of spend: ' + (f.mobile_share != null ? f.mobile_share + '%' : 'unknown') + '.');
  L.push('Search campaigns also on search partners or the Display Network: ' + list(f.partners) + '.');
  L.push('Ads: ' + f.ads + ' active, ' + f.weak_ads + ' rated poor or average by Google. Extras (assets) in use: ' + list(f.assets.map(function (a) { return a.toLowerCase().replace(/_/g, ' '); })) +
    '. Missing: ' + list(f.missing_assets.map(function (a) { return a.toLowerCase(); })) + '.');
  L.push('Landing pages: ' + list(f.landing_pages.map(function (p) {
    return p.url + ' (' + p.clicks + ' clicks, ' + p.conversions + ' conversions' + (p.speed != null ? ', speed score ' + p.speed + '/10' : '') +
      (p.mobile != null ? ', ' + p.mobile + '% mobile-friendly clicks' : '') + ')';
  })) + '.');
  L.push('Calls and forms recorded (real enquiries, counted in conversions or not): ' + f.leads + ' in ' + f.days + ' days, about ' + f.leads_month + ' a month' +
    (f.cost_per_lead != null ? ', about ' + dollars_(f.cost_per_lead) + ' each.' : '.'));
  if (f.value) {
    var rv = reportValueWords_(f.value);
    L.push('VALUE ESTIMATE, worked out by our tools. Use these figures exactly as written, always as an estimate, never as a promise: ' + rv.line + ' ' + rv.extra +
      ' (Footnote shown on the page: ' + rv.footnote + ')');
  } else L.push('VALUE ESTIMATE: none (no calls or forms recorded, or no typical price for this kind of business). Don\'t give dollar figures for what the ads bring in.');
  if (f.errors.length) L.push('Parts that could not be read: ' + f.errors.join('; ') + '.');
  return L.join('\n');
}

// The account report's estimate in words. Empty strings when there isn't one.
function reportValueWords_(v) {
  var out = { headline: '', line: '', extra: '', footnote: '' };
  if (!v) return out;
  out.headline = '$' + money_(v.low) + ' to $' + money_(v.high) + ' a month';
  out.line = 'Your ads bring in about ' + v.leads_month + ' calls and forms a month. If ' + inN_(v.book) + ' turn into booked jobs at $' + money_(v.job_low) +
    ' to $' + money_(v.job_high) + ' for ' + v.job + ', that\'s about ' + (v.jobs === 1 ? 'one job' : word_(v.jobs) + ' jobs') + ', or ' + out.headline + ' in work, for ' +
    dollars_(v.spend) + ' in ad spend over the last 30 days.' +
    (v.big ? ' Each ' + v.big.replace(/^(a|an) /, '') + ' on top of that is $' + money_(v.big_low) + ' to $' + money_(v.big_high) + '.' : '');
  if (v.extra_leads >= 1) out.extra = 'Moving the roughly $' + money_(v.wasted_month) + ' a month that goes to searches with no conversions onto searches that work could bring about ' +
    (v.extra_leads === 1 ? 'one more call or form' : word_(v.extra_leads) + ' more calls and forms') + ' a month, at what each one costs you now.';
  out.footnote = 'An estimate, not a promise: the calls and forms your account recorded, times ' + inN_(v.book) +
    ' booked, at typical Calgary-area prices for this work. Your own booking rate and prices will change it.';
  return out;
}

// For businesses whose trade doesn't say what they do: the website and the free audit's kind of work.
function reportHint_(lead) {
  var spec = auditSpecOf_(lead) || {};
  return (lead.website || '') + ' ' + ((spec.value || {}).work || '');
}

function freeAuditText_(aspec) {
  if (!aspec || !aspec.checks) return '';
  var L = ['', 'FROM THE FREE AUDIT (public searches, ' + (aspec.checked || aspec.date || '') + '):'];
  (aspec.searches || []).forEach(function (s) {
    var y = s.you || {};
    L.push('"' + s.keyword + '": Local Services Ads ' + (y.lsa ? '#' + y.lsa : (s.lsa || []).length ? 'not in it' : 'none shown') +
      ', ads ' + (y.ads ? '#' + y.ads : 'not shown') + ', map ' + (y.map_pack ? '#' + y.map_pack : y.maps ? '#' + y.maps + ' in Maps' : 'not in the top results') + '.');
  });
  aspec.checks.forEach(function (c, i) { L.push(CHECK_NAMES[i] + ': ' + c.note); });
  return L.join('\n');
}

function reportParams_(job) {
  var lead = findLead_('id', job.lead_id);
  var ex = lead ? latestExport_(lead.id) : null;
  var data = ex ? readExport_(ex) : null;
  if (!lead || !data) return null;
  var site = null;
  if (yes_(ex.site)) { try { site = JSON.parse(ex.site_json || '{}'); } catch (err) { site = {}; } }
  return {
    model: setting_('MODEL') || 'claude-opus-5-5', max_tokens: site ? 10000 : 6000, system: PROMPT_ACCOUNT_REPORT,
    tools: [{ type: 'web_fetch_20250910', name: 'web_fetch', max_uses: site ? 8 : 3, max_content_tokens: 12000 }],
    messages: [{ role: 'user', content:
      'Today is ' + Utilities.formatDate(new Date(), tz_(), 'EEEE, MMMM d, yyyy') + '. Write the Google Ads account audit report for this business.\n\n' +
      'Business: ' + (lead.business || 'unknown') + '\nWebsite: ' + (siteUrlOf_(lead.website) || 'not given') + '\nKind of business: ' + (lead.trade || 'local service business') +
      '\nTown: ' + (lead.area || 'Alberta') + '\n' + (lead.owner_says ? 'What the owner told us: ' + lead.owner_says + '\n' : '') +
      (lead.notes ? 'Notes: ' + String(lead.notes).slice(-600) + '\n' : '') + '\n' + factsText_(accountFacts_(data, lead.trade, reportHint_(lead))) +
      freeAuditText_(auditSpecOf_(lead)) + siteText_(site) + (site ? '' : '\n\nSITE AUDIT: not included. Leave site_sections out.') }]
  };
}

function applyAccountReport_(job, a) {
  var l = findLead_('id', job.lead_id);
  if (!l) return 'lead gone';
  var ex = latestExport_(l.id), data = ex ? readExport_(ex) : null;
  if (!data) return 'no export';
  var okSections = Array.isArray(a.sections) && a.sections.length === REPORT_SECTIONS.length &&
    a.sections.every(function (c) { return c && ['good', 'gap', 'unknown'].indexOf(c.status) > -1 && c.note; });
  var site = null;
  if (yes_(ex.site)) { try { site = JSON.parse(ex.site_json || '{}'); } catch (err) { site = {}; } }
  var okActions = Array.isArray(a.actions) && a.actions.length >= 3 && a.actions.length <= (site ? 8 : 6) &&
    a.actions.every(function (m) { return m && m.title && m.why && REPORT_OFFERS.indexOf(m.offer) > -1; });
  var okSite = !site || (Array.isArray(a.site_sections) && a.site_sections.length === SITE_SECTIONS.length &&
    a.site_sections.every(function (c) { return c && ['good', 'gap', 'unknown'].indexOf(c.status) > -1 && c.note; }) && a.site_note);
  if (!okSections || !okActions || !okSite || !a.summary || !a.top_finding) return 'retry';
  var spec = reportSpec_(l.business, data, a, new Date(), { trade: l.trade, website: reportHint_(l), site: site });
  var slug = slugify_(l.business) + '-ads-audit-' + rand_(6);
  appendRow_(TAB.reports, HEAD.reports, { slug: slug, lead_id: l.id, export_id: ex.id, created: new Date(), status: 'draft', spec_json: JSON.stringify(spec) });
  updateRow_(TAB.exports, HEAD.exports, ex, { status: 'report_ready', report_slug: slug, updated: new Date() });
  updateLead_(l, { report_slug: slug });
  requestReportReview_(findLead_('id', l.id), spec);
  return 'report ' + slug;
}

// What the management proposal would be, from what they spend now.
// The stored report: the numbers from the export (worked out here) and the words from Claude. No Sheet access, so build.py renders the sample through it.
function reportSpec_(business, data, a, now, o) {
  o = o || {};
  var f = accountFacts_(data, o.trade, o.website);
  var site = o.site ? {
    platform: (o.site.scan || {}).platform || '', note: String(a.site_note || ''),
    sections: (a.site_sections || []).map(function (c) { return { status: c.status, note: String(c.note) }; }),
    speed: (o.site.pages || []).map(function (p) { return { url: p.url, score: p.score, lcp: p.lcp }; })
  } : null;
  var day = function (s) { return s ? Utilities.formatDate(new Date(s + 'T12:00:00'), tz_(), 'MMM d, yyyy') : ''; };
  return {
    v: 1, business: business, date: Utilities.formatDate(now, tz_(), 'MMM d, yyyy'), period: day(f.start) + ' to ' + day(f.end), days: f.days,
    currency: f.currency, totals: { cost: f.cost, clicks: f.clicks, conversions: f.conversions, cpa: f.cpa, monthly: f.monthly },
    wasted: { total: f.wasted, share: f.wasted_share, top: f.wasted_top.slice(0, 10) }, campaigns: f.campaigns, value: f.value, site: site,
    summary: String(a.summary), top_finding: String(a.top_finding).replace(/\.$/, '') + '.',
    sections: a.sections.map(function (c) { return { status: c.status, note: String(c.note) }; }),
    actions: a.actions.map(function (m) { return { title: String(m.title), why: String(m.why), offer: m.offer, when: String(m.when || '') }; }),
    first_month: (Array.isArray(a.first_month) ? a.first_month : []).map(String).filter(String).slice(0, 5)
  };
}

function planFromSpend_(lead, monthly) {
  var budget = plannedBudget_(String(Math.round(Number(monthly || 0) / 50) * 50));
  var fee = feeFor_(budget), setup = Math.round(fee * Number(setting_('SETUP_MONTHS') || 1));
  return { budget: budget, fee: fee, setup: setup, credit: Math.min(auditCredit_(lead), setup) };
}

function requestReportReview_(l, spec) {
  var plan = planFromSpend_(l, spec.totals.monthly);
  ownerMail_('Check this account audit: ' + l.business,
    'The Google Ads account audit for ' + l.business + ' is ready.\n\n' +
    'Report: ' + siteUrl_() + '/report/' + l.report_slug + '\n' +
    'Biggest finding: ' + spec.top_finding + '\n' +
    'Spend: ' + dollars_(spec.totals.cost) + ' over ' + spec.days + ' days, ' + dollars_(spec.totals.monthly) + ' in the last 30. ' +
    (spec.wasted.total ? dollars_(spec.wasted.total) + ' went to searches that brought nothing.' : '') + '\n\n' +
    'Approving sends them the report and a management proposal priced on their spend: setup $' + money_(plan.setup) +
    (plan.credit ? ' less the $' + money_(plan.credit) + ' audit credit' : '') + ', then $' + money_(plan.fee) + '/month on a $' + money_(plan.budget) + '/month budget.\n\n' +
    'Looks right, send both: ' + ownerLink_('approve_report', l) + '\n' +
    'Write the report again: ' + ownerLink_('rebuild_report', l) + '\n\n' +
    'Want something different in it? Tell Claude in the Ledge project.');
  logEvent_(l.id, l.email, 'review_requested', 'account report');
}

function ownerApproveReport_(l) {
  var rep = l.report_slug ? findRow_(TAB.reports, HEAD.reports, 'slug', l.report_slug) : null;
  if (!rep) return { title: 'No report yet', message: 'There\'s no account audit report for ' + (l.business || l.email) + ' yet.' };
  if (rep.status === 'sent') return { title: 'Already sent', message: 'This report went to ' + l.business + ' already.' };
  var spec = JSON.parse(rep.spec_json);
  updateLead_(l, { budget: String(planFromSpend_(l, spec.totals.monthly).budget) });
  queueProposal_(findLead_('id', l.id), 'account report', 'management', true);
  l = findLead_('id', l.id);
  var prop = findRow_(TAB.proposals, HEAD.proposals, 'slug', l.proposal_slug);
  updateRow_(TAB.proposals, HEAD.proposals, prop, { status: 'sent', sent_at: new Date() });
  sendLeadEmail_(l, 'account_report');
  updateLead_(findLead_('id', l.id), { status: 'proposal_sent', touches: 1, next_touch: addBusinessDays_(new Date(), 3) });
  updateRow_(TAB.reports, HEAD.reports, rep, { status: 'sent' });
  var ex = findRow_(TAB.exports, HEAD.exports, 'report_slug', rep.slug);
  if (ex) updateRow_(TAB.exports, HEAD.exports, ex, { status: 'sent', updated: new Date() });
  logEvent_(l.id, l.email, 'report_sent', rep.slug);
  return { title: 'Sent', message: l.business + ' has the report and the management proposal.' };
}

function ownerRebuildReport_(l) {
  var ex = latestExport_(l.id);
  if (!ex || !ex.d1) return { title: 'Nothing to rebuild', message: 'There\'s no export for ' + (l.business || l.email) + ' yet.' };
  updateRow_(TAB.exports, HEAD.exports, ex, { status: 'report_queued', updated: new Date() });
  queueJob_('account_report', l.id, '');
  logEvent_(l.id, l.email, 'rebuild', 'account report');
  return { title: 'Rewriting', message: 'A fresh report for ' + l.business + ' will come back for review in an hour or two.' };
}

function renderReport_(slug) {
  var row = findRow_(TAB.reports, HEAD.reports, 'slug', slug);
  if (!row) return null;
  var lead = findLead_('id', row.lead_id) || {};
  var mspec = JSON.parse(row.spec_json);
  if (mspec.type === 'monthly') return renderMonthlySpec_(mspec, { sender_name: setting_('SENDER_NAME') || 'Logan' });
  return renderReportSpec_(JSON.parse(row.spec_json), {
    sender_name: setting_('SENDER_NAME') || 'Logan', proposal_url: row.status === 'sent' && lead.proposal_slug ? siteUrl_() + '/proposal/' + lead.proposal_slug : '',
    credit: (function () {
      var prop = row.status === 'sent' && lead.proposal_slug ? findRow_(TAB.proposals, HEAD.proposals, 'slug', lead.proposal_slug) : null;
      return prop ? Number(prop.credit || 0) : 0;
    })(),
    addon_prices: addonPrices_()
  });
}

// Report spec in, HTML out, with no Sheet access (build.py renders the sample through this).
function renderReportSpec_(spec, o) {
  var t = spec.totals || {}, w = spec.wasted || { top: [] };
  var tile = function (label, value, note) {
    return '      <div class="tile"><span class="tile-label">' + esc_(label) + '</span><span class="tile-value">' + esc_(value) + '</span>' +
      (note ? '<span class="tile-note">' + esc_(note) + '</span>' : '') + '</div>';
  };
  var offerTag = function (offer) {
    if (offer === 'management') return 'Part of monthly management';
    if (offer === 'free') return 'Quick win, included in monthly management';
    return offerTag_(offer, o);
  };
  var rv = reportValueWords_(spec.value);
  var site = spec.site;
  var platformLine = site ? (site.platform ? 'Your site runs on ' + site.platform + '. ' : '') + site.note : '';
  return fill_(REPORT_TEMPLATE, {
    business: spec.business, period: spec.period, date: spec.date, summary: spec.summary, sender_name: o.sender_name,
    currency_note: spec.currency && spec.currency !== 'CAD' ? 'Amounts in ' + spec.currency + '.' : '',
    wasted_line: w.total ? dollars_(w.total) + (w.share != null ? ', or ' + w.share + '% of what the listed searches cost,' : '') +
      ' went to searches with no conversions in these ' + (spec.days || 90) + ' days.' : '',
    proposal_url: o.proposal_url || '#',
    doc_label: site ? 'Google Ads and site audit' : 'Google Ads audit', hero_label: site ? 'Google Ads and site audit for' : 'Google Ads audit for',
    value_headline: rv.headline, value_line: rv.line, value_extra: rv.extra, value_footnote: rv.footnote, site_note: platformLine,
    ask_line: 'The plan is priced on what you spend now' + (o.credit ? ', and the $' + money_(o.credit) + ' for this audit comes off setup.' : '.')
  }, {
    tiles: [tile('Spent', dollars_(t.cost), (spec.days || 90) + ' days'), tile('Clicks', money_(t.clicks)), tile('Conversions', String(t.conversions || 0), 'as the account counts them'),
      tile('Each conversion cost', t.cpa != null ? dollars_(t.cpa) : 'n/a'), tile('Last 30 days', dollars_(t.monthly), 'spent')].join('\n'),
    wasted_rows: (w.top || []).map(function (x) {
      return '          <tr><td>' + esc_(x.term) + '</td><td>' + esc_(dollars_(x.cost)) + '</td><td>' + esc_(money_(x.clicks)) + '</td></tr>';
    }).join('\n'),
    wasted_hidden: (w.top || []).length ? '' : 'hidden',
    checks: (spec.sections || []).map(function (c, i) {
      return '      <li><b>' + esc_(REPORT_SECTIONS[i]) + '</b><span class="pill ' + esc_(c.status) + '">' + esc_(PILL[c.status] || PILL.unknown) +
        '</span><span class="note">' + esc_(c.note) + '</span></li>';
    }).join('\n'),
    campaign_rows: (spec.campaigns || []).map(function (c) {
      var sub = [c.type && c.name.toLowerCase().indexOf(c.type) === -1 ? c.type : '', c.status && c.status !== 'ENABLED' ? c.status.toLowerCase() : ''].filter(String).join(', ');
      return '          <tr><td>' + esc_(c.name) + (sub ? '<small>' + esc_(sub) + '</small>' : '') + '</td><td>' +
        esc_(dollars_(c.cost)) + '</td><td class="clicks">' + esc_(money_(c.clicks)) + '</td><td class="conv">' + esc_(String(c.conversions)) + '</td><td>' + esc_(c.cpa != null ? dollars_(c.cpa) : '') +
        '</td><td>' + esc_(c.lost_to_budget != null ? c.lost_to_budget + '%' : '') + '</td></tr>';
    }).join('\n'),
    campaigns_hidden: (spec.campaigns || []).length ? '' : 'hidden',
    actions: (spec.actions || []).map(function (m) {
      return '      <li><h3>' + esc_(m.title) + '</h3><p>' + esc_(m.why) + '</p><p class="offer ' + esc_(m.offer) + '">' + esc_(offerTag(m.offer)) +
        (m.when ? '<span class="when">' + esc_(m.when) + '</span>' : '') + '</p></li>';
    }).join('\n'),
    first_month: (spec.first_month || []).map(function (x) { return '        <li>' + esc_(x) + '</li>'; }).join('\n'),
    first_month_hidden: (spec.first_month || []).length ? '' : 'hidden',
    value_hidden: spec.value ? '' : 'hidden',
    site_hidden: site ? '' : 'hidden',
    site_checks: site ? site.sections.map(function (c, i) {
      return '      <li><b>' + esc_(SITE_SECTIONS[i]) + '</b><span class="pill ' + esc_(c.status) + '">' + esc_(PILL[c.status] || PILL.unknown) +
        '</span><span class="note">' + esc_(c.note) + '</span></li>';
    }).join('\n') : '',
    site_speed: site ? (site.speed || []).filter(function (p) { return p.score != null; }).map(function (p) {
      return '        <li><span class="score ' + (p.score >= 90 ? 'good' : p.score >= 50 ? 'unknown' : 'gap') + '">' + esc_(String(p.score)) + '</span><span>' +
        esc_(String(p.url).replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') || 'Home page') + (p.lcp ? '<small>Main content shows at ' + esc_(p.lcp) + ' on a phone</small>' : '') + '</span></li>';
    }).join('\n') : '',
    ask_hidden: o.proposal_url ? '' : 'hidden'
  });
}

/* ══════════════════════════ pages ══════════════════════════ */

function renderAudit_(slug) {
  var row = findRow_(TAB.audits, HEAD.audits, 'slug', slug);
  if (!row) return null;
  var spec = JSON.parse(row.spec_json);
  var lead = findLead_('id', row.lead_id) || { id: '' };
  return renderAuditSpec_(spec, {
    lead_id: lead.id, token: lead.id ? token_(lead.id) : '', sender_name: setting_('SENDER_NAME') || 'Logan',
    price_audit: setting_('PRICE_ACCOUNT_AUDIT') || 500, price_full: setting_('PRICE_FULL_AUDIT') || 0, credit_days: setting_('ACCOUNT_AUDIT_CREDIT_DAYS'),
    gst: yes_(setting_('GST_REGISTERED')), addon_prices: addonPrices_()
  });
}

// An audit that found things to fix on the website as well as in the ads: the account and site audit fits.
function siteFindings_(spec) {
  if (!spec || spec.stages) return false;
  var c = spec.checks || [];
  return (c[5] && c[5].status === 'gap') || (spec.moves || []).some(function (m) { return m.offer === 'page_fixes' || m.offer === 'landing_page'; });
}

// Spec and options in, HTML out, with no Sheet access. build.py renders the sample audits through this too (tools/render.js).
// Audits built before the switch to Local Search Audits (spec.stages) still render, with the general ask.
function renderAuditSpec_(spec, o) {
  var legacy = !!spec.stages;
  var rows = legacy ? spec.stages.map(function (s, i) { return { name: STAGE_NAMES[i], status: s.status, note: s.note }; })
    : spec.checks.map(function (c, i) { return { name: CHECK_NAMES[i], status: c.status, note: c.note }; });
  var moves = (legacy ? spec.fixes : spec.moves) || [];
  var seg = legacy ? 'unknown' : spec.segment;
  var searches = spec.searches || [];
  var price = money_(o.price_audit), credit = Number(o.credit_days || 0);
  var vw = valueWords_(spec.value);
  var full = Number(o.price_full || 0) > Number(o.price_audit || 0) && siteFindings_(spec);
  return fill_(AUDIT_TEMPLATE, {
    business: spec.business, area: spec.area, date: spec.date, summary: spec.summary,
    lead_id: o.lead_id, token: o.token, sender_name: o.sender_name,
    checks_title: legacy ? 'Where leads get missed' : 'Six checks',
    moves_title: legacy ? 'What we\'d fix first' : 'What we\'d do first',
    keyword_1: searches[0] ? searches[0].keyword : 'your main service', town: spec.area,
    price_audit: price, gst_note: o.gst ? ' + GST' : '',
    credit_line: !credit ? '' : full ? 'Either way, $' + price + ' comes off setup or monthly management if you go ahead within ' + credit + ' days.'
      : 'If you go ahead with setup or monthly management within ' + credit + ' days, the $' + price + ' comes off.',
    price_full: money_(o.price_full || 0),
    estimates_line: spec.market && spec.market.total ? 'Google estimates about ' + money_(spec.market.total) + ' searches a month in ' + spec.market.where +
      ' across ' + spec.market.count + ' searches about this work, including ' +
      oxford_(spec.market.top.slice(0, 4).map(function (t) { return '\u201c' + t[0] + '\u201d (' + money_(t[1]) + ')'; })) + '.' :
      (spec.estimates || []).length > 1 ? 'Google estimates about ' + money_(spec.estimate_total) + ' searches a month in ' + spec.estimate_where +
      ' across searches like these: ' + oxford_(spec.estimates.map(function (e) { return '\u201c' + e.keyword + '\u201d (' + money_(e.volume) + ')'; })) + '.' : '',
    value_headline: vw.headline, value_line: vw.line, value_big: vw.big_line, value_footnote: vw.footnote,
    method_note: 'Searches were run ' + (spec.checked || spec.date) + ' the way a phone in ' + spec.area +
      ' would see them. Results shift through the day, so treat the positions as a snapshot.'
  }, {
    searches: searches.map(searchCard_).join('\n'),
    searches_hidden: searches.length ? '' : 'hidden',
    estimates_hidden: (spec.market && spec.market.total) || ((spec.estimates || []).length > 1 && spec.estimate_total) ? '' : 'hidden',
    value_hidden: spec.value ? '' : 'hidden',
    value_headline_hidden: vw.headline ? '' : 'hidden',
    checks: rows.map(function (r) {
      return '      <li><b>' + esc_(r.name) + '</b><span class="pill ' + esc_(r.status) + '">' + esc_(PILL[r.status] || PILL.unknown) +
        '</span><span class="note">' + esc_(r.note) + '</span></li>';
    }).join('\n'),
    moves: moves.map(function (m) {
      return '      <li><h3>' + esc_(m.title) + '</h3><p>' + esc_(m.why) + '</p>' +
        (m.effort ? '<p class="effort">What it takes: ' + esc_(m.effort) + '</p>' : '') +
        (OFFERS[m.offer] ? '<p class="offer ' + esc_(m.offer) + '">' + esc_(offerTag_(m.offer, o)) + '</p>' : '') + '</li>';
    }).join('\n'),
    later: (spec.later || []).map(function (t) { return '        <li>' + esc_(t) + '</li>'; }).join('\n'),
    later_hidden: (spec.later || []).length ? '' : 'hidden',
    ask_audit_hidden: seg === 'running_ads' ? '' : 'hidden',
    ask_setup_hidden: seg === 'no_ads' ? '' : 'hidden',
    ask_general_hidden: seg === 'running_ads' || seg === 'no_ads' ? 'hidden' : '',
    credit_hidden: credit ? '' : 'hidden',
    pick_hidden: full ? '' : 'hidden',
    single_price_hidden: full ? 'hidden' : '',
    method_hidden: searches.length ? '' : 'hidden',
    sources: (spec.sources || []).map(function (s) {
      return '      <li><a href="' + esc_(s.url) + '" rel="nofollow noopener" target="_blank">' + esc_(s.label || s.url) + '</a></li>';
    }).join('\n')
  });
}

function offerTag_(offer, o) {
  var price = (o.addon_prices || {})[offer];
  if (offer === 'page_fixes') return OFFERS.page_fixes + (price ? ', $' + money_(price) : '') + '. We make the changes, or guide whoever runs your site';
  if (offer === 'landing_page') return OFFERS.landing_page + (price ? ', $' + money_(price) : '');
  if (offer === 'site_support') return OFFERS.site_support + (price ? ', $' + money_(price) + ' an hour' : '');
  return OFFERS[offer];
}

// One search, top of the page to the bottom, with the shop marked wherever it showed up.
function searchCard_(s) {
  var y = s.you || {};
  var biz = function (e) {
    var meta = [];
    if (e.rating != null) meta.push(String(e.rating) + ' stars');
    if (e.reviews != null) meta.push(money_(e.reviews) + (e.reviews === 1 ? ' review' : ' reviews'));
    if (e.paid) meta.push('sponsored');
    return '<li class="biz' + (e.you ? ' you' : '') + '"><span class="r">' + esc_(e.rank || '') + '</span><span class="b"><span class="n">' + esc_(e.name) + '</span>' +
      (meta.length ? '<span class="m">' + esc_(meta.join(', ')) + '</span>' : '') + (e.you ? '<span class="tag">You</span>' : '') + '</span></li>';
  };
  var slot = function (label, arr, empty) {
    arr = arr || [];
    var shown = arr.slice(0, 3), mine = arr.filter(function (e) { return e.you; })[0];
    if (mine && shown.indexOf(mine) === -1) shown.push(mine);
    var more = arr.length - shown.length;
    return '        <div class="slot"><dt>' + label + '</dt><dd>' + (shown.length ? '<ul>' + shown.map(biz).join('') + '</ul>' +
      (more > 0 ? '<span class="more">and ' + more + ' more</span>' : '') : '<span class="none">' + empty + '</span>') + '</dd></div>';
  };
  var hits = [], miss = [];
  if (y.lsa) hits.push('#' + y.lsa + ' in Local Services Ads'); else if ((s.lsa || []).length) miss.push('Local Services Ads');
  if (y.ads) hits.push('#' + y.ads + ' in the ads'); else miss.push('the ads');
  if (y.map_pack) hits.push('#' + y.map_pack + ' on the map');
  else if (y.maps) hits.push('#' + y.maps + ' in Google Maps');
  else if (s.maps_total) miss.push('the first ' + s.maps_total + ' map results');
  if (y.organic) hits.push('#' + y.organic + ' in the websites'); else miss.push('the top 20 websites');
  var line = hits.length ? 'You showed up ' + oxford_(hits) + '.' + (miss.length ? ' Not in ' + oxford_(miss, 'or') + '.' : '')
    : 'You didn\'t show up in ' + oxford_(miss, 'or') + '.';
  var meta = 'On a phone in ' + s.where + (s.volume >= 20 ? '<span>About ' + money_(s.volume) + ' searches a month in ' + esc_(s.volume_where || s.where) + '</span>' : '');
  return '    <li class="search">\n' +
    '      <p class="q"><span class="q-text">“' + esc_(s.keyword) + '”</span><span class="q-meta">' + meta.replace(/^On a phone in [^<]*/, function (t) { return esc_(t); }) + '</span></p>\n' +
    '      <dl class="serp">\n' +
    slot('Local Services Ads', s.lsa, 'None on this search') + '\n' +
    slot('Sponsored', s.ads, 'No ads on this search') + '\n' +
    slot('Map', s.map_pack, 'No map on this search') + '\n' +
    slot('Websites', s.organic, 'None') + '\n' +
    '      </dl>\n' +
    '      <p class="you-line">' + esc_(line) + '</p>\n' +
    '    </li>';
}

function oxford_(items, word) {
  word = word || 'and';
  if (items.length < 2) return items.join('');
  if (items.length === 2) return items[0] + ' ' + word + ' ' + items[1];
  return items.slice(0, -1).join(', ') + ', ' + word + ' ' + items[items.length - 1];
}

function renderProposal_(slug) {
  var p = findRow_(TAB.proposals, HEAD.proposals, 'slug', slug);
  if (!p) return null;
  var lead = findLead_('id', p.lead_id);
  if (!lead) return null;
  var audit = lead.audit_slug ? findRow_(TAB.audits, HEAD.audits, 'slug', lead.audit_slug) : null;
  return renderProposalSpec_(p, lead, audit ? JSON.parse(audit.spec_json) : {}, {
    token: token_(lead.id), sender_name: setting_('SENDER_NAME') || 'Logan', payment_line: paymentLine_(),
    tiers: tiers_(), min_fee: Number(setting_('MGMT_MIN_FEE') || 0), credit_days: Number(setting_('ACCOUNT_AUDIT_CREDIT_DAYS') || 0),
    addon_prices: addonPrices_()
  });
}

// What each offer covers. Used on the proposal page, in the kickoff email, and on the invoice note.
var OFFER_COPY = {
  account_audit: {
    label: 'Google Ads audit', item: 'Google Ads audit', approve: 'Approve and book the audit', scope_title: 'What we\'ll look at',
    lede: 'A look inside your Google Ads account, so you know where the budget goes and what to change first. It picks up where your free audit left off.',
    scope: [
      ['Where the budget goes', 'Which searches you pay for, which ones bring calls, and which ones don\'t.'],
      ['Why your ads miss some searches', 'Budget, bids, schedule, and locations, checked against the searches in your free audit.'],
      ['Call and form tracking', 'Whether calls and forms from your ads are counted, so Google can aim for more of them.'],
      ['Where clicks land', 'The pages your ads send people to, as a phone sees them.'],
      ['Local Services Ads', 'Whether your business qualifies for the Google Verified listings at the top, and how they\'d sit next to your search ads.']
    ],
    included: ['A written report in plain words, with what to change first', 'A 30-minute call to walk through it', '{credit_line}'],
    excluded: ['Changes to the account. We only look, and nothing changes without your OK', 'Website changes', 'Your ad spend, which you keep paying Google directly'],
    timing: ['You approve access from our Google Ads manager account. You\'ll get the steps; it takes a couple of minutes, nothing changes without your OK, and you can remove our access at any time.',
      'We look at the last 90 days.', 'The report usually follows within a week of getting access, and we book the call when it\'s ready.'],
    kickoff: '1. {payment_step}\n2. Reply with your 10-digit Google Ads customer ID (top right when you\'re signed in to Google Ads). I\'ll send a link request from ' +
      'our manager account ({manager_id}), and you approve it under Admin > Access and security > Managers. We only look; nothing changes without your OK.\n' +
      '3. Once it\'s linked, you\'ll get the written audit within about a week, and we\'ll go through it together on a short call.'
  },
  starting_plan: {
    label: 'Starting plan', item: 'Google Ads setup', approve: 'Approve the starting plan', scope_title: 'What we\'ll set up',
    lede: 'A Google Ads setup aimed at the searches in your free audit, with a budget you set. The account is yours and you pay Google directly.',
    scope: [
      ['A Google Ads account in your name', 'You own it and pay Google directly. We work in it as your manager, and you can remove us at any time.'],
      ['Search ads for {keyword} and related searches', 'Aimed at the people most likely to call: the right services, the right areas around {town}, and the hours you can answer.'],
      ['Call and form tracking', 'So you and Google both see which searches bring calls.'],
      ['Local Services Ads', 'If your business qualifies, we take you through Google\'s screening and verification for the Google Verified listings at the top.'],
      ['Your Google Business Profile', 'Categories, services, and hours checked, so the map and the ads tell the same story.']
    ],
    included: ['Everything set up and tested before anything goes live', 'Weekly checks in the first month', 'A short report each month: calls, what they cost, and what we changed',
      'Month to month once it\'s live, with no long-term contract.'],
    excluded: ['Your ad budget, paid to Google directly', 'Local Services Ads leads, also paid to Google directly', 'Website rebuilds. We\'ll tell you if a page needs work'],
    timing: ['Ads usually go live two to three weeks after your go-ahead.', 'You add a card to the Google Ads account in your name. We\'ll walk you through it.',
      'You answer a few questions by email: your main services, the areas you cover, your hours, and who answers the phone.'],
    kickoff: '1. {payment_step}\n2. I\'ll set up your Google Ads account through our manager account ({manager_id}) and invite you as its admin, so it\'s yours. ' +
      'You add your card, and I\'ll send a short list of questions: your main services, the areas you cover, your hours, and who answers the phone.\n' +
      '3. Ads usually go live two to three weeks from now. You\'ll see everything before it goes live.'
  },
  management: {
    label: 'Monthly management', item: 'Google Ads management setup', approve: 'Approve and get started', scope_title: 'What we\'ll do',
    lede: 'We take over your Google Ads, fix what\'s holding them back, and keep improving them month to month.',
    scope: [
      ['Clean up the account', 'Stop paying for searches that don\'t bring work, and tighten locations, hours, and budgets.'],
      ['Call and form tracking', 'Count every call and form from your ads, so Google can aim for more of them.'],
      ['Ads and pages', 'Ads written for your main services, sending people to a page that makes it easy to call.'],
      ['Local Services Ads', 'If your business qualifies and isn\'t running them yet, we take you through Google\'s screening and verification.'],
      ['A monthly report', 'Calls, what they cost, and what we changed, in plain words.']
    ],
    included: ['The cleanup and tracking in the first two weeks', 'Ongoing changes as the season and your schedule change', 'A short report each month',
      'Month to month, with no long-term contract.'],
    excluded: ['Your ad budget, paid to Google directly', 'Website rebuilds. We\'ll tell you if a page needs work'],
    timing: ['{access_timing}', 'Cleanup and tracking happen in the first two weeks, and nothing big changes without a heads-up.'],
    kickoff: '1. {payment_step}\n2. {access_step}\n' +
      '3. Cleanup and tracking happen in the first two weeks, and you\'ll get a short report every month after that.'
  },
  legacy: {
    label: 'Fixed price', item: 'Lead handling setup', approve: 'Approve and get started', scope_title: 'What we\'ll set up',
    lede: 'Here\'s what we\'d set up for you, based on your audit. Happy to walk through any of it on a call.',
    scope: [], included: ['Each fix set up and tested in the tools you already use', 'A short note showing what changed', '30 days of tweaks after everything is live'],
    excluded: ['Website rebuilds or redesigns', 'Switching phone systems or job software'],
    timing: ['The first fix is usually live within a week of your go-ahead, and all three within two to three weeks.', 'You add us as a user on the tools involved.'],
    kickoff: '1. {payment_step}\n2. I\'ll send the steps to add me as a user on the tools involved. It only takes a few minutes.\n' +
      '3. The first fix will be live within about a week, and all three within two to three weeks.'
  }
};

// The prices the home page shows. The site asks for these about once an hour, so changing prices on the
// Settings tab changes the site too (build.py bakes the defaults in as a fallback).
function pricingSummary_() {
  var t = tiers_(), min = Number(setting_('MGMT_MIN_FEE') || 0);
  return {
    ok: true, price_audit: money_(setting_('PRICE_ACCOUNT_AUDIT') || 500), credit_days: String(Number(setting_('ACCOUNT_AUDIT_CREDIT_DAYS') || 0)),
    min_fee: money_(t[0].pct ? Math.max(Math.round(Math.max(t[0].from, 1) * t[0].pct / 100), min) : t[0].fee),
    min_budget: money_(Math.max(Number(setting_('MIN_AD_BUDGET') || 0), t[0].from)),
    cap_line: feeCapLine_(t, min),
    price_page_fixes: money_(addonPrice_('page_fixes')), price_landing_page: money_(addonPrice_('landing_page')),
    price_full: money_(setting_('PRICE_FULL_AUDIT') || 0), price_site_support: money_(setting_('PRICE_SITE_SUPPORT') || 0),
    setup_months: (function (n) { return n === 1 ? 'one month' : n === 2 ? 'two months' : n + ' months'; })(Number(setting_('SETUP_MONTHS') || 1)),
    rows: t.map(function (x, i) { return tierLabels_(x, i, t, min); })
  };
}

function tierLabels_(t, i, tiers, minFee) {
  var next = tiers[i + 1];
  var range = !next ? '$' + money_(t.from) + ' and up' : t.from === 0 ? 'Under $' + money_(next.from) : '$' + money_(t.from) + ' to $' + money_(next.from - 1);
  return [range, t.pct ? t.pct + '% of the budget' : '$' + money_(t.fee)];
}

// "Our fee is never more than half of your ad budget", worked out from the tiers so it stays true if they change.
// The bottom tier is measured at the smallest budget a plan is built on. Left out when the fee can pass 60%.
function feeCapLine_(tiers, minFee) {
  var worst = 0, minBudget = Number(setting_('MIN_AD_BUDGET') || 0);
  tiers.forEach(function (t) { worst = Math.max(worst, t.pct ? t.pct / 100 : t.fee / Math.max(t.from, minBudget, 1)); });
  if (!worst || worst > 0.6) return '';
  return worst <= 0.5 ? 'Our fee is never more than half of your ad budget.' : 'Our fee is never more than ' + Math.ceil(worst * 100) + '% of your ad budget.';
}

// Proposal row, lead, and audit spec in, HTML out, with no Sheet access (build.py renders the samples through this).
function renderProposalSpec_(p, lead, aspec, o) {
  var kind = OFFER_COPY[p.kind] ? p.kind : 'legacy';
  var c = OFFER_COPY[kind];
  var gst = yes_(p.gst) ? '+ GST' : '';
  var approved = p.status === 'approved';
  var one = Number(p.price_sprint || 0), monthly = Number(p.price_care || 0), spend = Number(p.ad_spend || 0), credit = Number(p.credit || 0);
  var searches = aspec.searches || [];
  var vars = {
    keyword: searches[0] ? '\u201c' + searches[0].keyword + '\u201d' : 'your main services', town: aspec.area || lead.area || 'you',
    credit_line: o.credit_days ? 'If you go ahead with setup or monthly management within ' + o.credit_days + ' days, the $' + money_(one) + ' comes off' : '',
    access_timing: lead.ads_customer_id ? 'We\'re already linked to your Google Ads account from the Google Ads audit, so there\'s nothing to set up for access.'
      : 'You approve a link from our Google Ads manager account. You\'ll get the steps; it takes a couple of minutes, and you can remove it at any time.'
  };
  var fillv = function (t) { return String(t).replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? vars[k] : m; }); };
  var li = function (t) { t = fillv(t); return t ? '      <li>' + esc_(t) + '</li>' : ''; };
  var scope = kind === 'legacy' ? (aspec.fixes || aspec.moves || []).map(function (f) { return [f.title, f.effort || '']; }) : c.scope;
  var row = function (label, amt, small, note, cls) {
    return '      <div class="price-row' + (cls ? ' ' + cls : '') + '"><b>' + esc_(label) + '</b><span class="amt">' + esc_(amt) + ' <small>' + esc_(small) + '</small></span>' +
      (note ? '<p>' + esc_(note) + '</p>' : '') + '</div>';
  };
  var rows = [];
  if (kind === 'account_audit') rows.push(row('Google Ads audit', '$' + money_(one), gst, 'One fixed price.'));
  else if (kind === 'legacy') {
    rows.push(row('Setting up the three fixes', '$' + money_(one), gst, 'One fixed price. No hourly billing, no surprises.'));
    if (monthly) rows.push(row('Optional care plan once it\'s live', '$' + money_(monthly), '/month ' + gst, 'Month to month. Not required.'));
  } else {
    rows.push(row(kind === 'management' ? 'Setup and cleanup' : 'Setup', '$' + money_(one), 'one time ' + gst,
      one === monthly ? 'Setup costs the same as one month of management.' : ''));
    if (credit) rows.push(row('Your Google Ads audit, credited', '\u2212$' + money_(credit), '', 'You approved the Google Ads audit within ' + o.credit_days + ' days, so it comes off setup.', 'credit'));
    rows.push(row('Monthly management', '$' + money_(monthly), '/month ' + gst, kind === 'starting_plan' ? 'Starts the month your ads go live. Month to month.' : 'Month to month.'));
    rows.push(row('Your ad budget', '$' + money_(spend), '/month', 'Paid to Google directly, not to us. You can change it at any time, and the fee follows the table below.', 'quiet'));
  }
  var tiers = o.tiers || [];
  var tierRows = tiers.map(function (t, i) {
    var next = tiers[i + 1], label = tierLabels_(t, i, tiers, o.min_fee);
    var mine = spend >= t.from && (!next || spend < next.from);
    return '            <tr' + (mine ? ' class="yours"' : '') + '><td>' + esc_(label[0]) + '</td><td>' + esc_(label[1]) + '</td></tr>';
  });
  var lowest = tiers[0] || { from: 0, fee: 0 };
  var chosen = String(p.addons || '').split(',').filter(String);
  var offered = kind === 'legacy' ? [] : standingAddons_(kind).concat(suggestedAddons_(aspec));
  chosen.forEach(function (a) { if (ADDONS[a] && offered.indexOf(a) === -1) offered.push(a); });
  offered = offered.filter(function (a, i) { return offered.indexOf(a) === i; });
  var addonPriceText = function (a) {
    var x = ADDONS[a], price = (o.addon_prices || {})[a];
    return x.minus ? '$' + money_(price) + ' more ($' + money_(price + one) + ' with the Google Ads audit) ' + gst : '$' + money_(price) + ' one time ' + gst;
  };
  var addonsHtml = offered.length && !approved ? '        <fieldset class="addons"><legend>Add to this <span>(optional)</span></legend>\n' + offered.map(function (a) {
    return '          <label><input type="checkbox" name="addons" value="' + esc_(a) + '"' + (chosen.indexOf(a) > -1 ? ' checked' : '') + '> <span><b>' +
      esc_(ADDONS[a].item) + ', ' + esc_(addonPriceText(a)) + '</b> ' + esc_(ADDONS[a].blurb) + '</span></label>';
  }).join('\n') + '\n        </fieldset>' : '';
  var withSite = kind === 'account_audit' && chosen.indexOf('site_audit') > -1;
  return fill_(PROPOSAL_TEMPLATE, {
    business: lead.business, doc_label: withSite ? 'Google Ads and site audit' : c.label, lede: c.lede, scope_title: c.scope_title,
    approve_label: withSite ? 'Approve and book the audits' : c.approve,
    date: Utilities.formatDate(new Date(p.created), tz_(), 'MMM d, yyyy'),
    valid_until: Utilities.formatDate(new Date(new Date(p.created).getTime() + 30 * 864e5), tz_(), 'MMM d, yyyy'),
    payment_line: o.payment_line, lead_id: lead.id, token: o.token, sender_name: o.sender_name,
    approved_on: (approved && p.approved_at ? ' on ' + Utilities.formatDate(new Date(p.approved_at), tz_(), 'MMM d') : '') +
      (approved && chosen.length ? ', with ' + oxford_(chosen.map(function (a) { return ADDONS[a] ? ADDONS[a].item.toLowerCase() : a; })) : ''),
    tiers_note: 'Plans start at $' + money_(Math.max(lowest.from, Number(setting_('MIN_AD_BUDGET') || 0))) + ' a month in ad budget, so there\'s enough to learn what works. ' + feeCapLine_(tiers, o.min_fee)
  }, {
    scope: scope.map(function (s) { return '      <li><b>' + esc_(fillv(s[0])) + '</b>' + (s[1] ? '<span>' + esc_(fillv(s[1])) + '</span>' : '') + '</li>'; }).join('\n'),
    included: c.included.map(li).filter(String).join('\n'),
    excluded: c.excluded.map(li).join('\n'),
    timing: c.timing.map(li).join('\n'),
    price_rows: rows.join('\n'),
    addons: addonsHtml,
    tiers: tierRows.join('\n'),
    tiers_hidden: kind === 'starting_plan' || kind === 'management' ? '' : 'hidden',
    approve_hidden: approved ? 'hidden' : '',
    approved_hidden: approved ? '' : 'hidden'
  });
}

function fill_(tpl, text, raw) {
  var out = tpl.replace(/\{\{\{(\w+)\}\}\}/g, function (m, k) { return raw && raw[k] != null ? raw[k] : ''; });
  return out.replace(/\{\{(\w+)\}\}/g, function (m, k) { return text[k] != null ? esc_(text[k]) : (raw && raw[k] != null ? raw[k] : ''); });
}

/* ══════════════════════════ emails ══════════════════════════ */

// Cold emails come in two tracks: cold_N for shops with no Google Ads (or when we can't tell), and cold_ads_N for shops
// already running them. trackKey_ picks the track from the lead's segment; events are logged under cold_N either way.
var EMAILS = {
  inbound_confirm: {
    subject: 'Your Local Search Audit for {business}',
    body: 'Hi {first},\n\nThanks for reaching out. I\'m putting your audit together now and you\'ll have it by end of day {next_day}.\n\n' +
      'If there\'s anything you\'d like me to look at in particular, like a service you want more calls for, just reply to this email.\n\nTalk soon,\n{sign}'
  },
  inbound_audit: {
    body: 'Hi {first},\n\n{personal_para}Here\'s your audit:\n{audit_url}\n\nIt starts with what a customer sees when they search on a phone, then the three things I\'d do first. ' +
      'The biggest finding: {top_finding}\n\n{value_para}If you\'d like a hand, there\'s a short form at the bottom of the page, or just reply "yes".{booking_line}\n\n{sign}'
  },
  inbound_nudge1: {
    body: 'Hi {first},\n\nQuick follow-up on your audit. If you only do one thing, I\'d start here: {fix_1}.\n\n{offer_line}\n\n{sign}'
  },
  inbound_nudge2: {
    body: 'Hi {first},\n\nLast note from me. Your audit will stay up here whenever you want it:\n{audit_url}\n\nAll the best,\n{sign}'
  },
  cold_1: {
    subject: '{business}: {search_hook}',
    body: 'Hi {first},\n\nHope you\'re keeping busy. I\'m {sender}, and I run Ledge Communications here in Alberta. ' +
      'I help local businesses show up when people search for them on Google.\n\n' +
      '{search_line} No cost and nothing to sign up for:\n{audit_url}\n\n' +
      '{value_para}The short version: {top_finding}\n\n' +
      'If you\'d like to see what a small Google Ads budget aimed at those searches would look like, reply "yes" and I\'ll put together a starting plan.{booking_line}\n\nThanks,\n{sign}'
  },
  cold_2: {
    body: 'Hi {first},\n\nFollowing up on the audit I sent. If you only do one thing, I\'d start here: {fix_1}.\n\n' +
      'Happy to set it up for you. Reply "yes" and I\'ll send a starting plan with a fixed price.\n\n{sign}'
  },
  cold_3: {
    body: 'Hi {first},\n\nI\'ll keep this one short. If you want to be in front of the people searching {keyword_q} before things get busier, ' +
      'a starting plan usually takes two to three weeks to set up, and you choose the budget.\n\nReply "yes" and I\'ll send the details.{booking_line}\n\n{sign}'
  },
  cold_4: {
    body: 'Hi {first},\n\nI\'ll leave it here so I\'m not cluttering your inbox. Your audit will stay up if you want to look at it later:\n{audit_url}\n\nAll the best,\n{sign}'
  },
  cold_ads_1: {
    subject: '{business}: {ads_hook}',
    body: 'Hi {first},\n\nHope you\'re keeping busy. I\'m {sender}, and I run Ledge Communications here in Alberta. I manage Google Ads for local businesses.\n\n' +
      '{search_line} It includes where your ads showed up. No cost and nothing to sign up for:\n{audit_url}\n\n' +
      '{value_para}The biggest thing that stood out: {top_finding}\n\n' +
      'If you\'d like me to look inside the account and show you where the budget is going, reply "yes" and I\'ll send the details.{booking_line}\n\nThanks,\n{sign}'
  },
  cold_ads_2: {
    body: 'Hi {first},\n\nFollowing up on the audit I sent. From the outside I can see where your ads show up. From the inside I can see why: ' +
      'which searches you\'re paying for, and what a call costs you.\n\n{audit_price_line}\n\nReply "yes" and I\'ll send how it works.\n\n{sign}'
  },
  cold_ads_3: {
    body: 'Hi {first},\n\nOne more thought on your audit. If you only tackle one thing, I\'d start here: {fix_1}.\n\nReply "yes" and I\'ll send the details.{booking_line}\n\n{sign}'
  },
  cold_ads_4: {
    body: 'Hi {first},\n\nI\'ll leave it here so I\'m not cluttering your inbox. Your audit will stay up if you want to look at it later:\n{audit_url}\n\nAll the best,\n{sign}'
  },
  check_back: {
    body: 'Hi {first},\n\nChecking back like I said I would. Your audit is still up here:\n{audit_url}\n\n' +
      'If now is a better time to look at Google Ads, just reply and I\'ll put together a plan for where you could start.\n\n{sign}'
  },
  positive_ack: {
    body: 'Thanks {first}, appreciate you getting back to me.\n\nI\'ll put together {offer_noun} and send it over by end of day {next_day}.{booking_line}\n\n{sign}'
  },
  quote_ack: {
    fallbackSubject: 'Next steps from Ledge Communications',
    body: 'Hi {first},\n\nGot it. I\'ll send {offer_noun} by end of day {next_day}.\n\n{sign}'
  },
  proposal: {
    fallbackSubject: 'Your plan from Ledge Communications',
    body: 'Hi {first},\n\n{proposal_intro}\n{proposal_url}\n\n' +
      'It covers what\'s included, the price, and what I need from you. If it looks good, you can approve it right on the page. Any questions, just reply here.\n\n{sign}'
  },
  proposal_nudge: {
    body: 'Hi {first},\n\nJust checking whether you had any questions. Happy to adjust the budget or the scope if something doesn\'t fit:\n{proposal_url}\n\n{sign}'
  },
  kickoff: {
    body: 'Hi {first},\n\nThanks, we\'re on. Here\'s what happens next:\n\n{kickoff_steps}\n\nI\'ll keep you posted along the way.\n\n{sign}'
  },
  access_ack: {
    fallbackSubject: 'Your Google Ads audit',
    body: 'Hi {first},\n\nThanks, that\'s all I need. A link request from Ledge Communications ({manager_id}) will show up in your Google Ads account shortly, ' +
      'under Admin > Access and security > Managers. Once you approve it, I\'ll get started, and you\'ll have the audit within about a week.\n\n{sign}'
  },
  link_ack: {
    fallbackSubject: 'Linking your Google Ads account',
    body: 'Hi {first},\n\nThanks, that\'s all I need. A link request from Ledge Communications ({manager_id}) will show up in your Google Ads account shortly, ' +
      'under Admin > Access and security > Managers. Once you approve it, I\'ll get started on the cleanup.\n\n{sign}'
  },
  monthly_report: {
    subject: 'Your {report_month} Google Ads report',
    body: 'Hi {first},\n\nYour {report_month} report is ready:\n{monthly_url}\n\n{monthly_headline}\n\n{monthly_value_para}' +
      'It also covers what we changed and what\'s next. If there\'s anything you\'d like done differently, just reply here.\n\n{sign}'
  },
  account_report: {
    fallbackSubject: 'Your Google Ads audit',
    body: 'Hi {first},\n\nYour Google Ads audit is ready:\n{report_url}\n\nThe short version: {report_finding}\n\n{report_value_para}' +
      'It ends with what I\'d change first. I\'ve also put together a plan for running your ads month to month, priced on what you spend now:\n{proposal_url}\n\n' +
      'Happy to walk through both on a call.{booking_line}\n\n{sign}'
  }
};

function trackKey_(l, key) {
  var ads = key.replace(/^cold_(\d)$/, 'cold_ads_$1');
  return l && l.segment === 'running_ads' && ads !== key && EMAILS[ads] ? ads : key;
}

function auditSpecOf_(l) {
  try {
    var row = l.audit_slug ? findRow_(TAB.audits, HEAD.audits, 'slug', l.audit_slug) : null;
    return row ? JSON.parse(row.spec_json) : {};
  } catch (err) { return {}; }
}

function emailVars_(l) {
  var booking = setting_('BOOKING_URL');
  var pay = setting_('PAYMENT_URL');
  var spec = auditSpecOf_(l);
  var kw = spec.searches && spec.searches[0] ? spec.searches[0].keyword : '';
  var town = spec.area || l.area || '';
  var prop = l.proposal_slug ? findRow_(TAB.proposals, HEAD.proposals, 'slug', l.proposal_slug) : null;
  var kind = prop ? (OFFER_COPY[prop.kind] ? prop.kind : 'legacy') : proposalKind_(l, '');
  var price = money_(setting_('PRICE_ACCOUNT_AUDIT') || 500), credit = Number(setting_('ACCOUNT_AUDIT_CREDIT_DAYS') || 0);
  var paymentStep = fbConnected_() ? 'The invoice comes from FreshBooks within the hour. You can pay it online by card or bank transfer.'
    : pay ? 'You can pay here whenever suits: ' + pay : 'I\'ll send the invoice today.';
  var business = l.business || 'your business';
  return {
    first: l.first_name || 'there',
    business: business,
    audit_url: l.audit_slug ? auditUrl_(l) : '',
    proposal_url: l.proposal_slug ? siteUrl_() + '/proposal/' + l.proposal_slug : '',
    top_finding: l.top_finding || '',
    fix_1: String(l.fix_1 || '').replace(/\.$/, ''),
    sender: setting_('SENDER_NAME') || 'Logan',
    sign: String(setting_('SENDER_NAME') || 'Logan').trim().split(/\s+/)[0],
    next_day: nextBusinessDayName_(),
    booking_line: booking ? ' If a quick call is easier, grab a time here: ' + booking : '',
    keyword_q: kw ? '"' + kw + '"' : 'for what you do' + (town ? ' around ' + town : ''),
    search_hook: kw ? 'who shows up for "' + kw + '"' : 'a quick look at how you show up on Google',
    ads_hook: kw ? 'your ads on "' + kw + '"' : 'a quick look at your Google Ads',
    search_line: kw ? 'I searched "' + kw + '" on a phone in ' + town + ' and put together a one-page look at what came up, and where ' + business + ' sits.'
      : 'I looked at how ' + business + ' shows up on Google and put together a one-page audit.',
    offer_line: l.segment === 'running_ads' ? 'Reply "yes" and I\'ll send the details on the Google Ads audit.' : 'Reply "yes" and I\'ll send a starting plan with a fixed price.',
    offer_noun: { account_audit: 'the details on the Google Ads audit', starting_plan: 'a starting plan with a fixed price',
      management: 'a plan for running your ads month to month', legacy: 'a fixed price for those fixes' }[kind],
    audit_price_line: 'The Google Ads audit is a flat $' + price + (yes_(setting_('GST_REGISTERED')) ? ' + GST' : '') +
      (credit ? ', and it comes off setup or monthly management if you go ahead within ' + credit + ' days.' : '.'),
    proposal_intro: { account_audit: 'Here are the details on the Google Ads audit:', starting_plan: 'Here\'s your starting plan for Google Ads:',
      management: 'Here\'s the plan for running your Google Ads month to month:', legacy: 'Here\'s the fixed price for setting up those fixes:' }[kind],
    kickoff_steps: fillText_(OFFER_COPY[kind].kickoff, { payment_step: paymentStep, manager_id: setting_('ADS_MANAGER_ID') || 'Ledge Communications',
      access_step: l.ads_customer_id ? 'We\'re already linked to your Google Ads account from the audit, so there\'s nothing to do for access.'
        : 'Reply with your 10-digit Google Ads customer ID (top right when you\'re signed in to Google Ads). I\'ll send a link request from ' +
          'our manager account (' + (setting_('ADS_MANAGER_ID') || 'Ledge Communications') + '), and you approve it under Admin > Access and security > Managers.' }) +
      (function () {
        var picked = prop ? String(prop.addons || '').split(',').filter(function (a) { return ADDONS[a]; }) : [];
        var site = picked.filter(function (a) { return a !== 'site_audit'; });
        var steps = [];
        if (picked.indexOf('site_audit') > -1) steps.push('The site audit comes in the same report. I look at your website the way a visitor does, so there\'s nothing to set up for it.');
        if (site.length) steps.push('For the ' + oxford_(site.map(function (a) { return ADDONS[a].item.toLowerCase(); })) +
          ', I\'ll ask for access to your website (or a quick intro to whoever looks after it).');
        return steps.map(function (t, i) { return '\n' + (4 + i) + '. ' + t; }).join('');
      })(),
    payment_step: paymentStep,
    manager_id: setting_('ADS_MANAGER_ID') || '',
    report_url: l.report_slug ? siteUrl_() + '/report/' + l.report_slug : '',
    report_finding: reportSpecOf_(l).top_finding || '',
    report_value_para: (function () {
      var v = reportSpecOf_(l).value;
      return v ? 'Going by the calls and forms your account recorded, your ads bring in roughly $' + money_(v.low) + ' to $' + money_(v.high) +
        ' a month in work. The report shows how that\'s worked out.\n\n' : '';
    })(),
    value_para: (function () { var e = valueWords_(spec.value).email; return e ? e + '\n\n' : ''; })(),
    personal_para: l.personal_line ? String(l.personal_line).trim() + '\n\n' : ''
  };
}

function reportSpecOf_(l) {
  var r = l && l.report_slug ? findRow_(TAB.reports, HEAD.reports, 'slug', l.report_slug) : null;
  try { return r ? JSON.parse(r.spec_json) : {}; } catch (err) { return {}; }
}

function fillText_(s, vars) {
  return String(s).replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? vars[k] : m; });
}

function footer_(l) {
  return '\n\n--\n' + (setting_('SENDER_NAME') || 'Logan') + ' · Ledge Communications\n' +
    (setting_('MAILING_ADDRESS') ? setting_('MAILING_ADDRESS') + ' · ' : '') + 'ledgecommunications.com · ' + myEmail_() + '\n' +
    'Rather not hear from me? Unsubscribe: ' + unsubUrl_(l);
}

function previewEmail_(l, key) {
  var tpl = EMAILS[trackKey_(l, key)], vars = emailVars_(l);
  return (tpl.subject ? 'Subject: ' + fillText_(tpl.subject, vars) + '\n\n' : '') + fillText_(tpl.body, vars);
}

function sendLeadEmail_(l, key, extra) {
  if (!l || !l.email) return;
  var actual = trackKey_(l, key);
  var tpl = EMAILS[actual], vars = emailVars_(l);
  Object.keys(extra || {}).forEach(function (k) { vars[k] = extra[k]; });
  var text = fillText_(tpl.body, vars) + footer_(l);
  var res;
  if (l.thread_id && !tpl.subject) {
    res = gmailSend_(l.email, 'Re: ' + threadSubject_(l.thread_id), text, { threadId: l.thread_id, inReplyTo: l.last_msg_id, unsubUrl: unsubUrl_(l) });
  } else {
    res = gmailSend_(l.email, fillText_(tpl.subject || tpl.fallbackSubject || 'Ledge Communications', vars), text, { unsubUrl: unsubUrl_(l) });
  }
  updateLead_(l, { thread_id: res.threadId, last_msg_id: res.messageId || l.last_msg_id, last_touch: new Date() });
  logEvent_(l.id, l.email, 'sent_' + key, actual !== key ? actual : '');
}

function safeSend_(l, key, extra) {
  try { sendLeadEmail_(l, key, extra); } catch (err) { logEvent_(l && l.id, l && l.email, 'error', 'Email ' + key + ' failed: ' + (err && err.message || err)); }
}

function threadSubject_(threadId) {
  try { return String(GmailApp.getThreadById(threadId).getFirstMessageSubject()).replace(/^(re:\s*)+/i, ''); } catch (err) { return 'Ledge Communications'; }
}

// Sends through the Gmail API so follow-ups land in the same thread for the recipient too.
function gmailSend_(to, subject, text, opts) {
  opts = opts || {};
  var me = myEmail_();
  var name = (setting_('SENDER_NAME') || 'Ledge Communications').replace(/["\r\n]/g, '');
  var boundary = 'ledge' + Utilities.getUuid().replace(/-/g, '');
  var headers = [
    'From: ' + encodeHeader_('"' + name + '"') + ' <' + me + '>',
    'To: ' + to,
    'Subject: ' + encodeHeader_(subject),
    'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="' + boundary + '"'
  ];
  if (opts.inReplyTo) { headers.push('In-Reply-To: ' + opts.inReplyTo); headers.push('References: ' + opts.inReplyTo); }
  if (opts.unsubUrl) {
    headers.push('List-Unsubscribe: <mailto:' + me + '?subject=unsubscribe>, <' + opts.unsubUrl + '>');
    headers.push('List-Unsubscribe-Post: List-Unsubscribe=One-Click');
  }
  var mime = headers.join('\r\n') + '\r\n\r\n' +
    '--' + boundary + '\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n' + b64_(text) + '\r\n' +
    '--' + boundary + '\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n' + b64_(toHtml_(text)) + '\r\n' +
    '--' + boundary + '--';
  var resource = { raw: Utilities.base64EncodeWebSafe(mime, Utilities.Charset.UTF_8) };
  if (opts.threadId) resource.threadId = opts.threadId;
  var sent = Gmail.Users.Messages.send(resource, 'me');
  var mid = '';
  try {
    var meta = Gmail.Users.Messages.get('me', sent.id, { format: 'metadata', metadataHeaders: ['Message-ID'] });
    ((meta.payload && meta.payload.headers) || []).forEach(function (h) { if (String(h.name).toLowerCase() === 'message-id') mid = h.value; });
  } catch (err) {}
  return { threadId: sent.threadId, messageId: mid };
}

function b64_(s) { return Utilities.base64Encode(s, Utilities.Charset.UTF_8).replace(/(.{76})/g, '$1\r\n'); }
function encodeHeader_(s) { return /^[\x20-\x7e]*$/.test(s) ? s : '=?UTF-8?B?' + Utilities.base64Encode(s, Utilities.Charset.UTF_8) + '?='; }

function ownerMail_(subject, text) {
  var to = setting_('OWNER_EMAIL') || myEmail_();
  GmailApp.sendEmail(to, '[Ledge] ' + subject, text, { name: 'Ledge pipeline', htmlBody: toHtml_(text) });
}

/* ── emails to Logan: replies waiting, weekly digest ── */

function sendNeedsYou_() {
  var now = new Date();
  if (Number(Utilities.formatDate(now, tz_(), 'H')) !== 17) return;
  var today = Utilities.formatDate(now, tz_(), 'yyyy-MM-dd');
  if (prop_('LAST_NEEDS_YOU') === today) return;
  props_().setProperty('LAST_NEEDS_YOU', today);
  var items = readRows_(TAB.leads, HEAD.leads).filter(function (l) { return l.attention; });
  if (!items.length) return;
  ownerMail_(items.length + (items.length === 1 ? ' reply needs you' : ' replies need you'),
    'These replies weren\'t a clear yes or no, so they\'re waiting on you. Sequences to these people are paused.\n\n' +
    items.map(function (l) {
      var last = String(l.notes || '').split('\n').filter(function (n) { return /^Reply:/.test(n); }).pop() || '';
      return '• ' + (l.business || l.email) + ' <' + l.email + '>\n  ' + last.slice(0, 260) + '\n' +
        '  Open the thread: https://mail.google.com/mail/?authuser=' + encodeURIComponent(myEmail_()) + '#all/' + l.thread_id + '\n' +
        '  Done with it: ' + ownerLink_('handled', l) + '\n' +
        '  Check back later, one short note on the day: in a month ' + ownerLink_('check_back', l) + '&when=1m' +
        ' · in 3 months ' + ownerLink_('check_back', l) + '&when=3m' + ' · early March ' + ownerLink_('check_back', l) + '&when=march';
    }).join('\n\n'));
}

function sendDigest() {
  ensureSchema_();
  _settings = null;
  var since = new Date(Date.now() - 7 * 864e5);
  var ev = readRows_(TAB.events, HEAD.events).filter(function (e) { return new Date(e.timestamp) >= since; });
  var count = function (name) { return ev.filter(function (e) { return e.event === name; }).length; };
  var leads = readRows_(TAB.leads, HEAD.leads);
  var by = {};
  leads.forEach(function (l) { by[l.status] = (by[l.status] || 0) + 1; });
  var upcoming = leads.filter(function (l) { return l.status === 'booked' && l.booked_at && new Date(l.booked_at) > new Date(); })
    .map(function (l) { return '• ' + fmt_(l.booked_at) + ': ' + (l.business || l.email); });
  var waiting = leads.filter(function (l) { return l.attention; }).length;
  ownerMail_('Weekly: ' + count('won') + ' won, ' + count('quote_requested') + ' asked for a price, ' + count('audit_built') + ' audits',
    'Last 7 days\n' +
    '• New shops found: ' + ev.filter(function (e) { return e.event === 'prospects_found'; }).length + ' searches\n' +
    '• Audits built: ' + count('audit_built') + ', skipped: ' + count('skipped') + '\n' +
    '• Site audit requests: ' + count('inbound_request') + '\n' +
    '• Cold first emails sent: ' + count('sent_cold_1') + ' (today\'s cap ' + (yes_(setting_('COLD_EMAIL_ON')) ? coldCapToday_() : 'cold email is off') + ')\n' +
    '• Audits opened for the first time: ' + count('audit_opened') + '\n' +
    '• Replies: ' + ev.filter(function (e) { return /^reply_/.test(e.event); }).length + '\n' +
    '• Asked for a price: ' + count('quote_requested') + '\n' +
    '• Proposals approved: ' + count('won') + '\n' +
    '• Calls booked: ' + count('booked') + '\n' +
    '• Unsubscribes: ' + count('unsubscribed') + ', not interested: ' + count('not_interested') + ', bounces: ' + count('bounced') + '\n\n' +
    'Engine spend this month: about US$' + monthSpend_().toFixed(2) + ' of US$' + setting_('MONTHLY_ENGINE_BUDGET_USD') + '\n\n' +
    'Coming up\n' + (upcoming.length ? upcoming.join('\n') : '• No calls booked') + '\n\n' +
    'Pipeline now\n' + Object.keys(by).sort().map(function (k) { return '• ' + k + ': ' + by[k]; }).join('\n') +
    (waiting ? '\n\n' + waiting + ' replies are waiting on you.' : '') +
    (count('error') ? '\n\n' + count('error') + ' errors this week. Details are on the Events tab.' : ''));
}

/* ══════════════════════════ do-not-contact ══════════════════════════ */

function stopLead_(l, status, why) {
  updateLead_(l, { status: status, next_touch: '', attention: '' });
  logEvent_(l.id, l.email, status, why || '');
  if (status === 'unsubscribed' || status === 'not_interested' || status === 'bounced') addDnc_(l.email, status);
}

function addDnc_(email, reason) {
  email = String(email || '').toLowerCase().trim();
  if (!email || isDnc_(email)) return;
  appendRow_(TAB.dnc, HEAD.dnc, { email_or_domain: email, added: new Date(), reason: reason || '' });
}

function isDnc_(emailOrDomain) {
  var v = String(emailOrDomain || '').toLowerCase().trim();
  if (!v) return false;
  var domain = v.indexOf('@') > -1 ? v.split('@')[1] : v;
  return readRows_(TAB.dnc, HEAD.dnc).some(function (r) {
    var x = String(r.email_or_domain || '').toLowerCase().trim();
    return x && (x === v || x === domain);
  });
}

function removeFromDnc_(email) {
  var sh = sheet_(TAB.dnc);
  readRows_(TAB.dnc, HEAD.dnc).reverse().forEach(function (r) {
    if (String(r.email_or_domain).toLowerCase() === String(email).toLowerCase()) sh.deleteRow(r._row);
  });
}

/* ══════════════════════════ sheet helpers ══════════════════════════ */

function ensureSheet_(ss, name, headers) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sh.getLastRow() < 1) {
    if (sh.getMaxColumns() < headers.length) sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
    return sh;
  }
  // An older tab: add any new columns on the end, after whatever is already there.
  var width = Math.max(sh.getLastColumn(), 1);
  var current = sh.getRange(1, 1, 1, width).getValues()[0].map(function (h) { return String(h).trim(); });
  var missing = headers.filter(function (h) { return current.indexOf(h) === -1; });
  if (!missing.length) return sh;
  var start = headers.indexOf(missing[0]) + 1;
  var need = start + missing.length - 1;
  if (current.slice(start - 1).some(String)) sh.insertColumnsBefore(start, missing.length); // keep any columns added by hand
  else if (sh.getMaxColumns() < need) sh.insertColumnsAfter(sh.getMaxColumns(), need - sh.getMaxColumns());
  sh.getRange(1, start, 1, missing.length).setValues([missing]).setFontWeight('bold');
  return sh;
}

function sheet_(name) { return SpreadsheetApp.getActive().getSheetByName(name); }

function readRows_(name, headers) {
  var sh = sheet_(name);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, headers.length).getValues().map(function (r, i) {
    var o = { _row: i + 2 };
    headers.forEach(function (h, j) { o[h] = r[j]; });
    return o;
  }).filter(function (o) { return o[headers[0]] !== '' && o[headers[0]] != null; });
}

function findRow_(name, headers, key, value) {
  var rows = readRows_(name, headers);
  for (var i = rows.length - 1; i >= 0; i--) if (String(rows[i][key]).toLowerCase() === String(value).toLowerCase()) return rows[i];
  return null;
}

function findLead_(key, value) { return value ? findRow_(TAB.leads, HEAD.leads, key, value) : null; }

function appendRow_(name, headers, obj) {
  var sh = sheet_(name);
  if (!sh) { ensureSchema_(true); sh = sheet_(name); } // a tab added in a code update, before the Sheet caught up
  sh.appendRow(headers.map(function (h) { return obj[h] != null ? obj[h] : ''; }));
}

function updateRow_(name, headers, row, fields) {
  if (!row || !row._row) return;
  var sh = sheet_(name);
  Object.keys(fields).forEach(function (k) {
    var col = headers.indexOf(k);
    if (col === -1) return;
    sh.getRange(row._row, col + 1).setValue(fields[k]);
    row[k] = fields[k];
  });
}

function updateLead_(l, fields) { updateRow_(TAB.leads, HEAD.leads, l, fields); }

function logEvent_(id, email, event, detail) {
  try { sheet_(TAB.events).appendRow([new Date(), id || '', email || '', event, String(detail || '').slice(0, 1000)]); } catch (err) {}
}

function countEvents_(name, since) {
  return readRows_(TAB.events, HEAD.events).filter(function (e) { return e.event === name && (!since || new Date(e.timestamp) >= since); }).length;
}

function reviewsLeft_(kind) {
  var n = Number(setting_(kind === 'audit' ? 'REVIEW_AUDITS_FIRST' : 'REVIEW_PROPOSALS_FIRST') || 0);
  return Math.max(0, n - countEvents_(kind === 'audit' ? 'audit_approved' : 'proposal_approved'));
}

/* ══════════════════════════ small helpers ══════════════════════════ */

function setting_(key) {
  if (!_settings) {
    _settings = {};
    var sh = sheet_(TAB.settings);
    if (sh && sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function (r) { _settings[String(r[0]).trim()] = String(r[1]).trim(); });
  }
  return _settings[key] != null ? _settings[key] : '';
}

function props_() { return PropertiesService.getScriptProperties(); }
function prop_(k) { return props_().getProperty(k) || ''; }
function tz_() { return Session.getScriptTimeZone() || 'America/Edmonton'; }
function myEmail_() { return String(Session.getEffectiveUser().getEmail()).toLowerCase(); }
function yes_(v) { return /^(yes|true|on|1)$/i.test(String(v || '').trim()); }
function siteUrl_() { return String(setting_('SITE_URL') || 'https://ledgecommunications.com').trim().replace(/\/+$/, ''); }
function auditUrl_(l) { return siteUrl_() + '/audit/' + l.audit_slug; }
function unsubUrl_(l) { return siteUrl_() + '/api/unsubscribe?id=' + encodeURIComponent(l.id) + '&t=' + token_(l.id); }
function ownerLink_(action, l) { return prop_('WEB_APP_URL') + '?action=' + action + '&id=' + encodeURIComponent(l.id) + '&t=' + token_(l.id); }
/* ══════════════════════════ FreshBooks invoices ══════════════════════════ */
// Once connected (Ledge > Connect FreshBooks), each approved proposal gets a FreshBooks invoice within the hour, sent by
// FreshBooks with its pay-online button, and the hourly run watches for the payment. All calls happen inside the hourly
// run (it holds the script lock), because FreshBooks refresh tokens work once each.
var FB_API = 'https://api.freshbooks.com';
function fbConnected_() { return !!(prop_('FRESHBOOKS_TOKENS') && prop_('FRESHBOOKS_ACCOUNT_ID')); }

function connectFreshBooks() {
  ensureSchema_();
  var ui = SpreadsheetApp.getUi();
  if (!prop_('FRESHBOOKS_CLIENT_ID') || !prop_('FRESHBOOKS_CLIENT_SECRET') || !prop_('WEB_APP_URL')) {
    ui.alert('Add FRESHBOOKS_CLIENT_ID and FRESHBOOKS_CLIENT_SECRET to Script Properties first (from your FreshBooks developer app). SETUP.md has the steps.');
    return;
  }
  var state = rand_(24);
  props_().setProperty('FRESHBOOKS_STATE', state);
  var url = 'https://auth.freshbooks.com/oauth/authorize/?response_type=code&client_id=' + encodeURIComponent(prop_('FRESHBOOKS_CLIENT_ID')) +
    '&redirect_uri=' + encodeURIComponent(prop_('WEB_APP_URL')) + '&state=' + state;
  ui.showModalDialog(HtmlService.createHtmlOutput('<p style="font:15px/1.5 sans-serif">Sign in to FreshBooks and allow access. You\'ll land on a page that says "FreshBooks connected".</p>' +
    '<p style="font:15px/1.5 sans-serif"><a href="' + url + '" target="_blank" rel="noopener">Connect FreshBooks</a></p>').setWidth(420).setHeight(160), 'Connect FreshBooks');
}

function freshbooksCallback_(p) {
  if (!prop_('FRESHBOOKS_STATE') || p.state !== prop_('FRESHBOOKS_STATE')) return page_('Link not recognised', 'Start again from Ledge > Connect FreshBooks.');
  var tok = fbTokenRequest_({ grant_type: 'authorization_code', code: p.code });
  if (tok.error) return page_('FreshBooks didn\'t connect', tok.error);
  var me = UrlFetchApp.fetch(FB_API + '/auth/api/v1/users/me', { headers: { Authorization: 'Bearer ' + tok.access_token }, muteHttpExceptions: true });
  var account = '';
  try { account = JSON.parse(me.getContentText()).response.business_memberships[0].business.account_id; } catch (err) {}
  if (!account) return page_('FreshBooks didn\'t connect', 'Signed in, but no FreshBooks business came back. Check that this login owns the Ledge business in FreshBooks.');
  props_().setProperty('FRESHBOOKS_ACCOUNT_ID', String(account));
  props_().setProperty('FRESHBOOKS_SINCE', new Date().toISOString());
  props_().deleteProperty('FRESHBOOKS_STATE');
  logEvent_('', '', 'freshbooks', 'connected, account ' + account);
  return page_('FreshBooks connected', 'From now on, approved proposals get a FreshBooks invoice within the hour. Try Ledge > Send a test invoice to myself.');
}

// Swaps a code or refresh token for a new pair and saves it. FreshBooks refresh tokens work once, so the new one is kept right away.
function fbTokenRequest_(grant) {
  var body = { client_id: prop_('FRESHBOOKS_CLIENT_ID'), client_secret: prop_('FRESHBOOKS_CLIENT_SECRET'), redirect_uri: prop_('WEB_APP_URL') };
  Object.keys(grant).forEach(function (k) { body[k] = grant[k]; });
  var r = UrlFetchApp.fetch(FB_API + '/auth/oauth/token', { method: 'post', contentType: 'application/json', payload: JSON.stringify(body), muteHttpExceptions: true });
  var j = {};
  try { j = JSON.parse(r.getContentText()); } catch (err) {}
  if (r.getResponseCode() !== 200 || !j.access_token) return { error: 'FreshBooks said: ' + String(j.error_description || j.error || r.getResponseCode()).slice(0, 200) };
  var tok = { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + (Number(j.expires_in) || 43200) * 1000 - 120000 };
  props_().setProperty('FRESHBOOKS_TOKENS', JSON.stringify(tok));
  return tok;
}
function fbAccess_() {
  var tok = JSON.parse(prop_('FRESHBOOKS_TOKENS') || '{}');
  if (tok.access_token && Date.now() < tok.expires_at) return tok.access_token;
  var fresh = fbTokenRequest_({ grant_type: 'refresh_token', refresh_token: tok.refresh_token });
  if (fresh.error) {
    props_().deleteProperty('FRESHBOOKS_TOKENS');
    ownerMail_('FreshBooks disconnected', 'The hub lost its FreshBooks connection (' + fresh.error + '). Invoices are on hold until you use Ledge > Connect FreshBooks again; ' +
      'approvals in the meantime still email you the invoice details.');
    throw new Error('FreshBooks disconnected');
  }
  return fresh.access_token;
}
function fb_(method, path, body) {
  var opts = { method: method, headers: { Authorization: 'Bearer ' + fbAccess_() }, muteHttpExceptions: true };
  if (body) { opts.contentType = 'application/json'; opts.payload = JSON.stringify(body); }
  var r = UrlFetchApp.fetch(FB_API + '/accounting/account/' + prop_('FRESHBOOKS_ACCOUNT_ID') + path, opts);
  var j = {};
  try { j = JSON.parse(r.getContentText()); } catch (err) {}
  if (r.getResponseCode() >= 300) throw new Error('FreshBooks ' + method.toUpperCase() + ' ' + path.split('?')[0] + ': HTTP ' + r.getResponseCode() + ' ' + r.getContentText().slice(0, 200));
  return (j.response || {}).result || {};
}

function fbClientFor_(lead) {
  var email = String(lead.email || '').toLowerCase();
  var found = (fb_('get', '/users/clients?search[email]=' + encodeURIComponent(email)).clients || [])[0];
  if (found) return found.id;
  var name = String(lead.name || lead.first_name || '').trim().split(/\s+/);
  return fb_('post', '/users/clients', { client: { email: email, organization: lead.business || '', fname: name[0] || '', lname: name.slice(1).join(' ') } }).client.id;
}

// The invoice lines for a proposal: the same items as the invoice details in the approval email.
function invoiceLines_(prop) {
  var c = OFFER_COPY[prop.kind] || OFFER_COPY.legacy, credit = Number(prop.credit || 0);
  var lines = [{ name: c.item, description: credit ? 'Less $' + money_(credit) + ' Google Ads audit credit' : '', amount: Math.max(0, Number(prop.price_sprint || 0) - credit) }];
  String(prop.addons || '').split(',').filter(function (a) { return ADDONS[a]; }).forEach(function (a) {
    lines.push({ name: ADDONS[a].item, description: '', amount: addonPrice_(a) });
  });
  return lines;
}

function fbSendInvoice_(clientId, email, lines, gst, subject, note) {
  var inv = fb_('post', '/invoices/invoices', { invoice: {
    customerid: clientId, create_date: Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd'), currency_code: 'CAD',
    due_offset_days: Number(setting_('INVOICE_DUE_DAYS') || 0),
    lines: lines.map(function (l) {
      var line = { type: 0, name: l.name, description: l.description || '', qty: 1, unit_cost: { amount: Number(l.amount).toFixed(2), code: 'CAD' } };
      if (gst) { line.taxName1 = 'GST'; line.taxAmount1 = '5'; }
      return line;
    })
  } }).invoice;
  // Invoices made through the API don't get the pay-online button on their own: copy the account's defaults onto it first.
  try { inv.payment_gateway = fbEnableOnlinePayments_(inv.invoiceid || inv.id); }
  catch (err) { inv.payments_error = String(err && err.message || err).slice(0, 300); }
  fb_('put', '/invoices/invoices/' + inv.id, { invoice: { action_email: true, email_recipients: [email], email_include_pdf: false,
    invoice_customized_email: { subject: subject, body: note } } });
  if (inv.payments_error && !/test/i.test(subject)) {
    ownerMail_('No pay-online button on FreshBooks invoice #' + (inv.invoice_number || inv.id),
      'The invoice went out, but FreshBooks wouldn\'t switch on online payments for it:\n' + inv.payments_error + '\n\n' +
      'Open the invoice in FreshBooks and turn on online payments there, then resend it. If this keeps happening, run ' +
      'Ledge > Send a test invoice to myself and send Claude what it says.');
  }
  return inv;
}

// FreshBooks' online payments API (separate from accounting). Returns the parsed body.
function fbPayments_(method, path, body) {
  var opts = { method: method, headers: { Authorization: 'Bearer ' + fbAccess_() }, muteHttpExceptions: true };
  if (body) { opts.contentType = 'application/json'; opts.payload = JSON.stringify(body); }
  var r = UrlFetchApp.fetch(FB_API + '/payments/account/' + prop_('FRESHBOOKS_ACCOUNT_ID') + path, opts);
  var j = {};
  try { j = JSON.parse(r.getContentText()); } catch (err) {}
  if (r.getResponseCode() >= 300) throw new Error('FreshBooks payments ' + method.toUpperCase() + ' ' + path.split('?')[0] + ': HTTP ' + r.getResponseCode() + ' ' + r.getContentText().slice(0, 200));
  return j.payment_options || ((j.response || {}).result || {}).payment_options || {};
}

// Puts the account's default online payment options (set in FreshBooks > Payments > Online Payments) on one invoice.
function fbEnableOnlinePayments_(invoiceId) {
  var d = {};
  try { d = fbPayments_('get', '/payment_options?entity_type=invoice'); } catch (err) { d = {}; }
  var body = { gateway_name: d.gateway_name || 'fbpay', has_credit_card: d.has_credit_card !== false, entity_type: 'invoice', entity_id: String(invoiceId) };
  Object.keys(d).forEach(function (k) { if (/^(has_|allow_)/.test(k) && k !== 'has_credit_card') body[k] = d[k]; });
  fbPayments_('post', '/invoice/' + invoiceId + '/payment_options', body);
  return body.gateway_name;
}

// Hourly: an invoice for each proposal approved since FreshBooks was connected.
function sendInvoices_() {
  if (!fbConnected_()) return;
  var since = new Date(prop_('FRESHBOOKS_SINCE') || 0).getTime();
  readRows_(TAB.proposals, HEAD.proposals).filter(function (p) {
    return p.status === 'approved' && !p.invoice_id && p.approved_at && new Date(p.approved_at).getTime() >= since;
  }).slice(0, 10).forEach(function (p) {
    var l = findLead_('id', p.lead_id);
    if (!l || !l.email) return;
    try {
      var inv = fbSendInvoice_(fbClientFor_(l), l.email, invoiceLines_(p), yes_(p.gst), 'Invoice from Ledge Communications',
        'Hi ' + (l.first_name || firstName_(l.name) || 'there') + ',\n\nHere\'s the invoice for ' + (OFFER_COPY[p.kind] || OFFER_COPY.legacy).item.toLowerCase() +
        '. You can pay it online by card or bank transfer.\n\nThanks,\n' + firstName_(setting_('SENDER_NAME')) );
      updateRow_(TAB.proposals, HEAD.proposals, p, { invoice_id: String(inv.id), invoice_number: String(inv.invoice_number || '') });
      logEvent_(l.id, l.email, 'invoice_sent', 'FreshBooks #' + (inv.invoice_number || inv.id));
    } catch (err) {
      logEvent_(l.id, l.email, 'error', 'FreshBooks invoice: ' + String(err && err.message || err).slice(0, 300));
    }
  });
}

// Hourly: paid invoices. Logan hears about each one.
function checkPayments_() {
  if (!fbConnected_()) return;
  readRows_(TAB.invoices, HEAD.invoices).filter(function (r) { return r.invoice_id && !r.paid_at; }).slice(0, 20).forEach(function (r) {
    var inv;
    try { inv = fb_('get', '/invoices/invoices/' + r.invoice_id).invoice || {}; } catch (err) { return; }
    if (!(inv.v3_status === 'paid' || inv.payment_status === 'paid' || Number(inv.status) === 4)) return;
    updateRow_(TAB.invoices, HEAD.invoices, r, { paid_at: new Date(), status: 'paid' });
    var l = findLead_('id', r.lead_id) || {};
    logEvent_(l.id || '', l.email || '', 'paid', 'FreshBooks #' + (r.invoice_number || r.invoice_id) + ', ' + r.month);
    ownerMail_('Paid: ' + (l.business || 'invoice ' + r.invoice_number) + ', ' + monthName_(r.month), (l.business || 'A client') + ' paid FreshBooks invoice #' +
      (r.invoice_number || r.invoice_id) + ' (' + r.item + ').');
  });
  readRows_(TAB.proposals, HEAD.proposals).filter(function (p) { return p.invoice_id && !p.paid_at; }).slice(0, 20).forEach(function (p) {
    var inv;
    try { inv = fb_('get', '/invoices/invoices/' + p.invoice_id).invoice || {}; } catch (err) { return; }
    if (!(inv.v3_status === 'paid' || inv.payment_status === 'paid' || Number(inv.status) === 4)) return;
    updateRow_(TAB.proposals, HEAD.proposals, p, { paid_at: new Date() });
    var l = findLead_('id', p.lead_id) || {};
    logEvent_(l.id || '', l.email || '', 'paid', 'FreshBooks #' + (p.invoice_number || p.invoice_id));
    ownerMail_('Paid: ' + (l.business || 'invoice ' + p.invoice_number), (l.business || 'A client') + ' paid FreshBooks invoice #' + (p.invoice_number || p.invoice_id) +
      ' (' + (OFFER_COPY[p.kind] || OFFER_COPY.legacy).item + ').');
  });
}

// Ledge menu > Send a test invoice to myself: a $1 invoice to OWNER_EMAIL, to see what clients get.
function testFreshBooksInvoice() {
  ensureSchema_();
  var ui = SpreadsheetApp.getUi();
  if (!fbConnected_()) { ui.alert('Connect FreshBooks first (Ledge > Connect FreshBooks).'); return; }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { ui.alert('The hourly run is busy. Try again in a minute.'); return; }
  try {
    var me = setting_('OWNER_EMAIL') || myEmail_();
    var inv = fbSendInvoice_(fbClientFor_({ email: me, business: 'Ledge test', name: setting_('SENDER_NAME') }), me,
      [{ name: 'Test invoice', description: 'Checking the FreshBooks connection. No need to pay it.', amount: 1 }], false, 'Test invoice from Ledge Communications',
      'This is a test from the Ledge hub. Check that the pay-online button shows, then delete it in FreshBooks.');
    ui.alert('Sent FreshBooks invoice #' + (inv.invoice_number || inv.id) + ' to ' + me + '.\n\n' +
      (inv.payments_error ? 'Online payments did NOT switch on: ' + inv.payments_error : 'Online payments: on (' + inv.payment_gateway + '). The email should have a pay button.'));
  } catch (err) {
    ui.alert('That didn\'t work: ' + String(err && err.message || err).slice(0, 300));
  } finally { lock.releaseLock(); }
}

function paymentLine_() {
  if (fbConnected_()) return 'Approving tells us to go ahead. The invoice comes from FreshBooks within the hour, and you can pay it online by card or bank transfer.';
  return setting_('PAYMENT_URL') ? 'Approving tells us to go ahead. You\'ll get a payment link right away.' : 'Approving tells us to go ahead. The invoice follows the same day.';
}
function money_(n) { return Number(n || 0).toLocaleString('en-CA', { maximumFractionDigits: 0 }); }
function cents_(n) { return Number(n || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

// Everything the FreshBooks invoice needs, ready to copy. GST is 5% in Alberta.
function invoiceBlock_(lead, prop) {
  var extras = String(prop.addons || '').split(',').filter(function (a) { return ADDONS[a]; });
  var sub = Math.max(0, Number(prop.price_sprint || 0) - Number(prop.credit || 0)) + extras.reduce(function (n, a) { return n + addonPrice_(a); }, 0);
  var gst = yes_(prop.gst) ? Math.round(sub * 5) / 100 : 0;
  var c = OFFER_COPY[prop.kind] || OFFER_COPY.legacy;
  var item = c.item;
  if (!OFFER_COPY[prop.kind]) {
    try {
      var audit = lead.audit_slug ? findRow_(TAB.audits, HEAD.audits, 'slug', lead.audit_slug) : null;
      var aspec = audit ? JSON.parse(audit.spec_json) : {};
      var fixes = (aspec.fixes || aspec.moves || []).map(function (f) { return f.title; });
      if (fixes.length) item += ': ' + fixes.join('; ');
    } catch (e) {}
  }
  var monthly = Number(prop.price_care || 0);
  return 'For the invoice:\n' +
    'Client: ' + lead.business + ', ' + (lead.name || lead.first_name || '') + ', ' + lead.email + '\n' +
    'Item: ' + item + ', $' + cents_(prop.price_sprint) + '\n' +
    (Number(prop.credit) ? 'Google Ads audit credit: -$' + cents_(prop.credit) + '\n' : '') +
    extras.map(function (a) { return 'Add-on: ' + ADDONS[a].item + ', $' + cents_(addonPrice_(a)) + '\n'; }).join('') +
    'Amount: $' + cents_(sub) + '\n' +
    (gst ? 'GST (5%): $' + cents_(gst) + '\n' : '') +
    'Total: $' + cents_(sub + gst) + ' CAD' +
    (monthly ? '\n' + (prop.kind === 'starting_plan' ? 'Monthly management, starting the month ads go live' : OFFER_COPY[prop.kind] ? 'Monthly management' : 'Care plan, if they add it later') + ': $' + money_(monthly) + '/month' + (gst ? ' + GST' : '') : '');
}
function monthKey_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM'); }
function firstName_(name) { return String(name || '').trim().split(/\s+/)[0] || ''; }
function appendNote_(notes, line) { return (notes ? String(notes) + '\n' : '') + line; }
function rand_(n) { var s = ''; while (s.length < n) s += Math.random().toString(36).slice(2); return s.slice(0, n); }
function newId_(prefix) { return prefix + Utilities.formatDate(new Date(), tz_(), 'yyMMdd') + '-' + rand_(6); }
function slugify_(s) { return String(s || 'shop').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'shop'; }
function siteUrlOf_(website) {
  var w = String(website || '').trim();
  return !w ? '' : /^https?:\/\//i.test(w) ? w : 'https://' + w;
}
function ymd_(days) { return Utilities.formatDate(new Date(Date.now() + days * 864e5), tz_(), 'yyyy-MM-dd'); }
function domainOf_(url) {
  var m = String(url || '').toLowerCase().trim().replace(/^https?:\/\//, '').replace(/^www\./, '').match(/^[a-z0-9.-]+\.[a-z]{2,}/);
  return m ? m[0] : '';
}

function token_(id) {
  var sig = Utilities.computeHmacSha256Signature(String(id), prop_('HUB_KEY') || 'unset');
  return Utilities.base64EncodeWebSafe(sig).replace(/=+$/, '').slice(0, 22);
}

function inWindow_(fromHour, toHour) {
  var now = new Date();
  var dow = Number(Utilities.formatDate(now, tz_(), 'u'));
  var hour = Number(Utilities.formatDate(now, tz_(), 'H'));
  return dow <= 5 && hour >= fromHour && hour < toHour;
}

function startOfDay_() {
  var d = new Date(Utilities.formatDate(new Date(), tz_(), "yyyy-MM-dd'T'00:00:00"));
  return isNaN(d) ? new Date(new Date().setHours(0, 0, 0, 0)) : d;
}

function addBusinessDays_(date, n) {
  var d = new Date(date.getTime());
  while (n > 0) {
    d.setDate(d.getDate() + 1);
    if (Number(Utilities.formatDate(d, tz_(), 'u')) <= 5) n--;
  }
  d.setHours(9, 0, 0, 0);
  return d;
}

function nextBusinessDayName_() {
  var d = addBusinessDays_(new Date(), 1);
  var tomorrow = new Date(Date.now() + 864e5);
  return Utilities.formatDate(d, tz_(), 'yyyy-MM-dd') === Utilities.formatDate(tomorrow, tz_(), 'yyyy-MM-dd') ? 'tomorrow' : Utilities.formatDate(d, tz_(), 'EEEE');
}

function fmt_(when) { return when ? Utilities.formatDate(new Date(when), tz_(), 'EEE MMM d, h:mm a') : ''; }

function esc_(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function toHtml_(text) {
  var e = String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  e = e.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
  // Footer niceties: a plain "Unsubscribe" link instead of the long address, and the site as a proper https link.
  e = e.replace(/Unsubscribe: <a href="([^"]+)">[^<]*<\/a>/, '<a href="$1">Unsubscribe</a>');
  e = e.replace(/(^|[\s>])ledgecommunications\.com(?=[\s<·])/g, '$1<a href="https://ledgecommunications.com">ledgecommunications.com</a>');
  return '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#1B2A38">' +
    e.split(/\n{2,}/).map(function (p) { return '<p style="margin:0 0 14px">' + p.replace(/\n/g, '<br>') + '</p>'; }).join('') + '</div>';
}

function json_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
function text_(s) { return ContentService.createTextOutput(s).setMimeType(ContentService.MimeType.TEXT); }

function page_(title, msg) {
  return HtmlService.createHtmlOutput('<div style="font-family:Arial,sans-serif;max-width:520px;margin:48px auto;padding:0 16px;color:#1B2A38">' +
    '<h2 style="margin:0 0 8px">' + esc_(title) + '</h2><p style="color:#566A7E">' + esc_(msg || '') + '</p></div>').setTitle(title);
}
