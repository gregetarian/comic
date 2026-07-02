/**
 * buffers.js — pure typed-array reconstruction from transferred bytes. No THREE, no DOM.
 *
 * The Pyodide pipeline / static .bin path hand geometry over as raw byte buffers
 * (Uint8Array views, possibly at a non-zero offset into a shared ArrayBuffer). These
 * helpers reinterpret those bytes as Float32/Uint32 arrays. The .slice() copies to a
 * fresh 0-offset buffer so the typed-array alignment is always valid regardless of the
 * source view's byteOffset (a plain `new Float32Array(buf, offset)` throws when offset
 * isn't a multiple of the element size).
 */

/** Float32 view over a byte buffer, copied to a 0-offset buffer (alignment-safe). */
export const asF32 = (u8) => new Float32Array(u8.slice().buffer);
/** Uint32 view over a byte buffer, copied to a 0-offset buffer (alignment-safe). */
export const asU32 = (u8) => new Uint32Array(u8.slice().buffer);

/**
 * Slice a concatenated overlay `.bin` back into per-buffer Uint8Array views via the
 * meta's `bufferLayout` ([offset, length] per buffer index). Views share `arrayBuffer`
 * (no copy) — asF32/asU32 copy later where a typed reinterpret is needed.
 */
export function sliceBuffers(arrayBuffer, bufferLayout) {
    return bufferLayout.map(([o, l]) => new Uint8Array(arrayBuffer, o, l));
}
