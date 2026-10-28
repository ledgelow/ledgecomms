# Ledge lead system: setup

Everything here is one-time, about two hours in total. After it, leads move from first touch to an approved
offer without you: a free Local Search Audit, then a $500 Google Ads account audit for shops already running ads, or a
starting plan (setup plus monthly management) for shops that aren't.

Two rules while you set up:
- Passwords and API keys go straight into the tool that needs them (Cloudflare or Script Properties), never into chat.
- Do the steps in order. Step 4 gives you two values that step 2 needs, so you'll come back to Cloudflare once.

What it costs: $0 a month in fixed tools. Usage costs are the Claude API (roughly 50 cents to a dollar per audit on
Opus) and DataForSEO search data (1 to 2 cents per shop). The hub counts both and pauses itself at
`MONTHLY_ENGINE_BUDGET_USD` (US$60 to start).

The site runs as a Cloudflare **Worker** at `https://ledgecomms.ledgelow.workers.dev` until you're happy with it.
Your Squarespace site stays up on ledgecommunications.com until step 9, so you can test and edit without anyone seeing.

## Where you are (Oct 28, late): the paid account audit runs itself

The Google Ads version is live: site, pricing page, hub, DataForSEO, and the manager account (871-805-0188).
**Find prospects now** ran for Airdrie and found 15 shops, and the 10 Calgary shops from Oct 27 are being redone.
The hub runs searches for 6 shops an hour, then Claude writes the audits.

New in this update: the $500 account audit, end to end. See "Account audits" below for how it flows.

**Ship this update (15 minutes)**
1. **Apps Script:** replace `Code.gs` and `Templates.gs`, save, **Deploy** > **Manage deployments** > edit > **New
   version** > **Deploy**. On its next run the hub adds two tabs, **Ads exports** and **Account reports**.
2. **GitHub:** upload all 25 files from the new zip (one new: `sample-report.html`, the sample report the pricing page
   and the free audits now link to).
3. **The export script, in the manager account (once):**
   1. In Google Ads, switch to the manager account (871-805-0188). **Tools** > **Bulk actions** > **Scripts** > the
      blue **+** > **New script**.
   2. Name it `Ledge account export`. Delete what's in the editor and paste all of `ledge-ads-export.js`.
   3. Near the top, replace the two placeholders: `HUB_URL` is the hub's web app address (Script Properties >
      `WEB_APP_URL`, it ends in `/exec`) and `HUB_KEY` is the `HUB_KEY` value from the same place. These go straight
      into the script, never into chat.
   4. Click **Authorize** and allow it. Then **Preview**: the log at the bottom should say `0 account(s) to export`.
      Anything else, send me the log.
   5. **Save** and **Close**. In the scripts list, set its **Frequency** to **Hourly**.

**Prices from here on** are just the Settings tab: edit a cell and proposals use it right away; the site follows
within about 10 minutes.

**When the audits arrive**
4. They come in one "Check these N audits" email per hourly run, not one email each. Open each audit, then use its
   **Looks right**, **Rebuild**, or **Skip** link. Approving sends nothing while `COLD_EMAIL_ON` is no.
5. Send me anything that reads off. When they read right, `COLD_EMAIL_ON` = yes.

**Account audits ($500)**
1. They approve the account audit. The kickoff email asks for their 10-digit Google Ads customer ID.
2. They reply with it. The hub reads the ID from the reply (ignoring their phone number), tells them a link request is
   coming, and sends you a "Send a link request" email with the one manual step: manager account > **Accounts** >
   **+** > **Link existing account** > their ID > **Send request**. If the hub can't find an ID in the reply, it flags
   the reply for you instead. For anyone who sends it some other way, use **Ledge** > **Run an account audit**.
3. They accept the link. Within the hour the export script reads 90 days of their account (it only reads) and sends
   it to the hub, which works out the numbers itself: spend, searches that brought nothing, what's counted as a
   conversion, locations, budget limits, and the rest. Claude writes the report around those numbers.
4. You get a "Check this account audit" email with the report link, the biggest finding, and the management price
   it would lead to. **Looks right, send both** sends them the report and a management plan priced on what they
   spend now, with the $500 off setup. **Write the report again** reruns Claude on the same data.
5. If they approve the plan, the kickoff skips the access step (you're already linked). If a link isn't accepted
   within three weeks, the hub stops asking and emails you.

**Later**
7. Next builds: monthly reports for clients (the same export script, a short report each month), and a page per
   industry.
8. Optional: move the domain registration to Cloudflare Registrar before Mar 31, 2027. FreshBooks automation later.

**Add-ons.** Audits can tag one move as a page fix or a landing page, with its price. Proposals then show it as an
optional checkbox next to the approve button, and the "Approved" note and invoice details include whatever they tick.
The pricing section on the site lists both. Prices live on the Settings tab like everything else.

**New on the Ledge menu**
- **Check one shop**: runs the audit searches on any website and shows the results. Nothing is saved to Leads.
- **Run an account audit**: starts one by hand from an email address and customer ID (adds the lead if it's new).
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

Canada's anti-spam law requires a mailing address in every commercial email, cold or not. Your home address is fine.
It only appears in email footers, never on the site, audit, or proposal pages. Put it in the `MAILING_ADDRESS`
setting on one line. Cold email won't start until it's filled in.

If you ever want it out of the footers, a Canada Post PO box (roughly $120 to $215 a year) is the cheap swap:
change the setting and every email after that uses the new address.

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
