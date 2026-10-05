import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createReadAheadFile } from '../../src/utils/readAheadFile.js';

/**
 * A fake File over known bytes that counts how often it is really read —
 * the number that matters when every read is a network round trip.
 */
const fakeFile = length => {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) bytes[i] = i % 251;
  const file = {
    name: 'film.mkv',
    size: length,
    reads: 0,
    slice(start, end) {
      return {
        arrayBuffer: async () => {
          file.reads += 1;
          return bytes.slice(start, end).buffer;
        },
      };
    },
  };
  return { file, bytes };
};

const readBytes = async (f, start, end) => new Uint8Array(await f.slice(start, end).arrayBuffer());

describe('createReadAheadFile', () => {
  test('many small sequential reads cost one real read per window', async () => {
    const { file, bytes } = fakeFile(10_000);
    const buffered = createReadAheadFile(file, 1_000);

    for (let offset = 0; offset < 10_000; offset += 50) {
      const got = await readBytes(buffered, offset, offset + 50);
      assert.deepEqual(got, bytes.slice(offset, offset + 50));
    }

    assert.equal(file.reads, 10, '200 reads of 50 bytes over ten 1000-byte windows');
  });

  test('a read that straddles the end of the window still returns the right bytes', async () => {
    const { file, bytes } = fakeFile(5_000);
    const buffered = createReadAheadFile(file, 1_000);

    await readBytes(buffered, 0, 10);
    const got = await readBytes(buffered, 990, 1_010);

    assert.deepEqual(got, bytes.slice(990, 1_010));
  });

  test('a read larger than the window goes straight to the file', async () => {
    const { file, bytes } = fakeFile(5_000);
    const buffered = createReadAheadFile(file, 1_000);

    const got = await readBytes(buffered, 100, 3_100);

    assert.deepEqual(got, bytes.slice(100, 3_100));
    assert.equal(file.reads, 1);
  });

  test('reads are clamped to the file, and an empty range reads nothing', async () => {
    const { file, bytes } = fakeFile(500);
    const buffered = createReadAheadFile(file, 1_000);

    assert.deepEqual(await readBytes(buffered, 400, 9_999), bytes.slice(400, 500));
    assert.equal((await readBytes(buffered, 500, 600)).length, 0);
    assert.equal((await readBytes(buffered, 300, 300)).length, 0);
    assert.equal(file.reads, 1);
  });

  test('jumping backwards re-reads rather than returning stale bytes', async () => {
    const { file, bytes } = fakeFile(5_000);
    const buffered = createReadAheadFile(file, 1_000);

    await readBytes(buffered, 3_000, 3_010);
    const got = await readBytes(buffered, 20, 40);

    assert.deepEqual(got, bytes.slice(20, 40));
  });

  test('a read that never completes fails with its position instead of hanging', async () => {
    const stuck = {
      name: 'stuck.mkv',
      size: 5_000,
      slice: () => ({ arrayBuffer: () => new Promise(() => {}) }),
    };
    const buffered = createReadAheadFile(stuck, 1_000, 20);

    await assert.rejects(
      buffered.slice(2_000, 2_010).arrayBuffer(),
      /file read stalled: 1000 bytes at offset 2000 of 5000/
    );
  });

  test('counts real reads and bytes', async () => {
    const { file } = fakeFile(3_000);
    const buffered = createReadAheadFile(file, 1_000);

    await readBytes(buffered, 0, 10);
    await readBytes(buffered, 10, 20);
    await readBytes(buffered, 1_500, 1_510);

    assert.equal(buffered.stats.reads, 2);
    assert.equal(buffered.stats.bytes, 2_000);
  });

  test('carries the name and size the extractor reads', () => {
    const { file } = fakeFile(1_234);
    const buffered = createReadAheadFile(file);

    assert.equal(buffered.name, 'film.mkv');
    assert.equal(buffered.size, 1_234);
  });
});
