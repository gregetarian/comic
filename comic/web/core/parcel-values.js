/**
 * parcel-values.js — parse an uploaded per-parcel value table and work out which atlas it is.
 * Pure: no THREE, no DOM, no fetch.
 *
 * A "vector of Schaefer parcels" arrives in whatever shape the analysis that produced it emitted:
 * one value per line, one `region,value` pair per line, a single comma-separated row, with or
 * without a header, comma- or tab- or whitespace-separated. All of those are the same data, so
 * they are all accepted; what is NOT accepted is guessing when the answer is genuinely ambiguous
 * (see inferAtlas).
 *
 * The CLI's equivalent lives in comic/parcels.py (`load_value_table`). The two are deliberately
 * separate implementations — one runs in Python before Pyodide exists, the other in the browser —
 * but they must agree on the rules, so both are unit-tested against the same cases.
 */

const isNum = (s) => s !== '' && s != null && Number.isFinite(Number(s));

/** Split into rows of fields, sniffing the delimiter (tab > comma > whitespace). */
function tokenize(text) {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '');
    if (!lines.length) throw new Error('the file is empty');
    const head = lines[0];
    const delim = head.includes('\t') ? /\t/ : head.includes(',') ? /,/ : /\s+/;
    return lines.map((l) => l.split(delim).map((f) => f.trim()).filter((f, i, a) => !(f === '' && i === a.length - 1)));
}

/**
 * Parse a value table into { names, values }. `names` is null for a bare vector.
 *
 * Header detection is by CONTENT, not by a flag: a first row whose numeric field does not parse as
 * a number is a header and is dropped. That is unambiguous for real tables — a header's value
 * column says "value"/"beta"/"t", never a number — and it means the user never has to declare it.
 */
export function parseValueTable(text) {
    let rows = tokenize(text);

    // A single long row is a vector written across the line rather than down the file.
    if (rows.length === 1 && rows[0].length > 2) {
        const only = rows[0];
        const body = isNum(only[0]) ? only : only.slice(1);      // leading label = header
        rows = body.map((v) => [v]);
    }

    const width = Math.max(...rows.map((r) => r.length));
    if (width === 1) {
        if (!isNum(rows[0][0])) rows = rows.slice(1);            // header line
        const values = rows.map((r) => Number(r[0]));
        const bad = values.findIndex((v) => !Number.isFinite(v));
        if (bad >= 0) throw new Error(`row ${bad + 1} is not a number: "${rows[bad][0]}"`);
        return { names: null, values };
    }

    // ≥2 columns: first is the region, the SECOND is the value (matching the CLI, which takes the
    // first two columns — extra columns from a wider export are ignored rather than guessed at).
    if (!isNum(rows[0][1])) rows = rows.slice(1);                // header row
    const names = rows.map((r) => r[0]);
    const values = rows.map((r) => Number(r[1]));
    const bad = values.findIndex((v) => !Number.isFinite(v));
    if (bad >= 0) throw new Error(`row ${bad + 1} ("${names[bad]}") has a non-numeric value: "${rows[bad][1]}"`);
    return { names, values };
}

/**
 * Which atlas does this table describe?
 *
 * `atlases` is the parcels index: { name: { label, nparcels } }. Returns
 * `{ candidates, reason }` — candidates ordered best-first:
 *   - exactly one  → use it
 *   - several      → the caller must ASK (a bare 400-long vector is equally Schaefer-400 7- or
 *                    17-network; picking one silently would mislabel every parcel)
 *   - none         → the caller reports the lengths that ARE available
 *
 * Region names, when present, decide it outright: they are matched against each atlas's own name
 * list, so a named Schaefer table needs no question. A bare vector has only its length.
 */
export function inferAtlas(parsed, atlases, nameLists = {}) {
    const n = parsed.values.length;
    const byLength = Object.entries(atlases)
        .filter(([, a]) => a.nparcels === n)
        .map(([name]) => name);

    if (parsed.names) {
        const scored = byLength.map((name) => {
            const known = new Set(nameLists[name] || []);
            const hits = known.size ? parsed.names.filter((r) => known.has(r)).length : 0;
            return { name, hits };
        }).filter((s) => s.hits > 0).sort((a, b) => b.hits - a.hits);
        // An exact name match is decisive even when several atlases share the parcel count.
        if (scored.length && scored[0].hits === parsed.names.length)
            return { candidates: [scored[0].name], reason: 'matched by region names' };
        if (scored.length === 1)
            return { candidates: [scored[0].name], reason: 'matched by region names' };
        if (scored.length > 1)
            return { candidates: scored.map((s) => s.name), reason: 'several atlases share these region names' };
    }
    if (byLength.length === 1) return { candidates: byLength, reason: `${n} values matched one atlas` };
    if (byLength.length > 1) return { candidates: byLength, reason: `${n} values match ${byLength.length} atlases` };
    return { candidates: [], reason: `no baked atlas has ${n} parcels` };
}

/**
 * Expand per-parcel values onto the per-vertex fsaverage maps a surface overlay needs.
 * `atlas` is the loaded {lh, rh, names, hemis} label set; `values` is one number per parcel, in
 * the atlas's own parcel order (index i ↔ names[i]). Parcels not covered stay 0, i.e. invisible
 * at any threshold > 0, which is how the medial wall ends up unpainted.
 */
export function valuesToVertexMaps(values, atlas) {
    const nParcels = atlas.names.length;
    if (values.length !== nParcels)
        throw new Error(`got ${values.length} values but this atlas has ${nParcels} parcels`);
    const out = {};
    for (const hemi of ['lh', 'rh']) {
        const labels = atlas[hemi];
        const vals = new Float32Array(labels.length);
        for (let i = 0; i < labels.length; i++) {
            const l = labels[i];
            if (l >= 0) vals[i] = values[l];
        }
        out[hemi] = vals;
    }
    return out;
}

/** Map a table keyed by region NAME onto parcel order, tolerating the bilateral-name case.
 *  Mirrors comic/parcels.py:_match_regions — a FreeSurfer atlas spells a region identically in
 *  both hemispheres, so a bare name applies to both; lh_/rh_ (or _lh/_rh) selects one. */
export function namedValuesToParcelOrder(names, values, atlas) {
    const out = new Float32Array(atlas.names.length);
    const unmatched = [];
    for (let i = 0; i < names.length; i++) {
        const hits = matchRegions(names[i], atlas.names, atlas.hemis);
        if (!hits.length) { unmatched.push(names[i]); continue; }
        for (const j of hits) out[j] = values[i];
    }
    if (unmatched.length)
        throw new Error(`${unmatched.length} region name(s) are not in this atlas, e.g. `
            + unmatched.slice(0, 3).map((s) => `"${s}"`).join(', '));
    return out;
}

function matchRegions(key, names, hemis) {
    const k = key.trim();
    const exact = [];
    for (let i = 0; i < names.length; i++) if (names[i] === k) exact.push(i);
    if (exact.length) return exact;                       // the atlas's own spelling always wins
    const low = k.toLowerCase();
    let want = null, bare = k;
    for (const [pre, h] of [['lh_', 'lh'], ['lh-', 'lh'], ['left_', 'lh'], ['rh_', 'rh'], ['rh-', 'rh'], ['right_', 'rh']])
        if (low.startsWith(pre)) { want = h; bare = k.slice(pre.length); break; }
    if (want === null) for (const [suf, h] of [['_lh', 'lh'], ['-lh', 'lh'], ['_rh', 'rh'], ['-rh', 'rh']])
        if (low.endsWith(suf)) { want = h; bare = k.slice(0, -suf.length); break; }
    const out = [];
    for (let i = 0; i < names.length; i++)
        if (names[i] === bare && (want === null || hemis[i] === want)) out.push(i);
    return out;
}
