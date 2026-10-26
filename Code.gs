/**
 * Ledge lead hub, v2.
 *
 * Lives in the "Ledge Pipeline" Google Sheet owned by ledgecommunications@gmail.com
 * (Extensions > Apps Script). One Google account runs the whole system:
 *
 *   Site form ─────────> doPost(inbound) ─> lead, confirmation email, audit job queued
 *   Monday 5 am ───────> weeklyProspects ─> "find shops" job queued for the next area
 *   Every hour ────────> runHourly:
 *       engine:     queued jobs go to the Claude API as one batch; finished batches become
 *                   audits (and, for find jobs, new cold leads with their own audit jobs)
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
 *   ANTHROPIC_API_KEY, WEB_APP_URL (and HUB_KEY, which setup() creates).
 */

var TAB = {
  settings: 'Settings', leads: 'Leads', audits: 'Audits', proposals: 'Proposals',
  jobs: 'Engine jobs', events: 'Events', dnc: 'Do not contact'
};
var HEAD = {
  leads: ['id', 'created', 'source', 'status', 'attention', 'first_name', 'name', 'business', 'website', 'email',
    'phone', 'trade', 'area', 'consent_basis', 'consent_proof', 'audit_slug', 'top_finding', 'fix_1',
    'proposal_slug', 'thread_id', 'last_msg_id', 'last_reply_at', 'touches', 'next_touch', 'last_touch',
    'booked_at', 'notes', 'owner_says'],
  audits: ['slug', 'lead_id', 'created', 'business', 'spec_json'],
  proposals: ['slug', 'lead_id', 'created', 'price_sprint', 'price_care', 'gst', 'status', 'sent_at', 'approved_at'],
  jobs: ['job_id', 'kind', 'lead_id', 'area', 'status', 'batch_id', 'attempts', 'created', 'updated', 'est_cost_usd', 'detail'],
  events: ['timestamp', 'lead_id', 'email', 'event', 'detail'],
  dnc: ['email_or_domain', 'added', 'reason']
};
var SETTINGS_DEFAULTS = [
  ['OWNER_EMAIL', '', 'Where your notifications go (your everyday inbox).'],
  ['SENDER_NAME', '', 'Your full name, as it appears on every email.'],
  ['MAILING_ADDRESS', '', 'Mailing address for email footers. Canada\'s anti-spam law requires one. Shown only in email footers.'],
  ['SITE_URL', 'https://ledgecommunications.com', 'Where the site lives. Links in emails point here. Use the workers.dev address while testing.'],
  ['BOOKING_URL', '', 'Your booking page link (Superhuman or Google Calendar). Optional.'],
  ['CALENDAR_ID', 'primary', 'Calendar the booking page books into. "primary" = this account\'s main calendar.'],
  ['BOOKING_EVENT_MATCH', 'Ledge', 'Bookings from new people are picked up when the event title contains this.'],
  ['PRICE_SPRINT', '1000', 'Price to set up the three fixes, CAD before GST.'],
  ['PRICE_CARE', '250', 'Optional monthly care plan, CAD before GST. 0 hides it.'],
  ['GST_REGISTERED', 'yes', 'yes adds "+ GST" to prices.'],
  ['PAYMENT_URL', '', 'Optional payment link (Stripe or Wave) sent after a proposal is approved.'],
  ['REVIEW_AUDITS_FIRST', '5', 'Hold the first N audits for your one-click OK. 0 turns it off.'],
  ['REVIEW_PROPOSALS_FIRST', '3', 'Hold the first N proposals for your one-click OK. 0 turns it off.'],
  ['COLD_EMAIL_ON', 'no', 'yes starts cold emails. Leave it at no until you\'re happy with the first audits.'],
  ['COLD_PER_DAY_START', '5', 'Cold emails per weekday in the first week.'],
  ['COLD_PER_DAY_MAX', '20', 'Ceiling after adding 5 a week.'],
  ['PROSPECTS_PER_WEEK', '15', 'New shops to look for each Monday.'],
  ['AREAS', 'Calgary NE, Calgary NW, Calgary SE, Calgary SW, Airdrie, Chestermere, Cochrane, Okotoks', 'Areas to work through, in order.'],
  ['TRADES', 'heating and cooling, plumbing', 'Trades to look for.'],
  ['MODEL', 'claude-sonnet-5-5', 'Claude model for research.'],
  ['MONTHLY_ENGINE_BUDGET_USD', '20', 'The engine pauses for the rest of the month once estimated spend passes this.']
];
var STAGE_NAMES = ['Lead comes in', 'First response', 'Visit booked', 'Quote sent', 'Job done and paid', 'Customer comes back'];
var PILL = { good: 'Looks good', leak: 'Needs work', unknown: 'Couldn\'t check' };
var DONE_STATUSES = ['unsubscribed', 'bounced', 'not_interested', 'skipped', 'error', 'won', 'booked'];

var OPT_OUT = /\b(unsubscribe|remove me|take me off|stop (emailing|contacting|sending)|don'?t (email|contact)|do not (email|contact)|please stop|leave me alone)\b/i;
var NEGATIVE = /\b(not interested|no thanks|no thank you|we'?re (all )?(good|set)|we'?re not looking|pass on this|no need)\b/i;
var POSITIVE = /\b(yes|yeah|yep|sure|interested|sounds good|sounds great|let'?s (talk|chat|do it|go)|send (it|me|over)|go ahead|tell me more|more info|how much|what (does|would) (it|that) cost|price|pricing|quote)\b/i;
var AUTO_SUBJECT = /\b(out of (the )?office|automatic reply|auto.?reply|away from (the )?office|on vacation)\b/i;

var _settings = null;

/* ══════════════════════════ setup and menu ══════════════════════════ */

function setup() {
  var ss = SpreadsheetApp.getActive();
  Object.keys(TAB).forEach(function (k) {
    if (k === 'settings') return;
    ensureSheet_(ss, TAB[k], HEAD[k]);
  });
  var st = ss.getSheetByName(TAB.settings) || ss.insertSheet(TAB.settings, 0);
  if (st.getLastRow() < 1) st.getRange(1, 1, 1, 3).setValues([['setting', 'value', 'what it does']]).setFontWeight('bold');
  var have = st.getLastRow() > 1 ? st.getRange(2, 1, st.getLastRow() - 1, 1).getValues().map(function (r) { return r[0]; }) : [];
  SETTINGS_DEFAULTS.forEach(function (row) { if (have.indexOf(row[0]) === -1) st.appendRow(row); });
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
    .addItem('Send me the weekly digest now', 'sendDigest')
    .addItem('Check settings', 'showSettingsCheck')
    .addToUi();
}

function showSettingsCheck() {
  var missing = checkSettings_();
  SpreadsheetApp.getUi().alert(missing.length ? 'Still to fill in:\n\n' + missing.join('\n') : 'Settings look complete.');
}

function checkSettings_() {
  _settings = null;
  var need = ['OWNER_EMAIL', 'SENDER_NAME', 'MAILING_ADDRESS'].filter(function (k) { return !setting_(k); });
  if (!prop_('ANTHROPIC_API_KEY')) need.push('ANTHROPIC_API_KEY (Script Properties)');
  if (!prop_('WEB_APP_URL')) need.push('WEB_APP_URL (Script Properties, after you deploy)');
  return need;
}

/* ══════════════════════════ web entry points ══════════════════════════ */

function doPost(e) {
  try {
    var body = {};
    try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { body = {}; }
    if (body.key !== prop_('HUB_KEY')) return json_({ ok: false, error: 'forbidden' });
    if (body.type === 'inbound') return json_(handleInbound_(body.lead || {}));
    if (body.type === 'quote') return json_(handleQuoteRequest_(body.id, body.t, body.notes));
    if (body.type === 'approve') return json_(handleApprove_(body.id, body.t));
    if (body.type === 'unsubscribe') return json_(handleUnsubscribe_(body.id, body.t));
    return json_({ ok: false, error: 'unknown_type' });
  } catch (err) {
    logEvent_('', '', 'error', 'doPost: ' + (err && err.stack || err));
    return json_({ ok: false, error: 'server' });
  }
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.page) {
    if (p.key !== prop_('HUB_KEY')) return text_('forbidden');
    var html = p.page === 'audit' ? renderAudit_(p.slug) : p.page === 'proposal' ? renderProposal_(p.slug) : null;
    return text_(html || 'not_found');
  }
  if (!p.id || p.t !== token_(p.id)) return page_('Link not recognised', 'This link is incomplete or out of date.');
  var lead = findLead_('id', p.id);
  if (!lead) return page_('Lead not found', 'That lead is no longer in the pipeline.');
  var res;
  if (p.action === 'approve_audit') res = ownerApproveAudit_(lead);
  else if (p.action === 'approve_proposal') res = ownerApproveProposal_(lead);
  else if (p.action === 'skip') res = ownerSkip_(lead);
  else if (p.action === 'rebuild') res = ownerRebuild_(lead);
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
    email: email, phone: f.phone || '', trade: f.trade || '', area: '', owner_says: ownerSays_(f),
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

// The two optional form questions, as one line for the Leads tab and the audit request.
function ownerSays_(f) {
  var parts = [];
  if (f.missed_calls) parts.push('missed calls: ' + f.missed_calls);
  var tools = [f.tools, f.tools_other].filter(function (v) { return v; }).join(', ');
  if (tools) parts.push('schedules jobs with: ' + tools);
  return parts.join('; ');
}

function handleQuoteRequest_(id, t, notes) {
  if (!id || t !== token_(id)) return { ok: false, error: 'bad_token' };
  var lead = findLead_('id', id);
  if (!lead) return { ok: false, error: 'not_found' };
  notes = String(notes || '').trim().slice(0, 1000);
  if (notes) updateLead_(lead, { notes: appendNote_(lead.notes, 'Asked for a price: ' + notes) });
  if (lead.proposal_slug || ['quote_requested', 'awaiting_proposal_review', 'proposal_sent', 'won'].indexOf(lead.status) > -1) {
    return { ok: true, duplicate: true };
  }
  queueProposal_(lead, 'audit page');
  safeSend_(findLead_('id', id), 'quote_ack');
  return { ok: true };
}

function handleApprove_(id, t) {
  if (!id || t !== token_(id)) return { ok: false, error: 'bad_token' };
  var lead = findLead_('id', id);
  if (!lead || !lead.proposal_slug) return { ok: false, error: 'not_found' };
  if (lead.status === 'won') return { ok: true, duplicate: true };
  var prop = findRow_(TAB.proposals, HEAD.proposals, 'slug', lead.proposal_slug);
  updateRow_(TAB.proposals, HEAD.proposals, prop, { status: 'approved', approved_at: new Date() });
  updateLead_(lead, { status: 'won', next_touch: '' });
  logEvent_(lead.id, lead.email, 'won', '$' + prop.price_sprint);
  safeSend_(findLead_('id', id), 'kickoff');
  ownerMail_('Approved: ' + lead.business + ', $' + money_(prop.price_sprint),
    lead.business + ' approved the proposal.\n\n' +
    'Price: $' + money_(prop.price_sprint) + (yes_(prop.gst) ? ' + GST' : '') + '\n' +
    'Contact: ' + (lead.name || lead.first_name) + ' <' + lead.email + '>' + (lead.phone ? ', ' + lead.phone : '') + '\n' +
    'Proposal: ' + siteUrl_() + '/proposal/' + lead.proposal_slug + '\n' +
    'Audit: ' + auditUrl_(lead) + '\n\n' +
    'They were told: ' + paymentLine_() + ' Next from you: ' +
    (setting_('PAYMENT_URL') ? '' : 'the invoice, then ') + 'the steps to add you as a user on their tools.' +
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
    step_('checkReplies', checkReplies_);
    step_('checkBounces', checkBounces_);
    step_('checkCalendar', checkCalendar_);
    step_('pollBatches', pollBatches_);
    step_('submitJobs', submitJobs_);
    step_('deliverAudits', deliverAudits_);
    step_('deliverProposals', deliverProposals_);
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
  readRows_(TAB.leads, HEAD.leads).forEach(function (l) {
    if (l.status !== 'audit_ready') return;
    if (reviewsLeft_('audit') > 0) { requestAuditReview_(l); return; }
    releaseAudit_(l);
  });
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
  updateLead_(l, { status: 'awaiting_review' });
  var first = l.source === 'cold' ? previewEmail_(l, 'cold_1') : previewEmail_(l, 'inbound_audit');
  ownerMail_('Check this audit: ' + l.business,
    l.business + ' (' + (l.source === 'cold' ? 'cold prospect' : 'asked on the site') + ') is ready. ' +
    'It\'s one of the first ' + setting_('REVIEW_AUDITS_FIRST') + ' audits, so it waits for your OK (' + reviewsLeft_('audit') + ' left).\n\n' +
    'Audit: ' + auditUrl_(l) + '\n' +
    'Biggest finding: ' + l.top_finding + '\n' +
    (l.source === 'cold' ? 'Email found: ' + l.email + '\nWhere: ' + l.consent_proof + '\n' : '') +
    '\nThe email they\'ll get:\n────────\n' + first + '\n────────\n\n' +
    'Looks right, send it: ' + ownerLink_('approve_audit', l) + '\n' +
    'Rebuild the audit: ' + ownerLink_('rebuild', l) + '\n' +
    'Skip this shop: ' + ownerLink_('skip', l) + '\n\n' +
    'Want a change to how audits are written? Tell Claude in the Ledge project and it\'ll update the instructions.');
  logEvent_(l.id, l.email, 'review_requested', 'audit');
}

function ownerApproveAudit_(l) {
  if (l.status !== 'awaiting_review') return { title: 'Already handled', message: 'Status is ' + l.status + '.' };
  logEvent_(l.id, l.email, 'audit_approved', '');
  updateLead_(l, { status: 'audit_ready' });
  l = findLead_('id', l.id);
  var sent = releaseAudit_(l);
  return { title: 'Approved', message: l.source === 'cold' ? l.business + ' is queued for the next cold email slot.' :
    sent ? 'The audit went to ' + l.business + '.' : 'It goes out at 7 am, ' + l.business + ' included.' };
}

function ownerSkip_(l) {
  updateLead_(l, { status: 'skipped', next_touch: '' });
  logEvent_(l.id, l.email, 'skipped', 'by Logan');
  return { title: 'Skipped', message: (l.business || l.email) + ' won\'t get anything.' };
}

function ownerRebuild_(l) {
  updateLead_(l, { status: l.source === 'cold' ? 'researching' : 'requested', audit_slug: '' });
  queueJob_('audit', l.id, '');
  logEvent_(l.id, l.email, 'rebuild', '');
  return { title: 'Rebuilding', message: 'A fresh audit for ' + l.business + ' will come back for review in an hour or two.' };
}

/* ── proposals ── */

function queueProposal_(lead, via) {
  if (lead.proposal_slug) return;
  var slug = slugify_(lead.business || 'proposal') + '-' + rand_(6);
  appendRow_(TAB.proposals, HEAD.proposals, {
    slug: slug, lead_id: lead.id, created: new Date(), price_sprint: Number(setting_('PRICE_SPRINT') || 0),
    price_care: Number(setting_('PRICE_CARE') || 0), gst: yes_(setting_('GST_REGISTERED')) ? 'yes' : 'no', status: 'draft'
  });
  updateLead_(lead, { proposal_slug: slug, status: 'quote_requested', next_touch: '', attention: '' });
  logEvent_(lead.id, lead.email, 'quote_requested', via);
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
    'Price: $' + money_(prop.price_sprint) + (yes_(prop.gst) ? ' + GST' : '') +
    (Number(prop.price_care) ? ', care plan $' + money_(prop.price_care) + '/month' : '') + '\n' +
    'Audit: ' + auditUrl_(l) + '\n' +
    (l.notes ? 'Notes from them: ' + l.notes + '\n' : '') +
    '\nTo change the price for this one, edit price_sprint on the Proposals tab before approving.\n\n' +
    'Looks right, send it: ' + ownerLink_('approve_proposal', l) + '\n' +
    'Don\'t send: ' + ownerLink_('skip', l));
  logEvent_(l.id, l.email, 'review_requested', 'proposal');
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
  readRows_(TAB.leads, HEAD.leads).forEach(function (l) {
    if (!l.thread_id || DONE_STATUSES.indexOf(l.status) > -1) return;
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
  if (kind === 'negative') { stopLead_(l, 'not_interested', text.slice(0, 200)); return; }

  var preAudit = ['requested', 'researching', 'audit_ready', 'awaiting_review', 'ready_to_send'].indexOf(l.status) > -1;
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

/* ══════════════════════════ the engine (Claude API, batch) ══════════════════════════ */

function weeklyProspects() {
  _settings = null;
  var areas = String(setting_('AREAS') || '').split(',').map(function (s) { return s.trim(); }).filter(String);
  if (!areas.length) return;
  var i = (Number(prop_('AREA_INDEX') || -1) + 1) % areas.length;
  props_().setProperty('AREA_INDEX', String(i));
  queueJob_('find', '', areas[i]);
}

function queueJob_(kind, leadId, area) {
  var open = readRows_(TAB.jobs, HEAD.jobs).some(function (j) {
    return j.kind === kind && j.lead_id === leadId && (kind !== 'find' || j.area === area) && ['queued', 'submitted'].indexOf(j.status) > -1;
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
  var jobs = readRows_(TAB.jobs, HEAD.jobs).filter(function (j) { return j.status === 'queued'; }).slice(0, 25);
  if (!jobs.length) return;
  var requests = [];
  jobs.forEach(function (j) {
    var params = jobParams_(j);
    if (params) requests.push({ custom_id: j.job_id, params: params });
    else updateRow_(TAB.jobs, HEAD.jobs, j, { status: 'error', detail: 'Lead missing', updated: new Date() });
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
  var model = setting_('MODEL') || 'claude-sonnet-5-5';
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
  var site = /^https?:\/\//i.test(lead.website) ? lead.website : (lead.website ? 'https://' + lead.website : '');
  return {
    model: model, max_tokens: 6000, system: PROMPT_AUDIT,
    tools: [
      { type: 'web_search_20250305', name: 'web_search', max_uses: 6, user_location: loc },
      { type: 'web_fetch_20250910', name: 'web_fetch', max_uses: 6, max_content_tokens: 12000 }
    ],
    messages: [{ role: 'user', content:
      'Today is ' + today + '. Build a Lead Handling Audit for this business.\n\n' +
      'Business: ' + (lead.business || 'unknown') + '\n' +
      'Website: ' + (site || 'not given, search for it') + '\n' +
      'Trade: ' + (lead.trade || 'heating, cooling or plumbing') + '\n' +
      'Area: ' + (lead.area || 'Calgary, Alberta') + '\n' +
      (lead.owner_says ? 'What the owner told us on the form: ' + lead.owner_says + '\n' : '') +
      'Purpose: ' + (lead.source === 'cold' ? 'cold' : 'inbound (they asked for it, no contact details needed)') }]
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
    if (!retry) {
      var l = findLead_('id', job.lead_id);
      if (l) updateLead_(l, { status: 'error', notes: appendNote_(l.notes, 'Audit failed: ' + why) });
      logEvent_(job.lead_id, '', 'error', 'Job ' + job.job_id + ' gave up: ' + why);
    }
    return;
  }
  var outcome = job.kind === 'find' ? applyFind_(job, data) : applyAudit_(job, data);
  if (outcome === 'retry' && attempts < 3) {
    updateRow_(TAB.jobs, HEAD.jobs, job, { status: 'queued', attempts: attempts, est_cost_usd: totalCost, detail: 'Incomplete audit, retrying', updated: new Date() });
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
  var okStages = Array.isArray(a.stages) && a.stages.length === 6 && a.stages.every(function (s) { return s && PILL[s.status] && s.note; });
  var okFixes = Array.isArray(a.fixes) && a.fixes.length === 3 && a.fixes.every(function (f) { return f && f.title && f.why && f.effort; });
  if (!okStages || !okFixes || !a.summary || !a.top_finding || !a.fix_1) return 'retry';

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
  var spec = {
    business: a.business || l.business, area: a.area || l.area || 'Calgary',
    date: Utilities.formatDate(new Date(), tz_(), 'MMM d, yyyy'), summary: a.summary,
    stages: a.stages.map(function (s) { return { status: s.status, note: String(s.note) }; }),
    fixes: a.fixes.map(function (f) { return { title: String(f.title), why: String(f.why), effort: String(f.effort) }; }),
    sources: (a.sources || []).filter(function (s) { return s && /^https?:\/\//i.test(s.url); }).slice(0, 8)
  };
  appendRow_(TAB.audits, HEAD.audits, { slug: slug, lead_id: l.id, created: new Date(), business: spec.business, spec_json: JSON.stringify(spec) });
  fields.audit_slug = slug;
  fields.top_finding = a.top_finding;
  fields.fix_1 = String(a.fix_1).replace(/\.$/, '');
  fields.status = 'audit_ready';
  if (!l.business) fields.business = spec.business;
  updateLead_(l, fields);
  logEvent_(l.id, fields.email || l.email, 'audit_built', slug);
  return 'audit ' + slug;
}

function applyFind_(job, data) {
  var shops = Array.isArray(data.shops) ? data.shops : [];
  var known = knownDomains_();
  var limit = Number(setting_('PROSPECTS_PER_WEEK') || 15), added = 0;
  shops.forEach(function (s) {
    if (added >= limit || !s || !s.website) return;
    var d = domainOf_(s.website);
    if (!d || known.indexOf(d) > -1 || isDnc_(d)) return;
    known.push(d);
    var lead = {
      id: newId_('P'), created: new Date(), source: 'cold', status: 'researching', business: s.business || '',
      website: s.website, trade: s.trade || '', area: s.area || job.area, touches: 0, last_reply_at: 0,
      consent_basis: 'Conspicuous publication (CASL s.10(9)(b)): address published by the business, message relevant to its role'
    };
    appendRow_(TAB.leads, HEAD.leads, lead);
    queueJob_('audit', lead.id, '');
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
  var rates = /haiku/i.test(model || '') ? [0.05, 0.25] : /opus/i.test(model || '') ? [2, 10] : [1, 5]; // Batch API rates per million tokens (Oct 2026)
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

/* ══════════════════════════ pages ══════════════════════════ */

function renderAudit_(slug) {
  var row = findRow_(TAB.audits, HEAD.audits, 'slug', slug);
  if (!row) return null;
  var spec = JSON.parse(row.spec_json);
  var lead = findLead_('id', row.lead_id) || { id: '' };
  return fill_(AUDIT_TEMPLATE, {
    business: spec.business, area: spec.area, date: spec.date, summary: spec.summary,
    lead_id: lead.id, token: lead.id ? token_(lead.id) : '', sender_name: setting_('SENDER_NAME') || 'Logan'
  }, {
    stages: spec.stages.map(function (s, i) {
      return '      <li><b>' + esc_(STAGE_NAMES[i]) + '</b><span class="pill ' + esc_(s.status) + '">' + esc_(PILL[s.status]) +
        '</span><span class="note">' + esc_(s.note) + '</span></li>';
    }).join('\n'),
    fixes: spec.fixes.map(function (f) {
      return '      <li><h3>' + esc_(f.title) + '</h3><p>' + esc_(f.why) + '</p><p class="effort">What it takes: ' + esc_(f.effort) + '</p></li>';
    }).join('\n'),
    later: (spec.later || []).map(function (t) { return '        <li>' + esc_(t) + '</li>'; }).join('\n'),
    later_hidden: (spec.later || []).length ? '' : 'hidden',
    sources: spec.sources.map(function (s) {
      return '      <li><a href="' + esc_(s.url) + '" rel="nofollow noopener" target="_blank">' + esc_(s.label || s.url) + '</a></li>';
    }).join('\n')
  });
}

function renderProposal_(slug) {
  var p = findRow_(TAB.proposals, HEAD.proposals, 'slug', slug);
  if (!p) return null;
  var lead = findLead_('id', p.lead_id);
  if (!lead) return null;
  var audit = lead.audit_slug ? findRow_(TAB.audits, HEAD.audits, 'slug', lead.audit_slug) : null;
  var fixes = audit ? JSON.parse(audit.spec_json).fixes : [];
  var gst = yes_(p.gst) ? '+ GST' : '';
  var approved = p.status === 'approved';
  var care = Number(p.price_care || 0);
  return fill_(PROPOSAL_TEMPLATE, {
    business: lead.business, date: Utilities.formatDate(new Date(p.created), tz_(), 'MMM d, yyyy'),
    valid_until: Utilities.formatDate(new Date(new Date(p.created).getTime() + 30 * 864e5), tz_(), 'MMM d, yyyy'),
    price_sprint: money_(p.price_sprint), gst_note: gst, payment_line: paymentLine_(),
    lead_id: lead.id, token: token_(lead.id), sender_name: setting_('SENDER_NAME') || 'Logan',
    approved_on: approved && p.approved_at ? ' on ' + Utilities.formatDate(new Date(p.approved_at), tz_(), 'MMM d') : ''
  }, {
    fixes: fixes.map(function (f) { return '      <li><b>' + esc_(f.title) + '</b><span>' + esc_(f.effort) + '</span></li>'; }).join('\n'),
    care_row: care ? '      <div class="price-row"><b>Optional care plan once it\'s live</b><span class="amt">$' + money_(care) +
      ' <small>/month ' + gst + '</small></span><p>Each month we check that everything still runs, fix anything that breaks and adjust messages as your season changes. ' +
      'Month to month. Not required.</p></div>' : '',
    approve_hidden: approved ? 'hidden' : '',
    approved_hidden: approved ? '' : 'hidden'
  });
}

function fill_(tpl, text, raw) {
  var out = tpl.replace(/\{\{\{(\w+)\}\}\}/g, function (m, k) { return raw && raw[k] != null ? raw[k] : ''; });
  return out.replace(/\{\{(\w+)\}\}/g, function (m, k) { return text[k] != null ? esc_(text[k]) : (raw && raw[k] != null ? raw[k] : ''); });
}

/* ══════════════════════════ emails ══════════════════════════ */

var EMAILS = {
  inbound_confirm: {
    subject: 'Your Lead Handling Audit for {business}',
    body: 'Hi {first},\n\nThanks for reaching out. I\'m putting your audit together now and you\'ll have it by end of day {next_day}.\n\nTalk soon,\n{sender}'
  },
  inbound_audit: {
    body: 'Hi {first},\n\nHere\'s your audit:\n{audit_url}\n\nThe top three fixes are in the order I\'d tackle them. The biggest one: {top_finding}\n\n' +
      'If you\'d like a hand, there\'s a button at the bottom of the page to get a fixed price, or just reply "yes".{booking_line}\n\n{sender}'
  },
  inbound_nudge1: {
    body: 'Hi {first},\n\nQuick follow-up on your audit. If you only do one thing, I\'d start here: {fix_1}.\n\nReply "yes" and I\'ll send a fixed price for getting it done.\n\n{sender}'
  },
  inbound_nudge2: {
    body: 'Hi {first},\n\nLast note from me. Your audit will stay up here whenever you want it:\n{audit_url}\n\nAll the best,\n{sender}'
  },
  cold_1: {
    subject: '{business}: a quick look at your website and reviews',
    body: 'Hi {first},\n\nHope you\'re keeping busy. I\'m {sender}, and I run Ledge Communications here in Alberta. ' +
      'I help trades businesses make sure the calls and requests they already get turn into booked jobs.\n\n' +
      'I took a look at {business} from the outside and put together a one-page audit. No cost and nothing to sign up for:\n{audit_url}\n\n' +
      'The biggest thing that stood out: {top_finding}\n\n' +
      'If any of it is useful and you\'d like a hand, just reply "yes" and I\'ll send over a fixed price.{booking_line}\n\nThanks,\n{sender}'
  },
  cold_2: {
    body: 'Hi {first},\n\nFollowing up on the audit I sent. If you only tackle one thing, I\'d start here: {fix_1}.\n\nHappy to set it up for you. Reply "yes" and I\'ll send a fixed price.\n\n{sender}'
  },
  cold_3: {
    body: 'Hi {first},\n\nI know this time of year is busy, so I\'ll keep it short. If you want your after-hours calls and quote follow-ups taken care of before things get busier, ' +
      'I can have it set up in two or three weeks.\n\nReply "yes" and I\'ll send the details.{booking_line}\n\n{sender}'
  },
  cold_4: {
    body: 'Hi {first},\n\nI\'ll leave it here so I\'m not cluttering your inbox. Your audit will stay up if you want to look at it later:\n{audit_url}\n\nAll the best with the season,\n{sender}'
  },
  positive_ack: {
    body: 'Thanks {first}, appreciate you getting back to me.\n\nI\'ll put together a fixed price for those fixes and send it over by end of day {next_day}.{booking_line}\n\n{sender}'
  },
  quote_ack: {
    fallbackSubject: 'Your fixed price from Ledge Communications',
    body: 'Hi {first},\n\nGot it. I\'ll send the fixed price and what\'s included by end of day {next_day}.\n\n{sender}'
  },
  proposal: {
    fallbackSubject: 'Your fixed price from Ledge Communications',
    body: 'Hi {first},\n\nHere\'s the fixed price for setting up those fixes:\n{proposal_url}\n\n' +
      'It covers what I\'ll do, how long it takes and what I need from you. If it looks good, you can approve it right on the page. Any questions, just reply here.\n\n{sender}'
  },
  proposal_nudge: {
    body: 'Hi {first},\n\nJust checking whether you had any questions on the proposal. Happy to adjust the scope if something doesn\'t fit:\n{proposal_url}\n\n{sender}'
  },
  kickoff: {
    body: 'Hi {first},\n\nThanks, we\'re on. Here\'s what happens next:\n\n1. {payment_step}\n' +
      '2. I\'ll send the steps to add me as a user on the tools involved. It only takes a few minutes.\n' +
      '3. The first fix will be live within a week, and all three within two to three weeks.\n\nI\'ll keep you posted as each one goes live.\n\n{sender}'
  }
};

function emailVars_(l) {
  var booking = setting_('BOOKING_URL');
  var pay = setting_('PAYMENT_URL');
  return {
    first: l.first_name || 'there',
    business: l.business || 'your shop',
    audit_url: l.audit_slug ? auditUrl_(l) : '',
    proposal_url: l.proposal_slug ? siteUrl_() + '/proposal/' + l.proposal_slug : '',
    top_finding: l.top_finding || '',
    fix_1: String(l.fix_1 || '').replace(/\.$/, ''),
    sender: setting_('SENDER_NAME') || 'Logan',
    next_day: nextBusinessDayName_(),
    booking_line: booking ? ' If a quick call is easier, grab a time here: ' + booking : '',
    payment_step: pay ? 'You can pay here whenever suits: ' + pay : 'I\'ll send the invoice today.'
  };
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
  var tpl = EMAILS[key], vars = emailVars_(l);
  return (tpl.subject ? 'Subject: ' + fillText_(tpl.subject, vars) + '\n\n' : '') + fillText_(tpl.body, vars);
}

function sendLeadEmail_(l, key) {
  if (!l || !l.email) return;
  var tpl = EMAILS[key], vars = emailVars_(l);
  var text = fillText_(tpl.body, vars) + footer_(l);
  var res;
  if (l.thread_id && !tpl.subject) {
    res = gmailSend_(l.email, 'Re: ' + threadSubject_(l.thread_id), text, { threadId: l.thread_id, inReplyTo: l.last_msg_id, unsubUrl: unsubUrl_(l) });
  } else {
    res = gmailSend_(l.email, fillText_(tpl.subject || tpl.fallbackSubject || 'Ledge Communications', vars), text, { unsubUrl: unsubUrl_(l) });
  }
  updateLead_(l, { thread_id: res.threadId, last_msg_id: res.messageId || l.last_msg_id, last_touch: new Date() });
  logEvent_(l.id, l.email, 'sent_' + key, '');
}

function safeSend_(l, key) {
  try { sendLeadEmail_(l, key); } catch (err) { logEvent_(l && l.id, l && l.email, 'error', 'Email ' + key + ' failed: ' + (err && err.message || err)); }
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
        '  Done with it: ' + ownerLink_('handled', l);
    }).join('\n\n'));
}

function sendDigest() {
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
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
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
  sheet_(name).appendRow(headers.map(function (h) { return obj[h] != null ? obj[h] : ''; }));
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
function paymentLine_() { return setting_('PAYMENT_URL') ? 'Approving tells us to go ahead. You\'ll get a payment link right away.' : 'Approving tells us to go ahead. The invoice follows the same day.'; }
function money_(n) { return Number(n || 0).toLocaleString('en-CA', { maximumFractionDigits: 0 }); }
function monthKey_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM'); }
function firstName_(name) { return String(name || '').trim().split(/\s+/)[0] || ''; }
function appendNote_(notes, line) { return (notes ? String(notes) + '\n' : '') + line; }
function rand_(n) { var s = ''; while (s.length < n) s += Math.random().toString(36).slice(2); return s.slice(0, n); }
function newId_(prefix) { return prefix + Utilities.formatDate(new Date(), tz_(), 'yyMMdd') + '-' + rand_(6); }
function slugify_(s) { return String(s || 'shop').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'shop'; }
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
  return '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#1B2A38">' +
    e.split(/\n{2,}/).map(function (p) { return '<p style="margin:0 0 14px">' + p.replace(/\n/g, '<br>') + '</p>'; }).join('') + '</div>';
}

function json_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
function text_(s) { return ContentService.createTextOutput(s).setMimeType(ContentService.MimeType.TEXT); }

function page_(title, msg) {
  return HtmlService.createHtmlOutput('<div style="font-family:Arial,sans-serif;max-width:520px;margin:48px auto;padding:0 16px;color:#1B2A38">' +
    '<h2 style="margin:0 0 8px">' + esc_(title) + '</h2><p style="color:#566A7E">' + esc_(msg || '') + '</p></div>').setTitle(title);
}
