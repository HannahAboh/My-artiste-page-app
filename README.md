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

The first artist is Hannah Aboh, in `artists/hannah-aboh/`.

## Build the pages

You need [Node.js](https://nodejs.org) 20 or newer. There is nothing to install.

```sh
npm run build              # every artist
npm run build hannah-aboh  # one artist
npm test                   # build everything and run the safety checks
```

Each finished page lands in `dist/<name>/`, with its photos beside it, ready for any static host (Netlify, Cloudflare Pages).

## Add a new artist

1. Copy `artists/hannah-aboh` to `artists/<new-name>` (small letters and dashes, for example `ada-okafor`).
2. In the new `settings.json`, set `slug` to the folder name and change the words, links and switches.
3. Replace the photos in `photos/`.
4. Run `npm test`. Any mistake in the settings is explained in plain words.

Later phases replace these steps with the artist dashboard: artists sign up, edit in the dashboard, and their settings are saved to a database instead of a file. The template stays the same.
