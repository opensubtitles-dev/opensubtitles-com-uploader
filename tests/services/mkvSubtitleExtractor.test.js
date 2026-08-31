import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { humanizeExtractorError } from '../../src/services/mkvSubtitleExtractor.js';

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
