/**
 * presets.js — named layout presets as plain config fragments. Pure.
 *
 * A preset only specifies `layout` (+ optional style tweaks); everything else
 * comes from DEFAULTS via normalizeConfig. The 4-panel default and the legacy
 * 9-panel view are expressed in the SAME vocabulary — no code branches on panel
 * identity, so both render identically in the browser and headlessly.
 */
import { normalizeConfig } from './config-schema.js';

const cortexVoxel = (hemisphere) => ({ roles: ['cortex', 'voxel'], hemisphere });
// Cortex panels share one world scale so each brain is the same physical size.
const SHARED = { fit: 'shared' };

export const FOUR_PANEL = {
    layout: {
        grid: { rows: 2, cols: 2, rowWeights: [1, 1], colWeights: [1, 1] },
        panels: [
            { id: 'L_lat', title: 'L Lateral', cell: { row: 0, col: 0 }, camera: { plane: 'left_lateral' },  content: cortexVoxel('lh'), framing: SHARED },
            { id: 'R_lat', title: 'R Lateral', cell: { row: 0, col: 1 }, camera: { plane: 'right_lateral' }, content: cortexVoxel('rh'), framing: SHARED },
            { id: 'L_med', title: 'L Medial',  cell: { row: 1, col: 0 }, camera: { plane: 'left_medial' },   content: cortexVoxel('lh'), framing: SHARED },
            { id: 'R_med', title: 'R Medial',  cell: { row: 1, col: 1 }, camera: { plane: 'right_medial' },  content: cortexVoxel('rh'), framing: SHARED },
        ],
    },
};

const subcort = (hemi, cats) => ({
    roles: ['anatomy', 'voxel'], hemisphere: hemi, categories: cats,
});

// 8-panel: cortex profile views on top, extras (anterior/dorsal/subcortical)
// below. 2×4 so every panel — including the axial Dorsal — gets a full cell.
export const NINE_PANEL = {
    layout: {
        grid: { rows: 2, cols: 4, rowWeights: [1, 1], colWeights: [1, 1, 1, 1] },
        panels: [
            { id: 'L_lat', title: 'L Lateral', cell: { row: 0, col: 0 }, camera: { plane: 'left_lateral' },  content: cortexVoxel('lh'), framing: SHARED },
            { id: 'R_lat', title: 'R Lateral', cell: { row: 0, col: 1 }, camera: { plane: 'right_lateral' }, content: cortexVoxel('rh'), framing: SHARED },
            { id: 'L_med', title: 'L Medial',  cell: { row: 0, col: 2 }, camera: { plane: 'left_medial' },   content: cortexVoxel('lh'), framing: SHARED },
            { id: 'R_med', title: 'R Medial',  cell: { row: 0, col: 3 }, camera: { plane: 'right_medial' },  content: cortexVoxel('rh'), framing: SHARED },
            { id: 'ant',   title: 'Anterior',  cell: { row: 1, col: 0 }, camera: { plane: 'anterior' },      content: cortexVoxel('both'), framing: SHARED },
            { id: 'dor',   title: 'Dorsal',    cell: { row: 1, col: 1 }, camera: { plane: 'dorsal' },        content: cortexVoxel('both'), framing: SHARED },
            { id: 'sub_l', title: 'Subcort L', cell: { row: 1, col: 2 }, camera: { plane: 'left_lateral' },  content: subcort('lh', ['subcort_l', 'cereb_l', 'brainstem']), anatomyOpacity: 0.55 },
            { id: 'sub_r', title: 'Subcort R', cell: { row: 1, col: 3 }, camera: { plane: 'right_lateral' }, content: subcort('rh', ['subcort_r', 'cereb_r', 'brainstem']), anatomyOpacity: 0.55 },
        ],
    },
};

// Overview: one of each canonical view — a lateral, anterior, dorsal, and medial.
export const OVERVIEW = {
    layout: {
        grid: { rows: 2, cols: 2, rowWeights: [1, 1], colWeights: [1, 1] },
        panels: [
            { id: 'L_lat', title: 'L Lateral', cell: { row: 0, col: 0 }, camera: { plane: 'left_lateral' },  content: cortexVoxel('lh'),   framing: SHARED },
            { id: 'ant',   title: 'Anterior',  cell: { row: 0, col: 1 }, camera: { plane: 'anterior' },      content: cortexVoxel('both'), framing: SHARED },
            { id: 'dor',   title: 'Dorsal',    cell: { row: 1, col: 0 }, camera: { plane: 'dorsal' },        content: cortexVoxel('both'), framing: SHARED },
            { id: 'R_med', title: 'R Medial',  cell: { row: 1, col: 1 }, camera: { plane: 'right_medial' },  content: cortexVoxel('rh'),   framing: SHARED },
        ],
    },
};

// Default Free Canvas figure: L Lateral, R Medial (orbited), Anterior, Dorsal in a
// free arrangement. Authored in the editor; this is the boot default. The `style`
// carries only the global cosmetic look (the per-overlay data styling is left to
// whatever NIfTIs get loaded, so the bundled demo still renders correctly).
export const FREE_DEFAULT = {
    layout: {
        mode: 'free',
        grid: { rows: 2, cols: 4, rowWeights: [1, 1], colWeights: [1, 1, 1, 1] },
        canvas: { w: 1890, h: 676, bgAlpha: 1 },
        panels: [
            { id: 'fc1', framing: { fit: 'auto', margin: 1.1 }, camera: { plane: 'left_lateral' }, content: { roles: ['cortex', 'voxel'], hemisphere: 'lh' }, title: 'L Lateral', view: 'left_lateral', anatomyOpacity: null, place: { x: 0.1973, y: 0.0355, w: 0.2904, h: 0.3905, z: 0 } },
            { id: 'fc4', framing: { fit: 'auto', margin: 1.1 }, camera: { plane: 'right_medial' }, content: { roles: ['cortex', 'voxel'], hemisphere: 'rh' }, title: 'R Medial', view: 'right_medial', anatomyOpacity: null, place: { x: 0.3342, y: 0.3787, w: 0.4329, h: 0.5089, z: 3 }, rotate: { yaw: 330, pitch: 0, roll: -15 } },
            { id: 'fc6', framing: { fit: 'auto', margin: 1.1 }, camera: { plane: 'anterior' }, content: { roles: ['cortex', 'voxel'], hemisphere: 'both' }, title: 'Anterior', view: 'anterior', anatomyOpacity: null, place: { x: 0.4164, y: 0.0118, w: 0.3178, h: 0.4615, z: 4 }, rotate: { yaw: 0, pitch: 0, roll: 0 } },
            { id: 'fc7', framing: { fit: 'auto', margin: 1.1 }, camera: { plane: 'dorsal' }, content: { roles: ['cortex', 'voxel'], hemisphere: 'both' }, title: 'Dorsal', view: 'dorsal', anatomyOpacity: null, place: { x: 0.1651, y: 0.3669, w: 0.3945, h: 0.6036, z: 5 } },
        ],
    },
    style: { cortexSurface: 'pial', margin: 0.95, glass: { maxOpacity: 0.09 }, outline: { width: 3.5 } },
};

export const PRESETS = { freeDefault: FREE_DEFAULT, fourPanel: FOUR_PANEL, ninePanel: NINE_PANEL, overview: OVERVIEW };

/** Resolve a preset name or a raw config object → a normalized config. */
export function resolveConfig(nameOrConfig, overrides = {}) {
    const base = typeof nameOrConfig === 'string'
        ? (PRESETS[nameOrConfig] || (() => { throw new Error(`Unknown preset: ${nameOrConfig}`); })())
        : (nameOrConfig || FOUR_PANEL);
    // merge order: preset, then overrides (overrides win)
    return normalizeConfig(mergeRaw(base, overrides));
}

function mergeRaw(a, b) {
    // shallow-ish merge sufficient for {layout, style} fragments
    return {
        ...a, ...b,
        layout: b.layout ?? a.layout,
        style: { ...(a.style || {}), ...(b.style || {}) },
    };
}
