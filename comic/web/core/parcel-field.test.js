import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAdjacency, colorParcels, signedBoundaryFields, smoothFields, PLANES }
    from './parcel-field.js';

/** A flat W×H vertex grid split into two triangles per cell — a mesh with known geometry, so the
 *  distances below are checkable by hand (unit spacing ⇒ 1 mm per step). */
function grid(W, H) {
    const positions = new Float32Array(W * H * 3);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const v = y * W + x;
        positions[3 * v] = x; positions[3 * v + 1] = y; positions[3 * v + 2] = 0;
    }
    const index = [];
    for (let y = 0; y < H - 1; y++) for (let x = 0; x < W - 1; x++) {
        const a = y * W + x, b = a + 1, c = a + W, d = c + 1;
        index.push(a, b, c, b, d, c);
    }
    return { positions, index: new Uint32Array(index), n: W * H };
}

/** Vertical split of a W×H grid at column `col`; everything right of it gets label 1. */
function split(n, W, col, right = 1, left = 0) {
    const labels = new Int16Array(n);
    for (let v = 0; v < n; v++) labels[v] = (v % W) >= col ? right : left;
    return labels;
}

test('buildAdjacency is symmetric and covers every triangle edge', () => {
    const { index, n } = grid(4, 4);
    const { offsets, neighbours } = buildAdjacency(index, n);
    const set = (v) => new Set(neighbours.slice(offsets[v], offsets[v + 1]));
    for (let v = 0; v < n; v++) for (const w of set(v)) assert.ok(set(w).has(v), `${w}->${v} missing`);
    // corner 0 lies only in triangle (0,1,4) — the diagonal misses it; an interior vertex has 6
    assert.deepEqual([...set(0)].sort((a, b) => a - b), [1, 4]);
    assert.equal(set(5).size, 6);
});

test('colorParcels gives adjacent parcels different colours, wall included', () => {
    const { index, n } = grid(9, 5);
    const adj = buildAdjacency(index, n);
    // three vertical stripes + a medial wall stripe, so every pair of neighbours must differ
    const labels = new Int16Array(n);
    for (let v = 0; v < n; v++) {
        const x = v % 9;
        labels[v] = x < 2 ? 0 : x < 4 ? 1 : x < 6 ? 2 : -1;
    }
    const colour = colorParcels(labels, adj, 3);
    const { offsets, neighbours } = adj;
    const idx = (v) => (labels[v] < 0 ? 3 : labels[v]);
    for (let v = 0; v < n; v++) for (let e = offsets[v]; e < offsets[v + 1]; e++) {
        const w = neighbours[e];
        if (idx(v) !== idx(w)) assert.notEqual(colour[idx(v)], colour[idx(w)], `${idx(v)}/${idx(w)}`);
    }
    assert.equal(colour.length, 4, 'one entry per parcel plus the virtual wall parcel');
});

test('signed fields change sign across a boundary — the property that places it sub-triangle', () => {
    const W = 6, { positions, index, n } = grid(W, 6);
    const labels = split(n, W, 3);
    const adj = buildAdjacency(index, n);
    const colour = colorParcels(labels, adj, 2);
    const f = signedBoundaryFields(labels, adj, positions, colour, 2, { maxDist: 8 });
    // find the plane that separates these two parcels (they differ in at least one colour bit)
    const b = [0, 1, 2, 3].find((i) => ((colour[0] >> i) & 1) !== ((colour[1] >> i) & 1));
    assert.notEqual(b, undefined, 'a proper colouring must separate them in some bit-plane');
    const at = (x, y) => f[(y * W + x) * PLANES + b];
    // opposite signs on the two sides, equal magnitude = half the 1 mm edge → zero at the midpoint
    assert.ok(at(2, 2) * at(3, 2) < 0, 'sign flips across the interface');
    assert.equal(Math.abs(at(2, 2)), 0.5);
    assert.equal(Math.abs(at(3, 2)), 0.5);
    // and the magnitude grows by one unit per column away from the interface
    assert.equal(Math.abs(at(1, 2)), 1.5);
    assert.equal(Math.abs(at(0, 2)), 2.5);
});

test('unused planes stay constant so they can never draw a line', () => {
    const W = 6, { positions, index, n } = grid(W, 6);
    const labels = split(n, W, 3);
    const adj = buildAdjacency(index, n);
    const colour = colorParcels(labels, adj, 2);
    const f = signedBoundaryFields(labels, adj, positions, colour, 2, { maxDist: 8 });
    for (let b = 0; b < PLANES; b++) {
        const vals = new Set();
        for (let v = 0; v < n; v++) vals.add(f[v * PLANES + b]);
        const separating = ((colour[0] >> b) & 1) !== ((colour[1] >> b) & 1);
        // Inert means CONSTANT (whatever the saturated value's sign): a constant field has zero
        // screen gradient, so the shader maps it to an unreachable pixel distance and never draws.
        if (!separating) assert.equal(vals.size, 1, `plane ${b} must be constant, got ${[...vals]}`);
    }
});

test('signed fields cap at maxDist so cost stays local to the boundary', () => {
    const W = 30, { positions, index, n } = grid(W, 3);
    const labels = split(n, W, 1);
    const adj = buildAdjacency(index, n);
    const colour = colorParcels(labels, adj, 2);
    const f = signedBoundaryFields(labels, adj, positions, colour, 2, { maxDist: 4 });
    const b = [0, 1, 2, 3].find((i) => ((colour[0] >> i) & 1) !== ((colour[1] >> i) & 1));
    assert.equal(Math.abs(f[20 * PLANES + b]), 4, 'beyond the cap the magnitude saturates');
});

test('medialWall=false leaves the wall boundary unstroked', () => {
    const W = 6, { positions, index, n } = grid(W, 6);
    const labels = split(n, W, 3, -1, 0);     // right half is non-cortex
    const adj = buildAdjacency(index, n);
    const colour = colorParcels(labels, adj, 1);
    const on = signedBoundaryFields(labels, adj, positions, colour, 1, { includeWall: true, maxDist: 8 });
    const off = signedBoundaryFields(labels, adj, positions, colour, 1, { includeWall: false, maxDist: 8 });
    const near = (f) => Math.min(...[0, 1, 2, 3].map((b) => Math.abs(f[(2 * W + 2) * PLANES + b])));
    assert.equal(near(on), 0.5, 'the wall edge is an interface when it counts as a region');
    assert.equal(near(off), 8, 'and is not when it does not');
});

test('smoothFields moves the contour without changing which side a vertex is on', () => {
    const W = 9, { positions, index, n } = grid(W, 9);
    // a deliberately ragged boundary — the mesh staircase this is meant to round off
    const labels = new Int16Array(n);
    for (let v = 0; v < n; v++) labels[v] = (v % W) >= (4 + ((Math.floor(v / W) % 2))) ? 1 : 0;
    const adj = buildAdjacency(index, n);
    const colour = colorParcels(labels, adj, 2);
    const f = signedBoundaryFields(labels, adj, positions, colour, 2, { maxDist: 8 });
    const b = [0, 1, 2, 3].find((i) => ((colour[0] >> i) & 1) !== ((colour[1] >> i) & 1));
    const before = [...f];
    smoothFields(f, adj, 4, null);
    // the field genuinely changed (so the contour moved) …
    assert.ok(before.some((v, i) => v !== f[i]), 'smoothing must alter the field');
    // … but far from the boundary the sign is untouched, so parcels do not swap sides
    const sgn = (arr, x, y) => Math.sign(arr[(y * W + x) * PLANES + b]);
    assert.equal(sgn(f, 0, 4), sgn(before, 0, 4));
    assert.equal(sgn(f, 8, 4), sgn(before, 8, 4));
});

test('smoothFields with 0 iterations is the identity', () => {
    const W = 5, { positions, index, n } = grid(W, 5);
    const labels = split(n, W, 2);
    const adj = buildAdjacency(index, n);
    const colour = colorParcels(labels, adj, 2);
    const f = signedBoundaryFields(labels, adj, positions, colour, 2, { maxDist: 8 });
    const copy = [...f];
    smoothFields(f, adj, 0, null);
    assert.deepEqual([...f], copy);
});
