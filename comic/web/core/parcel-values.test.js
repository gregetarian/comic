import test from 'node:test';
import assert from 'node:assert/strict';
import { parseValueTable, inferAtlas, valuesToVertexMaps, namedValuesToParcelOrder }
    from './parcel-values.js';

// The shapes a per-parcel result actually arrives in. Every one of these is the same three values.
test('parseValueTable accepts a bare vector, one value per line', () => {
    assert.deepEqual(parseValueTable('1.5\n-2\n3\n'), { names: null, values: [1.5, -2, 3] });
});

test('parseValueTable drops a header line from a bare vector', () => {
    assert.deepEqual(parseValueTable('value\n1.5\n-2\n3\n'), { names: null, values: [1.5, -2, 3] });
});

test('parseValueTable reads a single comma-separated row as a vector', () => {
    assert.deepEqual(parseValueTable('1.5,-2,3'), { names: null, values: [1.5, -2, 3] });
    assert.deepEqual(parseValueTable('beta,1.5,-2,3'), { names: null, values: [1.5, -2, 3] });
});

test('parseValueTable reads region,value pairs with or without a header', () => {
    const want = { names: ['a', 'b'], values: [1.5, -2] };
    assert.deepEqual(parseValueTable('region,value\na,1.5\nb,-2\n'), want);
    assert.deepEqual(parseValueTable('a,1.5\nb,-2\n'), want);
    assert.deepEqual(parseValueTable('region\tvalue\na\t1.5\nb\t-2\n'), want);
    assert.deepEqual(parseValueTable('a 1.5\nb -2\n'), want);
});

test('parseValueTable tolerates blank lines and a trailing delimiter', () => {
    assert.deepEqual(parseValueTable('\n1.5,\n\n-2,\n'), { names: null, values: [1.5, -2] });
});

test('parseValueTable fails loudly on a non-numeric value, naming the row', () => {
    // Silently coercing to NaN would paint a parcel with a hole and never say why.
    assert.throws(() => parseValueTable('a,1.5\nb,n/a\n'), /row 2 \("b"\).*n\/a/);
    assert.throws(() => parseValueTable('1.5\nn\/a\n'), /row 2/);
    assert.throws(() => parseValueTable('   \n'), /empty/);
});

const ATLASES = {
    schaefer400_7: { nparcels: 400 }, schaefer400_17: { nparcels: 400 },
    schaefer100_7: { nparcels: 100 }, aparc: { nparcels: 68 },
};

test('inferAtlas resolves a unique parcel count on its own', () => {
    const got = inferAtlas({ names: null, values: new Array(100).fill(0) }, ATLASES);
    assert.deepEqual(got.candidates, ['schaefer100_7']);
});

test('inferAtlas refuses to guess between atlases of the same size', () => {
    // A bare 400-long vector is equally Schaefer-400 7- or 17-network. Picking one silently would
    // mislabel every parcel in the figure, so the caller has to ask.
    const got = inferAtlas({ names: null, values: new Array(400).fill(0) }, ATLASES);
    assert.deepEqual(got.candidates.sort(), ['schaefer400_17', 'schaefer400_7']);
    assert.match(got.reason, /match 2 atlases/);
});

test('inferAtlas reports when nothing has that parcel count', () => {
    const got = inferAtlas({ names: null, values: new Array(7).fill(0) }, ATLASES);
    assert.deepEqual(got.candidates, []);
    assert.match(got.reason, /no baked atlas has 7 parcels/);
});

test('inferAtlas uses region names to break a length tie', () => {
    const names = ['7Networks_LH_Vis_1', '7Networks_LH_Vis_2'];
    const atlases = { a7: { nparcels: 2 }, a17: { nparcels: 2 } };
    const lists = { a7: names, a17: ['17Networks_LH_VisCent_1', '17Networks_LH_VisCent_2'] };
    const got = inferAtlas({ names, values: [1, 2] }, atlases, lists);
    assert.deepEqual(got.candidates, ['a7']);
    assert.match(got.reason, /region names/);
});

const ATLAS = {
    // 4 vertices per hemi; -1 is the medial wall. Parcels: lh a,b then rh a,b.
    lh: new Int16Array([0, 0, 1, -1]),
    rh: new Int16Array([2, 3, -1, -1]),
    names: ['a', 'b', 'a', 'b'],
    hemis: ['lh', 'lh', 'rh', 'rh'],
};

test('valuesToVertexMaps paints parcels and leaves the medial wall at 0', () => {
    const m = valuesToVertexMaps([10, 20, 30, 40], ATLAS);
    assert.deepEqual([...m.lh], [10, 10, 20, 0]);
    assert.deepEqual([...m.rh], [30, 40, 0, 0]);
});

test('valuesToVertexMaps fails loudly on a length mismatch', () => {
    assert.throws(() => valuesToVertexMaps([1, 2, 3], ATLAS), /got 3 values but this atlas has 4/);
});

test('a bare region name is bilateral; an lh_/rh_ prefix is not', () => {
    // FreeSurfer atlases spell a region identically in both hemispheres.
    assert.deepEqual([...namedValuesToParcelOrder(['a'], [9], ATLAS)], [9, 0, 9, 0]);
    assert.deepEqual([...namedValuesToParcelOrder(['lh_a'], [9], ATLAS)], [9, 0, 0, 0]);
    assert.deepEqual([...namedValuesToParcelOrder(['a_rh'], [9], ATLAS)], [0, 0, 9, 0]);
});

test('an unmatched region name raises rather than silently dropping the row', () => {
    assert.throws(() => namedValuesToParcelOrder(['nope'], [1], ATLAS), /not in this atlas.*"nope"/);
});
