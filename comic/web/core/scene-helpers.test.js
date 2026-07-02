/**
 * Unit tests for the pure scene helpers extracted from scene/asset-loader.js and
 * scene/renderer.js. No THREE, no DOM. Run with:  node --test  (from comic/web/core/)
 * These guard the mesh taxonomy, the render-layer scheme, and the byte→typed-array
 * reconstruction that all three overlay-loading paths share.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { hemiOfCategory, categoryOfStructure, anatomyLayer, overlayLayer, meshLayer } from './mesh-meta.js';
import { asF32, asU32, sliceBuffers } from './buffers.js';

// --- taxonomy: hemisphere from category ---
test('hemiOfCategory maps _l/_r suffixes + cortex tags + midline', () => {
    assert.equal(hemiOfCategory('subcort_l'), 'lh');
    assert.equal(hemiOfCategory('cereb_l'), 'lh');
    assert.equal(hemiOfCategory('lh_cortex'), 'lh');
    assert.equal(hemiOfCategory('subcort_r'), 'rh');
    assert.equal(hemiOfCategory('cereb_r'), 'rh');
    assert.equal(hemiOfCategory('rh_cortex'), 'rh');
    assert.equal(hemiOfCategory('brainstem'), 'mid');   // midline → exempt from the hemisphere gate
});

// --- taxonomy: category from a subcortical structure name ---
test('categoryOfStructure splits L-/R- subcortex + cerebellum, brainstem is midline', () => {
    assert.equal(categoryOfStructure('Brainstem'), 'brainstem');
    assert.equal(categoryOfStructure('L-Thalamus-Proper'), 'subcort_l');
    assert.equal(categoryOfStructure('R-Hippocampus'), 'subcort_r');
    assert.equal(categoryOfStructure('L-Cerebellum-Cortex'), 'cereb_l');
    assert.equal(categoryOfStructure('R-Cerebellum-Cortex'), 'cereb_r');
    assert.equal(categoryOfStructure('Unknown'), 'brainstem');   // no L-/R- prefix → midline fallback
});

// --- layers: cortex 0, overlay i→1+i, subcortex shell past the overlays (N+1) ---
test('meshLayer assigns the documented layer + renderOrder per role', () => {
    assert.deepEqual(meshLayer({ role: 'cortex' }, 3), { layer: 0, renderOrder: 1 });
    assert.deepEqual(meshLayer({ role: 'anatomy' }, 3), { layer: 4, renderOrder: 5 });   // N+1
    assert.deepEqual(meshLayer({ role: 'voxel', overlay: 0 }, 3), { layer: 1, renderOrder: 15 });
    assert.deepEqual(meshLayer({ role: 'voxel', overlay: 2 }, 3), { layer: 3, renderOrder: 15 });
    assert.deepEqual(meshLayer({ role: 'voxel' }, 3), { layer: 1, renderOrder: 15 });     // overlay ?? 0
});

test('the subcortex layer never collides with an overlay layer', () => {
    for (const N of [0, 1, 2, 5]) {
        assert.equal(anatomyLayer(N), N + 1);
        // overlay layers are 1..N (overlay index 0..N-1); the shell sits strictly above them
        assert.equal(overlayLayer(0), 1);
        assert.ok(anatomyLayer(N) > overlayLayer(N - 1) || N === 0);
    }
});

// --- buffers: byte→typed-array reconstruction (the alignment-safe path) ---
test('asF32/asU32 round-trip a 0-offset byte buffer', () => {
    const f = new Float32Array([1.5, -2.25, 3.0, 0]);
    assert.deepEqual([...asF32(new Uint8Array(f.buffer))], [1.5, -2.25, 3.0, 0]);
    const u = new Uint32Array([0, 7, 4294967295]);
    assert.deepEqual([...asU32(new Uint8Array(u.buffer))], [0, 7, 4294967295]);
});

test('asF32 tolerates a MISaligned source view (the reason it copies via slice)', () => {
    const src = new Float32Array([1.25, -6.5]);
    const big = new Uint8Array(2 + src.byteLength);         // pad 2 bytes → force misalignment
    big.set(new Uint8Array(src.buffer), 2);
    const view = new Uint8Array(big.buffer, 2, src.byteLength);   // byteOffset 2: not a multiple of 4
    assert.deepEqual([...asF32(view)], [1.25, -6.5]);       // slice() → fresh 0-offset buffer → valid
    // the naive reinterpret (no slice) throws on the same misaligned offset:
    assert.throws(() => new Float32Array(big.buffer, 2));
});

test('asF32 copies (does not alias) the source bytes', () => {
    const f = new Float32Array([9, 8]);
    const u8 = new Uint8Array(f.buffer);
    const out = asF32(u8);
    f[0] = 100;                                             // mutate the original after reconstruction
    assert.equal(out[0], 9);                               // the copy is unaffected
});

test('sliceBuffers cuts a concatenated .bin into per-buffer views by [offset,length]', () => {
    const buf = new ArrayBuffer(10);
    new Uint8Array(buf).set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const parts = sliceBuffers(buf, [[0, 4], [4, 2], [6, 4]]);
    assert.equal(parts.length, 3);
    assert.deepEqual([...parts[0]], [0, 1, 2, 3]);
    assert.deepEqual([...parts[1]], [4, 5]);
    assert.deepEqual([...parts[2]], [6, 7, 8, 9]);
    // views share the source buffer (no copy at slice time)
    assert.equal(parts[0].buffer, buf);
    assert.equal(parts[1].byteOffset, 4);
});
