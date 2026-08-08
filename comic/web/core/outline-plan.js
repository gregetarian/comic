/**
 * outline-plan.js — pure outline pass planning.
 *
 * Cortex and subcortex are anatomical groups with independent depth fields. A
 * separately styled silhouette therefore runs once for each group, never over
 * the union of anatomy and statistical overlays. This keeps thick contours on
 * the anatomy and prevents voxel geometry from becoming the figure outline.
 */

/** Resolve the per-panel outline passes from the global style. */
export function outlinePlan(outline = {}, panelOutline = null) {
    const sil = outline.silhouette || {};
    const folds = outline.enabled !== false;
    const silhouettes = sil.enabled !== false;
    const inheritsLook = sil.color == null && sil.width == null;
    const splitSilhouettes = silhouettes && (!folds || !inheritsLook);
    const widthMul = panelOutline?.widthMul || 1;
    const thresholdMul = panelOutline?.thresholdMul || 1;
    const anatomyMul = outline.anatomyWidthMul ?? 1;
    const foldWidth = (outline.width ?? 1.5) * widthMul;
    const silhouetteWidth = (sil.width ?? outline.width ?? 1.5) * widthMul;

    return {
        folds,
        splitSilhouettes,
        // Combined pass when silhouette inherits the fold style. Otherwise the
        // fold pass excludes background-touching edges and the group-specific
        // silhouette pass owns them. A disabled silhouette also means folds only.
        foldBgMode: folds && silhouettes && !splitSilhouettes ? 0 : 1,
        threshold: (outline.threshold ?? 0.004) * thresholdMul,
        cortexFold: {
            color: outline.color ?? '#000000',
            width: foldWidth,
        },
        anatomyFold: {
            color: outline.anatomyColor ?? outline.color ?? '#000000',
            width: foldWidth * anatomyMul,
        },
        cortexSilhouette: {
            color: sil.color ?? outline.color ?? '#000000',
            width: silhouetteWidth,
        },
        anatomySilhouette: {
            color: sil.color ?? outline.anatomyColor ?? outline.color ?? '#000000',
            width: silhouetteWidth * anatomyMul,
        },
    };
}
