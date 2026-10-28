# Cold sequences

Sent from ledgecommunications@gmail.com through Gmail, plain text, one thread per shop. Starts only when COLD_EMAIL_ON is yes. Weekdays 8 am to 5 pm Mountain, 5 a day to start, plus 5 a week, up to 20. Stops on any reply, booking, bounce, or unsubscribe.

Two tracks, picked by the shop's segment on the Leads tab: shops already running Google Ads get the account audit track; everyone else (no ads found, or we couldn't tell) gets the starting plan track. Same timing for both.

Placeholders: {first} first name, {business}, {audit_url}, {proposal_url}, {top_finding} and {fix_1} (from the audit), {sender} (SENDER_NAME), {sign} (its first word, for sign-offs), {next_day} (next business day), {booking_line} (only when BOOKING_URL is set).
Built from the audit's first search: {search_hook} ("who shows up for "furnace repair airdrie"", or "a quick look at how you show up on Google" when no search ran), {ads_hook}, {search_line} ("I searched "furnace repair airdrie" on a phone in Airdrie and put together a one-page look at what came up, and where {business} sits."), and {keyword_q}.
Built from the segment or the offer: {offer_line}, {offer_noun}, {audit_price_line} (from PRICE_ACCOUNT_AUDIT and ACCOUNT_AUDIT_CREDIT_DAYS), {proposal_intro}, and {kickoff_steps} (from the offer, on the proposal page too).
Every email also gets the footer: your name, mailing address, the site, ledgecommunications@gmail.com, and a one-click unsubscribe link.

The live copy is the EMAILS block in hub/Code.gs. Edit there (or send me your markup) and this file gets regenerated.

---

# Track 1: no Google Ads yet (starting plan)

## Day 0

**Subject:** {business}: {search_hook}

> Hi {first},
>
> Hope you're keeping busy. I'm {sender}, and I run Ledge Communications here in Alberta. I help local businesses show up when people search for them on Google.
>
> {search_line} No cost and nothing to sign up for:
> {audit_url}
>
> The short version: {top_finding}
>
> If you'd like to see what a small Google Ads budget aimed at those searches would look like, reply "yes" and I'll put together a starting plan.{booking_line}
>
> Thanks,
> {sign}

## 3 business days later

*Same thread, "Re:" the first subject.*

> Hi {first},
>
> Following up on the audit I sent. If you only do one thing, I'd start here: {fix_1}.
>
> Happy to set it up for you. Reply "yes" and I'll send a starting plan with a fixed price.
>
> {sign}

## 4 business days later

*Same thread, "Re:" the first subject.*

> Hi {first},
>
> I'll keep this one short. If you want to be in front of the people searching {keyword_q} before things get busier, a starting plan usually takes two to three weeks to set up, and you choose the budget.
>
> Reply "yes" and I'll send the details.{booking_line}
>
> {sign}

## 5 business days later

*Same thread, "Re:" the first subject.*

> Hi {first},
>
> I'll leave it here so I'm not cluttering your inbox. Your audit will stay up if you want to look at it later:
> {audit_url}
>
> All the best,
> {sign}

---

# Track 2: already running Google Ads (account audit)

## Day 0

**Subject:** {business}: {ads_hook}

> Hi {first},
>
> Hope you're keeping busy. I'm {sender}, and I run Ledge Communications here in Alberta. I manage Google Ads for local businesses.
>
> {search_line} It includes where your ads showed up. No cost and nothing to sign up for:
> {audit_url}
>
> The biggest thing that stood out: {top_finding}
>
> If you'd like me to look inside the account and show you where the budget is going, reply "yes" and I'll send the details.{booking_line}
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
> Reply "yes" and I'll send how it works.
>
> {sign}

## 4 business days later

*Same thread, "Re:" the first subject.*

> Hi {first},
>
> One more thought on your audit. If you only tackle one thing, I'd start here: {fix_1}.
>
> Reply "yes" and I'll send the details.{booking_line}
>
> {sign}

## 5 business days later

*Same thread, "Re:" the first subject.*

> Hi {first},
>
> I'll leave it here so I'm not cluttering your inbox. Your audit will stay up if you want to look at it later:
> {audit_url}
>
> All the best,
> {sign}
