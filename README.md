# My Artiste Page

One page design, many artists. Every artist's website is built from the same template, filled in with that artist's own settings and photos.

## How it is organised

| Folder | What's in it |
| --- | --- |
| `template/page.html` | The page design every artist shares. Change it once and every artist's page changes. |
| `artists/<name>/settings.json` | One artist's words, links, colours and on/off switches. |
| `artists/<name>/photos/` | That artist's photos (bio photo, cut-out, link-preview image). |
| `scripts/build.mjs` | Puts the template and an artist's settings together into a finished page. |
| `docs/settings.md` | What every setting means. |
| `web/` | The sales page and the sign-up, login, onboarding and account pages. |
| `worker/` | The small server behind them: Paystack checkout and payment news, accounts, emails, renewals and pausing. |
| `supabase/schema.sql` | The accounts database, pasted once into Supabase. |
| `docs/setup-payments.md` | **The steps only the owner can do** to switch payments on (accounts and keys). |

The first artist is Hannah Aboh, in `artists/hannah-aboh/`.

## Build the pages

You need [Node.js](https://nodejs.org) 20 or newer. There is nothing to install.

```sh
npm run build              # every artist
npm run build hannah-aboh  # one artist
npm test                   # build everything and run the safety checks
```

Each finished page lands in `dist/<name>/`, with its photos beside it, ready for any static host (Netlify, Cloudflare Pages).

## Sales page and paid sign-up

The sales site runs on Cloudflare Workers (`wrangler.toml`), with Supabase for logins and Paystack for payments.

1. An artist picks monthly ($5) or yearly ($50) and pays on Paystack.
2. Once Paystack confirms the payment (signed webhook), the account is created and a "set your password" email goes out (Resend).
3. First login asks for their Spotify artist or podcast link.
4. Paystack renews the plan by itself. If a renewal fails, the artist gets an email and the page stays live for 7 days, with reminders. After that the page shows "coming back soon" and the account shows a pay-now screen, until they pay.

`GET /api/site-status?slug=` tells the hosting engine whether a page is live or paused. `npm run dev` runs the site locally on port 8787; keys go in `.dev.vars` (never committed). Secret keys live only in Cloudflare's settings.

## Add a new artist

1. Copy `artists/hannah-aboh` to `artists/<new-name>` (small letters and dashes, for example `ada-okafor`).
2. In the new `settings.json`, set `slug` to the folder name and change the words, links and switches.
3. Replace the photos in `photos/`.
4. Run `npm test`. Any mistake in the settings is explained in plain words.

Later phases replace these steps with the artist dashboard: artists sign up, edit in the dashboard, and their settings are saved to a database instead of a file. The template stays the same.
