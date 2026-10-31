# Cold sequences

Sent from ledgecommunications@gmail.com through Gmail, plain text, one thread per shop. Starts only when COLD_EMAIL_ON is yes. Weekdays 8 am to 5 pm Mountain, 5 a day to start, plus 5 a week, up to 20. Stops on any reply, booking, bounce, or unsubscribe.

Two tracks, picked by the shop's segment on the Leads tab: shops already running Google Ads get the account audit track; everyone else (no ads found, or we couldn't tell) gets the starting plan track. Same timing for both.

Placeholders: {first} first name, {business}, {audit_url}, {proposal_url}, {top_finding} and {fix_1} (from the audit), {sender} (SENDER_NAME), {sign} (its first word, for sign-offs), {next_day} (next business day), {booking_line} (only when BOOKING_URL is set).
Built from the audit's first search: {search_hook} ("who shows up for "furnace repair airdrie"", or "a quick look at how you show up on Google" when no search ran), {ads_hook}, {search_line} ("I searched "furnace repair airdrie" on a phone in Airdrie and put together a one-page look at what came up, and where {business} sits."), and {keyword_q}.
Built from the segment or the offer: {offer_line}, {offer_noun}, {audit_price_line} (from PRICE_ACCOUNT_AUDIT and ACCOUNT_AUDIT_CREDIT_DAYS), {proposal_intro}, and {kickoff_steps} (from the offer, on the proposal page too).
For the account audit: {manager_id} (ADS_MANAGER_ID), {report_url}, {report_finding} (the report's biggest finding), and {report_value_para} (what the ads bring in, when the report has an estimate).
{value_para} is the audit's yearly estimate as one sentence ("Going by Google's search estimates and typical rates, those searches are worth roughly $7,200 to $12,000 a year in work to a business that shows up on them."), left out when there's no estimate.
{personal_para} is the line you add before a site-form audit goes out (left out when you don't add one).
Every email also gets the footer: your name, mailing address, the site, ledgecommunications@gmail.com, and a one-click unsubscribe link.

The live copy is the EMAILS block in hub/Code.gs. Edit there (or send me your markup) and this file gets regenerated.

---

# Track 1: no Google Ads yet (starting plan)

## Day 0

**Subject:** {search_subject}

> Hi {first},
>
> {search_line} The biggest opportunity: {top_finding}
>
> {value_para}Wanted to share it with you in case it's helpful (no cost and nothing to sign up for):
> {audit_url}
>
> I'm {sender}, and I run Ledge Communications here in Alberta. {intro_line} If it'd help, I'm happy to put together a plan for where you could start. Just reply and let me know.
>
> Thanks,
> {sign}

## 3 business days later

*Same thread, "Re:" the first subject.*

> Hi {first},
>
> Following up on the audit I sent. If you only take one thing away from it, I'd start here: {business} should absolutely {fix_1_them}.
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
> {search_line} It includes where your ads showed up. The biggest thing that stood out: {top_finding}
>
> {value_para}Wanted to share it with you in case it's helpful (no cost and nothing to sign up for):
> {audit_url}
>
> I'm {sender}, and I run Ledge Communications here in Alberta. {intro_line} If it'd help, I'm happy to look inside the account and show you where the budget is going. Just reply and let me know.
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
