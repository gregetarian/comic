/**
 * mesh-meta.js — pure mesh taxonomy + render-layer assignment. No THREE, no DOM.
 *
 * Two concerns, both previously embedded (and untested) in scene/asset-loader.js
 * and scene/renderer.js:
 *   - taxonomy: derive a mesh's hemisphere from its category, and a subcortical
 *     structure's category from its FreeSurfer-style name (L-/R- prefixes, Cerebellum,
 *     Brainstem).
 *   - layers: the multi-layer scheme the engine renders + strokes into. Cortex owns
 *     layer 0; each overlay i owns layer 1+i; the subcortical shell owns a SEPARATE
 *     layer past the overlays (N+1) so it can carry its own outline pass. renderOrder
 *     matches the original inline literals (cortex 1, anatomy 5, voxel 15).
 */

/** Hemisphere ('lh' | 'rh' | 'mid') from a category tag. Midline (brainstem) → 'mid'. */
export function hemiOfCategory(cat) {
    if (cat.endsWith('_l') || cat === 'lh_cortex') return 'lh';
    if (cat.endsWith('_r') || cat === 'rh_cortex') return 'rh';
    return 'mid'; // brainstem
}

/** Category tag from a subcortical structure name (L-/R- prefix, Cerebellum, Brainstem). */
export function categoryOfStructure(name) {
    const cereb = name.includes('Cerebellum');
    if (name === 'Brainstem') return 'brainstem';
    if (name.startsWith('L-')) return cereb ? 'cereb_l' : 'subcort_l';
    if (name.startsWith('R-')) return cereb ? 'cereb_r' : 'subcort_r';
    return 'brainstem';
}

/** The subcortex shell's own layer (past the N overlay layers) — carries a separate outline pass. */
export const anatomyLayer = (N) => N + 1;
/** Overlay i's own layer (each overlay is stroked + depth-clipped independently). */
export const overlayLayer = (overlayIndex) => 1 + overlayIndex;

/**
 * Render layer + renderOrder for a mesh, from its role. N = overlay count.
 *   cortex  → layer 0,   renderOrder 1
 *   anatomy → layer N+1, renderOrder 5
 *   voxel   → layer 1+i, renderOrder 15   (i = meta.overlay ?? 0)
 */
export function meshLayer(meta, N) {
    if (meta.role === 'cortex') return { layer: 0, renderOrder: 1 };
    if (meta.role === 'anatomy') return { layer: anatomyLayer(N), renderOrder: 5 };
    return { layer: overlayLayer(meta.overlay ?? 0), renderOrder: 15 };
}
