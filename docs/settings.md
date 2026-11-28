# Artist settings

Each artist has one `settings.json` in `artists/<slug>/`. This page explains every setting. Words in `code` are the setting names. Photo paths are relative to the artist's folder, for example `photos/bio-photo.webp`.

## Who the artist is

| Setting | What it does |
| --- | --- |
| `slug` | The artist's short web name, the same as the folder name. Small letters, numbers and dashes only (`hannah-aboh`). It becomes their address later (`hannah-aboh.yourbrand.com`). |
| `name` | The artist's name, shown on the page and in link previews. |
| `descriptor` | What they do, for example `Singer · Songwriter`. |
| `handle` | Their social handle, shown at the bottom of the bio photo. |
| `heroNote` | A short line such as `New single out now`. |

## Bio

| Setting | What it does |
| --- | --- |
| `bio.headline` | The big word behind the photo, for example `ABOUT ME`. |
| `bio.photo` | The main photo, filling the top of the page edge to edge. |
| `bio.cutout` | The same photo with the background removed (transparent), so the artist stands in front of the big word. Leave it out and the word sits over the photo. |
| `bio.backdrop` | A small blurred copy of the photo, shown around it on wide screens. Optional. |
| `bio.short` | The short bio over the photo. |
| `bio.text` | Longer bio paragraphs for Read full bio. Empty hides the button. |
| `bio.facts` | Optional pairs such as `["Based in", "Lagos"]`. |

## Sections (on/off switches)

`sections` turns parts of the page on (`true`) or off (`false`). Turning one off hides it and removes it from the menu. The bio is always shown.

`videos`, `listen`, `release` (new single countdown), `tour`, `store`, `support` (tips), `mailingList`, `booking`.

## Colours and look

| Setting | What it does |
| --- | --- |
| `theme` | A ready-made theme: `classic` (warm cream and brown), `linen` (linen, navy, coral), `midnight` (navy, glacier blue, red), `rose` (cream, hot pink, emerald) or `onyx` (dark, warm white, gold). Or the artist's own colours: `{ "background": "#f2ece4", "text": "#1f3550", "main": "#1f3550", "accent": "#e4674f" }`. `main` colours the buttons and mailing-list box, `accent` the small details and the music icon. Text is checked automatically and adjusted if it would be hard to read. |
| `corners` | Rounded corners in pixels: `0` square, `16` soft, `24` extra round. |
| `flyingNote` | The music icon that travels to each section as fans scroll. |
| `doodles` | A quiet line pattern of music icons behind the page. |
| `hostCode` | Unlocks the in-page Colours panel for the artist (`?host=CODE` on the address). This goes away once the dashboard has a proper login. |

## Music and videos

| Setting | What it does |
| --- | --- |
| `spotifyArtist`, `artistPage`, `youtube` | Links to the artist's Spotify, Apple Music and YouTube. |
| `discography` | Every release, newest first: `title`, `type` (Single, EP, Album), `year`, `cover`, `links` as `["Spotify", "https://..."]` pairs, and optional `story` and `lyrics`. Releases marked `"sample": true` hide their lyrics. |
| `showSongs` | How many of the newest songs show under Listen. |
| `platforms` | The streaming buttons each song shows, in order. A missing Spotify link falls back to the artist profile; Audiomack and Boomplay fall back to a search. |
| `player` | `spotify` uses Spotify's player (30-second previews for listeners not signed in). `full` plays whole songs when a song has its own audio file or an Audiomack link. |
| `songs` | The videos, newest first. Each has `title` (empty = filled in from YouTube), `meta`, `note`, `video.href` (the YouTube link) and `stream` links. |
| `showVideos` | How many videos show (up to 3). |

## New single, tour, store, support

| Setting | What it does |
| --- | --- |
| `release` | Countdown and pre-save for the next release: `type` (`Single`, `EP`, `Album` or `Podcast`; sets the heading, e.g. "New EP", and the button, e.g. "Pre-save the EP"), `title`, `date` as `2026-12-18T00:00:00+01:00` (+01:00 is Lagos time), `cover` (empty uses the bio photo), `presave` (any one link: Spotify, Apple Music or the distributor's pre-save link), `listen`. `"sample": true` marks placeholder content. |
| `shows` | Tour dates as `[day, month, weekday, city, venue, status, ticket link]`. Status is empty, `Few left` or `Sold out`. |
| `bandsintown` | Set `artist` and `appId` to load tour dates from Bandsintown instead. |
| `store`, `merch` | Store link, and products with `name`, `price`, `href` and `icon` (`vinyl`, `tee` or `poster`). |
| `support` | Tips: `currency` (`USD` or `NGN`), `amounts`, the `naira` payment link (Paystack) and `international` link (PayPal), and optional `bank` details. |

## Fans and contact

| Setting | What it does |
| --- | --- |
| `mailingList.endpoint` | Where sign-ups go. Empty uses Netlify Forms. Later it will point at the dashboard. Every sign-up is tagged with the artist's name. |
| `joinApps` | WhatsApp channel and Telegram links beside the sign-up box. Empty hides a button. |
| `contact` | Booking email and contact cards. |
| `socials` | Links for the icons at the bottom: `youtube`, `spotify`, `apple`, `instagram`, `tiktok`. |
| `linkInBio` | Turns on the short link-in-bio page at `/links`. |
| `stats.goatcounter` | A free GoatCounter account name for visit counts. |

## Sharing (link previews)

| Setting | What it does |
| --- | --- |
| `siteUrl` | The live web address. Needed so WhatsApp and Instagram can find the preview image. |
| `share.title` | The browser tab title. |
| `share.description` | The line under the name in link previews. Empty uses `bio.short`. |
| `share.image` | The preview picture, 1200 × 630 pixels. |
| `share.hideFromSearch` | `true` keeps the page out of Google while it is still being set up. |

Fields marked `"sample": true` (or `showsSample`, `merchSample`) hold placeholder content and show a small "sample" marker on the page until real details are added.
