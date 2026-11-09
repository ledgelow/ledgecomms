# Site leads and proposals

For people who ask for an audit on the site (CASL implied consent from the inquiry), and for anyone who asks for a price, from the audit page or by replying "yes".

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

## Right away

**Subject:** Your Local Search Audit for {business}

> Hi {first},
>
> Thanks for reaching out. I'm putting your audit together now and you'll have it by end of day {next_day}.
>
> If there's anything you'd like me to look at in particular, like a service you want more calls for, just reply to this email.
>
> Talk soon,
> {sign}

## When the audit is ready (it waits up to INBOUND_HOLD_HOURS for your OK and an optional personal line)

*Same thread, "Re:" the first subject.*

> Hi {first},
>
> {personal_para}Here's your audit:
> {audit_url}
>
> It starts with what a customer sees when they search on a phone, then the three things I'd do first. The biggest finding: {top_finding}
>
> {value_para}If you'd like a hand, there's a short form at the bottom of the page, or just let me know by replying here.{booking_line}
>
> All the best,
> {sign}

## 2 business days later

*Same thread, "Re:" the first subject.*

> Hi {first},
>
> Quick follow-up on your audit. If you only do one thing, I'd start here: {fix_1}.
>
> {offer_line}
>
> All the best,
> {sign}

## 3 business days later

*Same thread, "Re:" the first subject.*

> Hi {first},
>
> Just checking in to see if you've had a chance to review the audit I shared previously and whether any questions came up.
>
> Some of it is easier to talk through than to read, so if a short call would help, I'm happy to walk you through it.{call_line}
>
> Your audit still lives here either way in case there's anything helpful to pull from it:
> {audit_url}
>
> All the best,
> {sign}

---

# Asking for a price

## When they reply "yes"

*Same thread, "Re:" the first subject.*

> Thanks {first}, appreciate you getting back to me.
>
> I'll put together {offer_noun} and send it over by end of day {next_day}.{ack_line}
>
> All the best,
> {sign}

## When they use the form on the audit page

*Same thread, "Re:" the first subject (or "Next steps from Ledge Communications" when there's no thread yet).*

> Hi {first},
>
> Got it, thanks. I'll send {offer_noun} by end of day {next_day}.
>
> All the best,
> {sign}

## The proposal (after your OK for the first few)

*Same thread, "Re:" the first subject (or "Your plan from Ledge Communications" when there's no thread yet).*

> Hi {first},
>
> {proposal_intro}
> {proposal_url}
>
> {proposal_hook}It covers what's included, the price, and what I need from you to get moving.
>
> If it looks good, you can approve it right on the page. Any questions, just let me know.
>
> All the best,
> {sign}

## If they haven't approved

*Same thread, "Re:" the first subject.*

> Hi {first},
>
> Just checking whether you had any questions. Happy to adjust the budget or the scope if something doesn't feel right:
> {proposal_url}
>
> All the best,
> {sign}

## When they approve

*Same thread, "Re:" the first subject.*

> Hi {first},
>
> Thanks, we're on. Here's what happens next:
>
> {kickoff_steps}
>
> I'll keep you posted as I work through it on my end.
>
> All the best,
> {sign}

---

# Check back later

When a reply says "not now", the needs-you email offers a check-back date (in a month, in 3 months, or early March). On that day they get this one note, and nothing before it.

## On the date you picked

*Same thread, "Re:" the first subject.*

> Hi {first},
>
> Hope you're doing well. Checking back in, as promised. Your audit is still up here:
> {audit_url}
>
> If now is a better time to look at your Google Ads setup, just let me know and I'll put together a plan for where you could start.
>
> All the best,
> {sign}

---

# The account audit

## When they reply with their customer ID

*Same thread, "Re:" the first subject (or "Your Google Ads audit" when there's no thread yet).*

> Hi {first},
>
> Thanks for sending that through. A link request from Ledge Communications ({manager_id}) will show up in your Google Ads account shortly, under Admin > Access and security > Managers.
>
> Once you approve it, I'll get started, and you'll have the audit within about a week. Keep me posted if you're running into any issues or if there's any insights or priorities I should keep in mind with my review.
>
> All the best,
> {sign}

## When the report is ready (after your OK)

*Same thread, "Re:" the first subject (or "Your Google Ads audit" when there's no thread yet).*

> Hi {first},
>
> Your Google Ads audit is ready:
> {report_url}
>
> Key takeaway: {report_finding}
>
> {report_value_para}It ends with what I'd change first. I've also put together a plan for running your ads month to month, priced on what you spend now:
> {proposal_url}
>
> Let me know if you have any questions.{booking_line}
>
> All the best,
> {sign}
