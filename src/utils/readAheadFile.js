/**
 * Read-ahead wrapper for a File.
 *
 * The pure-JS Matroska extractor walks a file cluster by cluster and issues
 * two reads for each one — a 16-byte header, then the body. A two-hour film
 * has several thousand clusters, so that is several thousand
 * `file.slice().arrayBuffer()` calls. On a local disk each costs a few
 * milliseconds. On a network share each is a round trip, and the walk slows to
 * a few clusters per second: a 1.2 GB film on a NAS sat on "Detecting MKV
 * streams" for many minutes with nothing visibly wrong.
 *
 * This serves those small sequential reads out of one large window, so the
 * same walk costs one real read per `windowBytes` instead of two per cluster.
 *
 * Only what the extractor uses is implemented: `name`, `size`, and
 * `slice(start, end).arrayBuffer()`. It is not a general File replacement.
 */

export const READ_AHEAD_BYTES = 8 * 1024 * 1024;

// A read that has not come back after this long is not slow, it is stuck.
// Failing it turns an endless "Detecting…" into an error that says where.
export const READ_TIMEOUT_MS = 30_000;

const EMPTY = new ArrayBuffer(0);

/**
 * @param {File|Blob} file
 * @param {number} [windowBytes]
 * @param {number} [readTimeoutMs]
 * @returns {{name: string, size: number, type: string, slice: Function, stats: object}}
 */
export function createReadAheadFile(
  file,
  windowBytes = READ_AHEAD_BYTES,
  readTimeoutMs = READ_TIMEOUT_MS
) {
  const size = file.size;
  let windowStart = 0;
  let windowData = null; // Uint8Array, or null before the first read
  const stats = { reads: 0, bytes: 0, slowestMs: 0 };

  // One real read of the underlying file, timed and bounded.
  const readReal = async (from, to) => {
    const startedAt = Date.now();
    let timeoutId;
    try {
      const buffer = await Promise.race([
        file.slice(from, to).arrayBuffer(),
        new Promise((_, reject) => {
          timeoutId = setTimeout(
            () =>
              reject(
                new Error(
                  `file read stalled: ${to - from} bytes at offset ${from} of ${size} ` +
                    `did not complete within ${Math.round(readTimeoutMs / 1000)} s`
                )
              ),
            readTimeoutMs
          );
        }),
      ]);
      stats.reads += 1;
      stats.bytes += buffer.byteLength;
      stats.slowestMs = Math.max(stats.slowestMs, Date.now() - startedAt);
      return buffer;
    } finally {
      clearTimeout(timeoutId);
    }
  };

  const read = async (start, end) => {
    const from = Math.max(0, start);
    const to = Math.min(size, end);
    if (to <= from) return EMPTY;

    // Larger than a window: nothing to gain from buffering it.
    if (to - from > windowBytes) return readReal(from, to);

    const inWindow =
      windowData !== null && from >= windowStart && to <= windowStart + windowData.length;
    if (!inWindow) {
      const data = new Uint8Array(await readReal(from, Math.min(size, from + windowBytes)));
      windowStart = from;
      windowData = data;
    }

    // A copy, so the caller owns its bytes and the window can move on.
    return windowData.slice(from - windowStart, to - windowStart).buffer;
  };

  return {
    name: file.name,
    size,
    type: file.type || '',
    stats,
    slice(start = 0, end = size) {
      return { arrayBuffer: () => read(start, end) };
    },
  };
}
