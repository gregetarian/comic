/**
 * parcel-resample.js — nearest-neighbour expansion of lower-order fsaverage labels.
 *
 * FreeSurfer's fsaverage ico meshes are nested: ico5's 10,242 vertices are the first
 * 10,242 vertices of ico7.  A DK68 label vector on fsaverage5 can therefore be expanded
 * onto Comic's ico7 surface by nearest-neighbour assignment in the existing ico7 vertex
 * coordinates.  This mirrors comic.pipeline._upsample_to_template, but runs in-browser.
 *
 * Pure module: no THREE, no DOM.
 */

function buildKDTree(positions, n) {
    const ids = Array.from({ length: n }, (_, i) => i);

    function coord(i, axis) { return positions[i * 3 + axis]; }

    function build(list, depth = 0) {
        if (!list.length) return null;
        const axis = depth % 3;
        list.sort((a, b) => {
            const d = coord(a, axis) - coord(b, axis);
            return d || (a - b);
        });
        const mid = list.length >> 1;
        return {
            i: list[mid], axis,
            left: build(list.slice(0, mid), depth + 1),
            right: build(list.slice(mid + 1), depth + 1),
        };
    }
    return build(ids);
}

function nearest(tree, positions, x, y, z) {
    let best = -1, bestD2 = Infinity;
    const eps = 1e-12;

    function visit(node) {
        if (!node) return;
        const i = node.i, k = i * 3;
        const dx = x - positions[k], dy = y - positions[k + 1], dz = z - positions[k + 2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < bestD2 - eps || (Math.abs(d2 - bestD2) <= eps && (best < 0 || i < best))) {
            bestD2 = d2; best = i;
        }

        const q = node.axis === 0 ? x : node.axis === 1 ? y : z;
        const p = positions[k + node.axis];
        const delta = q - p;
        const near = delta <= 0 ? node.left : node.right;
        const far = delta <= 0 ? node.right : node.left;
        visit(near);
        if (delta * delta <= bestD2 + eps) visit(far);
    }
    visit(tree);
    return best;
}

/**
 * Map every target vertex to its nearest vertex among the first sourceN vertices.
 * The prefix itself maps identically. Returned Uint32Array is reusable across atlases.
 */
export function nearestSourceMap(positions, sourceN) {
    if (positions.length % 3) throw new Error('positions must be xyz triples');
    const n = positions.length / 3;
    if (!(sourceN > 0 && sourceN <= n))
        throw new Error(`source vertex count ${sourceN} is invalid for target with ${n} vertices`);

    const out = new Uint32Array(n);
    for (let i = 0; i < sourceN; i++) out[i] = i;
    if (sourceN === n) return out;

    const tree = buildKDTree(positions, sourceN);
    for (let i = sourceN; i < n; i++) {
        const k = i * 3;
        out[i] = nearest(tree, positions, positions[k], positions[k + 1], positions[k + 2]);
    }
    return out;
}

/** Expand an Int16 label vector with a precomputed source->target nearest map. */
export function upsampleLabels(labels, nearestMap) {
    if (!labels.length) throw new Error('label vector is empty');
    const out = new Int16Array(nearestMap.length);
    for (let i = 0; i < nearestMap.length; i++) {
        const j = nearestMap[i];
        if (j >= labels.length)
            throw new Error(`nearest source index ${j} exceeds label vector length ${labels.length}`);
        out[i] = labels[j];
    }
    return out;
}
