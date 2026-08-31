/**
 * Base64 encoding helpers for binary data.
 */

/**
 * Bytes converted per `String.fromCharCode` call.
 *
 * `String.fromCharCode.apply(null, bytes)` passes every byte as a separate
 * function argument, so the engine's argument-count limit caps how much can be
 * converted at once. V8 throws `RangeError: Maximum call stack size exceeded`
 * between 64KB and 128KB; WKWebView — which the macOS/iOS Tauri builds run on —
 * throws at roughly 65k arguments. 0x8000 (32768) stays well under both.
 */
const CHUNK_SIZE = 0x8000;

/**
 * Convert a byte array to a base64 string.
 *
 * Chunked deliberately. The obvious one-liner
 * `btoa(String.fromCharCode.apply(null, bytes))` blows the stack on larger
 * inputs — and it sat in the subtitle upload path, operating on zlib-compressed
 * bytes, so a large enough subtitle simply could not be uploaded.
 *
 * @param {Uint8Array|Array<number>} bytes Raw bytes to encode
 * @returns {string} base64-encoded data
 */
export function uint8ArrayToBase64(bytes) {
  let binary = '';

  for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
    const chunk = bytes.subarray
      ? bytes.subarray(offset, offset + CHUNK_SIZE)
      : bytes.slice(offset, offset + CHUNK_SIZE);

    binary += String.fromCharCode.apply(null, chunk);
  }

  return btoa(binary);
}
