import test from 'node:test';
import assert from 'node:assert/strict';
import { nearestSourceMap, upsampleLabels } from './parcel-resample.js';

test('nearestSourceMap preserves the source prefix and expands by nearest vertex', () => {
    // first 3 points are sources, final 3 are targets
    const xyz = new Float32Array([
        0, 0, 0,
        10, 0, 0,
        0, 10, 0,
        1, 0, 0,
        9, 0, 0,
        0, 8, 0,
    ]);
    const map = nearestSourceMap(xyz, 3);
    assert.deepEqual([...map], [0, 1, 2, 0, 1, 2]);
    const labels = upsampleLabels(new Int16Array([7, 8, 9]), map);
    assert.deepEqual([...labels], [7, 8, 9, 7, 8, 9]);
});

test('nearestSourceMap tie-breaks deterministically to the lower source index', () => {
    const xyz = new Float32Array([
        -1, 0, 0,
         1, 0, 0,
         0, 0, 0,
    ]);
    assert.deepEqual([...nearestSourceMap(xyz, 2)], [0, 1, 0]);
});

test('resampling validates source and label lengths', () => {
    assert.throws(() => nearestSourceMap(new Float32Array([0, 0, 0]), 2), /invalid/);
    assert.throws(() => upsampleLabels(new Int16Array([1]), new Uint32Array([0, 1])), /exceeds/);
});
