from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one match, found {count}\n--- needle ---\n{old[:700]}")
    p.write_text(text.replace(old, new, 1))


replace_once(
    "comic/web/core/views.js",
    """// Cortex of one hemisphere + the CONTRALATERAL subcortex (left subcortex with the right
// hemisphere, and vice versa). The visibility layer keeps cortical surface painting but suppresses
// that cortex's blocky/smooth volume, leaving only voxels within the selected internal hemisphere.
// Keep the category lists explicit: this view is deliberately asymmetric, so a single broad
// hemisphere/category filter cannot describe it without leaking the wrong cerebellar half.
const cortexSubcortContra = (cortexHemi, subHemi) => {
    const side = subHemi === 'lh' ? 'l' : 'r';
    const anatomyCategories = [`subcort_${side}`, `cereb_${side}`, 'brainstem'];
    return {
        roles: ['cortex', 'anatomy', 'voxel'],
        hemisphere: cortexHemi,
        anatomyHemisphere: subHemi,
        // This is a hybrid view: cortical statistics are painted on the displayed sheet,
        // while only the selected contralateral interior remains volumetric. Without this
        // panel-level override the visibility rule correctly removes the cortical volume,
        // but has no surface projection to replace it, which can look sign-specific when
        // one sign happens to be predominantly cortical.
        representation: 'surface',
        categories: null,
        anatomyCategories,
        voxelCategories: [`${cortexHemi}_cortex`, ...anatomyCategories],
        anatomyStyle: 'opaque',
    };
};
""",
    """// Cortex of one hemisphere + the CONTRALATERAL subcortex (left subcortex with the right
// hemisphere, and vice versa). This view filters which anatomical compartments are present; it
// does not change how the statistical map is represented. Blocky stays blocky, smooth stays
// smooth, and an explicitly selected surface overlay remains a surface overlay.
// Keep the category lists explicit: this view is deliberately asymmetric, so a single broad
// hemisphere/category filter cannot describe it without leaking the wrong cerebellar half.
const cortexSubcortContra = (cortexHemi, subHemi) => {
    const side = subHemi === 'lh' ? 'l' : 'r';
    const anatomyCategories = [`subcort_${side}`, `cereb_${side}`, 'brainstem'];
    return {
        roles: ['cortex', 'anatomy', 'voxel'],
        hemisphere: cortexHemi,
        anatomyHemisphere: subHemi,
        categories: null,
        anatomyCategories,
        voxelCategories: [`${cortexHemi}_cortex`, ...anatomyCategories],
        anatomyStyle: 'opaque',
    };
};
""",
)
replace_once(
    "comic/web/core/views.js",
    "// Each cortical surface is paired with the CONTRALATERAL subcortex; only surface paint and internal voxels remain.",
    "// Each cortical hemisphere is paired with the CONTRALATERAL subcortex; representation follows the overlay setting.",
)

replace_once(
    "comic/web/core/visibility.js",
    """const isAnatomyVoxel = (m) => m.role === 'voxel' && ANATOMY_VOXEL_CATEGORIES.has(m.category);
const isCorticalVoxel = (m) => m.role === 'voxel'
    && (m.category === 'lh_cortex' || m.category === 'rh_cortex');
""",
    """const isAnatomyVoxel = (m) => m.role === 'voxel' && ANATOMY_VOXEL_CATEGORIES.has(m.category);
""",
)
replace_once(
    "comic/web/core/visibility.js",
    """    // Paired cortex + contralateral-interior views use the cortical sheet as the
    // display surface and the selected internal hemisphere as the volumetric layer.
    // Keep a cortical surface projection (or a native surface map), but suppress the
    // blocky/smooth cortical volume that would otherwise sit behind the subcortex.
    const pairedInteriorView = c.anatomyStyle === 'opaque' && c.anatomyHemisphere
        && c.hemisphere && c.anatomyHemisphere !== c.hemisphere;
    if (pairedInteriorView && isCorticalVoxel(meshMeta) && meshMeta.variant !== 'surface') {
        return false;
    }

""",
    """    // Paired cortex + contralateral-interior views retain the overlay's requested
    // representation. The explicit category/hemisphere filters above select the allowed cortex
    // and interior, while the opaque anatomy depth wall handles front/back occlusion.

""",
)

replace_once(
    "comic/web/core/framing.js",
    """export function viewDepthRange(aabb, position, lookAt) {
    const fwd = normalize(sub(lookAt, position));
    const c = aabbCenter(aabb), he = aabbHalf(aabb);
    const depth = dot(sub(c, position), fwd);
    const halfD = projHalf(he, fwd);
    return { nearZ: depth - halfD, farZ: depth + halfD };
}

""",
    """export function viewDepthRange(aabb, position, lookAt) {
    const fwd = normalize(sub(lookAt, position));
    const c = aabbCenter(aabb), he = aabbHalf(aabb);
    const depth = dot(sub(c, position), fwd);
    const halfD = projHalf(he, fwd);
    return { nearZ: depth - halfD, farZ: depth + halfD };
}

/**
 * Exact view-space depth range of sampled WORLD positions for the current panel camera.
 * This avoids the empty-corner error of projecting an axis-aligned bounding box in an oblique
 * view. Re-evaluating the same samples against each panel pose makes the gate follow that panel's
 * live yaw/pitch/world-axis rotation.
 */
export function viewDepthRangeOfPositions(positions, position, lookAt) {
    const fwd = normalize(sub(lookAt, position));
    let nearZ = Infinity, farZ = -Infinity;
    for (let i = 0; i + 2 < positions.length; i += 3) {
        const d = (positions[i] - position[0]) * fwd[0]
            + (positions[i + 1] - position[1]) * fwd[1]
            + (positions[i + 2] - position[2]) * fwd[2];
        if (d < nearZ) nearZ = d;
        if (d > farZ) farZ = d;
    }
    return isFinite(nearZ) ? { nearZ, farZ } : null;
}

""",
)

replace_once(
    "comic/web/scene/renderer.js",
    "import { frameContent, mergeAABB, viewDepthRange } from '../core/framing.js';",
    "import { frameContent, mergeAABB, viewDepthRange, viewDepthRangeOfPositions } from '../core/framing.js';",
)
replace_once(
    "comic/web/scene/renderer.js",
    """    // Downsampled world voxel vertices, for anchoring the depth veil to the ACTUAL
    // nearest voxel (not a bounding-box corner that sits in empty space under tilt).
    scene.updateMatrixWorld(true);
    {
        const v = new THREE.Vector3();
        for (const tm of sceneModel.meshes) {
            if (tm.meta.role !== 'voxel') continue;
            const pos = tm.mesh.geometry.attributes.position, n = pos.count;
            const step = Math.max(1, Math.floor(n / 300));
            const pts = [];
            for (let i = 0; i < n; i += step) {
                v.fromBufferAttribute(pos, i).applyMatrix4(tm.mesh.matrixWorld);
                pts.push(v.x, v.y, v.z);
            }
            tm.depthSamples = new Float32Array(pts);
        }
    }
""",
    """    // Downsampled WORLD vertices for view-relative depth cues. Statistical samples
    // anchor the colour veil to real voxels. Cortex/anatomy samples anchor the hard depth gate to
    // real anatomical surfaces, so every panel (including a rotated Free Canvas panel) derives its
    // own near/far range along its current camera direction rather than from empty AABB corners.
    scene.updateMatrixWorld(true);
    {
        const v = new THREE.Vector3();
        const sampleWorld = (tm, target) => {
            const pos = tm.mesh.geometry.attributes.position;
            const n = pos ? pos.count : 0;
            if (!n) return new Float32Array();
            const step = Math.max(1, Math.ceil(n / target));
            const pts = [];
            const extrema = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity];
            const extremeIdx = new Int32Array(6).fill(-1);
            for (let i = 0; i < n; i++) {
                v.fromBufferAttribute(pos, i).applyMatrix4(tm.mesh.matrixWorld);
                if (i % step === 0) pts.push(v.x, v.y, v.z);
                if (v.x < extrema[0]) { extrema[0] = v.x; extremeIdx[0] = i; }
                if (v.x > extrema[1]) { extrema[1] = v.x; extremeIdx[1] = i; }
                if (v.y < extrema[2]) { extrema[2] = v.y; extremeIdx[2] = i; }
                if (v.y > extrema[3]) { extrema[3] = v.y; extremeIdx[3] = i; }
                if (v.z < extrema[4]) { extrema[4] = v.z; extremeIdx[4] = i; }
                if (v.z > extrema[5]) { extrema[5] = v.z; extremeIdx[5] = i; }
            }
            for (const i of new Set(extremeIdx)) {
                if (i < 0) continue;
                v.fromBufferAttribute(pos, i).applyMatrix4(tm.mesh.matrixWorld);
                pts.push(v.x, v.y, v.z);
            }
            return new Float32Array(pts);
        };
        for (const tm of sceneModel.meshes) {
            if (tm.meta.role === 'voxel') tm.depthSamples = sampleWorld(tm, 300);
            else if (tm.meta.role === 'cortex') tm.anatomyDepthSamples = sampleWorld(tm, 4096);
            else if (tm.meta.role === 'anatomy') tm.anatomyDepthSamples = sampleWorld(tm, 512);
        }
    }
""",
)
replace_once(
    "comic/web/scene/renderer.js",
    """    // The hard depth gate is relative to the visible anatomical shell, not to the overlay's own
    // nearest voxel. Thus a thalamus-only map remains deep in a dorsal view instead of redefining
    // itself as depth zero. Volume-only panels fall back to the panel content range below.
    function anatomicalDepthRange(content, position, lookAt) {
        const boxes = [];
        for (const tm of sceneModel.meshes) {
            if (tm.meta.role !== 'cortex' && tm.meta.role !== 'anatomy') continue;
            if (meshVisible(content, tm.meta)) boxes.push(tm.aabb);
        }
        return boxes.length ? viewDepthRange(mergeAABB(boxes), position, lookAt) : null;
    }
""",
    """    // The hard depth gate is relative to the visible anatomical shell, measured along THIS
    // panel's current camera direction. Thus a dorsal panel treats SMA as superficial and thalamus
    // as deep; rotating only that panel rotates the depth slab with it. Real sampled vertices avoid
    // an oblique AABB's empty-corner bias. Volume-only panels fall back to the panel range below.
    function anatomicalDepthRange(content, position, lookAt) {
        let nearZ = Infinity, farZ = -Infinity;
        const boxes = [];
        for (const tm of sceneModel.meshes) {
            if (tm.meta.role !== 'cortex' && tm.meta.role !== 'anatomy') continue;
            if (!meshVisible(content, tm.meta)) continue;
            boxes.push(tm.aabb);
            const r = tm.anatomyDepthSamples
                ? viewDepthRangeOfPositions(tm.anatomyDepthSamples, position, lookAt) : null;
            if (!r) continue;
            if (r.nearZ < nearZ) nearZ = r.nearZ;
            if (r.farZ > farZ) farZ = r.farZ;
        }
        if (isFinite(nearZ)) return { nearZ, farZ };
        return boxes.length ? viewDepthRange(mergeAABB(boxes), position, lookAt) : null;
    }
""",
)

replace_once(
    "comic/web/core/core.test.js",
    "import { aabbOfPositions, mergeAABB, frameContent } from './framing.js';",
    "import { aabbOfPositions, mergeAABB, frameContent, viewDepthRangeOfPositions } from './framing.js';",
)
replace_once(
    "comic/web/core/core.test.js",
    """test('aabb helpers merge correctly', () => {
    const a = aabbOfPositions(new Float32Array([0, 0, 0, 10, 0, 0]));
    const b = aabbOfPositions(new Float32Array([-5, 2, 0]));
    const m = mergeAABB([a, b]);
    assert.deepEqual(m.min, [-5, 0, 0]);
    assert.deepEqual(m.max, [10, 2, 0]);
});

""",
    """test('aabb helpers merge correctly', () => {
    const a = aabbOfPositions(new Float32Array([0, 0, 0, 10, 0, 0]));
    const b = aabbOfPositions(new Float32Array([-5, 2, 0]));
    const m = mergeAABB([a, b]);
    assert.deepEqual(m.min, [-5, 0, 0]);
    assert.deepEqual(m.max, [10, 2, 0]);
});

test('sampled anatomical depth follows each panel current viewing direction', () => {
    const pts = new Float32Array([
        0, 0, 70,
        0, 50, 0,
        0, 0, 0,
    ]);
    const dorsal = viewDepthRangeOfPositions(pts, [0, 0, 400], [0, 0, 0]);
    const anterior = viewDepthRangeOfPositions(pts, [0, 400, 0], [0, 0, 0]);
    assert.deepEqual(dorsal, { nearZ: 330, farZ: 400 });
    assert.deepEqual(anterior, { nearZ: 350, farZ: 400 });
    const oblique = viewDepthRangeOfPositions(pts, [0, 400, 400], [0, 0, 0]);
    assert.ok(oblique.nearZ < oblique.farZ);
    assert.notDeepEqual(oblique, dorsal);
    assert.notDeepEqual(oblique, anterior);
});

""",
)

p = Path("comic/web/core/core.test.js")
text = p.read_text()
start = text.index("test('paired cortex + contralateral-interior views keep surface paint and only internal volumes'")
end = text.index("\n// --- anatomical outline planning", start)
replacement = """test('paired cortex + contralateral-interior views retain the selected voxel representation', () => {
    const blocky = { voxel: { representation: 'blocky', subcortexRepresentation: 'blocky' } };
    const smooth = { voxel: { representation: 'smooth', subcortexRepresentation: 'smooth' } };
    const surface = { voxel: { representation: 'surface', subcortexRepresentation: 'blocky' } };
    for (const [view, cortexHemi, internalHemi, cortexCat, subCat, cerebCat, wrongSub, wrongCereb] of [
        ['cortex_subcort_l', 'lh', 'rh', 'lh_cortex', 'subcort_r', 'cereb_r', 'subcort_l', 'cereb_l'],
        ['cortex_subcort_r', 'rh', 'lh', 'rh_cortex', 'subcort_l', 'cereb_l', 'subcort_r', 'cereb_r'],
        ['cortex_subcort_lm', 'lh', 'rh', 'lh_cortex', 'subcort_r', 'cereb_r', 'subcort_l', 'cereb_l'],
        ['cortex_subcort_rm', 'rh', 'lh', 'rh_cortex', 'subcort_l', 'cereb_l', 'subcort_r', 'cereb_r'],
    ]) {
        const content = VIEWS[view].content;
        assert.equal(content.representation, undefined);
        assert.deepEqual(content.voxelCategories, [cortexCat, subCat, cerebCat, 'brainstem']);
        assert.deepEqual(content.anatomyCategories, [subCat, cerebCat, 'brainstem']);
        assert.equal(visible(content, { role: 'voxel', hemisphere: cortexHemi, category: cortexCat, variant: 'blocky' }, blocky), true);
        assert.equal(visible(content, { role: 'voxel', hemisphere: cortexHemi, category: cortexCat, variant: 'smooth' }, blocky), false);
        assert.equal(visible(content, { role: 'voxel', hemisphere: cortexHemi, category: cortexCat, variant: 'smooth' }, smooth), true);
        assert.equal(visible(content, { role: 'voxel', hemisphere: cortexHemi, category: cortexCat, variant: 'surface' }, surface), true);
        assert.equal(visible(content, { role: 'voxel', hemisphere: internalHemi, category: subCat, variant: 'blocky' }, blocky), true);
        assert.equal(visible(content, { role: 'voxel', hemisphere: internalHemi, category: subCat, variant: 'smooth' }, smooth), true);
        assert.equal(visible(content, { role: 'voxel', hemisphere: internalHemi, category: subCat, variant: 'blocky' }, surface), true);
        assert.equal(visible(content, { role: 'voxel', hemisphere: internalHemi, category: cerebCat, variant: 'blocky' }, blocky), true);
        assert.equal(visible(content, { role: 'anatomy', hemisphere: internalHemi, category: subCat }, blocky), true);
        assert.equal(visible(content, { role: 'anatomy', hemisphere: internalHemi, category: cerebCat }, blocky), true);
        assert.equal(visible(content, { role: 'voxel', hemisphere: internalHemi === 'lh' ? 'rh' : 'lh', category: wrongSub, variant: 'blocky' }, blocky), false);
        assert.equal(visible(content, { role: 'voxel', hemisphere: internalHemi === 'lh' ? 'rh' : 'lh', category: wrongCereb, variant: 'blocky' }, blocky), false);
        assert.equal(visible(content, { role: 'anatomy', hemisphere: internalHemi === 'lh' ? 'rh' : 'lh', category: wrongCereb }, blocky), false);
    }
});
"""
p.write_text(text[:start] + replacement + text[end:])
