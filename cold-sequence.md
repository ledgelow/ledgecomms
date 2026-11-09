# Cold sequences

Sent from ledgecommunications@gmail.com through Gmail, plain text, one thread per shop. Starts only when COLD_EMAIL_ON is yes. Weekdays 8 am to 5 pm Mountain, COLD_PER_DAY_START a day to start, plus 5 a week, up to COLD_PER_DAY_MAX. Stops on any reply, booking, bounce, or unsubscribe, and once you've written to the shop yourself. Before the first email, the address's domain is checked: one that doesn't exist or takes no email is skipped.

Two tracks, picked by the shop's segment on the Leads tab: shops already running Google Ads get the account audit track; everyone else (no ads found, or we couldn't tell) gets the starting plan track. Same timing for both.

Placeholders: {first} (the first name we have; else one read from the address, like mike@; else, on cold emails, the shop's team, "Lamberts HVAC team"; else "there"), {business}, {short_business} (the name without Ltd. or a tagline), {audit_url}, {proposal_url}, {top_finding} and {fix_1} (from the audit), {sender} (SENDER_NAME), {sign} (its first word, for sign-offs), {next_day} (next business day), {booking_line} (only when BOOKING_URL is set).
Built from the audit's first search: {lead_line} ("I searched "furnace repair airdrie" on a phone in Airdrie, and one thing stood out: " then {top_finding}, or "I looked at how {short_business} shows up on Google, and one thing stood out: ..." when no search ran), {search_hook}, {ads_hook}, {search_line}, and {keyword_q}.
{pass_line} is " If someone else looks after marketing, I'd appreciate you passing this along." for a shared inbox (info@, office@, service@) with no name to go on, and empty otherwise.
Built from the segment or the offer: {offer_line}, {offer_noun}, {audit_price_line} (from PRICE_ACCOUNT_AUDIT and ACCOUNT_AUDIT_CREDIT_DAYS), {proposal_intro}, and {kickoff_steps} (from the offer, on the proposal page too).
For the account audit: {manager_id} (ADS_MANAGER_ID), {report_url}, {report_finding} (the report's biggest finding), and {report_value_para} (what the ads bring in, when the report has an estimate).
{value_para} is the audit's estimate as one sentence, left out when there's no estimate. The first cold email doesn't carry it: the money is on the audit page and in cold email 3.
{personal_para} is the line you add before a site-form audit goes out (left out when you don't add one).
Every email also gets the footer: your name, mailing address, the site, ledgecommunications@gmail.com, and a one-click unsubscribe link.

The live copy is the EMAILS block in hub/Code.gs. Edit there (or send me your markup) and this file gets regenerated.

---

# Track 1: no Google Ads yet (starting plan)

## Day 0

**Subject:** {search_subject}

> Hi {first},
>
> {lead_line}
>
> I put together a one-page look at what came up and where {short_business} stands:
> {audit_url}
>
> No cost and nothing to sign up for. I'm {sign}, and I run Ledge Communications here in Alberta, setting up Google Ads for local trades. Want me to send over where I'd start?{pass_line}
>
> Thanks,
> {sign}

## 3 business days later

*Same thread, "Re:" the first subject.*

> Hi {first},
>
> Following up on the audit I sent. If you only do one thing from it, I'd start here: {fix_1}.
>
> Happy to set it up for you or share more details. Just let me know, and I'll send a plan for how I'd recommend running it.
>
> All the best,
> {sign}

## 4 business days later

*Same thread, "Re:" the first subject.*

> Hi {first},
>
> {more_para}
>
> If you'd like one, just reply and let me know.{booking_line}
>
> All the best,
> {sign}

## 5 business days later

*Same thread, "Re:" the first subject.*

> Hi {first},
>
> I'll leave it here so I'm not clogging up your inbox. Your audit will stay up if you want to review when the timing is better: {audit_url}
>
> If you'd like me to check back down the road, just let me know when.
>
> All the best,
> {sign}

---

# Track 2: already running Google Ads (account audit)

## Day 0

**Subject:** {ads_subject}

> Hi {first},
>
> {lead_line}
>
> I put together a one-page look at what came up, including where your ads did and didn't show:
> {audit_url}
>
> No cost and nothing to sign up for. I'm {sign}, and I run Ledge Communications here in Alberta, managing Google Ads for local trades. Want me to send over what I'd look at first in your account?{pass_line}
>
> Thanks,
> {sign}

## 3 business days later

*Same thread, "Re:" the first subject.*

> Hi {first},
>
> Following up on the audit I sent. From the outside I can see where your ads show up. From the inside I can see why: which searches you're paying for, and what a call costs you.
>
> {audit_price_line}
>
> If you'd like the details, just let me know and I'll send them through.
>
> All the best,
> {sign}

## 4 business days later

*Same thread, "Re:" the first subject.*

> Hi {first},
>
> One more thought on your audit. If you only take one thing away from it, I'd start here: {fix_1}.
>
> If you'd like the details, just reply and let me know.{booking_line}
>
> All the best,
> {sign}

## 5 business days later

*Same thread, "Re:" the first subject.*

> Hi {first},
>
> I'll leave it here so I'm not clogging up your inbox. Your audit will stay up if you want to review when the timing is better: {audit_url}
>
> If you'd like me to check back down the road, just let me know when.
>
> All the best,
> {sign}

---

# When a shop reads its audit

The first time a cold prospect who hasn't replied reads their audit, you get an email ("[Ledge] Lamberts HVAC just read their audit") with when they were emailed, their priority, the next automatic email, the audit link, and a suggested two-line note. READ_ALERTS on the Settings tab turns it off.

Reply in the shop's thread from Superhuman as usual, then tap the alert's link so the automatic follow-ups to that shop stop (for a proposal, the nudge is dropped and a quiet proposal still comes back to you after 5 business days). A note written straight from the ledgecommunications@gmail.com inbox is noticed on its own within the hour. Their reply is read like any other. Never mention that you saw them read it.
