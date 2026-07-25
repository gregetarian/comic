/**
 * parcel-field.js — parcellation boundary maths on a triangle mesh. Pure: no THREE, no DOM.
 *
 * Turns a per-vertex integer label field into a per-vertex distance-to-boundary field, which
 * scene/parcellation.js then renders as an analytically anti-aliased line (see that file for why
 * a distance field rather than a screen-space label-edge filter).
 */

/**
 * Vertex adjacency in CSR form from a triangle index buffer.
 * Duplicate entries are left in: relaxing the same edge twice is idempotent, and deduplicating
 * ~2M entries costs more than the duplicates do.
 */
export function buildAdjacency(index, nVerts) {
    const offsets = new Uint32Array(nVerts + 1);
    for (let i = 0; i < index.length; i++) offsets[index[i] + 1] += 2;   // 2 co-triangle neighbours
    for (let i = 0; i < nVerts; i++) offsets[i + 1] += offsets[i];
    const cursor = offsets.slice(0, nVerts);
    const neighbours = new Uint32Array(offsets[nVerts]);
    const push = (a, b) => { neighbours[cursor[a]++] = b; };
    for (let t = 0; t < index.length; t += 3) {
        const a = index[t], b = index[t + 1], c = index[t + 2];
        push(a, b); push(a, c); push(b, a); push(b, c); push(c, a); push(c, b);
    }
    return { offsets, neighbours };
}

/** Number of bit-planes packed into the border attribute — so up to 2^4 = 16 parcel colours. */
export const PLANES = 4;

/**
 * Greedy proper colouring of the parcel adjacency graph (parcels that share an edge get
 * different colours). The medial wall participates as one extra virtual parcel at index
 * `nParcels`, so the ring around it is coloured like any other boundary.
 *
 * Why colour at all: a signed distance field is what places a boundary sub-triangle accurately,
 * and a sign needs a two-way split. A partition into many parcels has no global inside/outside —
 * but a proper colouring does: for each BIT of the colour, "bit set" vs "bit clear" is a genuine
 * two-way split, and any two adjacent parcels differ in at least one bit, so every boundary is
 * captured by at least one bit-plane. Surface parcellations are near-planar and greedy needs only
 * a handful of colours in practice; 16 is a large margin.
 */
export function colorParcels(labels, adj, nParcels) {
    const { offsets, neighbours } = adj;
    const wall = nParcels;                       // virtual parcel for label -1
    const idx = (v) => (labels[v] < 0 ? wall : labels[v]);
    const nbrs = Array.from({ length: nParcels + 1 }, () => new Set());
    for (let v = 0; v < labels.length; v++) {
        const a = idx(v);
        for (let e = offsets[v]; e < offsets[v + 1]; e++) {
            const b = idx(neighbours[e]);
            if (a !== b) { nbrs[a].add(b); nbrs[b].add(a); }
        }
    }
    // Welsh–Powell ordering (highest degree first) keeps the colour count low.
    const order = [...nbrs.keys()].sort((p, q) => nbrs[q].size - nbrs[p].size);
    const colour = new Int32Array(nParcels + 1).fill(-1);
    for (const p of order) {
        const used = new Set();
        for (const q of nbrs[p]) if (colour[q] >= 0) used.add(colour[q]);
        let c = 0;
        while (used.has(c)) c++;
        colour[p] = c;
    }
    const nColours = Math.max(...colour) + 1;
    if (nColours > (1 << PLANES))
        throw new Error(`parcellation needs ${nColours} colours, only ${1 << PLANES} are packable`);
    return colour;
}

/**
 * SIGNED distance fields, one per bit-plane, packed as PLANES floats per vertex.
 *
 * For bit b the surface splits in two: parcels whose colour has bit b set, and the rest. Every
 * edge joining the two sides is an interface, taken to cross at the midpoint, so its endpoints are
 * seeded at ±half the edge length — POSITIVE on the bit-set side, negative on the other. Magnitude
 * then propagates outward exactly as an unsigned field would, each vertex keeping the sign of its
 * own side.
 *
 * The sign is the whole point. Seeding both endpoints positive (the obvious unsigned reading) makes
 * the linear interpolant across the interface a plateau at ~½ edge: it never reaches zero, so the
 * line renders as a faint edge-length-dependent smudge. Forcing the zero onto the vertices instead
 * fixes the opacity but quantises the line to the mesh, which is what made the borders staircase.
 * Signed, the interpolant runs +½e → −½e and crosses zero exactly at the interface — anywhere
 * inside a triangle — so the rendered contour is smooth and sub-triangle accurate.
 *
 * Unused planes are filled with `maxDist` and are inert: their screen gradient is 0, so the shader
 * maps them to an effectively infinite pixel distance and they never draw.
 */
export function signedBoundaryFields(labels, adj, positions, colour, nParcels,
                                     { includeWall = true, maxDist = 8 } = {}) {
    const { offsets, neighbours } = adj;
    const n = labels.length;
    const wall = nParcels;
    const out = new Float32Array(n * PLANES).fill(maxDist);
    const edgeLen = (a, b) => Math.hypot(positions[3 * a] - positions[3 * b],
                                         positions[3 * a + 1] - positions[3 * b + 1],
                                         positions[3 * a + 2] - positions[3 * b + 2]);
    const active = (v) => includeWall || labels[v] >= 0;
    const bitOf = (v, b) => ((colour[labels[v] < 0 ? wall : labels[v]] >> b) & 1);

    for (let b = 0; b < PLANES; b++) {
        const dist = new Float32Array(n).fill(maxDist);
        let frontier = [];
        for (let v = 0; v < n; v++) {
            if (!active(v)) continue;
            const sv = bitOf(v, b);
            for (let e = offsets[v]; e < offsets[v + 1]; e++) {
                const w = neighbours[e];
                if (!active(w) || bitOf(w, b) === sv) continue;
                const half = 0.5 * edgeLen(v, w);
                if (half < dist[v]) dist[v] = half;
            }
            if (dist[v] < maxDist) frontier.push(v);
        }
        while (frontier.length) {
            const next = [];
            const queued = new Uint8Array(n);
            for (const v of frontier) {
                const dv = dist[v];
                for (let e = offsets[v]; e < offsets[v + 1]; e++) {
                    const w = neighbours[e];
                    if (!active(w)) continue;
                    const cand = dv + edgeLen(v, w);
                    if (cand < dist[w] && cand < maxDist) {
                        dist[w] = cand;
                        if (!queued[w]) { queued[w] = 1; next.push(w); }
                    }
                }
            }
            frontier = next;
        }
        for (let v = 0; v < n; v++) {
            if (!active(v)) continue;
            out[v * PLANES + b] = bitOf(v, b) ? dist[v] : -dist[v];
        }
    }
    return out;
}

/**
 * Laplacian-smooth the packed signed fields in place, which smooths the rendered CONTOUR.
 *
 * An atlas boundary is quantised to vertices, so even a perfectly placed sub-triangle contour
 * still zigzags at the ~1 mm mesh scale. Majority-vote relabelling cannot fix that — it moves
 * vertices between parcels but the boundary stays a vertex-to-vertex staircase. Smoothing the
 * signed field does: the zero level set of a smoothed field is a smoothed curve, free to sit
 * anywhere inside a triangle.
 *
 * Line WIDTH is unaffected. The shader measures |s| / |∇s|, which is invariant to any local
 * rescaling of s — so flattening the field near the zero crossing moves the contour without
 * thinning the stroke.
 *
 * Deliberately a fixed, modest amount rather than a user parameter: heavy smoothing pulls the
 * contour toward the average of its neighbourhood, which would shrink small parcels.
 */
export function smoothFields(fields, adj, iterations, active, lambda = 0.5) {
    const { offsets, neighbours } = adj;
    const n = fields.length / PLANES;
    for (let it = 0; it < iterations; it++) {
        const prev = fields.slice();
        for (let v = 0; v < n; v++) {
            if (active && !active[v]) continue;
            let k = 0;
            const sum = [0, 0, 0, 0];
            for (let e = offsets[v]; e < offsets[v + 1]; e++) {
                const w = neighbours[e];
                if (active && !active[w]) continue;
                for (let b = 0; b < PLANES; b++) sum[b] += prev[w * PLANES + b];
                k++;
            }
            if (!k) continue;
            for (let b = 0; b < PLANES; b++) {
                const i = v * PLANES + b;
                fields[i] = prev[i] + lambda * (sum[b] / k - prev[i]);
            }
        }
    }
    return fields;
}
