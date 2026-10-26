# ledgecomms

Ledge Communications' website and lead system. Setup steps are in `SETUP.md`.

Every file sits at the top level on purpose, so uploading through GitHub's web page can't lose folders.
To update anything, drag the new files onto **Add file** > **Upload files**; files with the same name are replaced.
Cloudflare redeploys about a minute after each commit.

| Files | What they are |
| --- | --- |
| `index.html`, `sample-audit.html`, `sample-proposal.html`, `favicon.svg`, `robots.txt`, `_headers`, the six `.jpg` photos | The website. |
| `worker.js` | Runs in front of the site: the audit form, the fixed-price and approve buttons, unsubscribe, each shop's audit and proposal page (fetched from the hub), and the booking link and spam check on every page. |
| `build-site.js` | Arranges the files above into the site's folders on each deploy. |
| `wrangler.jsonc` | Tells Cloudflare how to deploy. |
| `Code.gs`, `Templates.gs`, `appsscript.json` | The pipeline hub. These live in Apps Script (the Ledge Pipeline sheet); they're here as the record of what's running. |
| `cold-sequence.md`, `inbound-sequence.md` | Every email, for review. |

No lead data lives in this repo. Leads, consent records and the do-not-contact list stay in the Google Sheet.
