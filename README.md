# Hectorskalaen – Bar Smell Index (Bergen)

Hectorskalaen is a community smell index for bars in Bergen, Norway. Anyone can rate a venue from **1** (no smell / good smell) to **10** (smells like piss). The score on each card is the live average of those votes.

The original editorial list, photos, and descriptions are kept in the repository. They were not deleted.

---

## What changed

The site is user-driven:

1. **Ratings** — visitors give 1–10. You can change your own vote; it updates the average instead of stacking duplicates.
2. **Bars come from OpenStreetMap** — not from a submit form. A scan of Bergen (`amenity=bar|pub|nightclub|biergarten`) is stored as `src/bars.json`. Missing venues belong on [OpenStreetMap](https://www.openstreetmap.org), then a catalog refresh picks them up. That avoids spam and keeps names/coordinates in one place.
3. **Persistence** — vote totals need a tiny always-on database. The API is built for **[Turso](https://turso.tech)** (libSQL/SQLite): free tier, no sleep/idle, no cold start, plenty of room for this dataset. Locally, votes are stored in `data/ratings.json` so you can run the app without an account.

Supabase and Neon were not used because their free tiers pause. Turso keeps the database as a file, so it stays awake.

---

## Running the app

```bash
npm start
```

Then open http://localhost:8000

- `/` — browse, search, sort, map (hover a pin for photo + score, click for votes and comments), and rate
- `/game.html` — guess the community average

```bash
npm test
```

---

## How ratings work

- Catalog (names, coordinates, photos, original write-ups) lives in `src/bars.json`.
- Votes live in the `/api/ratings` function (`GET` aggregates, `POST` upsert).
- Each anonymous visitor can leave **one score and one optional comment per bar**. Updating replaces the previous vote; it does not stack.
- Others can like or dislike a comment (one vote per visitor; click again to undo). Comments are sorted by most likes. A net score of −1 or lower hides the comment in a collapsed list at the bottom.
- Comments are trimmed, capped at 280 characters, and shown on the bar page. Editorial seed scores have no comments.
- The homepage lists bars that already have a score. Use **Uten score** to browse the rest.
- The ten original scores are seeded once as editorial votes so the old ranking is the starting point, not a wipe.
- Each browser gets an anonymous id in `localStorage`. Re-rating the same bar updates that vote and comment.
- Vote POSTs are lightly limited per IP (about 40/minute and 200/hour) so a script cannot dump a thousand requests. GET is not limited.

### Production database (Turso)

The Azure Portal **Environment variables** blade currently errors with
`App settings are undefined` on this Static Web App, so we do **not** rely on it.

1. Create a free database at [https://app.turso.tech/signup](https://app.turso.tech/signup) (no card, databases do not go idle).
2. Add these **GitHub Actions secrets** (not Azure Portal settings):
   [https://github.com/Zylvian/Hectorskalaen/settings/secrets/actions](https://github.com/Zylvian/Hectorskalaen/settings/secrets/actions)

   - `TURSO_DATABASE_URL` = `libsql://…turso.io`
   - `TURSO_AUTH_TOKEN` = the database token

3. Re-run **Deploy web app to Azure Static Web Apps** on `main` (or push a commit). The workflow writes the values into the API package at deploy time.

Until those secrets exist, the deployed API still works but stores votes in a temporary file that does not survive restarts.

If you prefer Azure CLI instead of GitHub secrets:

```bash
az staticwebapp appsettings set \
  --name <your-swa-name> \
  --setting-names TURSO_DATABASE_URL=libsql://… TURSO_AUTH_TOKEN=…
```

---

## How to refresh the Bergen bar list

```bash
npm run fetch-bars
```

This calls the OSM Overpass API for Bergen, merges the result with `src/data/original-bars.json` (so titles, photos, descriptions, and seed scores stay), and writes:

- `src/bars.json` — public catalog
- `api/data/seeds.json` — ids + editorial seeds for the API

Offline / replay a saved Overpass dump:

```bash
node scripts/fetch-bergen-bars.mjs --from-file /tmp/bergen-bars.json
```

Do not add bars by hand in a form. If OSM is missing a place, add it there, then refresh.

Photos live on the catalog entries in `src/bars.json` (`picture` + `pictureSource`), not in Turso. After a bar-list refresh, fill missing photos:

```bash
npm run fetch-images
```

That script looks up, in order: OpenStreetMap / Wikidata photos, the venue website’s `og:image`, a nearby Wikipedia page image, Openverse (CC) photos matching the name in Bergen, then a neighborhood map snapshot saved under `src/media/maps/` so every card still has an image. Original editorial photos are never replaced. Map snapshots © OpenStreetMap contributors.

---

## Original data (kept)

`src/data/original-bars.json` is the exact pre-revamp list (Hector, Kråken, Kulturhuset, Henrik, Rævadilter, Fotballpubben, Legal, Grøndahls, Folk & Røvere, Pappa), including pictures and copy. Those ten are matched to OSM where possible and still show up first in the catalog file.

---

## Folder structure

- `src/index.html` — browse UI (grid / list / map)
- `src/game.html` — guess-the-score game
- `src/app.js` / `src/styles.css` — client
- `src/bars.json` — OSM + curated catalog
- `src/media/maps/` — neighborhood map snapshots for venues without a photo
- `src/data/original-bars.json` — archived original entries
- `api/` — Azure Functions ratings API
- `scripts/dev-server.mjs` — local static + API server
- `scripts/fetch-bergen-bars.mjs` — Bergen OSM scan
- `scripts/fetch-bar-images.mjs` — attach photo URLs to catalog entries
- `scripts/test-store.mjs` — catalog + rating tests

---

## Design goals

- Anyone in Bergen can rate smell without creating an account
- The bar list tracks the real map, not a wiki of user-submitted names
- Votes persist on a free database that does not fall asleep
- Nothing from the original list is thrown away
