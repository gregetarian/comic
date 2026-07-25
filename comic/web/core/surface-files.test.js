import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isParcelValueFile, isSurfaceFile, detectHemi, groupSurfaceFiles, surfaceOverlayName, VOL_RE } from './surface-files.js';

test('isSurfaceFile: surface extensions and hemi-marked morph files, not NIfTI', () => {
    for (const n of ['lh.thickness.gii', 'rh.stat.mgh', 'sub-01_hemi-L_stat.gii', 'lh.curv', 'stat.mgz'])
        assert.equal(isSurfaceFile(n), true, n);
    for (const n of ['zstat1.nii.gz', 'map.nii', 'blob.gz', 'notes.txt'])
        assert.equal(isSurfaceFile(n), false, n);
});

test('detectHemi: lh/rh tokens + BIDS hemi-L/hemi-R', () => {
    assert.equal(detectHemi('lh.thickness.gii'), 'lh');
    assert.equal(detectHemi('rh.stat.mgh'), 'rh');
    assert.equal(detectHemi('sub-01_hemi-L_stat.gii'), 'lh');
    assert.equal(detectHemi('sub-01_hemi-R_stat.gii'), 'rh');
    assert.equal(detectHemi('thickness.gii'), null);   // no marker
});

test('groupSurfaceFiles: pairs lh/rh with the same base; lone/undetectable -> lh slot', () => {
    const g = groupSurfaceFiles([{ name: 'lh.thickness.gii' }, { name: 'rh.thickness.gii' }]);
    assert.equal(g.length, 1);
    assert.equal(g[0].lh.name, 'lh.thickness.gii');
    assert.equal(g[0].rh.name, 'rh.thickness.gii');

    const lone = groupSurfaceFiles([{ name: 'lh.stat.mgh' }]);
    assert.equal(lone.length, 1);
    assert.equal(lone[0].lh.name, 'lh.stat.mgh');
    assert.equal(lone[0].rh, null);

    // two independent pairs stay separate
    const two = groupSurfaceFiles([
        { name: 'lh.A.gii' }, { name: 'rh.A.gii' }, { name: 'lh.B.gii' }, { name: 'rh.B.gii' }]);
    assert.equal(two.length, 2);

    // undetectable hemisphere -> lh slot (single-hemi render)
    const nohemi = groupSurfaceFiles([{ name: 'thickness.gii' }]);
    assert.equal(nohemi[0].lh.name, 'thickness.gii');
});

test('surfaceOverlayName strips extension + hemi marker', () => {
    assert.equal(surfaceOverlayName({ lh: { name: 'lh.thickness.gii' }, rh: { name: 'rh.thickness.gii' } }), 'thickness');
    assert.equal(surfaceOverlayName({ lh: { name: 'lh.stat.mgh' }, rh: null }), 'stat');
});

test('VOL_RE matches NIfTI, not surface files', () => {
    assert.equal(VOL_RE.test('zstat1.nii.gz'), true);
    assert.equal(VOL_RE.test('stat.mgz'), false);
    assert.equal(VOL_RE.test('lh.thickness.gii'), false);
});

test('a per-parcel value table is NOT a surface file, even with a hemi marker', () => {
    // `lh_schaefer_values.csv` matches the hemi pattern, so without this it would be routed into
    // process_surface and hand a CSV to a GIFTI reader.
    assert.equal(isParcelValueFile('values.csv'), true);
    assert.equal(isParcelValueFile('schaefer400.tsv'), true);
    assert.equal(isParcelValueFile('betas.txt'), true);
    assert.equal(isParcelValueFile('lh.thickness.gii'), false);
    assert.equal(isSurfaceFile('lh_schaefer_values.csv'), false);
    assert.equal(isSurfaceFile('lh.thickness.gii'), true);
});
