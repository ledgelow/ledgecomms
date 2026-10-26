# Ledge lead system: setup

Everything here is one-time, about two hours in total. After it, leads move from first touch to an approved
fixed price without you.

Two rules while you set up:
- Passwords and API keys go straight into the tool that needs them (Cloudflare or Script Properties), never into chat.
- Do the steps in order. Step 4 gives you two values that step 2 needs, so you'll come back to Cloudflare once.

What it costs: $0 a month in fixed tools. The Claude API is the only usage cost, about US$0.10 to $0.20 per audit,
and the hub pauses itself at US$20 a month.

Already done: DNS for ledgecommunications.com is on Cloudflare (Free plan), and the `ledgecomms` Worker exists.

The site runs as a Cloudflare **Worker** at `https://ledgecomms.ledgelow.workers.dev` until you're happy with it.
Your Squarespace site stays up on ledgecommunications.com until step 9, so you can test and edit without anyone seeing.

---

## 1. Put the site in GitHub (10 minutes)

The repo is flat on purpose: 22 files, no folders, so nothing can get lost in the upload.

1. GitHub > `ledgecomms` > **Settings** > scroll to **Danger Zone** > **Delete this repository**.
2. **New repository** > name `ledgecomms`, **Private** > **Create repository**.
3. Download `ledgecomms-flat.zip` and unzip it (on Windows: right-click > **Extract All**).
4. On the new repo's page, click **uploading an existing file**. Open the unzipped `ledgecomms-files` folder,
   select all 22 files and drag them in (or pick them with "choose your files"). **Commit changes**.
5. The repo's main page should list 22 files, including `worker.js`, `build-site.js` and `wrangler.jsonc`,
   with no "(1)" or "(2)" in any name.

Later changes work the same way: I send updated files, you drag them in (same names replace the old ones),
and Cloudflare redeploys in about a minute.

## 2. Cloudflare Worker (15 minutes)

1. **Workers & Pages** > `ledgecomms` > **Settings** > **Builds**. Disconnect the old repo, then **Connect** >
   GitHub > `ledgecomms`. If it isn't in the list, use the link there to give Cloudflare's GitHub app access to it.
2. Build settings: Build command blank. Deploy command `npx wrangler deploy` (the default). Root directory `/`.
   Save. `wrangler.jsonc` does the rest: it arranges the site's folders, runs `worker.js` and serves only the site.
3. When the build finishes, open `https://ledgecomms.ledgelow.workers.dev` on your phone. You should see the new site.
   If the Builds settings look stuck, delete the Worker (Settings, bottom of the page) and make it again:
   **Create application** > **GitHub** > `ledgecomms`, keeping the name `ledgecomms`.
4. **Turnstile** (left menu, under Application security) > **Add widget**. Name it Ledge. Hostnames:
   `ledgecommunications.com` and `ledgecomms.ledgelow.workers.dev`. Mode **Managed**. Keep the two keys handy.
5. Worker > **Settings** > **Variables and Secrets** > **Add**. Saving deploys a new version on its own.

| Name | Value | Type |
| --- | --- | --- |
| `TURNSTILE_SITE_KEY` | Turnstile site key | Text |
| `TURNSTILE_SECRET` | Turnstile secret key | Secret |
| `BOOKING_URL` | Your Superhuman booking link (step 6). Optional | Text |
| `HUB_URL` | The web app URL from step 4 | Secret |
| `HUB_KEY` | The HUB_KEY from step 4 | Secret |

The custom domain comes last (step 9), once the site reads right.

## 3. Claude API key (10 minutes)

1. console.anthropic.com, signed in with ledgelow@gmail.com (or the Ledge account, your call).
2. **Billing**: add about US$10 of credit. That covers the first 50 or so audits.
3. **Limits**: set a monthly spend limit, for example US$25. The hub also stops itself at US$20.
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
   **Advanced** > **Go to Ledge Pipeline (unsafe)** > **Allow**. It asks for Gmail, Sheets, Calendar and
   outside connections, all used by the hub.
6. **View** > **Logs** (or Execution log) shows `HUB_KEY`. Copy it for Cloudflare.
7. **Project Settings** > **Script Properties** > add `ANTHROPIC_API_KEY` with the key from step 3.
8. **Deploy** > **New deployment** > type **Web app**. Execute as **Me**, Who has access **Anyone**. Deploy and copy the
   web app URL.
9. Add one more Script Property: `WEB_APP_URL` = that URL.
10. Back in Cloudflare (step 2.5), add `HUB_URL` (the web app URL) and `HUB_KEY`.
11. Back in the Sheet, reload it. A **Ledge** menu appears. Fill in the **Settings** tab:
    - `SITE_URL`: `https://ledgecomms.ledgelow.workers.dev` while you test, so links in emails work (step 9 switches it back)
    - `OWNER_EMAIL`: your everyday inbox, where review emails and the 5 pm list go
    - `SENDER_NAME`: your full name, exactly as it should appear on emails
    - `MAILING_ADDRESS`: your home address, on one line (step 7)
    - `BOOKING_URL`: the Superhuman link (step 6), optional
    - `GST_REGISTERED`: leave it at **yes** (Ledge is registered)
    - Leave `COLD_EMAIL_ON` at **no** for now
12. **Ledge** > **Check settings** should say the settings look complete.

If you ever change `Code.gs`: **Deploy** > **Manage deployments** > edit > Version **New version** > Deploy.
The URL stays the same.

## 5. Gmail details (5 minutes)

In ledgecommunications@gmail.com:
1. **Settings** > **Accounts** > **Send mail as**: edit the name to your full name.
2. Add a short plain signature only if you want one; the hub already adds a footer with your name, mailing address,
   the site and the unsubscribe link.

## 6. Superhuman booking page (10 minutes, optional)

Calls are optional; the emails always ask for a reply first. If you want the link available:
1. Add ledgecommunications@gmail.com to Superhuman if it isn't already.
2. Press **2** for the week view > **+** next to Booking Pages.
3. Duration 15 minutes. Scheduling windows weekdays 4 to 5 pm Mountain. Calendar: the
   ledgecommunications@gmail.com calendar. Event title: something with "Ledge" in it, like
   "Ledge Communications call", so the hub recognises bookings from new people.
4. Save, copy the link, and put it in Settings (`BOOKING_URL`) and Cloudflare (`BOOKING_URL`).

If the booking page has to use another calendar, share that calendar with ledgecommunications@gmail.com and put its
calendar ID in the `CALENDAR_ID` setting.

## 7. Mailing address (1 minute)

Canada's anti-spam law requires a mailing address in every commercial email, cold or not. Your home address is fine.
It only appears in email footers, never on the site, audit or proposal pages. Put it in the `MAILING_ADDRESS`
setting on one line. Cold email won't start until it's filled in.

If you ever want it out of the footers, a Canada Post PO box (roughly $120 to $215 a year) is the cheap swap:
change the setting and every email after that uses the new address.

## 8. Trial runs (20 minutes, phone is fine)

Use a personal address that isn't ledgecommunications@gmail.com.

1. **Site lead.** Fill in the form on `https://ledgecomms.ledgelow.workers.dev`. Expect a confirmation email within a minute and a row on
   the Leads tab. Within a few hours (batches usually finish inside the hour, occasionally longer) you get a
   "Check this audit" email. Open the preview, then approve it. The audit email lands in the same thread.
2. **Fixed price.** On the audit page, tap **Send me a fixed price**. You get "Check this proposal"; approve it.
   The proposal email arrives. Open the page and tap **Approve and get started**. Expect the kickoff email and a
   "won" note to you.
3. **Opt-out.** From a second test address, reply "unsubscribe" to any email. It stops and lands on the Do not contact tab.
   Also try the unsubscribe link at the bottom of an email.
4. **Cold prospects.** **Ledge** > **Find prospects now**. Over the next few hours, new shops appear on the Leads tab
   and the first audits come to you for review. Nothing goes to a shop while `COLD_EMAIL_ON` is no.

If anything looks off, the **Events** tab shows what happened and when. Send me a screenshot of it.

## 9. Go live on ledgecommunications.com (10 minutes, once the copy reads right)

1. Worker > **Settings** > **Domains & Routes** > **Add** > **Custom domain** > `ledgecommunications.com`.
   Then add `www.ledgecommunications.com` the same way.
2. If Cloudflare says a DNS record already exists: **DNS** > **Records**, delete the Squarespace records (the A records
   on `ledgecommunications.com` and the `www` CNAME), then add the custom domain again. Leave any other records alone.
3. Open ledgecommunications.com on your phone. It can take a few minutes to switch over.
4. In the Sheet's **Settings** tab, change `SITE_URL` back to `https://ledgecommunications.com`.
5. Cancel the Squarespace **website** plan before Jan 18, 2027. The domain registration can stay there
   (it renews Mar 31, 2027) or move to Cloudflare Registrar later.

## 10. Validate, then switch on cold email

1. Read the first 5 audits and 3 proposals as they arrive. Approve, rebuild or skip from each email.
2. Send me anything that reads wrong; I'll adjust the prompt or the copy.
3. Once the site is live on ledgecommunications.com and you're happy, set `COLD_EMAIL_ON` to **yes**.
   It starts at 5 a day and adds 5 a week, up to 20.

---

## What runs on its own

| When | What |
| --- | --- |
| Every hour | Replies, bounces and bookings checked; Claude batches sent and collected; audits, proposals and emails sent |
| Daily, 5 pm | One email to you, only if there are replies it couldn't sort |
| Monday 5 am | Claude looks for new shops in the next area |
| Monday 7 am | Weekly digest to you |

Emails to shops only go out on weekdays during working hours, Mountain time.
