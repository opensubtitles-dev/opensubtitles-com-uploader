# Plan: Create-from-ID workflow for missing titles

**Date:** 2026-05-07
**Status:** Largely shipped (see callout)
**Owners:** uploader (this repo) + osdb3 backend (separate plan)
**Cross-ref:** osdb3-side counterpart → `docs/plans/2026-05-07-stub-feature-from-imdb-tmdb.md`

> [!success] Status as of 2026-05-26
> Backend and frontend are both on staging.
> - **Resolve flow** — `uploadApi.resolveFromId({imdbId, tmdbId})` calls
>   `POST /subtitles/upload/features/from_id` (`src/services/api/upload.js:218-227`).
>   The server normalises episode imdb_ids to the parent show + preselected
>   coords and embeds the full season/episode graph.
> - **Confirm + create** — `StubFeatureDialog.jsx` runs the two-state machine
>   (`resolve → confirming`), renders the season/episode picker for tvshow
>   responses (`StubFeatureDialog.jsx:391-405`), and `onCreated` propagates
>   `imdb_id` / `tmdb_id` / `source` into `createStubFeature` so the server
>   row carries the canonical external id (`upload.js:173-179`).
> - **Server policy** — resolved-from-id stubs come back `enabled: true`
>   (not `enabled: false` as the original §3 of the backend plan implied),
>   so `/guess` can find them immediately. Only `source: "manual"` rows
>   stay disabled until a moderator approves.
> - **Known cosmetic issue** — TMDB poster thumbnails occasionally fail
>   to render under the host page's Cross-Origin-Resource-Policy headers
>   (CORP). It does not block the flow; the confirm step still shows
>   title / year / IMDb id / picker. Tracked as a polish item, not a
>   blocker.

---

## 1. Problem

Current "movie not in our database" flow (`StubFeatureDialog`):

1. User searches a title in `MovieSearch`.
2. No results.
3. Clicks "Movie not in database? Create a new entry →".
4. Dialog opens with the **search query string** pre-filled in the
   `Title` field. If the user pasted `https://www.imdb.com/title/tt11114492/`,
   that whole URL ends up as the title — which is wrong, and the
   user is the one expected to clean it up + invent the year.
5. Submitting POSTs `{title, year, type}` to
   `/api/v1/subtitles/upload/features/stub`. The server creates a
   provisional feature with whatever the user typed, and a moderator
   reviews it later.

Problems:
- Client side has the IMDb id (or a URL that contains it), but throws it
  away and asks the user to type a free-text title instead.
- The server never gets a chance to look up the canonical metadata
  from IMDb / TMDb, so the provisional entry is just whatever the user
  typed — moderators have to re-resolve it manually.
- The user has to enter year + type by hand even though IMDb / TMDb
  knows both.
- No "is this what you meant?" confirmation step before commit.

## 2. Desired flow

```
[ User searches "tt11114492" or pastes IMDb URL ]
            │
            ▼
   /subtitles/upload/guess (existing) ← already returns 0 hits
            │
            ▼
[ "Movie not in database? Create from IMDb/TMDb id" CTA ]
            │
            ▼
   ┌───────────────────────────────────┐
   │  Step A — Resolve dialog          │
   │  - field: IMDb id  /  TMDb id     │
   │  - parses any imdb URL paste      │
   │  - "Look up" button               │
   └────────────────┬──────────────────┘
                    │
        POST /subtitles/upload/features/from-id
              { imdb_id?: "tt11114492", tmdb_id?: 123 }
                    │
        ┌───────────┴───────────────┐
        │                           │
   Server fetches IMDb /        Server returns 404
   TMDb metadata via existing  ("imdb_id_not_found"
   integrations (TMDB API,      / "tmdb_id_not_found"):
   IMDb scrape, or pre-cached   show inline error in
   list)                        the resolve dialog.
        │
        ▼
   ┌───────────────────────────────────┐
   │  Step B — Confirm dialog          │
   │  Title:  Norsemen                 │
   │  Year:   2016                     │
   │  Type:   TV show                  │
   │  IMDb:   tt11114492 ✓             │
   │  Poster: <thumbnail>              │
   │  [Cancel] [Looks right — Create]  │
   └────────────────┬──────────────────┘
                    │
   POST /subtitles/upload/features/stub
       { title, year, type, imdb_id, tmdb_id, source: 'imdb' | 'tmdb' }
                    │
                    ▼
   feature_id returned → uploader attaches subtitle to it
```

The two endpoints (`/from-id` for resolve, `/stub` for commit) keep the
network shape simple and let the user back out at the confirm step.
Alternatively the backend can collapse them (see §6 trade-off).

## 3. API contract — backend deliverable

### New: `POST /api/v1/subtitles/upload/features/from-id`

**Auth:** anonymous OK. Same JWT plumbing as `/check`.

**Body** (one of `imdb_id` / `tmdb_id` required):

```json
{ "imdb_id": "tt11114492" }            // or "11114492"
{ "tmdb_id": 84958 }
```

**Response 200 — match found in IMDb/TMDb:**

```json
{
  "found": true,
  "source": "imdb",
  "imdb_id": "tt11114492",
  "tmdb_id": null,
  "title": "Norsemen",
  "original_title": "Vikingane",
  "year": 2016,
  "type": "tvshow",
  "poster_url": "https://image.tmdb.org/t/p/w185/...",
  "exists_in_db": false,
  "feature_id": null
}
```

If the title **already exists** in our DB (catch race against `/guess`):

```json
{
  "found": true,
  "exists_in_db": true,
  "feature_id": 9988012,
  "title": "Norsemen",
  "year": 2016,
  "type": "tvshow"
}
```

The uploader treats this case the same as a successful `/guess`
result (skip the "Create" step, attach directly to `feature_id`).

**Response 404 — id resolves to nothing:**

```json
{ "code": "imdb_id_not_found", "message": "No IMDb title with id tt11114492" }
{ "code": "tmdb_id_not_found", "message": "No TMDb entry with id 84958" }
```

**Response 422 — bad input:**

```json
{ "code": "invalid_imdb_id", "message": "Expected tt-prefixed digits" }
{ "code": "missing_id",      "message": "Provide imdb_id or tmdb_id" }
```

### Extend: `POST /api/v1/subtitles/upload/features/stub`

Existing endpoint already takes `{title, year, type}`. Extend the
payload to optionally carry the resolved id metadata:

```json
{
  "title": "Norsemen",
  "year": 2016,
  "type": "tvshow",
  "imdb_id": "tt11114492",
  "tmdb_id": null,
  "source": "imdb"
}
```

When `source !== 'manual'`, the server:
- Stores the imdb/tmdb id on the feature so a moderator review can
  link the provisional → real entry without manual re-resolution.
- Optionally lifts `provisional` faster (e.g. 24h cooldown vs the
  current full manual review) — separate policy decision.

Backwards compatibility: existing manual-mode callers continue to
work without touching `source`.

### Backend implementation notes (osdb3 plan deliverable)

- `Api::V1::Subtitles::Upload::FeaturesController` gains a `from_id`
  action that delegates to a new service `Subtitles::Features::ResolveFromId`.
- The resolver reuses existing TMDb integration and whatever IMDb
  metadata path is in place. For IMDb, the cleanest source is the
  legacy MySQL `Movies` table — it already has imdb_id + title + year
  for ~10M films, no scrape needed. New imdb ids that aren't there
  can fall through to TMDb's `find?external_id=...` which returns
  IMDb→TMDb mappings.
- Caching: 24h cache per imdb_id / tmdb_id at Redis level — these
  metadata lookups are stable enough.
- Provisional feature creation in the extended `/stub` endpoint should
  index the imdb_id / tmdb_id as a unique partial index so
  duplicate Create attempts return the existing `feature_id` instead
  of stacking provisionals.
- See `osdb3/docs/plans/2026-05-07-stub-feature-from-imdb-tmdb.md`
  (to be written) for full backend phasing, migrations, and tests.

## 4. Uploader frontend — this repo's deliverable

### Files to touch

| File | Change |
|------|--------|
| `src/services/api/upload.js` | Add `uploadApi.resolveFromId({imdbId, tmdbId})` calling `/features/from-id`. Extend `createStubFeature` payload to accept `imdbId`, `tmdbId`, `source`. |
| `src/components/MovieSearch.jsx` | Detect when query is an IMDb id / URL or TMDb id. Promote the "Create new entry" CTA from a tiny link to a primary card when query parses as an id. Skip the empty-results step entirely if user pasted an id with no hits — go straight to the resolve dialog. |
| `src/components/StubFeatureDialog.jsx` | Two-step internal state machine: `resolve` (current = collect imdb/tmdb id) → `confirm` (display fetched title/year/poster, [Create] button). Keep the manual-fallback "I just want to type the title myself" path for users who don't have an id. |
| `src/components/MovieDisplay.jsx` | "Create new entry" button on the no-match warning becomes a direct shortcut into the new dialog with `imdbId` pre-parsed from the search query (when available). |

### Component state

`StubFeatureDialog` becomes a small state machine:

```
state: 'resolve' | 'confirming' | 'submitting' | 'manual'

resolve  → typing imdb_id / tmdb_id → click "Look up" → API call
  on found:not-in-db    → confirming
  on found:exists-in-db → onCreated(feature_id) immediately
  on not_found          → inline error, stay in resolve
  on validation_error   → inline error, stay in resolve
  link "...or enter title manually" → manual

manual   → existing form (title, year, type) — submits with source: 'manual'

confirming → shows title + year + type + poster
  [Cancel] → back to resolve
  [Create] → submitting

submitting → POST /stub with full payload → onCreated(feature_id)
```

### IMDb id parsing

Keep current input box accepting any of:
- `tt11114492`
- `11114492`
- `https://www.imdb.com/title/tt11114492/`
- `https://www.imdb.com/title/tt11114492/?ref_=...`

Helper `parseImdbId(input) → 'tt11114492' | null` already exists in
`src/utils/fileUtils.js` (used by `MovieSearch`); reuse it. Add
`parseTmdbId(input)` in the same file (just digits, optional URL).

### Error handling

- 404 / not_found → red banner inside the dialog: "No IMDb/TMDb entry
  with id X" + suggest checking the id or switching to manual mode.
- 422 / invalid_imdb_id / invalid_tmdb_id → inline field error.
- 401 (anonymous-rejected) → daisyui alert + Login button (reuse
  `errorCopy` mapping).
- Network / 5xx → standard `ErrorBanner` with retry.

## 5. Acceptance criteria

- [ ] Pasting `tt11114492` (no DB hit) into MovieSearch surfaces the
      "Create from IMDb id" CTA prominently — not buried as a hint.
- [ ] Clicking through opens the new resolve dialog pre-filled with the
      parsed id (no double-paste).
- [ ] On a successful lookup, user sees the fetched title + year +
      poster and explicitly confirms.
- [ ] On confirm, `feature_id` flows back into the upload flow; the
      subtitle's "No movie match" warning replaces with the fetched
      title.
- [ ] If the resolved id already maps to an existing feature in our DB,
      the dialog skips the confirm step and attaches directly.
- [ ] Manual-mode (free-text title + year + type) still works for
      truly unlisted content.
- [ ] No regressions on the existing `StubFeatureDialog` callers
      (`MovieSearch.jsx` is the only one).

## 6. Open questions / trade-offs

1. **Single endpoint vs two-step** — could the backend collapse
   `/from-id` (lookup) and `/stub` (commit) into one call that takes
   `{imdb_id, confirm: true}`? Probably yes, but two endpoints make
   the "back" navigation in the dialog cheap and let us cache the
   lookup independently of commits. Recommended: keep two.
yes ok
2. **Episode handling** — IMDb episode pages exist (e.g. `tt0959621`
   = LOST S01E01). Should `/from-id` resolve episodes too, or only
   accept show-level ids? Recommend accepting episode ids; the server
   creates / links the parent show feature *and* the episode child.
   This unlocks orphaned single-episode subtitle uploads where the
   user can find the IMDb episode page but the show isn't in our DB.

we have to make sure uploads never happen on the tv serie itself. if user sends a episode or tvshow imdbid, we need to build the whole serie, all seasons and episodes, and the user must pick the appropriate season and episode. so if the from id is the episode we can return the show and episode pre-selected. if it's the tv serie, we return the show and a select for season and episode. note we have already all the imdb show structures in the duckdb, so we can do some quering without API

3. **TMDb vs IMDb precedence** — when both ids are sent, which wins?
   IMDb is the source of truth for our existing data; recommend prefer
   imdb_id, fall back to tmdb_id only if imdb_id is missing.
  
   yes imdb always prefered source of truth
   
4. **Spam / abuse** — the create-from-id flow makes provisional-entry
   creation easier, which could be abused. Mitigations: rate-limit
   per-user (5/hour anonymous, 50/hour logged-in), reject ids that are
   already in spam-IDs deny-list, queue all provisional features to
   the `feature_review` Sidekiq queue for async moderator alert.
hopefully creating valid imdb records shouldn't be too much of a probem, we can have a secondary mechanism that cleans up records if nothing gets uploaded to them

## 7. Phasing

1. **Backend specs** — write the osdb3 counterpart plan first; agree
   on response shape before any code lands.
2. **Backend impl** — `from_id` action + extended `/stub` accepting
   `imdb_id` / `tmdb_id` / `source`. Behind a feature flag if needed.
3. **Uploader resolveFromId service** — small, mechanical, can ship
   independently of the dialog rewrite (becomes dead code until
   step 4).
4. **Uploader UI** — refactor `StubFeatureDialog` into the two-state
   machine + integrate with `MovieSearch` direct-id path.
5. **Polish** — poster thumbnail, "Episodes too" expansion (open
   question 2), abuse limits.

Steps 1–2 are blocked on backend availability; 3 can ship in
parallel. 4 ships once backend is on staging. 5 is post-launch.

## 8. Out of scope for this plan

- Bulk-create from a list of imdb ids.
- TMDb-only titles that don't exist on IMDb at all (rare).
- Migrating existing manually-typed provisional features to imdb-linked
  ones (separate cleanup task for the moderation team).
