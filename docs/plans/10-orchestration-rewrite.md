---
title: subtitleUploadService.js orchestration rewrite (REST-native)
date: 2026-05-06
status: ready-to-implement
predecessor: 05-upload-flow.md
audit: ../../../osdb3/docs/three-brain-out/2026-05-04-uploader-v2-deep-analysis/report.md  (§5)
---

# Orchestration Rewrite — drop the legacy XML-RPC shape

## Why this exists

`src/services/subtitleUploadService.js` (1339 lines) is the load-bearing
upload sequencer. Its REST plumbing in `src/services/api/upload.js` is built
and tested, but the orchestration layer still produces XML-RPC-shaped
payloads (`{ subtitles: [{...}] }` for try, `{ baseinfo, cd1, subcontent }`
for commit), then translates them via `adaptLegacyCheckPayload` /
`adaptLegacyCommitPayload` before sending. Responses come back through
`restCheckResponseToLegacy` / `restCommitResponseToLegacy` and the
downstream code reads `alreadyindb`, `status: "200 OK"`, etc.

This is a working bridge but two things make it the next priority:

1. **It's the single biggest blocker for shipping the .com binary** — the
   audit (`docs/three-brain-out/.../report.md` §5) puts Phase 2 at ~40%
   complete; remaining client work is dominated by this rewrite.
2. **The legacy adapters obscure real bugs** — when something breaks in the
   pipeline, you have to mentally translate twice (REST↔legacy↔REST) to
   reason about it.

Goal: orchestration produces REST shape directly, drops both adapter
calls and response translators, downstream code reads the REST envelope
fields (`already_in_db`, `subtitle_id`, `status: "created"`, etc.).

## Inventory (what changes)

### Files to rewrite

| File | Lines | Scope |
|---|---|---|
| `src/services/subtitleUploadService.js` | 1339 | Rewrite 4 `prepare*` static methods to emit flat REST objects; drop adapter calls at 4-6 call sites; switch consumers to read REST response shape |
| `src/services/api/upload.js` | (12 KB) | Once orchestration consumers are updated, **delete** the four adapter functions: `adaptLegacyCheckPayload`, `adaptLegacyCommitPayload`, `restCheckResponseToLegacy`, `restCommitResponseToLegacy`. Keep the `uploadApi` factory (already pure REST). |

### Files with XML-RPC fallback branches (separate audit needed)

| File | Lines | What's there |
|---|---|---|
| `src/components/MovieDisplay.jsx` | 941 | `/* Fallback to XML-RPC data only */` branch |
| `src/components/SubtitleUploader.jsx` | 2016-2022 | `Extract GuessIt data from XML-RPC response` branches |
| `src/components/FileList/VideoFile.jsx` | 426 | `/* Fallback to XML-RPC data */` branch |
| `src/hooks/useMovieGuess.js` | 216, 465 | `source: 'xmlrpc-enhanced-with-guessit-episode-data'` marker; `// This will use XML-RPC which already handles episodes correctly` |
| `src/hooks/useGuessIt.js` | 7-57 | Priority: `WASM offline > XML-RPC data > API fallback` |
| `src/components/DebugPanel.jsx` | 344 | "Delete all stored language and XML-RPC cache" admin button — keep until Phase 4 storage cleanup |

### Storage-key cleanup (after the orchestration rewrite is green)

`src/utils/storageKeys.js` has a `LEGACY_KEYS` array referencing
`opensubtitles_xmlrpc_*` cache keys. Remove the writes (and write a one-shot
purge in `useEffect` on app boot) once nothing else reads them.

## Refactor plan — orchestration (this doc's focus)

### Step 1 — Update `prepareUploadDataForSingleSubtitle` to emit REST shape

**File:** `src/services/subtitleUploadService.js:575-655`

Currently produces `{ subtitles: [{ subhash, subfilename, moviehash,
moviebytesize, moviefilename, idmovieimdb, ... }] }` (XML-RPC tryUpload
shape).

Rewrite to produce flat REST `/check` shape directly. The exact REST
payload accepted by the .com server (per `docs/api/upload-v2-contract.md`
§2.1):

```javascript
{
  subhash:        '<md5>',
  subfilename:    'Movie.2024.srt',
  moviehash:      '<16-hex>',
  moviebytesize:  Number,
  moviefilename:  'Movie.2024.mkv',
  idmovieimdb:    '0411008',         // string of 7-digit IMDb id (no 'tt')
  // OR
  tmdbid:         '605',
  // OR
  feature_id:     12,
  season_number:  Number,             // for episodes via parent_imdbid
  episode_number: Number,
  movietimems:    Number,
  moviefps:       Number,
  movieframes:    Number,
  sublanguageid:  'eng',
}
```

The current legacy-shape work in this method (extracting fields from the
subtitle/video pair, computing flags, applying overrides) **stays the
same**. Only the return-statement shape changes. Local helper variables
(`subtitleInfo`, `bestMovieData`, `videoMetadata`, etc.) are unchanged.

**Method-level diff sketch:**

```diff
   static async prepareUploadDataForSingleSubtitle({ ... }) {
     // ... unchanged setup work (lines 576-650 ish)

-    return {
-      subtitles: [
-        {
-          subhash: subtitleInfo.hash,
-          subfilename: subtitle.name,
-          moviehash: videoHash,
-          moviebytesize: videoSize,
-          moviefilename: video.name,
-          idmovieimdb: imdbId,
-          movietimems: videoMetadata?.duration_ms,
-          moviefps: videoMetadata?.fps,
-          movieframes: videoMetadata?.total_frames,
-        }
-      ]
-    };
+    return {
+      subhash:       subtitleInfo.hash,
+      subfilename:   subtitle.name,
+      moviehash:     videoHash,
+      moviebytesize: videoSize,
+      moviefilename: video.name,
+      idmovieimdb:   imdbId,
+      movietimems:   videoMetadata?.duration_ms,
+      moviefps:      videoMetadata?.fps,
+      movieframes:   videoMetadata?.total_frames,
+      // sublanguageid + season/episode injected at the call site if present
+    };
   }
```

### Step 2 — Update `prepareActualUploadData` to emit REST shape

**File:** `src/services/subtitleUploadService.js:657-870`

Currently produces `{ baseinfo: {...}, cd1: {...}, subcontent }` (XML-RPC
UploadSubtitles shape). The REST flat-shape adds the same baseinfo and cd1
fields onto a single object plus `subcontent`:

```diff
-    return {
-      baseinfo: {
-        idmovieimdb: imdbId,
-        moviereleasename: cleanedReleaseName,
-        movieaka: movieAka,
-        sublanguageid: subtitleLang,
-        subauthorcomment: authorComment,
-        hearingimpaired: hi ? '1' : '0',
-        highdefinition: hd ? '1' : '0',
-        automatictranslation: autoTrans ? '1' : '0',
-        subtranslator: translator,
-        foreignpartsonly: foreignParts ? '1' : '0',
-      },
-      cd1: {
-        subhash: subtitleInfo.hash,
-        subfilename: subtitle.name,
-        moviehash: videoHash,
-        moviebytesize: videoSize,
-        moviefilename: video.name,
-        subcontent: base64GzippedContent,
-        movietimems: videoMetadata?.duration_ms,
-        moviefps: videoMetadata?.fps,
-        movieframes: videoMetadata?.total_frames,
-      },
-      subcontent: base64GzippedContent,
-    };
+    return {
+      // Identification (same shape as /check)
+      subhash:        subtitleInfo.hash,
+      subfilename:    subtitle.name,
+      subcontent:     base64GzippedContent,
+      moviehash:      videoHash,
+      moviebytesize:  videoSize,
+      moviefilename:  video.name,
+      idmovieimdb:    imdbId,
+      movietimems:    videoMetadata?.duration_ms,
+      moviefps:       videoMetadata?.fps,
+      movieframes:    videoMetadata?.total_frames,
+      sublanguageid:  subtitleLang,
+      // Metadata (was baseinfo)
+      release_name:       cleanedReleaseName,
+      movie_aka:          movieAka,
+      author_comments:    authorComment,
+      translator:         translator,
+      hearing_impaired:   !!hi,
+      high_definition:    !!hd,
+      foreign_parts_only: !!foreignParts,
+      automatic_translation: !!autoTrans,
+      machine_translated: !!machineTranslated,
+      // Optional client guessit + video metadata
+      guessit:        guessItPayload || undefined,
+      video_metadata: videoMetadata ? {
+        codec:   videoMetadata.codec,
+        bitrate: videoMetadata.bitrate,
+      } : undefined,
+    };
```

**Renames to note:**
- `moviereleasename` → `release_name`
- `movieaka` → `movie_aka`
- `subauthorcomment` → `author_comments`
- `subtranslator` → `translator`
- `hearingimpaired` → `hearing_impaired` (and switch from "0"/"1" to boolean)
- `highdefinition` → `high_definition`
- `foreignpartsonly` → `foreign_parts_only`
- `automatictranslation` → `automatic_translation`
- `cd1.*` → flattened to top-level

### Step 3 — Drop adapter calls at the 4 call sites

**Sites in `subtitleUploadService.js`:**

| Line | Current | After |
|---|---|---|
| 133 | `await uploadApi.check(adaptLegacyCheckPayload(uploadData), {...})` | `await uploadApi.check(uploadData, {...})` |
| 181 | `await uploadApi.commit(adaptLegacyCommitPayload(actualUploadData), {...})` | `await uploadApi.commit(actualUploadData, {...})` |
| 369 | `await uploadApi.check(adaptLegacyCheckPayload(uploadData), {...})` (orphaned subtitle path) | `await uploadApi.check(uploadData, {...})` |
| 416 | `await uploadApi.commit(adaptLegacyCommitPayload(actualUploadData), {...})` (orphaned) | `await uploadApi.commit(actualUploadData, {...})` |

### Step 4 — Switch response consumers to REST shape

The four call sites currently wrap responses in `restCheckResponseToLegacy`
/ `restCommitResponseToLegacy` and consumers read `alreadyindb`, `status:
"200 OK"`, `data.IDSubtitleFile`, etc.

**REST envelope** (per `upload-v2-contract.md` §2.1 + §2.2):

```javascript
// /check response:
{
  already_in_db:      boolean,
  duplicate_of:       number | null,    // subtitle_id
  similar_to:         null | object,
  feature: { feature_id, imdbid, tmdbid, title, year, type, provisional },
  would_be_rejected:  boolean,
  rejection_reasons:  string[],
  flags_suggested: { hearing_impaired, high_definition, foreign_parts_only },
  quota: { limit, remaining, resets_at }
}

// /upload (commit) response:
{
  subtitle_id:   number,
  feature_id:    number,
  subfile_id:    number,
  download_url:  string,
  status:        'created' | 'flagged_for_review',
  flags_applied: string[],
  warnings:      string[],   // 'storage_repair_pending', 'flagged_for_review', ...
  quota:         { limit, remaining, resets_at }
}
```

**Replace these legacy reads:**

| Legacy field (lines) | REST equivalent |
|---|---|
| `tryUploadResponse.alreadyindb === 0` (146, 382) | `tryUploadResponse.already_in_db === false` |
| `tryUploadResponse.alreadyindb === 1` (217) | `tryUploadResponse.already_in_db === true` |
| `response.status !== '200 OK'` (213) | check the HTTP layer / `restClient` rejection (4xx maps to RestError); 2xx is success |
| `response.data.IDSubtitleFile` | `response.subtitle_id` |
| `response.data.IDSubtitleFileURL` | `response.download_url` |

The rejection-on-status branch at line 213 is dead code in REST mode —
`restClient` raises `RestError` on 4xx and the await throws, so the catch
block (further down) handles errors. Remove the manual status check.

### Step 5 — Remove now-unused adapters from `api/upload.js`

After steps 1-4 land and tests are green, delete:

- `adaptLegacyCheckPayload` (lines 208-227)
- `adaptLegacyCommitPayload` (lines 228-263)
- `restCheckResponseToLegacy` (lines 264-283)
- `restCommitResponseToLegacy` (lines 284-302)

Plus their `import` statements at `subtitleUploadService.js:1-7`.

### Step 6 — Tests

Add or extend `tests/services/subtitleUploadService.test.js` covering:

- Happy path: prepare → check (already_in_db=false) → commit → success.
- Already-in-DB short-circuit: prepare → check (already_in_db=true) → no
  commit; result reports the existing subtitle_id.
- 409 on commit (race-window duplicate): rest layer throws RestError with
  `code: 'duplicate'`; orchestrator translates to user-facing "already
  uploaded" outcome.
- 422 subhash mismatch: handled with retry-able error message.
- 413 payload_too_large: shown as "subtitle too large" with cap value.
- Storage-warning surfaced: response with `warnings:
  ["storage_repair_pending"]` is reported as success-with-warning, not
  failure.

Use `node --test` (per `package.json` scripts).

## Build order

Granular and reversible:

1. **Land `prepareUploadDataForSingleSubtitle` rewrite** + update its 1
   call site (line 133). Other paths still use legacy adapters. Run tests.
2. Same for `prepareActualUploadData` + its call site (line 181). Run tests.
3. Same for the orphaned variants (lines 369 + 416) using the orphaned-prepare
   methods at lines 872 and 940.
4. Switch response consumers (line 132, 146, 180, 213, 217, 225, 368, 382,
   394+).
5. Delete the four adapter functions + their imports.
6. Audit + remove the 6 XML-RPC fallback branches in components/hooks
   (separate sub-task; can run in parallel with steps 1-5).
7. Storage-key purge (LEGACY_KEYS) — Phase 4 cleanup, can defer.

Each step ships green; nothing is required to "land in one shot".

## Estimated effort

Per the audit (report §5):

- Steps 1-5 (orchestration + adapter removal): **1-2 engineer-days**
- Step 6 (component fallback audit): **0.5 day**
- Step 7 (storage-key purge): **0.5 day**
- Tests: **0.5 day**
- Golden replay (5-20 prod uploads): **1 day**

**Total: ~3-5 engineer-days** to land Phase 2 fully — matches the roadmap
estimate.

## Acceptance criteria (Phase 2 exit)

Per `docs/three-brain-out/2026-05-04-uploader-v2-deep-analysis/roadmap.md`
Phase E:

- Forked app uploads a real subtitle through `staging.opensubtitles.com`
  end-to-end with JWT auth.
- Duplicate detection works (re-uploading the same file shows "already in
  DB").
- Replace from history works.
- "Not in IMDb" stub flow works.
- Golden replay 5-20 fixtures all match expected outcomes.
- No XML-RPC code path is reachable from a clean install (legacy storage
  keys cleared, fallback branches removed).
- All `xmlrpc` / `xml-rpc` / `XML-RPC` comments in code body either deleted
  or updated to "(legacy, removed YYYY-MM-DD)".

## Open question — episode metadata via `useMovieGuess` — RESOLVED 2026-05-06: server gap, fallback STAYS

`useMovieGuess.js:216` carries `source: 'xmlrpc-enhanced-with-guessit-episode-data'`
which suggests the legacy XML-RPC `GuessMovieFromString` returned
season/episode metadata that the new REST `/subtitles/upload/guess` doesn't.

**Verified against staging on 2026-05-06**:

`POST /api/v1/subtitles/upload/guess` with `{"filename":"Lost.S01E03.HDTV.mkv"}`
returns:

```json
{
  "best_guess": {
    "feature_id": 2308696,
    "imdbid": 33042203,
    "title": "Indiana Jones: Raiders of the Lost Ark Pitch Meeting",
    "year": null,
    "type": "Episode",
    "provisional": false
  },
  "candidates": [...]
}
```

Two gaps vs the legacy:

1. **Wrong feature.** The text-match scan is hitting random `type: "Episode"`
   rows that share the word "Lost"; the actual TV show "Lost" (2004) isn't
   in the candidates at all. There's no season/episode-aware ranking that
   matches the parent show + S01E03.
2. **No `season_number` / `episode_number` field.** Even if the right
   feature IS picked, the response shape can't tell the client which S/E
   to upload against.

Compare to a working movie filename — `Inception.2010.1080p.BluRay.x264.mkv`
correctly returns Inception (2010, Movie, IMDb 1375666) as the best_guess.
Movies work fine; episodes don't.

**Decision:**
- **Keep the XML-RPC fallback in `useMovieGuess.js`** as the path for
  filenames matching `S\d+E\d+` until the server-side gap is filed and fixed.
- **Step 6** of this rewrite (component fallback removal) is **partially
  blocked**: `useMovieGuess.js:216` and the matching branch in
  `useGuessIt.js` stay until then.
- File a server-side ticket to add episode-aware ranking + S/E fields to
  `/subtitles/upload/guess` — see
  `../../../osdb3/docs/plans/2026-05-06-fix-rest-guess-episode-parity.md`
  (to be written).

## Why not just rewrite from scratch

Tempting but risky:

- The 1339 lines have a lot of edge-case handling for orphaned subtitles,
  CD splits, language inference, video-metadata fallbacks, debug-info
  threading, and abort-signal chaining. A green-field rewrite would
  re-discover those edge cases the hard way.
- The `prepare*` methods are the only place that holds the
  business-logic-to-payload mapping. The rest of the file is
  flow-control / debug / progress reporting and works fine.
- Per-step migration (per "Build order" above) keeps the app shippable at
  every commit. A from-scratch rewrite would be a single big-bang.
