import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {
  humanizeExtractorError,
  MkvSubtitleExtractor,
} from '../../src/services/mkvSubtitleExtractor.js';

/**
 * The extractor surfaces raw errors from the underlying WASM/FileReader stack.
 * The one users actually hit on large MKVs is
 *
 *   "Failed to extract metadata: File could not be read! Code=-1"
 *
 * which says nothing actionable. The root cause is the browser's FileReader
 * memory ceiling (~2 GB), not the extractor's chunking and not mkvmerge — so
 * the only real workaround is to extract the tracks locally and drop the .srt
 * files in. Everything else must pass through unchanged: dressing up errors we
 * do not understand would be worse than showing them verbatim.
 */

const bigFile = { size: 8.5 * 1024 * 1024 * 1024 }; // 8.5 GB

describe('humanizeExtractorError', () => {
  test('rewrites the FileReader memory failure into something actionable', () => {
    const out = humanizeExtractorError(
      new Error('Failed to extract metadata: File could not be read! Code=-1'),
      bigFile
    );
    assert.match(out, /8\.50 GB/);
    assert.match(out, /FileReader/);
    assert.match(out, /mkvextract|ffmpeg/);
    assert.doesNotMatch(out, /Code=-1/);
  });

  test('matches the bare "file could not be read ... code=-1" shape too', () => {
    const out = humanizeExtractorError(new Error('File could not be read! Code=-1'), bigFile);
    assert.match(out, /FileReader/);
  });

  test('is case-insensitive about the underlying message', () => {
    const out = humanizeExtractorError(new Error('FILE COULD NOT BE READ! CODE=-1'), bigFile);
    assert.match(out, /FileReader/);
  });

  test('passes unrelated errors through untouched', () => {
    const msg = 'Unsupported codec: DVDSUB in stream 3';
    assert.equal(humanizeExtractorError(new Error(msg), bigFile), msg);
  });

  test('does not claim a memory problem for a generic failure', () => {
    const out = humanizeExtractorError(new Error('network timeout'), bigFile);
    assert.doesNotMatch(out, /FileReader/);
  });

  test('reports an unknown size rather than NaN when the file has none', () => {
    const out = humanizeExtractorError(new Error('File could not be read! Code=-1'), undefined);
    assert.match(out, /\? GB/);
    assert.doesNotMatch(out, /NaN/);
  });

  test('survives a null or non-Error argument', () => {
    assert.equal(humanizeExtractorError(null, bigFile), 'unknown error');
    assert.equal(humanizeExtractorError('plain string failure', bigFile), 'plain string failure');
  });
});

/**
 * The pure-JS MKV fast path cannot hand its output back directly: upstream
 * builds a ZIP and triggers a browser download. The service captures that ZIP
 * by temporarily replacing URL.createObjectURL and document.createElement —
 * both process-wide. These tests pin down the two ways that went wrong.
 */
describe('MKV fast path', () => {
  const saved = {};
  let anchorClicks;

  beforeEach(() => {
    for (const k of ['window', 'document', 'FileReader']) saved[k] = globalThis[k];
    saved.createObjectURL = URL.createObjectURL;
    anchorClicks = 0;
    globalThis.window = {};
    globalThis.document = {
      createElement: () => ({
        click() {
          anchorClicks += 1;
        },
      }),
    };
    // JSZip reads Blobs through FileReader, which Node does not have.
    globalThis.FileReader = class {
      readAsArrayBuffer(blob) {
        blob.arrayBuffer().then(
          result => this.onload({ target: { result } }),
          error => this.onerror({ target: { error } })
        );
      }
    };
  });

  afterEach(() => {
    for (const k of ['window', 'document', 'FileReader']) {
      if (saved[k] === undefined) delete globalThis[k];
      else globalThis[k] = saved[k];
    }
    URL.createObjectURL = saved.createObjectURL;
  });

  // Stands in for the package's extractMkvSubtitlesFast: works for `ms`, then
  // zips one subtitle named after the file and "downloads" it.
  const fakeExtractFast = ms => async file => {
    await new Promise(r => setTimeout(r, ms[file.name]));
    const filename = `${file.name}.eng.srt`;
    const zip = new JSZip();
    zip.file(filename, `subtitle of ${file.name}`);
    const blob = await zip.generateAsync({ type: 'blob' });
    URL.createObjectURL(blob);
    document.createElement('a').click();
    return {
      extractedCount: 1,
      totalSubtitleStreams: 1,
      failedCount: 0,
      errors: [],
      extracted: [{ filename, language: 'eng', streamIndex: 2 }],
    };
  };

  const textOf = result => new TextDecoder().decode(result.extractedFiles[0].data);

  test('overlapping extractions each get their own subtitles', async () => {
    const extractor = new MkvSubtitleExtractor({
      isMatroska: async () => true,
      // The first file takes longer, so the second finishes while the first
      // is still running — a second drop before the first is done.
      extractFast: fakeExtractFast({ 'slow.mkv': 40, 'quick.mkv': 5 }),
    });

    const [slow, quick] = await Promise.all([
      extractor.extractAllSubtitles({ name: 'slow.mkv' }),
      extractor.extractAllSubtitles({ name: 'quick.mkv' }),
    ]);

    assert.equal(textOf(slow), 'subtitle of slow.mkv');
    assert.equal(textOf(quick), 'subtitle of quick.mkv');
    assert.equal(anchorClicks, 0, 'no ZIP download may reach the browser');
  });

  test('leaves the patched browser globals as it found them', async () => {
    const createElement = document.createElement;
    const createObjectURL = URL.createObjectURL;
    const extractor = new MkvSubtitleExtractor({
      isMatroska: async () => true,
      extractFast: fakeExtractFast({ 'a.mkv': 20, 'b.mkv': 1 }),
    });

    await Promise.all([
      extractor.extractAllSubtitles({ name: 'a.mkv' }),
      extractor.extractAllSubtitles({ name: 'b.mkv' }),
    ]);

    assert.equal(URL.createObjectURL, createObjectURL);
    assert.equal(document.createElement, createElement);
    document.createElement('a').click();
    assert.equal(anchorClicks, 1, 'anchors created afterwards must click normally');
  });

  test('a Matroska file with no text subtitles does not fall through to ffmpeg', async () => {
    let ffmpegCalls = 0;
    const extractor = new MkvSubtitleExtractor({
      isMatroska: async () => true,
      extractFast: async () => ({
        extractedCount: 0,
        totalSubtitleStreams: 0,
        failedCount: 0,
        errors: [],
        extracted: [],
      }),
      extractAllFromPackage: async () => {
        ffmpegCalls += 1;
        return { extractedFiles: [] };
      },
    });

    const result = await extractor.extractAllSubtitles({ name: 'nosubs.mkv' });

    assert.deepEqual(result.extractedFiles, []);
    assert.equal(ffmpegCalls, 0);
  });

  test('a fast path that fails still falls back to ffmpeg', async () => {
    let ffmpegCalls = 0;
    const extractor = new MkvSubtitleExtractor({
      isMatroska: async () => true,
      extractFast: async () => {
        throw new Error('first Cluster element not found');
      },
      extractAllFromPackage: async () => {
        ffmpegCalls += 1;
        return { extractedFiles: [{ filename: 'x.srt' }] };
      },
    });

    const result = await extractor.extractAllSubtitles({ name: 'odd.mkv' });

    assert.equal(ffmpegCalls, 1);
    assert.equal(result.extractedFiles.length, 1);
  });
});
