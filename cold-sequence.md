# Cold sequence

Sent from ledgecommunications@gmail.com through Gmail, plain text, one thread per shop. Starts only when COLD_EMAIL_ON is yes. Weekdays 8 am to 5 pm Mountain, 5 a day to start, plus 5 a week, up to 20. Stops on any reply, booking, bounce, or unsubscribe.

Placeholders: {first} first name, {business}, {audit_url}, {proposal_url}, {top_finding}, {fix_1} (from the audit), {sender} (SENDER_NAME), {next_day} (next business day), {booking_line} (only when BOOKING_URL is set). Every email also gets the footer: your name, mailing address, the site, ledgecommunications@gmail.com and a one-click unsubscribe link.

The live copy is the EMAILS block in hub/Code.gs. Edit there (or send me your markup) and this file gets regenerated.

---

## Day 0

**Subject:** {business}: a quick look at your website and reviews

> Hi {first},
>
> Hope you're keeping busy. I'm {sender}, and I run Ledge Communications here in Alberta. I help trades businesses make sure the calls and requests they already get turn into booked jobs.
>
> I took a look at {business} from the outside and put together a one-page audit. No cost and nothing to sign up for:
> {audit_url}
>
> The biggest thing that stood out: {top_finding}
>
> If any of it is useful and you'd like a hand, just reply "yes" and I'll send over a fixed price.{booking_line}
>
> Thanks,
> {sender}

## 3 business days later

*Same thread (sent as a reply).*

> Hi {first},
>
> Following up on the audit I sent. If you only tackle one thing, I'd start here: {fix_1}.
>
> Happy to set it up for you. Reply "yes" and I'll send a fixed price.
>
> {sender}

## 4 business days after that

*Same thread (sent as a reply).*

> Hi {first},
>
> I know this time of year is busy, so I'll keep it short. If you want your after-hours calls and quote follow-ups taken care of before things get busier, I can have it set up in two or three weeks.
>
> Reply "yes" and I'll send the details.{booking_line}
>
> {sender}

## 5 business days after that (last)

*Same thread (sent as a reply).*

> Hi {first},
>
> I'll leave it here so I'm not cluttering your inbox. Your audit will stay up if you want to look at it later:
> {audit_url}
>
> All the best with the season,
> {sender}

---

# After a reply

## They reply with a yes or a price question

*Same thread (sent as a reply).*

> Thanks {first}, appreciate you getting back to me.
>
> I'll put together a fixed price for those fixes and send it over by end of day {next_day}.{booking_line}
>
> {sender}

A clear no or an unsubscribe stops everything and adds them to the Do not contact tab, with no reply sent. Anything else waits for you in the 5 pm email.
