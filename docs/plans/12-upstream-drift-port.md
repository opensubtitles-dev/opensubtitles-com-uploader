---
title: "Upstream Drift — porting fixes from OpenSubtitles-Uploader-PRO"
aliases: [upstream-drift, mkv-port, fork-drift]
tags: [uploader, upstream, mkv, port, phase-2]
created: 2026-08-31
updated: 2026-09-01 — four of six findings ported; MKV fast path outstanding
status: mostly-ported
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
| 5 | No MKV fast path (`_tryExtractMkvFast`) | MEDIUM | ⬜ **not ported** — see below |
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

## 5 — MKV fast path: not ported, deliberately

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
