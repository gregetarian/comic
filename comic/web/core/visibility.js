/**
 * visibility.js — declarative per-panel mesh visibility. Pure.
 *
 * Replaces the tangled categoryVisible/applyVisibility boolean logic. A panel
 * declares WHAT it contains (roles, hemisphere, categories, representation);
 * this answers, per mesh, whether it shows. Because hemisphere is a first-class
 * filter, the "far hemisphere bleeds through the lateral view" bug is impossible.
 *
 * meshMeta = { role:'cortex'|'anatomy'|'voxel', hemisphere:'lh'|'rh'|'mid'|null,
 *              structure, category, variant:'blocky'|'smooth'|'surface'|null }
 * panelContent = { roles:[...], hemisphere:'lh'|'rh'|'both', categories:null|[...],
 *                  anatomyCategories:null|[...], voxelCategories:null|[...],
 *                  representation:null|'blocky'|'smooth'|'surface' }
 */

const ANATOMY_VOXEL_CATEGORIES = new Set([
    'subcort_l', 'subcort_r', 'cereb_l', 'cereb_r', 'brainstem',
]);
const isAnatomyVoxel = (m) => m.role === 'voxel' && ANATOMY_VOXEL_CATEGORIES.has(m.category);

export function visible(panelContent, meshMeta, style = {}) {
    const c = panelContent || {};
    const followsAnatomy = meshMeta.role === 'anatomy' || isAnatomyVoxel(meshMeta);

    // role gate
    if (c.roles && !c.roles.includes(meshMeta.role)) return false;

    // category gate (e.g. a subcortical panel limited to subcort_l/cereb_l/brainstem)
    if (c.categories && meshMeta.category && !c.categories.includes(meshMeta.category)) {
        return false;
    }
    // Paired cortex+interior views are intentionally asymmetric. These role-specific gates
    // encode the exact allowed structures (e.g. left cortex + right subcortex/cerebellum),
    // instead of trusting a broad hemisphere tag to imply the intended combination.
    if (c.anatomyCategories && followsAnatomy && meshMeta.category
        && !c.anatomyCategories.includes(meshMeta.category)) return false;
    if (c.voxelCategories && meshMeta.role === 'voxel' && meshMeta.category
        && !c.voxelCategories.includes(meshMeta.category)) return false;

    // Hemisphere gate — midline structures (brainstem) are exempt. Anatomy AND voxels classified
    // inside that anatomy share anatomyHemisphere, so a right cortical half paired with the left
    // subcortex cannot accidentally colour the right subcortex. Cortical voxels continue to follow
    // the displayed cortex hemisphere.
    const hemi = (followsAnatomy && c.anatomyHemisphere)
        ? c.anatomyHemisphere : (c.hemisphere || 'both');
    if (hemi !== 'both' && meshMeta.hemisphere && meshMeta.hemisphere !== 'mid'
        && meshMeta.hemisphere !== hemi) {
        return false;
    }

    // variant gate: voxels (blocky/smooth) and cortex (pial/inflated) each keep
    // both variants loaded; only the active one shows.
    if (meshMeta.variant) {
        if (meshMeta.role === 'voxel') {
            // A native surface overlay has no blocky/smooth variant — force its 'surface' gate so it
            // always shows, regardless of the panel/global representation (which may be blocky/smooth).
            const requested = meshMeta.surfaceOnly ? 'surface'
                : (c.representation || (style.voxel && style.voxel.representation) || 'blocky');
            // Only cortical voxels can be projected onto a cortical surface. In surface mode keep
            // anatomy-classified voxels volumetric, smooth by default (or blocky when selected).
            const rep = requested === 'surface' && isAnatomyVoxel(meshMeta)
                ? ((style.voxel && style.voxel.subcortexRepresentation) || 'smooth')
                : requested;
            if (meshMeta.variant !== rep) return false;
        } else if (meshMeta.role === 'cortex') {
            const surf = c.surface || style.cortexSurface || 'pial';
            if (surf === 'hidden') return false;
            if (meshMeta.variant !== surf) return false;
        }
    }

    return true;
}
