---
title: "Upstream Drift — porting fixes from OpenSubtitles-Uploader-PRO"
aliases: [upstream-drift, mkv-port, fork-drift]
tags: [uploader, upstream, mkv, port, phase-2]
created: 2026-08-31
updated: 2026-10-05 — second pass over v1.8.22–v1.9.0; link remover ported; MKV fast path landed and hardened
status: second pass done — updater pipeline and three smaller ports outstanding
---

# Upstream Drift — porting fixes from the original project

> [!INFO] What this is
> We forked [OpenSubtitles-Uploader-PRO](https://github.com/opensubtitles/OpenSubtitles-Uploader-PRO)
> at **v1.8.9** and rewired it from `.org` XML-RPC to `.com` REST (see [[00-README]]).
> Upstream kept shipping — it is at **v1.8.21**. This document records which of
> those changes apply to us, which were ported, and which were deliberately not.
>
> The raw study output lives in `three-brain-out/2026-08-31-upstream-drift/`,
> which is **gitignored**. This file is the durable record; treat it as the
> source of truth.

## How the study was run

Three independent passes over the upstream diff, then adjudication:

- **Gemini 3** (via `agy`, long-context) — read the full upstream release notes
  and the portable diff in one pass.
- **Codex GPT-5.5** — independent review of the same material.
- **Claude** — verified every candidate by reading this fork's actual source.

The models disagreed sharply. Codex proposed 25 ports; Gemini proposed 12.
Codex's extra items were mostly bound to the `.org` XML-RPC API this fork
deleted — porting them would have reintroduced the dependency the whole 2.0.0
migration removed. **Nothing below was accepted on a model's say-so**; each
finding was confirmed by direct code inspection before it was ported.

## Findings

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| 1 | base64 stack overflow in the upload path | CRITICAL | ✅ ported — `1ab82be` |
| 2 | MKV-extracted subtitles misclassified as orphaned | HIGH | ✅ ported — `6d9957e` |
| 3 | `extraction_failed` set but never surfaced | MEDIUM-HIGH | ✅ ported — `6f4512e` |
| 4 | No `humanizeExtractorError` | MEDIUM | ✅ ported — `6f4512e` |
| 5 | No MKV fast path (`_tryExtractMkvFast`) | MEDIUM | ✅ ported — `cfa592a`, hardened in `b6f2428` (see second pass) |
| 6 | No `trackTitle` propagation for SDH detection | MEDIUM | ✅ ported — `39b3b5b` |

### 1 — base64 stack overflow (`1ab82be`)

The worst of the set, and not MKV-specific. `subtitleHash.js:113,152,196` and
`cache.js:26` all used:

```js
btoa(String.fromCharCode.apply(null, compressed))
```

`apply` spreads every byte as a separate function argument, so the engine's
argument-count limit caps the input. Measured empirically: fine at 64KB, throws
`RangeError` at 128KB. WKWebView — which the macOS Tauri build runs on — throws
at roughly 65k arguments.

This sat in the upload path operating on **zlib-compressed** subtitle bytes, so
a real 1.4MB subtitle (compressing to 113,832 bytes) simply could not be
uploaded — it failed at hash time.

Fixed with a chunked `uint8ArrayToBase64()` in `src/utils/base64Utils.js`
(`CHUNK_SIZE = 0x8000`). Tests pin correctness across the chunk boundary, not
merely that it stops throwing, and one test asserts the naive form still throws
so the reason for the helper stays documented.

### 2 — Extracted subtitles treated as orphaned (`6d9957e`)

`fileProcessing.js` set `file.pairedWithMkv`, and **nothing ever read it**.
Upstream v1.8.19 added `&& !file.pairedWithMkv` to the orphan test; our
`SubtitleUploader.jsx:492` matched upstream's pre-fix line exactly.

Consequence: a subtitle extracted from an MKV lost its association with the
source video, so it lost the episode number too — and uploaded against the
series-level IMDb ID instead of the episode-level one.

Ported as an exported predicate `isOrphanedSubtitle(file, pairedSubtitlePaths)`
in `fileUtils.js` rather than an inline condition, so it is testable.

### 3 & 4 — Silent extraction failures (`6f4512e`)

`extraction_failed` was written at `fileProcessing.js:428` and `:634` with
**zero readers** anywhere in `src/` — MKV extraction failed completely silently.
Added the missing `extraction_failed` branch to `VideoFile.jsx`.

Alongside it, `humanizeExtractorError(error, file)` rewrites the one error users
actually hit on large MKVs:

```
Failed to extract metadata: File could not be read! Code=-1
```

The root cause is the browser's FileReader memory ceiling (~2GB), not our
chunking and not mkvmerge, so the only real workaround is to extract tracks
locally and drop the `.srt` files in — which the humanized message now says.
Everything it does not recognise passes through **verbatim**: dressing up errors
we do not understand would be worse than showing them raw.

### 6 — SDH from the Matroska track title (`39b3b5b`)

Upstream v1.8.15 reads the TrackEntry Name (e.g. `English [SDH]`) to auto-flag
hearing-impaired. We now propagate it as `trackTitle` from
`fileProcessing.js:596` and feed it as a third HI input.

Rather than bolt this onto the existing condition, the rule was extracted as
`indicatesHearingImpaired()` in `fileUtils.js` and `SubtitleUploadOptions.jsx`
now delegates to it — so filenames and track titles are judged by **one** rule
instead of two that drift apart.

> [!WARNING] Two known caveats
> **False positive on `Hi-Res` / `Hi-Fi`.** The `hi[_-]` pattern matches the
> `Hi-` prefix. Both are audio descriptors, so they are vanishingly rare as
> subtitle track titles, and maintaining a second divergent HI rule would be
> worse than the edge case. Pinned in a test as a known limitation.
>
> **The component wiring is not test-covered.** Sabotage-verified: deleting the
> three lines that feed `trackTitle` into detection leaves all 55 tests passing.
> The predicate is covered; the component path is not, because there is no React
> test harness. Needs a real MKV with an SDH-titled track.
>
> Verified-good cases: correctly flags `English [SDH]`, `HI`, `Chinese (Hi)`;
> correctly ignores `Hindi`, `Thai`, `Swahili`, `Cantonese (HK)`, `English (CC)`.

## 5 — MKV fast path: not ported, deliberately *(superseded 2026-10-02)*

> [!NOTE] Superseded
> The fast path was ported in `cfa592a` (extractor 1.9.0) and hardened on
> 2026-10-05 in `b6f2428`. The reasoning below is kept as the record of why it
> waited; the corpus it asks for is still only partly covered — see
> § Second pass → MKV fast path.

Upstream v1.8.14 added `_tryExtractMkvFast` plus a `BROWSER_FILEREADER_SOFT_LIMIT`
— a pure-JS EBML reader that bypasses ffmpeg-WASM for Matroska containers. It is
a real win (performance, and it avoids the WASM memory ceiling), and it is the
largest change of the six.

**It was left out on purpose.** A mis-parsing EBML reader does not fail loudly —
it yields *wrong subtitle content*, which would then be uploaded. Unit tests over
synthetic buffers cannot establish that it parses real-world Matroska correctly.

**To pick this up:** port it behind the existing slow path as a fast attempt that
falls back on any parse anomaly, and validate against a real corpus — at minimum
a multi-track MKV, one with an SDH track, one >2GB, and one with a non-SRT codec
(PGS/ASS). Do not land it as the only path.

## Deliberately not applicable

These were proposed (mostly by Codex) and rejected — all bind to the `.org`
XML-RPC API this fork deleted:

- Duplicate-on-OS count badges and `[OS]` links
- `suggest_imdb` fallback
- XML-RPC language-code families
- `UserRanks`/`UserRank` merge

## Already solved differently here

Upstream's "TV series episode IMDb resolution utility" centralises logic this
fork already centralises in `src/utils/uploadTarget.js` (`buildUploadTarget`,
`feature_id > imdb > tmdb` precedence, season/episode coords). No port needed —
our version is REST-shaped and covered by 24 tests.

## Release impact

All four ports landed **after** the `v2.0.0` tag. The v2.0.0 binaries still
carry the base64 bug, the orphan misclassification, and the silent extraction
failures. A **v2.0.1** is warranted — see [[00-README]] § Current state.

---

# Second pass — upstream v1.8.22 → v1.9.0 (2026-10-05)

Upstream shipped six releases after the first study. This pass was a single
reviewer reading the diffs and commit messages directly (`git log
v1.8.21..upstream/main`), then checking each candidate against this fork's
source and, where it mattered, against what this fork has actually published.

| Upstream | Change | Verdict here |
|---|---|---|
| **1.9.0** | Remove links from subtitles (opt-in, preview first) | ✅ **ported** — see below |
| 1.8.26 | API error banner no longer covers the header (`38f1392`) | ⬜ applies — ours is still `fixed top-0` at `ApiHealthCheck.jsx:396` |
| 1.8.26 / 1.8.25 | AppImage only started for the user who built it; AppStream metadata | ❓ unverified — upstream confirmed it against Tauri CLI 2.11.5; we ship an AppImage on 2.6 and have not checked ours. Metadata only matters for the AppImage catalog |
| 1.8.24 | macOS auto-update fix; refuse to publish a broken manifest (`31ecc9a`) | 🔴 **applies, and it is worse here** — see below |
| 1.8.23 | Tauri 2.7 → 2.11.6 and every plugin | ⬜ applies — we are on 2.6. Own change, built on all three platforms |
| 1.8.22 | Hourly session keep-alive | ❌ not applicable — built on the `.org` PHPSESSID. Our JWT lives 24 h with no refresh (D2) |
| 1.8.22 | Auth robustness, ESLint 2022, masked token logging | ✅ already here — `1e0f3fa`, `4687c6d`, `982865d` |
| — | Signed updater artifacts (`73953db`) | 🔴 not ported — same item as the 1.8.24 row |
| — | Privacy policy, footer link, MIT licence | ⬜ maintainer's call |

## The updater pipeline is broken in this fork

Found while checking whether upstream's macOS fix applied. The `latest.json`
this fork published for v2.0.0 has an **empty signature for all five platforms**,
and the three macOS entries point at the `.dmg`:

```
windows-x86_64   | sig_len 0 | …_2.0.0_x64-setup.exe
darwin-universal | sig_len 0 | …_2.0.0_universal.dmg
darwin-x86_64    | sig_len 0 | …_2.0.0_universal.dmg
darwin-aarch64   | sig_len 0 | …_2.0.0_universal.dmg
linux-x86_64     | sig_len 0 | …_2.0.0_amd64.AppImage
```

`tauri.conf.json` sets an updater `pubkey`, so the native updater must verify a
signature and cannot; and it cannot install a `.dmg` in any case. Upstream had
the identical defect on macOS only and fixed it in `73953db` + `31ecc9a`. Our
workflow still has the pre-fix shape:

- `build-desktop-apps.yml` hardcodes `"signature": ""` in the manifest step;
- it passes `TAURI_PRIVATE_KEY` (the Tauri v1 name; v2 reads
  `TAURI_SIGNING_PRIVATE_KEY`);
- macOS builds with `--bundles dmg`, which never emits `.app.tar.gz` + `.sig`;
- `createUpdaterArtifacts` is not set.

**Not tested end to end.** `updateService.js` has its own download fallback, so
what a v2.0.0 user actually experiences is unknown. Treat as "very likely
broken"; fix before the next release, and port upstream's guard that fails the
build when a signature is empty.

## Link remover — ported

Seven files copied **verbatim** from upstream v1.9.0, so a future diff against
upstream stays clean: `subtitleSanitizer.js`, `data/tlds.js`,
`utils/subtitleBytes.js`, `hooks/useLinkSanitizer.js`,
`LinkSanitizePreview.jsx`, the 99-test file, and `scripts/generate-tlds.js`
(`npm run generate-tlds`). Upstream's unrelated prettier churn in
`SubtitleUploader.jsx` / `ConfigOverlay.jsx` was left out.

What it does: on drop, scans subtitle dialogue for URLs, emails, IPv4
addresses, obfuscated links (`example (dot) com`, `hxxp://`) and `@handles`,
and opens a preview with a checkbox per match. Nothing changes without
confirmation. Cues left holding only a link are dropped and SRT indexes
renumbered; edits run over a byte-preserving latin1 view so non-UTF-8 files
keep their encoding.

**One deliberate difference from upstream — the default is changeable.**
Upstream hard-codes `stripUrls: false`. This app saves its whole config on
first launch, so that `false` would be frozen into every user's storage and a
later default flip would only reach fresh installs. Here the stored value has
three states — `true` / `false` once the user has moved the switch, `null`
while they never have — and `null` follows one constant:

```js
// src/utils/constants.js
export const STRIP_URLS_DEFAULT = false;
```

It ships `false`, matching upstream. To make link removal default-on, change
that one line; everyone who has not explicitly chosen follows it.

Verified in WebKit against the dev server with a cp1250 `.srt`: dialog opened,
four links removed (URL, obfuscated, email, handle), the three false-positive
traps left alone (`Stop.It's over`, `I know.Now go`, `example.commute`), cp1250
bytes and CRLF endings intact. Fresh install → off, stored `null`; explicit
on/off respected. **Not verified:** an actual upload of a cleaned file.

> [!WARNING] Known limits
> **It removes the link, not the sentence.** `Downloaded from www.example.com`
> becomes `Downloaded from`. Upstream calls this "Layer 1, generic patterns
> only" and says the private pattern list stays server-side. That is the gap
> the osdb3 work can close — see below.
>
> **The duplicate check sees the original file.** The early `/upload/check`
> hashes the subtitle as dropped, so after cleaning, the "already in database"
> verdict refers to the uncleaned bytes. The upload itself re-reads and
> re-hashes, so hash and content stay consistent. Upstream has the same order.

## Where this meets osdb3

osdb3 rejects ad-carrying uploads server-side (`SpamPattern`, kinds
`filename | content | comment`, severities `reject | flag | log`, with allow
patterns overriding deny). Three gaps keep the client and server halves apart:

1. **`/subtitles/upload/check` does not scan content** — only filename
   patterns. Content patterns run at upload time, so the user learns of a
   rejection after doing all the work.
2. **`SpamPattern#matches?` returns a boolean**, so the server cannot say
   *where* the match is.
3. **The uploader's message is wrong.** `errorCopy.js` renders `spam_content`
   as "Subtitle too small" (written for the old size check) and never shows the
   `rule_id` / literal `rule` osdb3 has returned since `8b9be412`.

Proposed order: fix the message (3); run the content scan in `/upload/check`
and return spans for literal patterns (1 + 2); feed those spans into the same
preview dialog so the offer becomes "remove these and upload" rather than a
refusal. Regex rules stay hidden, as now.

## MKV fast path — landed, then hardened

Ported in `cfa592a`. Four defects in the wrapper were fixed in `b6f2428`:

- **Overlapping runs clobbered each other.** The fast path captures its ZIP by
  replacing `URL.createObjectURL` and `document.createElement`, both
  process-wide. Runs now take turns through a module-level queue.
- **A clean "nothing to extract" fell through to ffmpeg** — a 180 s timeout,
  then the whole file read into memory. It now returns `conclusive: true`.
- **Unbuffered reads.** Two reads per cluster, thousands per film, each a
  round trip on a network share. `utils/readAheadFile.js` serves them from an
  8 MB window (27 real reads instead of 1,302 on a 203 MB episode) and fails a
  read that stalls for 30 s with its offset.
- **Leftovers:** `document.createElement` restored to a bound copy; the 180 s
  fallback timer never cancelled.

Corpus actually exercised: single-track SRT MKVs of 203 MB and 1.2 GB, in Node,
Playwright WebKit and the system WKWebView (file picker and simulated native
drop). **Still not exercised:** multi-track, an SDH-titled track, >2 GB, and
ASS/PGS codecs — the list § 5 asked for.

> [!WARNING] Open: a stall the maintainer saw that was never reproduced
> In the Tauri dev app, a 1.2 GB local MKV sat on "Detecting MKV streams". The
> same file extracts in ~1.2 s in a *visible* system WKWebView. Two leads:
> a hidden or covered window makes WebKit throttle the page until the same
> extraction crawls (reproduced), and Web Inspector was open in every failing
> run (untested). The stall watchdog and the `[mkvfast]` progress lines were
> added so the next occurrence says where it stopped.
>
> Also seen and not investigated: the file-picker route runs extraction twice
> for one file — possibly only a dev-mode double render.
