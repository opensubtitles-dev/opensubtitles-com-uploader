---
title: "05 — Upload Flow (check → commit → history)"
aliases: [upload-flow, upload-pipeline, check-commit]
tags: [uploader/upload, phase-2]
created: 2026-04-15
status: locked
---

# 05 — Upload Flow

> [!INFO] Purpose
> End-to-end client pipeline: from user dropping a file to subtitle landing in the backend + visible in "Upload history". Every step + the data shape passed between steps.

## 1. High-level pipeline

```
┌──────────────────────────────────────────────────────────────┐
│ 1. DROP / PICK FILE                                          │
│    hook: useFileHandling                                     │
│    produces: File[] (subtitle + optional video)              │
└──────────────────┬───────────────────────────────────────────┘
                   │
┌──────────────────▼───────────────────────────────────────────┐
│ 2. CLIENT-SIDE ANALYSIS (all parallel, no network)           │
│    - subhash = md5(raw subtitle bytes)          subtitleHash │
│    - subcontent = base64(gzip(raw bytes))       pako + buffer│
│    - video moviehash + bytesize                 movieHash    │
│    - video FPS / duration / framecount / bitrate/codec       │
│                                                 videoMetadataService │
│    - guessit on filename                        guessItService│
└──────────────────┬───────────────────────────────────────────┘
                   │
┌──────────────────▼───────────────────────────────────────────┐
│ 3. FEATURE RESOLUTION (network)                              │
│    hook: useMovieGuess → uploadApi.guess(filename, moviehash) │
│    returns: { best_guess, candidates }                       │
│                                                              │
│    UI shows: "We think this is Dune (2021)" + candidates     │
│    User confirms or picks different                          │
│    OR clicks "Movie not in database" → stub feature flow     │
└──────────────────┬───────────────────────────────────────────┘
                   │
┌──────────────────▼───────────────────────────────────────────┐
│ 4. PRE-UPLOAD CHECK (network)                                │
│    hook: useUploadCheck → uploadApi.check(payload)           │
│    returns: { already_in_db, duplicate_of, would_be_rejected,│
│               rejection_reasons, flags_suggested, quota }    │
│                                                              │
│    Branches:                                                 │
│    - already_in_db=true → "already there" CTA, skip upload   │
│    - would_be_rejected → show reasons, let user fix          │
│    - clean → apply flags_suggested, show "Upload" button     │
└──────────────────┬───────────────────────────────────────────┘
                   │
┌──────────────────▼───────────────────────────────────────────┐
│ 5. COMMIT (network)                                          │
│    uploadApi.commit(payload)                                 │
│    returns: { subtitle_id, subfile_id, download_url,         │
│               status, flags_applied, warnings, quota }       │
│                                                              │
│    UI: success toast + link to download_url                  │
│    UI: "View in history" link                                │
└──────────────────┬───────────────────────────────────────────┘
                   │
┌──────────────────▼───────────────────────────────────────────┐
│ 6. UPLOAD HISTORY (separate route)                           │
│    GET /my/uploads — list, edit, delete                      │
│    see [[06-my-uploads-integration]]                         │
└──────────────────────────────────────────────────────────────┘
```

## 2. Payload shape — single source of truth

The upload payload is assembled once (step 2 above) and mutated minimally through steps 3-5. Canonical TypeScript shape (informal — we're in JS):

```ts
type UploadPayload = {
  // computed client-side (step 2)
  subhash:       string;       // MD5 hex of raw subtitle bytes
  subfilename:   string;       // original filename
  subcontent:    string;       // base64(gzip(raw bytes))  — only for commit, not check
  sublanguageid: string;       // ISO-639-3 code (e.g. "eng")

  // video metadata (step 2, if video is present)
  moviehash:     string | null;
  moviebytesize: number | null;
  moviefilename: string | null;
  moviefps:      number | null;
  movieframes:   number | null;
  movietimems:   number | null;
  video_metadata: { bitrate?: number; codec?: string } | null;

  // feature (step 3)
  idmovieimdb?:  string;
  tmdbid?:       string;
  feature_id?:   number;       // preferred over imdb/tmdb when provisional

  // user-editable (step 4-5 form)
  release_name:        string;
  movie_aka:           string;
  translator:          string;
  author_comments:     string;
  hearing_impaired:    boolean;
  high_definition:     boolean;
  foreign_parts_only:  boolean;
  machine_translated:  boolean;

  // optional passthrough
  guessit?: object;            // client GuessIt payload
};
```

### 2.1 `/check` and `/commit` differ in one field

- `/check` — no `subcontent` (content isn't uploaded for dry-runs; server verifies by subhash only)
- `/commit` — includes `subcontent` (server recomputes MD5 to verify integrity)

This lets the UI call `/check` cheaply while the user's still picking metadata. `/commit` happens once.

## 3. Service redesign — `subtitleUploadService.js`

### 3.1 Current shape (50 KB)
- Massive orchestration — assembles XML-RPC payload, calls `tryUploadSubtitles` then `uploadSubtitles`, parses responses
- Payload construction lives mixed with XML-construction logic

### 3.2 Target shape (~15 KB expected)

Three clean phases, each pure:

```js
// src/services/subtitleUploadService.js
import { uploadApi } from './api/upload.js';
import { computeSubHash, gzipBase64 } from './subtitleHash.js';
import { computeMovieHash, probeVideo } from './movieHash.js';
import { runGuessIt } from './guessItService.js';

export class SubtitleUploadService {
  // PHASE 2 — analyze local files, produce partial payload
  static async analyze({ subtitleFile, videoFile }) {
    const rawBytes = await subtitleFile.arrayBuffer();
    const [subhash, subcontent, videoMeta, guessit] = await Promise.all([
      computeSubHash(rawBytes),
      gzipBase64(rawBytes),
      videoFile ? probeVideo(videoFile) : null,
      runGuessIt(subtitleFile.name),
    ]);
    return {
      subhash,
      subcontent,
      subfilename: subtitleFile.name,
      moviehash:     videoMeta?.moviehash ?? null,
      moviebytesize: videoMeta?.bytesize ?? null,
      moviefilename: videoFile?.name ?? null,
      moviefps:      videoMeta?.fps ?? null,
      movieframes:   videoMeta?.frames ?? null,
      movietimems:   videoMeta?.durationMs ?? null,
      video_metadata: videoMeta ? { bitrate: videoMeta.bitrate, codec: videoMeta.codec } : null,
      guessit,
      // user-editable fields start empty, populated from guessit/feature resolution
      release_name: guessit?.release_name ?? '',
      movie_aka: '',
      translator: '',
      author_comments: '',
      hearing_impaired: false,
      high_definition: false,
      foreign_parts_only: false,
      machine_translated: false,
    };
  }

  // PHASE 3 — resolve feature from payload + user pick
  static async resolveFeature({ filename, moviehash }) {
    return uploadApi.guess(filename, moviehash);
  }

  // PHASE 4 — pre-check (stripped to subhash, no subcontent)
  static async check(payload, { anonymous = false } = {}) {
    const { subcontent, ...checkPayload } = payload;
    return uploadApi.check(checkPayload, { anonymous });
  }

  // PHASE 5 — commit
  static async commit(payload, { anonymous = false } = {}) {
    return uploadApi.commit(payload, { anonymous });
  }
}
```

### 3.3 Anonymous flag passthrough

`anonymous: true` maps to `{ authenticated: false }` on the REST client → no `Authorization` header. The server's `BaseController` handles anon as `uploader_id: nil`.

### 3.4 Multi-CD — Phase 2 scope decision

Legacy uploader packaged cd1+cd2+cd3 in one XML-RPC call. REST API is one-subtitle-per-request.

**Phase 2 shipping plan:** multi-CD subtitles are uploaded one at a time. If the user drops `Movie.CD1.srt` and `Movie.CD2.srt` together:
1. Analyze both
2. Resolve feature once (shared)
3. Check both (independent dedup)
4. Commit sequentially
5. On 2nd+ upload, include `parent_subtitle_id` pointing at 1st's returned `subtitle_id`

Server-side the `parent_subtitle_id` column already exists on `Subtitle` (per Rails audit). **Add to upload payload schema if not already there.**

> [!TODO] Rails backend — parent_subtitle_id passthrough
> Verify that the Rails `UploadController#persist_upload!` writes `parent_subtitle_id` from params. If not, a small backend change is needed before multi-CD works.

## 4. Hook redesign — `useUpload.js` (new consolidated hook)

Replaces pieces of `useMovieGuess`, `useCheckSubHash`, and ad-hoc upload state in `SubtitleUploader.jsx`.

State machine:
```
idle → analyzing → needs_feature → checking → ready → committing → done
                                       ↓           ↓         ↓
                                     error       error     error
```

```js
export function useUpload({ subtitleFile, videoFile, anonymous }) {
  const [phase, setPhase] = useState('idle');
  const [payload, setPayload] = useState(null);
  const [feature, setFeature] = useState(null);
  const [checkResult, setCheckResult] = useState(null);
  const [commitResult, setCommitResult] = useState(null);
  const [error, setError] = useState(null);

  const analyze = useCallback(async () => {
    setPhase('analyzing');
    try {
      const p = await SubtitleUploadService.analyze({ subtitleFile, videoFile });
      setPayload(p); setPhase('needs_feature');
    } catch (e) { setError(e); setPhase('error'); }
  }, [subtitleFile, videoFile]);

  const resolveFeature = useCallback(async () => {
    const guessResult = await SubtitleUploadService.resolveFeature({
      filename: payload.subfilename, moviehash: payload.moviehash,
    });
    setFeature(guessResult);
    return guessResult;
  }, [payload]);

  const setPickedFeature = useCallback((f) => {
    setPayload(p => ({ ...p, idmovieimdb: f.imdbid, tmdbid: f.tmdbid, feature_id: f.feature_id }));
  }, []);

  const check = useCallback(async () => {
    setPhase('checking');
    try {
      const r = await SubtitleUploadService.check(payload, { anonymous });
      setCheckResult(r);
      // auto-apply suggested flags
      setPayload(p => ({ ...p, ...r.flags_suggested }));
      setPhase('ready');
    } catch (e) { setError(e); setPhase('error'); }
  }, [payload, anonymous]);

  const commit = useCallback(async () => {
    setPhase('committing');
    try {
      const r = await SubtitleUploadService.commit(payload, { anonymous });
      setCommitResult(r);
      setPhase('done');
    } catch (e) { setError(e); setPhase('error'); }
  }, [payload, anonymous]);

  return { phase, payload, feature, checkResult, commitResult, error,
           analyze, resolveFeature, setPickedFeature, updatePayload: setPayload, check, commit };
}
```

## 5. Error handling per phase

| Phase | Error | UI response |
|---|---|---|
| Analyze | File read fail | "Cannot read subtitle file — try again" |
| Analyze | Gzip fail | Unlikely; log + "Unexpected error preparing subtitle" |
| Analyze | Video probe fail | Continue without moviehash (not fatal) |
| Resolve feature | Network error | Retry button; fall back to manual search |
| Resolve feature | Empty candidates | Show "Create new entry" CTA (stub feature) |
| Check | `duplicate` (409) | "Already in database — view it here" link |
| Check | `quota_exceeded` (429) | Show quota UI + upgrade/login CTA |
| Check | `anon_duplicate_language` (403) | "Anonymous uploads can't duplicate — log in or choose different language" |
| Check | `invalid_language` (400) | Highlight language dropdown |
| Commit | `subhash_mismatch` (422) | "File changed during upload — restart" |
| Commit | `invalid_content` (400) | "Subtitle content is corrupt" |
| Commit | `spam_content` (403) | "File too small / looks spammy — try again or contact support" |
| Commit | network error mid-flight | Retry once automatically; after that show manual retry |

Error codes listed canonically in [[07-error-mapping]].

## 6. UI sequencing

Maintain a single `UploadStepper` component with these phases visible:

1. **Pick files** — drag/drop, shown until `analyze` runs
2. **Analyzing** — spinner + "Computing subtitle hash, probing video..."
3. **Feature confirmation** — movie card + "Is this right? [Confirm] [Pick different]"
4. **Metadata** — form for release_name, comments, flags (pre-filled from guessit + `flags_suggested`)
5. **Review** — summary panel, quota display ("You have 49 uploads remaining today")
6. **Uploading** — progress (server-side is atomic; show "Uploading... this takes a few seconds")
7. **Done** — success card with `download_url` + "View in history" link + "Upload another"

## 7. Non-goals for Phase 2

- Subtitle content preview / diff against existing version (Phase 5 item)
- Bulk parallel upload (Phase 5 item — safer to ship sequential first)
- Replace-file flow (`POST /my/uploads/:id/replace`) — not exposed server-side yet (Phase 1 remaining todo in Rails plan). When it ships, we add it to `myUploadsApi` + extend `UploadHistory` edit UI.

## 8. Checklist

- [ ] Analyze phase: `SubtitleUploadService.analyze()` + `useUpload` wiring
- [ ] Guess phase: `uploadApi.guess()` + existing `useMovieGuess` adapter
- [ ] Feature selection UI: reuse `MovieSearchOverlay`, add "Create stub" CTA
- [ ] Check phase: `uploadApi.check()` + `useUpload.check()`
- [ ] Form: release_name / flags / comments — reuse current form components
- [ ] Review panel with quota display
- [ ] Commit phase: `uploadApi.commit()` + `useUpload.commit()`
- [ ] Success card with download link + history link
- [ ] Error boundary per phase (see [[#5 Error handling per phase]])
- [ ] Multi-CD: sequential upload with `parent_subtitle_id`
- [ ] Anonymous mode toggle in ConfigOverlay — plumbed into `useUpload({ anonymous })`

## 9. Staging smoke script (manual)

```
1. Start app: npm run tauri:dev
2. Header switch → select Production, log in with a test account
3. Drop any .srt + .mkv pair
4. Confirm:
   - Analyze completes (spinner → feature card)
   - Guess returns correct movie
   - Check returns quota info, no duplicates
   - Commit returns subtitle_id + download_url
   - History tab shows the new upload at top
5. Edit release_name on the history entry → PATCH works
6. Delete → entry disappears (soft-deleted on server)
7. Refresh app → still gone from history
```

Golden-replay automation in [[08-testing-strategy#Golden replay]].
