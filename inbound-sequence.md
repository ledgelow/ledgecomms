# Site leads and proposals

For people who ask for an audit on the site (CASL implied consent from the inquiry), and for anyone who asks for a price, from the audit page or by replying "yes".

Placeholders: {first} first name, {business}, {audit_url}, {proposal_url}, {top_finding} and {fix_1} (from the audit), {sender} (SENDER_NAME), {sign} (its first word, for sign-offs), {next_day} (next business day), {booking_line} (only when BOOKING_URL is set).
Built from the audit's first search: {search_hook} ("who shows up for "furnace repair airdrie"", or "a quick look at how you show up on Google" when no search ran), {ads_hook}, {search_line} ("I searched "furnace repair airdrie" on a phone in Airdrie and put together a one-page look at what came up, and where {business} sits."), and {keyword_q}.
Built from the segment or the offer: {offer_line}, {offer_noun}, {audit_price_line} (from PRICE_ACCOUNT_AUDIT and ACCOUNT_AUDIT_CREDIT_DAYS), {proposal_intro}, and {kickoff_steps} (from the offer, on the proposal page too).
For the account audit: {manager_id} (ADS_MANAGER_ID), {report_url}, {report_finding} (the report's biggest finding), and {report_value_para} (what the ads bring in, when the report has an estimate).
{value_para} is the audit's yearly estimate as one sentence ("Going by Google's search estimates and typical rates, those searches are worth roughly $7,200 to $12,000 a year in work to a business that shows up on them."), left out when there's no estimate.
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

## When the audit is ready (after your OK for the first few)

*Same thread, "Re:" the first subject.*

> Hi {first},
>
> Here's your audit:
> {audit_url}
>
> It starts with what a customer sees when they search on a phone, then the three things I'd do first. The biggest finding: {top_finding}
>
> {value_para}If you'd like a hand, there's a short form at the bottom of the page, or just reply "yes".{booking_line}
>
> {sign}

## 2 business days later

*Same thread, "Re:" the first subject.*

> Hi {first},
>
> Quick follow-up on your audit. If you only do one thing, I'd start here: {fix_1}.
>
> {offer_line}
>
> {sign}

## 3 business days later

*Same thread, "Re:" the first subject.*

> Hi {first},
>
> Last note from me. Your audit will stay up here whenever you want it:
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
> I'll put together {offer_noun} and send it over by end of day {next_day}.{booking_line}
>
> {sign}

## When they use the form on the audit page

*Same thread, "Re:" the first subject (or "Next steps from Ledge Communications" when there's no thread yet).*

> Hi {first},
>
> Got it. I'll send {offer_noun} by end of day {next_day}.
>
> {sign}

## The proposal (after your OK for the first few)

*Same thread, "Re:" the first subject (or "Your plan from Ledge Communications" when there's no thread yet).*

> Hi {first},
>
> {proposal_intro}
> {proposal_url}
>
> It covers what's included, the price, and what I need from you. If it looks good, you can approve it right on the page. Any questions, just reply here.
>
> {sign}

## If they haven't approved

*Same thread, "Re:" the first subject.*

> Hi {first},
>
> Just checking whether you had any questions. Happy to adjust the budget or the scope if something doesn't fit:
> {proposal_url}
>
> {sign}

## When they approve

*Same thread, "Re:" the first subject.*

> Hi {first},
>
> Thanks, we're on. Here's what happens next:
>
> {kickoff_steps}
>
> I'll keep you posted along the way.
>
> {sign}

---

# The account audit

## When they reply with their customer ID

*Same thread, "Re:" the first subject (or "Your Google Ads audit" when there's no thread yet).*

> Hi {first},
>
> Thanks, that's all I need. A link request from Ledge Communications ({manager_id}) will show up in your Google Ads account shortly, under Admin > Access and security > Managers. Once you approve it, I'll get started, and you'll have the audit within about a week.
>
> {sign}

## When the report is ready (after your OK)

*Same thread, "Re:" the first subject (or "Your Google Ads audit" when there's no thread yet).*

> Hi {first},
>
> Your Google Ads audit is ready:
> {report_url}
>
> The short version: {report_finding}
>
> {report_value_para}It ends with what I'd change first. I've also put together a plan for running your ads month to month, priced on what you spend now:
> {proposal_url}
>
> Happy to walk through both on a call.{booking_line}
>
> {sign}
