# Ledge lead system: setup

Everything here is one-time, about two hours in total. After it, leads move from first touch to an approved
offer without you: a free Local Search Audit, then a $500 Google Ads audit for shops already running ads, or a
starting plan (setup plus monthly management) for shops that aren't.

Two rules while you set up:
- Passwords and API keys go straight into the tool that needs them (Cloudflare or Script Properties), never into chat.
- Do the steps in order. Step 4 gives you two values that step 2 needs, so you'll come back to Cloudflare once.

What it costs: $0 a month in fixed tools. Usage costs are the Claude API (roughly 50 cents to a dollar per audit on
Opus) and DataForSEO search data (1 to 2 cents per shop). The hub counts both and pauses itself at
`MONTHLY_ENGINE_BUDGET_USD` (US$250 since Oct 30, to see the first 100 or so cold emails through).

The site runs as a Cloudflare **Worker** at `https://ledgecomms.ledgelow.workers.dev` until you're happy with it.
Your Squarespace site stays up on ledgecommunications.com until step 9, so you can test and edit without anyone seeing.

## Where you are (Nov 12): false replies fixed, nothing waits on you

- **The 21 "replies" weren't replies.** Since the Ledge inbox went into Superhuman, a copy of our own last email turned up
  in prospects' threads two days after it went (most likely a Superhuman draft or reminder). The hub read each as their
  reply, so 21 shops stopped getting follow-ups and landed in your needs-you email. None were real. Now a message only
  counts as theirs when it isn't a draft, has a sender, isn't from the Ledge address or yours (`OWNER_EMAIL`), and
  doesn't just repeat one of our emails. On the first run after the update, the 21 go back into their sequence (a
  follow-up that came due meanwhile goes the next business morning), and the Events tab logs what each copy was
  (`false_reply_undone`).
- **Screenshots no longer hold anything up (`COLD_SHOT_WAIT_HOURS`, 24).** A cold audit waits a day for your phone
  screenshots, then gets written without them (it then says nothing about who advertises on that search). The 9 audits
  waiting since Nov 10 (Airdrie garage doors, Cochrane plumbers, KaiTech) go on the next run. 0 waits as long as it takes.
- **Read alerts need nothing from you (`READ_PULLS_FOLLOWUP`, yes).** When a prospect reads their audit for the first
  time, their next follow-up moves up to the next business morning (never sooner than 2 business days after the last
  email), and the alert says so. Writing to them yourself is optional. Prospects who already read theirs get the same
  move on the first run after the update.

Ship it:
1. Paste `Code.gs` into the Apps Script editor (replace everything) and save.
2. **Deploy > Manage deployments >** pencil icon **> Version: New version > Deploy** (the read change runs in the web app).
3. Upload `Code.gs` and `SETUP.md` to GitHub.

Two things to clear by hand: **Skip** Tru Electric and Stronghold Electric (waiting for review since Nov 3; the check
flagged both as builder and commercial shops), and approve or skip the four audits from Nov 9 and 10 (Macleod's,
5th Element, Timberline, Our Electrician).

## Where you were (Nov 9, afternoon): a shorter first email, read alerts, old pages cleared

- **A shorter first cold email (about 80 words).** It opens with the finding ("I searched "furnace repair calgary" on a
  phone in Calgary, and one thing stood out: ..."), then the audit link, then one plain ask ("Want me to send over where
  I'd start?"). The dollar estimate and the 10+ years line are out of it; the money stays on the audit and in email 3.
  Email 2 now reads "If you only do one thing from it, I'd start here: get on Local Services Ads." Audits already in the
  queue go out with the new copy.
- **Better hellos.** No more "Hi there" on cold emails: the name from the audit, else one read from the address
  (mike@ is "Hi Mike"), else the shop's team ("Hi Lamberts HVAC team"). A name you type in `first_name` on the Leads tab
  wins. When a shop replies, the first name in their From line is saved, so the thank-you says "Thanks Dana".
- **Shared inboxes** (info@, office@, service@) with no name get one extra line: "If someone else looks after marketing,
  I'd appreciate you passing this along."
- **Read alerts (`READ_ALERTS`, on).** The first time a cold prospect who hasn't replied reads their audit, you get
  "[Ledge] Lamberts HVAC just read their audit": when they were emailed, their priority, the next automatic email, the
  audit link, and a suggested two-line note. Reply in their thread from Superhuman as usual, and never mention that you
  saw them read it.
- **Your note stops the templates.** After sending it, tap the alert's "so the automatic emails stop" link, and nothing
  more goes to that shop on its own (the row's notes say so). The tap matters: notes sent from Superhuman go out through
  ledgelow@gmail.com, so the hub never sees them. A note written straight from the ledgecommunications@gmail.com inbox is
  noticed on its own within the hour. For a proposal, the nudge is dropped, and a quiet proposal still comes back to you
  after 5 business days.
- **Dead domains are skipped.** Before a first cold email, the address's domain is checked with Google's public DNS. One
  that doesn't exist or takes no email is skipped ("Email domain doesn't accept email"), and the next shop takes its slot.
  It can't tell when one mailbox is gone on a working domain, so the odd bounce still happens.
- **The old Squarespace pages.** The blog (posts, tags, and categories), /new-gallery, and the content marketing page now
  answer "410 Gone", which tells Google they were taken down on purpose. The four old service pages redirect: digital
  marketing and SEO to the home page, website development and landing pages to pricing.

Ship it:
1. Paste `Code.gs` into the Apps Script editor (replace everything) and save. `Templates.gs` hasn't changed.
2. **Deploy > Manage deployments >** pencil icon **> Version: New version > Deploy.** The read alert runs in the web app,
   so it starts only once the new version is deployed.
3. Upload `Code.gs`, `worker.js`, `cold-sequence.md`, `inbound-sequence.md`, and `SETUP.md` to GitHub (the Worker
   rebuilds in about a minute).
4. Search Console: **Indexing > Pages > Not found (404) > Validate fix.** Google takes a week or two to work through it.

The `READ_ALERTS` row appears on the Settings tab after the next hourly run.

## Where you were (Nov 9, morning): Search Console after the site switch

Done: www, plain http, and the old workers.dev address move to https://ledgecommunications.com for good; the sitemap at
/sitemap.xml (home, pricing, privacy) is submitted; home and pricing were sent for indexing. "Blocked by robots.txt"
(the per-shop audit, proposal, and report pages) and "Alternate page with proper canonical tag" or "Page with redirect"
(other addresses for the same page) are expected and stay.

## Where you were (Nov 5, night): a subject line test

- **`COLD_SUBJECT_B`** (Settings tab, starts as `Made this for {business}`): while it's filled in, every other cold first
  email goes out with it instead of the usual subject, alternating down the send queue so both get the same mix of shops.
  Placeholders: `{business}` (the shop's name, shortened: "Lamberts HVAC Ltd. Heating & Air Conditioning" becomes
  "Lamberts HVAC"), `{search}`, `{town}`, `{job}`. A shop whose placeholder can't be filled gets the usual subject.
  Follow-ups reply in the same thread, so they carry whichever subject the shop got. Clear the cell to stop the test.
- **The results** show in **Where the audits are** and the Monday digest, one line per subject: sent, bounced, read their
  audit, replied. A new `subject_test` column on the Leads tab says which one each shop got. There's no open tracking
  (no tracking pixel), so "read their audit" is the measure: it takes an open and a click.
- **Send a test cold email** now sends both subjects, so you can see each in your inbox.
- At 10 a day, each subject gets about 25 a week. Treat the first two weeks as a rough read, not a verdict.

Ship it: replace `Code.gs` in Apps Script (and GitHub), then Deploy > Manage deployments > edit > New version > Deploy.

## Where you were (Nov 5): checking the cold emails land

- **Ledge menu > Send a test cold email (spam check).** Sends the first cold email exactly as a shop got it (the latest
  one sent), through the same send path, to up to five addresses you type: a fresh mail-tester.com address for a spam
  score, and inboxes of your own on Gmail, Outlook or Hotmail, Yahoo, and a work account. Nothing on the shop's row
  changes, its unsubscribe links do nothing, and opening its audit link doesn't count as the shop reading it. Each test
  is logged on the Events tab as `test_cold_email`.
- **Your own views no longer count as a shop reading its audit,** from any browser that's opened a page with
  `?ledge_me=1` (the same switch that leaves it out of Google Analytics).

Ship it: replace `Code.gs` and `Templates.gs` in Apps Script, upload both and `SETUP.md` to GitHub, reload the Sheet so
the new menu item shows, and deploy a new version of the web app (Deploy > Manage deployments > edit > New version >
Deploy). Anything opened from a link (audit pages, approve links, the site form) runs on the deployed version.

## Where you were (Nov 4): Google Analytics and a privacy page

The new site had no analytics: the GA4 tag lived in Squarespace, so the property has shown nothing since the switch on
Oct 28. Now the Worker adds GA4 to every page (site, audits, proposals, reports) once `GA4_ID` is set in Cloudflare.
- **Each page is in a content group** (Home, Pricing, Privacy, Audit, Proposal, Account report, the samples), so audit
  visits read apart from the site's own pages. In GA4: Reports > Engagement > Pages and screens, then switch the first
  column to "Content group".
- **Events:** `generate_lead` (the site's audit form went through), `quote_request` (the ask on an audit, with the offer
  picked), `proposal_approved`, and `book_call_click` (any booking link).
- **Nothing a link carries reaches GA:** page addresses are sent without their query string (utm tags kept).
- **Your own visits are left out.** Any browser that opens a page with `?ledge_me=1` sends nothing from then on (a note
  at the bottom confirms it). The audit, proposal, and report links in the pipeline's emails to you carry it, so
  checking an audit from a review email never counts. Links to shops never carry it. `?ledge_me=0` undoes it.
- **Per-shop opens stay on the Leads tab** (`audit_opened`, `audit_opens`): that's who read their audit. GA is the
  overall picture.
- **Privacy page** at /privacy/, linked from every footer: what we collect, the service providers, Google Analytics with
  Google's opt-out, and how to ask for a copy or deletion. Google Analytics' terms require one.

Set up Nov 4 and 5 (done): `GA4_ID` in Cloudflare, the key events, and your browsers left out with `?ledge_me=1`
(`?ledge_me=0` undoes it). Optional: GA4 > Admin > Data collection > Data retention, set to 14 months.

## Where you were (Nov 3, night): homeowner shops only, each measured on its biggest job

The first wave had shops that don't really do homeowner work (a commercial overhead door company, a luxury general
contractor listed as an electrician, an electrical shop for builders), and every shop was measured on its trade's broad
searches. Now:
- **The home page is read first.** Before any search money is spent, the small model reads each prospect's home page:
  does it do its trade for homeowners, which of our priced big jobs it offers, and who it mostly works for. A cold
  prospect that mostly serves businesses, industry, or builders, or doesn't do the trade for homes, is held as
  `Held (not residential)` with what its page says. Site-form leads are never held. A page that can't be read (too
  little text, a script-built site) holds nothing. Turn it off with `FIT_CHECK`.
- **Each shop is measured on its biggest job.** The second search and the value box go on whichever big job its site
  offers would book the most work in its town at typical rates: heat pump installs, air conditioners (April to
  September), tankless water heaters, sewer lines, EV chargers, or the trade's usual one when nothing beats it. Prices
  and sources are in `engine/value-sources.md`.
- **Screenshots only for strong prospects.** The "Phone screenshots needed" email leaves out any prospect that would be
  held anyway, even with the most a screenshot could add to its score. Those are held right away instead of waiting.
- **On the first run after the update,** prospects you haven't approved get the home page read: non-residential ones
  are held (an approve link for one then says it's already handled), and ones whose site offers a bigger job worth more
  in their town get fresh searches on it and a new audit. Prospects held as lower priority get the same chance.
  **Where the audits are** now breaks the held count down by reason.

This version also carries everything from the evening update below, so paste this one in place of it.

## Where you were (Nov 3, evening): every cold audit waits for your OK

What went wrong: `REVIEW_AUDITS_FIRST` was 10 and 14 audits had been approved, so from then on any audit the check
passed went straight into the send queue without a review email. About 33 audits were queued that you'd never seen.
Now:
- **`REVIEW_ALL` (yes):** every cold audit waits for your OK, however many you've approved. The batch email's
  approve-all link keeps that to one click.
- **On the first run after the update,** audits queued without your OK come back (status `audit_ready`) and arrive in
  one "Check these N audits" email. The ones you approved stay queued. Chains are held even if approved (Home Depot
  Heating & Cooling: the email found belonged to the installer behind the listing). The audit that ran out of room
  is written again with more.
- **Where the audits are** now shows the whole line: being researched, written, checked, waiting for your review (and
  when it'll reach your inbox), approved and queued to send, emailed so far, and held.

## Where you were (Nov 3, afternoon): faster, fewer, stronger, reviewed in batches

The cycle was too slow (every step waited for the next hourly run) and weak prospects took the same slow, costly path
as strong ones. Now:
- **Only strong prospects get written up.** Before any audit is written, a cold prospect is held (status `held`, the
  reason in `priority_why`) when it's a chain or national brand (Home Depot, Reliance, Enercare, Mr. Rooter, and the
  like), its website doesn't load or shows a placeholder ("domain isn't connected"), its work can't pay for search ads,
  or it scores under `AUDIT_MIN_PRIORITY` (55). Dead sites are caught before any search money is spent. Lower the bar
  and the held ones come back on the next run.
- **More per run, less waiting.** Each run researches up to `SHOPS_PER_RUN` (15) shops instead of 6, and while work is
  with Claude a short extra pass runs 15 minutes later (`QUICK_RUNS`), so writing, the check, and its second read each
  take about 15 minutes to pick up instead of an hour. A wave of audits now takes an hour or two, not most of a day.
- **One review email per wave** (`REVIEW_BATCH`). Finished cold audits are held until the wave in progress is done, 10
  are ready, or the oldest has waited 4 hours, then come in one "Check these N audits" email, strongest first, with
  **one link that approves every audit in it with nothing flagged**. Flagged ones keep their own links. Site-form
  audits still come right away.
- **On the first run after the update,** chains and shops without a working site already in the pipeline (not approved)
  are held, and prospects not yet written up are held under the bar.

If the Sheet ever shows "Service using too much computer time for one day" (a free Gmail account gets 90 minutes of
script time a day), set `QUICK_RUNS` to no.

Ship it: replace `Code.gs` and `Templates.gs` in Apps Script and GitHub, then **Run now**.

## Where you were (Nov 3): each shop audited in its own town and trade

From the 9 audits on Nov 3:
- **Town:** a cold prospect was audited in the area we were searching when we found it, so a Calgary shop that came
  up in a Chestermere search got Chestermere's (much smaller) numbers. Now the shop's own town decides: the city on its
  Google listing, then its website (a street address with "AB" and the page title count most; a town it lists among
  the places it serves doesn't move it). New prospects outside the towns in `AREAS` are left out.
- **Trade:** same story. An HVAC shop found in a plumber search was audited as a plumber. Its Google category now sets
  the trade (HVAC contractor is heating and cooling), and a kind of business we don't do is left out or held.
- **Failed searches** ("Search 2 didn't run") are tried again on the spot, and the check no longer asks you for a
  screenshot when one didn't run.
- **The home page picture** (the phone capture from PageSpeed) now goes to both the writer and the check, so a site
  built with scripts (where our scan reads nothing) is judged from what a visitor actually sees.
- **Ads under a different legal name** ("CRC Electric LTD" for Colz) are matched by the shop's website, so they're
  theirs. The check no longer flags that.
- **Small towns:** with the corrected search totals, a town where the big job's searches book fewer than three a
  year gets no value box (rather than "two jobs a year from about $0 a month"). That's not the same as a money-loser:
  those shops aren't held, they just score lower.
- **No more doubled asks** in "NEEDS YOU".

On the first run after the update, every cold prospect that hasn't been emailed is checked against its own site and
listing: wrong town, wrong trade, or a failed search means fresh searches and a new audit (an audit already with
Claude for the old town is set aside). Flagged audits that were right are read again by the check with what it
knows now.

**Higher-value prospects:** small towns have small search markets, so their shops score lower (and should). To fill the
pipeline with stronger prospects, put the Calgary quadrants first in `AREAS` (or only them for now), then
**Find prospects now**: each run finds up to `PROSPECTS_PER_WEEK` shops in the next area on the list.

Ship it: replace `Code.gs` and `Templates.gs` in Apps Script and GitHub, then **Run now**.

## Where you were (Nov 2, night and evening): the check edits; the value box only when the money adds up

- The check reads each audit as the owner would, rewrites lines with problems in place, confirms what the writer said
  about the shop's site, and drops the value box when its numbers don't hold up. Your review email shows the finished
  audit; "NEEDS YOU" appears only for what a rewrite can't settle (wrong business, town, or trade).
- Search totals are capped at four times the three biggest searches (small towns were showing "600 a month").
- The value box shows only when the work it books starts at no less than the ad spend and its middle is at least twice it
  (`VALUE_MIN_RETURN`, 2). Appliance repair fails that and is off; `TRADES` is heating and cooling, plumbing,
  electrical, and garage doors (roofing and eavestroughs come back in March). Cold prospects outside `TRADES` are held.
- Every prospect has a priority out of 100 (`priority`, `priority_why`): what the work is worth (40), room to grow on
  Google (30), and how likely ads are to work (30). Everything runs strongest first.

## Where you were (Nov 2): a check before audits reach you

From your review of The Urban Electrician audit:
- **One map position per search.** The page and Claude's lines no longer set "#2 on the map" beside "#7 of 40 in Google
  Maps" (two different Google lists that often disagree). The shop gets one spot on the map per search, and the "You"
  line reads in sentences: "You're #2 on the map. Your website isn't in the first 20 results below the map."
- **Plainer moves.** Each "why" is a full sentence or two, the way you'd say it ("None of the shops at the top of the map
  have run search ads lately, so we'd start by testing ads on panel upgrade searches.").
- **"What a prospective customer sees"** is the new heading for the searches.
- **The check (`QA_ON`).** After Claude writes an audit, a second Claude read goes through it the way the owner
  would: anything confusing, two numbers for the same thing, parts that disagree, or claims the evidence doesn't back.
  Problems in Claude's lines get one rewrite with the problems spelled out. If it still isn't right, or the fix needs
  you, it comes to you with "Before you approve, the check flagged:" at the top of the review email. A flagged audit
  always waits for you. Adds about an hour and a few cents per audit.
- **Phone screenshots before writing (`REQUIRE_SHOTS`).** A cold audit now waits until every search it uses has a
  phone screenshot, and you get a "Phone screenshots needed" email listing the searches and the shops waiting on them
  (when the list grows, and once a day while anything waits). A site-form audit waits at most `SHOT_WAIT_HOURS` (4),
  then builds without, so it's still on time. **Where the audits are** shows both.
- **`REVIEW_AUDITS_FIRST` is now 20**, so the next 15 or so come to you before any go out on their own.

**Ship it (5 minutes)**
1. **Apps Script:** replace `Code.gs` and `Templates.gs`, save. **GitHub:** upload `Code.gs`, `Templates.gs`,
   `sample-audit.html`, and `SETUP.md`.
2. Nothing else to run. On the next run, every audit that hasn't gone out (the ones you approved too) goes through the
   check. Those that pass come back to you to approve, and the rest are rewritten first or wait for screenshots.
3. Watch for the "Phone screenshots needed" email: Chestermere and any other town without screenshots will be on it.
   The same list is under Ledge menu > **Searches that need a phone screenshot**. Name each file after its search
   ("electrician chestermere.pdf"; a number after it is fine) and it's read as that search, no guessing. A batch PDF
   with several searches in it is still matched page by page.
4. Approve from the new "Check this audit" emails, then turn on `COLD_EMAIL_ON`.

After a change to how audits are written, Ledge menu > **Check the waiting audits again** puts the unsent ones through
the check once more.

## Where you were (Nov 1): audits rebuilt around real evidence

Your review of the first audits found two data problems, and the page needed to scan better:
- **Ads and Local Services Ads:** our search data almost never includes them (Google holds ads back from automated
  searches; confirmed with the Diag check on phone and computer, by map point and by city name). Audits no longer say
  "no ads on this search". Instead: your phone screenshots of each search (read by Claude, shown on the page), and
  Google's Ads Transparency record for the shop and the shops at the top of the map, shown right on the page.
- **"google.com" websites:** Google now hands most results out as redirect links. The site name comes from the result itself.
- **Layout:** the short version (three lines), the value box built on one big-ticket job (price, searches a month, cost
  per click, then what a month of Google Ads could book; no fee; the working-out in a dropdown), six checks with icons,
  the phone screenshot beside each search, reviews against the top of the map, the home page on a phone, and an ask
  that says plainly nothing is paid or signed until they say go.

**Ship it (about 15 minutes, then the rebuild runs on its own)**
1. **Apps Script:** replace `Code.gs` and `Templates.gs`, add a new script file called `Jpeg` and paste in `Jpeg.gs`,
   delete the `Diag` file, save.
2. **Authorize Drive:** in the Sheet, Ledge menu > **Read new search screenshots now**. Google asks for Drive access
   (the hub keeps the screenshots and home page pictures there). Allow it. Then **deploy a new version** of the web app.
3. **GitHub:** upload `worker.js`, `sample-audit.html`, `sample-proposal.html`, `sample-site.jpg`, `Jpeg.gs`, and `SETUP.md`.
4. **Screenshots:** Ledge menu > **Searches that need a phone screenshot**. Search each one on your phone and take a
   full-page screenshot, or normal ones (the top of the results, then a scroll or two). Full-page JPEGs, and PDFs saved
   from Photos (one picture or a whole batch in one PDF), all work: the hub cuts each full page into screen-sized pieces.
   A full-page PNG doesn't; save it as a PDF from Photos first. Put them in the `Ledge search screenshots` folder in Drive
   (ledgecommunications@gmail.com), no renaming needed, then **Read new search screenshots now**. A full page takes a
   while, so run it again until it says everything is read. Each search lands in the Search screenshots tab with what
   Claude read: if your search box is blacked out, it matches the page to the searches your audits need and says so in
   the note. Check the `query` column once. Audit pages never show the screenshots, only what was on them.
5. **Rebuild:** Ledge menu > **Rebuild audits that haven't gone out**, then **Run now** three or four times a few
   minutes apart (each run gathers 6 shops). The audits come back for review over the next hour or two.
6. Keep `COLD_EMAIL_ON` off until you've approved the rebuilt audits.

If a screenshot's search didn't match (blank or "best guess" in the `query` column): **Re-read screenshots that didn't
match** clears those rows and any doubled ones and reads the files again. If a row is still blank, open its `link`
(for a batch PDF, the `#4` on the file ID means page 4), type the search into `query`, and run it once more: that page
is read again as the search you typed. Then **Rebuild audits that now have screenshots** rewrites only the waiting audits that gained screenshot data,
keeping their searches, so it's quick. When a shop has several "Check this audit" emails, use the newest one.

Screenshots stay in use for `SEARCH_SHOT_DAYS` (14). One screenshot covers every shop in that trade and town, so
it's roughly 10 a week once the pipeline settles. Since Nov 2, a cold audit waits for its screenshots (see above); a
site-form audit that builds without one makes no claim about who's in the ads, and marks the Local Services Ads check "Couldn't check".

## Where you were (Oct 30, evening): mailbox address, worksheet decisions built

Live: site, pricing page, hub, DataForSEO, PageSpeed, FreshBooks (connected, with online payments), the manager account (871-805-0188), and the export script (authorized through ledgelow@gmail.com, hourly).

**Ship this update (Oct 31, last one before launch, 5 minutes)**
1. **Apps Script:** replace `Code.gs`, save, then deploy a new version.
2. **GitHub:** upload `Code.gs`, `cold-sequence.md`, and `SETUP.md`.

What changed: cold email 4 in your final words, and weekends. Anything that answers someone who asked (their audit, a
proposal, the note after a yes) now goes out any day, 7 am to 9 pm. Cold first emails and every follow-up stay on
weekdays. Promises still count business days ("by end of day Monday").

**Launch checklist**
1. Site-form trial (fine on a weekend now): the form on ledgecommunications.com as `ledgelow+trial1@gmail.com` with a
   real Calgary shop's website. Check the confirmation, the "Add a personal line and send" link in the "Check this
   audit" email (within a couple of hours), your line under "Hi" in the audit email, `audit_opened` on the Leads tab
   after the audit's been on screen a few seconds, and a "Not right now, maybe in the spring" reply landing in the
   5 pm email with check-back links. Then set that row's status to `skipped`.
2. Approve the rebuilt audits as they come in. Approved cold shops queue for the first sends.
3. Set `COLD_EMAIL_ON` to yes. The first 5 go out Monday morning, then 5 a day, rising by 5 a week to 10.
4. Monday's weekly digest, then the first real read after about 100 first emails (three to four weeks).

**Oct 31, round two (done): your last email edits**
1. **Apps Script:** replace `Code.gs` and `Templates.gs`, save, then deploy a new version. No rebuild needed this time.
2. **GitHub:** upload `Code.gs`, `Templates.gs`, `cold-sequence.md`, `inbound-sequence.md`, and `SETUP.md`.
3. A new `SENDER_TITLE` setting (Founder) goes in the signature: "Logan Edgelow | Founder, Ledge Communications".

**Oct 31, morning (done): the final email copy (10 minutes, then a rebuild)**
1. **Apps Script:** replace `Code.gs` and `Templates.gs`, save, then deploy a new version.
2. **GitHub:** upload `Code.gs`, `Templates.gs`, `sample-audit.html`, `cold-sequence.md`, `inbound-sequence.md`, and `SETUP.md`.
3. **Ledge > Rebuild audits that haven't gone out** (once). The audit write-ups now open with one big job, so audits
   written before today need fresh ones. Roughly 80 US cents each; they come back for your OK over a few hours.
4. Read the **Final emails** tab in the email worksheet and tick its box.
5. Monday: the site-form trial run. When it checks out, set `COLD_EMAIL_ON` to yes.

What's new: every email in its final wording (your edits, "just reply and let me know" as the ask, "All the best,"
sign-offs, the shorter subject lines, no booking link in the first cold email). Audits and emails lead with one big job,
and the yearly range follows. Claude sorts replies (yes, no, later, other) with a small model (`REPLY_MODEL`), so
"Yes, we already have someone" comes to you instead of getting a proposal; the word lists are the fallback. Proposals
still quiet 5 business days after their nudge show up in your 5 pm email. Test invoices go to your `+fbtest` alias.

**Online payments on invoices (Oct 30, late afternoon, done)**
Invoices the hub makes through FreshBooks' API don't get a pay-online button on their own. The hub now copies your
default online payment options onto each invoice before FreshBooks emails it.
1. **Apps Script:** replace `Code.gs`, save, then deploy a new version. **GitHub:** upload `Code.gs` and `SETUP.md`.
2. In FreshBooks > **Payments** > **Online Payments**, check the defaults for invoices are on (card, and bank payments if
   you offer them). Those are what get copied.
3. **Ledge** > **Send a test invoice to myself**. The pop-up says "Online payments: on" or why not.
4. **If it says HTTP 403 (it did on the first try):** the Ledge app in FreshBooks can read payments but not change them.
   In FreshBooks, open the developer page (my.freshbooks.com/#/developer), edit the `Ledge hub` app, tick **payments: write**
   (keep everything else), and save. Then **Ledge** > **Connect FreshBooks** again (new permissions need a fresh
   connection) and rerun the test invoice.

**Evening update (done)**
1. **Settings tab:** set `MAILING_ADDRESS` to `1122 3 St SE, Ste 1906 #117, Calgary, AB T2G 0E7` (one line). Every
   email footer uses it from then on.
2. **FreshBooks:** Settings > Business > address: the same mailbox address, so invoices carry it too.
3. **Apps Script:** replace `Code.gs` and `Templates.gs`, save, then **Deploy** > **Manage deployments** > edit > **New
   version** > **Deploy**.
4. **GitHub:** upload `Code.gs`, `Templates.gs`, `worker.js`, `index.html`, `pricing.html`, `sample-audit.html`,
   `cold-sequence.md`, `inbound-sequence.md`, and `SETUP.md`.
5. **Settings tab, on its own:** the next hourly run applies the worksheet calls you made, wherever a cell still holds
   the old default: `COLD_PER_DAY_MAX` 10, `PROSPECTS_PER_WEEK` 40, `REVIEW_PROPOSALS_FIRST` 10, `TRADES` without roofing
   and eavestroughs (add them back in March), and a new `INBOUND_HOLD_HOURS` of 3.

What's new:
- **Mailbox address** in the site footer (home and pricing pages). Your home address is no longer used anywhere once
  `MAILING_ADDRESS` is changed.
- **Who opened their audit.** The audit page tells the hub once it's been on screen for four seconds (link scanners
  don't count, and neither do your own checks before it goes out). New Leads columns `audit_opened` and `audit_opens`;
  the weekly digest counts first opens and replies.
- **Check back later.** Each reply in the 5 pm needs-you email now has three links: in a month, in 3 months, early
  March. Pick one and that shop gets one short note on the day, and nothing before it.
- **A personal line on site-form audits.** Site-form audits now wait up to 3 hours (`INBOUND_HOLD_HOURS`) for your OK.
  The email about it has an "Add a personal line and send" link: type a line, tap Send, and it goes right under "Hi
  Dana,". If you don't get to it, it goes out on its own. An audit you approve after 9 pm goes at 7 am.

**Pricing cleanup (Oct 30, afternoon, done):** "Clear prices, no long-term contract.", the "Is there a contract?" answer,
"Google Ads audit" everywhere a customer sees it, add-ons at $750, $1,500, and $125 an hour, and the footer email link.

**Oct 28 update (done)**
1. **Apps Script:** replace `Code.gs` and `Templates.gs`, save, then **Deploy** > **Manage deployments** > edit > **New
   version** > **Deploy**. The next run adds two tabs, **Clients** and **Invoices**, and a `MONTHLY_REVIEW` setting.
2. **The export script:** signed in as ledgelow@gmail.com (the login that authorized it), open the manager account >
   **Tools** > **Bulk actions** > **Scripts** > "Ledge account export". Select all, paste the new `ledge-ads-export.js`
   over it, put your `HUB_URL` and `HUB_KEY` back in on lines 11 and 12, then **Save**. **Preview** should still say
   `0 account(s) to export`.
3. **GitHub:** upload `Code.gs`, `Templates.gs`, and `SETUP.md` (nothing else changed).

**Google Verified (Oct 28, late night):** Google retired "Google Guaranteed" (and "Google Screened") in late 2025 for
one "Google Verified" badge on Local Services Ads, and ended the money-back guarantee. The site, audits, reports,
proposals, and prompts now say Local Services Ads, with Google Verified only for the badge, and never promise a
guarantee. Audits built before this update still say Google Guaranteed.

**Rebuild everything that hasn't gone out (once):** **Ledge** > **Rebuild audits that haven't gone out**. It re-runs the
searches and the write-up for every audit waiting for review or for cold email, so they get the new wording, the dollar
estimate, and the profile details. (A single Rebuild link clicked before this update reused the old searches, so this
catches those too.) Roughly 80 US cents an audit; they come back for review over a few hours.

**Monthly reports and billing**
- **Clients tab.** Every approved management plan or starting plan adds a row. It's yours to edit: `status` (active,
  paused, or ended), `monthly_fee`, `bill_from` (the first month to invoice, as 2026-12), and `notes_for_report` (what you
  worked on or want mentioned; the next report uses it).
- **Customer IDs.** Management clients reply to the kickoff with theirs, the hub fills it in, and you get the usual
  "Send a link request" email. For a starting plan, put the new account's customer ID in the Clients tab once you've
  made the account.
- **Between the 2nd and the 7th of each month**, the hub asks the export script for last month's numbers and the
  account's change history for each active client with a customer ID. Claude writes a short report (the month against
  the one before, roughly what the calls and forms are worth, what we changed, the searches that brought calls, and what's
  next) and you get a "Check ... report" email. Approving sends it to the client. It also flags when last month's spend
  sits in a different fee tier from what they pay.
- **The month's management invoices** are drafted at the same time and come to you in one email; one link sends them
  all from FreshBooks, and you get a "Paid" email for each. Management plans bill from the month after approval
  (setup covers the first). A starting plan bills from the first full month after its ads start spending.
- `MONTHLY_REVIEW` is yes to start, so nothing goes to a client or out as an invoice without your OK. Set it to no
  once you trust it.

**Earlier on Oct 28**
New in this update:
- **What it's worth.** Free audits now open with roughly what the searches are worth in booked work a year, and
  account reports with roughly what the ads bring in a month. The emails lead with it too. Every page carries a footnote
  saying it's an estimate and how it was worked out. See "How the estimate works" below.
- **Account and site audit, $1,000.** The account audit stays $500. When a free audit finds things to fix on the
  website as well as in the ads, its ask offers both, with the $1,000 one picked. The report then adds a "Your website"
  section (speed on a phone, tap-to-call, forms, booking, service pages, trust, tracking) with each fix priced.
- **Site support, $100 an hour**, for site changes bigger than the page fixes add-on. On the pricing page and in reports.
- **No more "you can do this yourself" tags.** Quick wins say "Quick win, included in any Ledge plan", and page
  fixes say "We make the changes, or guide whoever runs your site".
- **Pricing page** rebuilt as plan cards: audits, running your ads, and website add-ons.
- **FreshBooks invoicing**, ready to switch on once you've done the steps in "FreshBooks and payments" below.
- **Sharper checks (Oct 28, late):** free audits now read the shop's Business Profile details from the Maps results we
  already pay for (claimed or not, categories, photos against the shops above, hours, booking link), and site audits
  add PageSpeed's search basics and accessibility checks. Only `Code.gs` and `Templates.gs` changed.

**Shipped earlier tonight (done)**
1. **Apps Script:** replace `Code.gs` and `Templates.gs`, save, then **Deploy** > **Manage deployments** > edit > **New
   version** > **Deploy**. The next run adds the new Settings rows (`PRICE_FULL_AUDIT` 1000, `PRICE_SITE_SUPPORT` 100,
   `INVOICE_DUE_DAYS`, and the `VALUE_` rows) and a few columns.
2. **GitHub:** upload the 25 files from the new zip (same names as last time).
3. **Before your first site audit (5 minutes):** a free Google API key for the speed test, which otherwise gets
   rate-limited. In Google Cloud Console (signed in as the Ledge account): pick or create a project > **APIs & Services**
   > **Library** > "PageSpeed Insights API" > **Enable**. Then **Credentials** > **Create credentials** > **API key**.
   Paste it into Script Properties as `PAGESPEED_API_KEY`.

**Audits already built:** see "Rebuild everything that hasn't gone out" above.

**How the estimate works**
- Free audit: Google's monthly search estimates for the town, across all the related searches about the work (one
  extra DataForSEO lookup per town and trade, about 7.5 cents, kept 60 days), times typical Google Ads rates for that
  trade, times the share of calls and forms that get booked, times a typical Calgary-area price for the everyday job.
  In big markets it stops at what a $1,500 a month budget buys, so Calgary numbers don't balloon. The big job (a furnace
  replacement, say) is mentioned separately.
- Account report: the calls and forms the account actually recorded, times the booking rate, times the same prices.
- `VALUE_BOOK_RATE` (35% to start) is the one to change once you know a client's real booking rate. Prices and trade
  rates are in the code, with every source in `engine/value-sources.md`. Tell me if a trade's prices look off.

**FreshBooks and payments (about 30 minutes, plus FreshBooks' review)**
You don't need a separate Stripe account. FreshBooks Payments in Canada runs on Stripe and is set up inside FreshBooks.
1. In FreshBooks (the Ledge business): **Settings** > **Business info**: country Canada, and your GST number if you
   have one.
2. **Settings** > **Payments and Client Billing** > **Online Payments** > **Get Started**. It asks for your details,
   business type, and bank account (institution, transit, and account numbers), then FreshBooks reviews it and
   emails you. Once it shows as active, turn on online payments by default for new invoices.
3. The developer app: go to **my.freshbooks.com/#/developer** > **Create an App**. Name: `Ledge hub`. Type: **Private
   App**. Scopes: clients (read and write), invoices (read and write), and payments (read and write). Redirect URI: the hub's web
   app address (Script Properties > `WEB_APP_URL`, the one ending in `/exec`). Save.
4. Copy the app's **Client ID** and **Client Secret** straight into Script Properties as `FRESHBOOKS_CLIENT_ID` and
   `FRESHBOOKS_CLIENT_SECRET`.
5. In the Sheet: **Ledge** > **Connect FreshBooks** > the link > sign in and allow. You'll land on "FreshBooks
   connected".
6. **Ledge** > **Send a test invoice to myself**: a $1 invoice to your inbox. Check the pay-online button shows,
   then delete it in FreshBooks. Send me what you see if anything's off.

After that, each approved proposal gets a FreshBooks invoice within the hour (setup or the audit, less any credit, plus
add-ons and GST), and you get a "Paid" email when it's paid. Monthly management fees go out each month too (see
"Monthly reports and billing" above).

**Prices from here on** are just the Settings tab: edit a cell and proposals use it right away; the site follows
within about 10 minutes.

**When the audits arrive**
4. They come in one "Check these N audits" email per hourly run, not one email each. Open each audit, then use its
   **Looks right**, **Rebuild**, or **Skip** link. Approving sends nothing while `COLD_EMAIL_ON` is no.
5. Send me anything that reads off. When they read right, `COLD_EMAIL_ON` = yes.

**Account audits ($500, or $1,000 with the site audit)**
The export script lives in the manager account (**Tools** > **Bulk actions** > **Scripts** > "Ledge account export"),
authorized through ledgelow@gmail.com and running hourly. If that user is ever removed from the manager account, the
script stops until another admin authorizes it.
1. They approve the account audit. The kickoff email asks for their 10-digit Google Ads customer ID.
2. They reply with it. The hub reads the ID from the reply (ignoring their phone number), tells them a link request is
   coming, and sends you a "Send a link request" email with the one manual step: manager account > **Accounts** >
   **+** > **Link existing account** > their ID > **Send request**. If the hub can't find an ID in the reply, it flags
   the reply for you instead. For anyone who sends it some other way, use **Ledge** > **Run an account audit**.
3. They accept the link. Within the hour the export script reads 90 days of their account (it only reads) and sends
   it to the hub, which works out the numbers itself: spend, searches that brought nothing, what's counted as a
   conversion, locations, budget limits, and the rest. With the site audit, the hub also scans their home page and runs
   Google's speed test on a phone. Claude writes the report around those numbers.
4. You get a "Check this account audit" email with the report link, the biggest finding, and the management price
   it would lead to. **Looks right, send both** sends them the report and a management plan priced on what they
   spend now, with the $500 off setup. **Write the report again** reruns Claude on the same data.
5. If they approve the plan, the kickoff skips the access step (you're already linked). If a link isn't accepted
   within three weeks, the hub stops asking and emails you.

**Later**
7. Next build: a page per industry. Monthly reports and billing are done (above).
8. Optional: move the domain registration to Cloudflare Registrar before Mar 31, 2027.

**Add-ons.** Audits can tag one move as a page fix or a landing page, with its price. Proposals then show it as an
optional checkbox next to the approve button, and the "Approved" note and invoice details include whatever they tick.
The pricing section on the site lists both. Prices live on the Settings tab like everything else.

**New on the Ledge menu**
- **Check one shop**: runs the audit searches on any website and shows the results. Nothing is saved to Leads.
- **Run an account audit**: starts one by hand from an email address and customer ID (adds the lead if it's new), and
  asks whether to include the site audit.
- **Connect FreshBooks** and **Send a test invoice to myself**: see "FreshBooks and payments".
- **Make a management proposal**: for anyone already running ads, outside the account audit flow. Asks for their email and
  monthly ad budget, then the proposal goes through the usual review and send. An approved account audit inside the
  credit window comes off setup automatically.

---

## 1. Put the site in GitHub (10 minutes)

Done. Kept here for reference. The repo is flat on purpose: 24 files, no folders, so nothing can get lost in the upload.

1. GitHub > `ledgecomms` > **Settings** > scroll to **Danger Zone** > **Delete this repository**.
2. **New repository** > name `ledgecomms`, **Private** > **Create repository**.
3. Download `ledgecomms-flat.zip` and unzip it (on Windows: right-click > **Extract All**).
4. On the new repo's page, click **uploading an existing file**. Open the unzipped `ledgecomms-files` folder,
   select all 24 files and drag them in (or pick them with "choose your files"). **Commit changes**.
5. The repo's main page should list 24 files, including `worker.js`, `build-site.js`, and `wrangler.jsonc`,
   with no "(1)" or "(2)" in any name.

**Updating the repo:** on the repo's main page, **Add file** > **Upload files**, drag in the new files (same names
replace the old ones), and **Commit changes**. Cloudflare rebuilds in about a minute; check the workers.dev address.
To delete a file: click its name > the **...** menu (top right) > **Delete file** > **Commit changes**.
Photos: every `.jpg` in the repo is published, and the build stops with a "Missing from the repo" message if a page
uses a photo that isn't there.

## 2. Cloudflare Worker (15 minutes)

1. **Workers & Pages** > `ledgecomms` > **Settings** > **Builds**. Disconnect the old repo, then **Connect** >
   GitHub > `ledgecomms`. If it isn't in the list, use the link there to give Cloudflare's GitHub app access to it.
2. Build settings: Build command blank. Deploy command `npx wrangler deploy` (the default). Root directory `/`.
   Save. `wrangler.jsonc` does the rest: it arranges the site's folders, runs `worker.js`, and serves only the site.
3. When the build finishes, open `https://ledgecomms.ledgelow.workers.dev` on your phone. You should see the new site.
   If the Builds settings look stuck, delete the Worker (Settings, bottom of the page) and make it again:
   **Create application** > **GitHub** > `ledgecomms`, keeping the name `ledgecomms`.
4. **Turnstile** (left menu, under Application security) > **Add widget**. Name it Ledge. Hostnames:
   `ledgecommunications.com` and `ledgecomms.ledgelow.workers.dev`. Mode **Managed**. Keep the two keys handy.
5. Worker > **Settings** > the **Variables and Secrets** card near the top of the page > **Add**. There's a second
   "Variables and secrets" box further down, inside the **Build** section (under Root directory, Build watch paths, and
   API token). That one only feeds the build step; the live site never sees it, so don't use it. Types: **Text** (plain,
   stays visible) or **Secret** (hidden once saved). Names must match exactly, in capitals. Saving there deploys a new
   version on its own, and `wrangler.jsonc` tells GitHub deploys to keep these.

| Name | Type | Value | When |
| --- | --- | --- | --- |
| `TURNSTILE_SITE_KEY` | Text | The Turnstile **site key** | Now |
| `TURNSTILE_SECRET` | Secret | The Turnstile **secret key**. The name is `TURNSTILE_SECRET`, with no `_KEY` on the end | Now |
| `HUB_URL` | Secret | The hub's web address, from step 4.8. Starts `https://script.google.com/macros/s/` and ends `/exec` | After step 4 |
| `HUB_KEY` | Secret | The hub's password, from step 4.6. A long string of letters and numbers the hub makes for itself | After step 4 |

`HUB_URL` is where the site sends each audit request; `HUB_KEY` proves the request came from your site. Until both are
in, the form says it couldn't send. A secret can't be renamed: to fix a name, delete it and add it again.

These go under **Settings** > **Variables and Secrets**, not under **Settings** > **Builds** (that section is for build
settings, and the site never sees what's there). To check the site key is working, open the site: a small Cloudflare
box appears just above **Send me my audit**. If it's missing, the site isn't seeing `TURNSTILE_SITE_KEY`. With the secret
set and the box missing, every form submission is turned away, so fix this before the trial runs. The usual causes:
the keys were added under **Builds** instead of **Variables and Secrets**, the name has a typo or a space, or the change
was saved as a version without being deployed (choose **Deploy**).

The custom domain comes last (step 9), once the site reads right.

## 3. Claude API key (10 minutes)

1. console.anthropic.com, signed in with ledgelow@gmail.com (or the Ledge account, your call).
2. **Billing**: make sure there's credit on the account. On the Opus model an audit costs roughly 50 cents to a dollar,
   searches and page reads included; finding a week of prospects is about the same.
3. **Limits**: set a monthly spend limit, for example US$75. The hub also pauses itself once its own estimate passes
   `MONTHLY_ENGINE_BUDGET_USD` (60 to start), and the weekly digest shows the month's spend so far.
4. **API keys** > Create key, name it "Ledge hub". Copy it for step 4. Don't paste it anywhere else.

## 4. The pipeline hub (25 minutes)

Do this signed in as **ledgecommunications@gmail.com**, because every email goes out from the account that owns the hub.

1. Google Sheets > new sheet, name it **Ledge Pipeline**. **Extensions** > **Apps Script**. Rename the project
   (top left, "Untitled project") to **Ledge Pipeline**.
2. Apps Script **Project Settings** (gear) > tick **Show "appsscript.json" manifest file in editor**.
3. In the editor:
   - Replace the contents of `appsscript.json` with the repo's `appsscript.json`.
   - Replace `Code.gs` with the repo's `Code.gs`.
   - **+** > Script, name it `Templates`, and paste the repo's `Templates.gs`.
   - Save.
4. **Services** (+ next to Services) > **Gmail API** > Add. (The manifest asks for it too; this just confirms it.)
5. Pick `setup` in the function menu > **Run**. Google warns the app isn't verified, because it's your own script:
   **Advanced** > **Go to Ledge Pipeline (unsafe)** > **Allow**. It asks for Gmail, Sheets, Calendar, and
   outside connections, all used by the hub.
6. The **Execution log** opens at the bottom of the editor. One line reads
   `HUB_KEY (paste into Cloudflare as HUB_KEY): ` followed by a long string of letters and numbers. Copy just that
   string. This is `HUB_KEY`. (Lost it? It's also under **Project Settings** > **Script Properties**.)
7. **Project Settings** > **Script Properties** > add `ANTHROPIC_API_KEY` with the key from step 3, plus
   `DATAFORSEO_LOGIN` and `DATAFORSEO_PASSWORD` from dataforseo.com (API Access in your DataForSEO dashboard).
8. **Deploy** > **New deployment** > gear > **Web app**. Execute as **Me**, Who has access **Anyone**. Deploy. The
   confirmation shows a Deployment ID and a **Web app** URL; copy the URL (it ends in `/exec`). This is `HUB_URL`.
9. Add one more Script Property: `WEB_APP_URL` = that URL.
10. Back in Cloudflare: Worker > **Settings** > **Variables and Secrets** > **Add**, twice, both as **Secret**:
    `HUB_URL` = the web app URL from step 8, and `HUB_KEY` = the string from step 6.
11. Back in the Sheet, reload it. A **Ledge** menu appears. Fill in the **Settings** tab:
    - `SITE_URL`: `https://ledgecomms.ledgelow.workers.dev` while you test, so links in emails work (step 9 switches it back)
    - `OWNER_EMAIL`: your everyday inbox, where review emails and the 5 pm list go
    - `SENDER_NAME`: your full name, exactly as it should appear on emails
    - `MAILING_ADDRESS`: your home address, on one line (step 7)
    - `BOOKING_URL`: the Superhuman link (step 6), optional
    - `GST_REGISTERED`: leave it at **yes** (Ledge is registered)
    - Pricing, all CAD before GST: `PRICE_ACCOUNT_AUDIT` (500), `ACCOUNT_AUDIT_CREDIT_DAYS` (30), `MGMT_TIERS`
      (`1000:500, 2000:800, 4000:1200, 8000:15%`: budget-from:fee), `MGMT_MIN_FEE` (500), `MIN_AD_BUDGET` (1000), and
      `SETUP_MONTHS` (1). You can also edit the prices on a single proposal before approving it. `PRICE_SPRINT` and
      `PRICE_CARE` only matter for proposals made before the switch
    - Leave `COLD_EMAIL_ON` at **no** for now
    - `MODEL`: `claude-opus-5-5`, the stronger model for research and writing. `claude-sonnet-5-5` costs about half
    - `MONTHLY_ENGINE_BUDGET_USD`: `60` to start. Raise it any time
    - `TRADES`: `heating and cooling, plumbing, electrical, roofing and eavestroughs, garage doors, appliance repair`.
      Each one gets its own Google Maps search when the hub looks for prospects
    If you ran `setup` before these defaults changed, those cells still hold the old values; type the new ones in.
12. In the **Sheet** (not the script editor), reload the page. A **Ledge** menu appears at the top, to the right of
    **Help**. **Ledge** > **Check settings** should say the settings look complete. The first time, Google asks you to
    allow the script again; that's expected. (Running `showSettingsCheck` from the script editor writes the same
    answer to the Execution log instead.)

If you ever change `Code.gs`: **Deploy** > **Manage deployments** > edit > Version **New version** > Deploy.
The URL stays the same.

## 5. Gmail details (15 minutes)

In ledgecommunications@gmail.com. The files come from `ledge-brand-kit.zip`.

1. **Name:** **Settings** > **Accounts** > **Send mail as**: your full name. (Done.)
2. **Profile photo:** myaccount.google.com > **Personal info** > **Profile picture** > `ledge-mark-profile-photo.jpg`.
   It shows next to your emails in Gmail and on calendar invites. A clear headshot works too, and for cold email from
   one person it can feel more personal; your call.
3. **Signature** (for emails you write yourself; the hub's emails carry their own footer): **Settings** > **See all
   settings** > **General** > **Signature** > **Create new**, then paste:

       Logan [last name]
       Ledge Communications
       Alberta, Canada · ledgecommunications.com

   Set it as the default for new emails and for replies, and tick **Insert this signature before quoted text**. Plain
   text is the better choice: images in signatures can push cold email toward spam folders and show up as attachments.
   If you want the logo on emails you write yourself, insert `ledge-logo-email-signature.png` and set it to small.
   Superhuman has its own signature setting, so paste the same text there.
4. **Undo send:** **General** > **Undo Send** > 30 seconds.
5. **2-Step Verification:** myaccount.google.com > **Security**. Turn it on; this account sends every email and runs the hub.
6. **Leave threads alone:** archiving and labels are fine, but don't delete emails from leads. The hub reads each
   conversation to notice replies.

**One inbox: ledgelow@gmail.com, through Superhuman.** Superhuman runs on ledgelow@gmail.com, so Ledge mail comes to you
there and you reply as Ledge. The hub keeps its own copy and keeps working.

1. In **ledgecommunications@gmail.com**: **Settings** > **See all settings** > **Forwarding and POP/IMAP** > **Add a
   forwarding address** > `ledgelow@gmail.com`. Google emails a confirmation code to ledgelow; enter it. Then pick
   **Forward a copy of incoming mail to ledgelow@gmail.com** and **keep Gmail's copy in the Inbox**. Keep the copy:
   the hub reads it to notice replies, opt-outs, and bounces.
2. In **ledgelow@gmail.com**: **Settings** > **See all settings** > **Accounts and Import** > **Send mail as** > **Add
   another email address**. Your full name, `ledgecommunications@gmail.com`, leave **Treat as an alias** ticked. The
   verification email arrives through the forward from step 1; click it. Then, in the same section, choose **Reply from
   the same address the message was sent to**.
3. In Superhuman, reply to a Ledge email and check the From line shows ledgecommunications@gmail.com. Superhuman uses
   the addresses set up in Gmail.

A few inboxes (mostly Outlook) may show those replies as sent "on behalf of" the other address. It's cosmetic. The hub
notices a lead's reply on its own copy and stops its follow-ups, so you and the hub won't talk over each other.

## 6. Superhuman booking page (10 minutes, optional)

Calls are optional and the link only ever appears in emails, never on the site. The emails always ask for a reply first.
Your booking page lives on ledgelow@gmail.com (Superhuman), so bookings land on that calendar. Done so far: the link is
in `BOOKING_URL`, and your Kulin calendar counts as busy time. Two things let the hub see the bookings:
1. In Google Calendar on **ledgelow@gmail.com**: your calendar's **Settings and sharing** > **Share with specific
   people** > add `ledgecommunications@gmail.com` with **See all event details**. In the Ledge account, open the share
   email and click **Add this calendar**.
2. In the Ledge Pipeline sheet, Settings tab: `CALENDAR_ID` = `ledgelow@gmail.com`.

Keep "Ledge" in the booking page's event title (for example "Ledge Communications call"): the hub only looks at events
with that word in the title, so the rest of your calendar is left alone.

## 7. Mailing address (1 minute)

Canada's anti-spam law requires a mailing address in every commercial email, cold or not. Use the Ledge mailbox
(Anytime Mailbox Calgary): `1122 3 St SE, Ste 1906 #117, Calgary, AB T2G 0E7`, in the `MAILING_ADDRESS` setting on one
line. It's also in the site footer and on FreshBooks invoices. Cold email won't start until it's filled in.

Keep the mailbox off your Google Business Profile: Google doesn't accept mailbox addresses there (next step).

## 7a. Ledge's own Google Business Profile (optional, 20 minutes plus verification)

A profile puts Ledge on the map and gives first clients somewhere to leave reviews, which matters for a business that
sells local search. Google lists businesses that have a location customers can visit, or that travel to customers where
they are. Ledge fits the second only if you'll actually meet clients at their shop (a kickoff visit counts). If it stays
email and phone only, skip this: Google's rules don't cover a remote-only service.

1. At business.google.com, signed in as ledgecommunications@gmail.com, add **Ledge Communications**: the real name,
   nothing added to it.
2. Category: **Internet marketing service**. Add **Marketing agency** as a second one.
3. When it asks about a location customers can visit, say **no**. Give your home address only where Google asks for it
   to verify; it stays hidden from the public. Never use the mailbox here: Google doesn't accept mailbox or virtual
   office addresses, and that's a common reason profiles get suspended.
4. Service areas: Calgary, Airdrie, Chestermere, Cochrane, and Okotoks (the same as `AREAS`). Google allows up to 20, within
   about two hours' drive.
5. Website ledgecommunications.com. A phone number is optional (it ties into the worksheet's phone decision).
6. Verification is usually a short, unedited video, filmed in one take. Show where you are (street signs or landmarks near
   home are fine for a home-based business), that the business exists (your workspace, with the site or an audit on
   screen), and that you run it (a FreshBooks invoice or other document in the name Ledge Communications). Keep bank,
   tax, and ID numbers out of frame.
7. Hours: when you take calls.

## 8. Trial runs (20 minutes, phone is fine)

Use a personal address that isn't ledgecommunications@gmail.com.

1. **Site lead.** Fill in the form on ledgecommunications.com, including the optional town, Google Ads, and budget questions.
   Expect a confirmation email within a minute and a row on the Leads tab, with your answers in the `owner_says`
   column. Within a few hours (batches usually finish inside the hour, occasionally longer) you get a
   "Check this audit" email. Open the preview, then approve it. The audit email lands in the same thread.
2. **The offer.** At the bottom of the audit page, use the form (**Book the account audit** if you said you run ads,
   **Send me a starting plan** if not). You get "Check this proposal"; approve it. The proposal email arrives. Open the
   page and approve it there. Expect the kickoff email and an "Approved" note to you.
3. **Opt-out.** From a second test address, reply "unsubscribe" to any email. It stops and lands on the Do not contact tab.
   Also try the unsubscribe link at the bottom of an email.
4. **Cold prospects.** **Ledge** > **Find prospects now**. New shops from Google Maps appear on the Leads tab right
   away, and their audits come to you for review over the next few hours. Nothing goes to a shop while
   `COLD_EMAIL_ON` is no.

If anything looks off, the **Events** tab shows what happened and when. Send me a screenshot of it.

**Invoicing (FreshBooks):** when a client approves, the "Approved" email to you ends with everything the invoice needs:
client, line item (the offer), any account audit credit, amount, 5% GST, total, and the monthly fee if there is one. Make the invoice in FreshBooks from that. Turn on
online payments in FreshBooks so the client can pay by card straight from the invoice email.

## 9. Go live on ledgecommunications.com (10 minutes, once the copy reads right)

1. Worker > **Settings** > **Domains & Routes** > **Add** > **Custom domain** > `ledgecommunications.com`.
   Then add `www.ledgecommunications.com` the same way.
2. If Cloudflare says the hostname "already has externally managed DNS records": those records live in **Cloudflare**,
   not Squarespace (Cloudflare has run the domain's DNS since the move). Cloudflare left menu > **Domains** >
   `ledgecommunications.com` > **DNS** > **Records**. Delete the A records on `ledgecommunications.com` (Squarespace's
   use addresses starting 198.) and the `www` CNAME (pointing to `ext-sq.squarespace.com`). Leave everything else,
   especially TXT and MX records. Then add the custom domain again. The old site goes dark for the minute in between.
3. Open ledgecommunications.com on your phone. It can take a few minutes to switch over.
4. In the Sheet's **Settings** tab, change `SITE_URL` back to `https://ledgecommunications.com`. Do this as soon as the
   domain works: until then, every email links to the workers.dev address, and spam filters distrust workers.dev links
   because phishing sites use them a lot.
5. Cancel the Squarespace **website** plan before Jan 18, 2027. The domain registration can stay there
   (it renews Mar 31, 2027) or move to Cloudflare Registrar later.

## 10. Validate, then switch on cold email

1. Read the first 5 audits and 3 proposals as they arrive. Approve, rebuild, or skip from each email.
2. Send me anything that reads wrong; I'll adjust the prompt or the copy.
3. Once the site is live on ledgecommunications.com and you're happy, set `COLD_EMAIL_ON` to **yes**.
   It starts at 5 a day and adds 5 a week, up to 20.

---

## What runs on its own

| When | What |
| --- | --- |
| Every hour | Replies, bounces, and bookings checked; searches run for up to 6 new audits; Claude batches sent and collected; audits, proposals, and emails sent |
| Daily, 5 pm | One email to you, only if there are replies it couldn't sort |
| Monday 5 am | New shops from Google Maps for the next area in `AREAS` |
| Monday 7 am | Weekly digest to you |
| Every hour (Google Ads) | The export script in the manager account reads any newly linked accounts and sends the data to the hub |

Emails to shops only go out on weekdays during working hours, Mountain time.
