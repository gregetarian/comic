/**
 * config-schema.js — the single source of truth for a viewer config. Pure.
 *
 * normalizeConfig(raw) deep-merges `raw` over DEFAULTS and validates a few
 * load-bearing invariants. The result is a plain JSON-serializable object that
 * drives BOTH the browser and the headless renderer.
 */

import { VIEWS } from './views.js';

export const DEFAULTS = {
    version: '2.0',
    // Template / space (M2). 'mni' = the bundled fsaverage; 'custom' = a user template dir
    // (M9); 'none' = render the volume in its own space with no anatomical shell (M7). The
    // baked scene.json.templateMode mirrors this and gates the view vocabulary.
    template: { kind: 'mni', dir: null, space: 'MNI152' },   // kind: 'mni' | 'custom' | 'none'
    data: { manifest: 'scene.json', colormaps: 'colormaps.json' },
    render: {
        width: 1600, height: 1200, pixelRatio: 2, background: '#ffffff',
        colorbar: true,
        // Colorbar tick font — Computer Modern (LaTeX roman) by default, serif fallback.
        colorbarFont: 'Computer Modern Serif, CMU Serif, Latin Modern Roman, serif',
        colorbarFontSize: 11,
    },
    style: {
        colormap: 'YlGnBu',
        colormapMode: 'auto',     // 'auto' | 'diverging' | 'sequential'
        threshold: null,          // null = use manifest threshold
        positiveOnly: false,
        gamma: 0.5,
        // Colour limit (M2): null = derive from data (meta.maxAbsValue, the 99th pct). A
        // [vmin,vmax] pair sets it explicitly; a bare scalar v means symmetric [-v,v] when the
        // resolved mode is diverging, else [0,v]. Per-overlay override via overlays[i].clim.
        clim: null,
        // Units (M2): how thresholds / clim / cluster sizes read. value = the stat shown on the
        // colorbar ('stat' | 'z' | 't' | ...); cluster = 'voxels' (default) or 'mm3'.
        units: { value: 'stat', cluster: 'voxels' },
        // Global framing tightness: <1 packs brains closer (driver view fills its
        // cell at this fraction). 0.95 = snug; 1.0 = no padding; 1.06 = old roomy.
        margin: 0.95,
        cortexSurface: 'inflated', // 'pial' | 'inflated'
        voxel: {
            representation: 'smooth', // 'blocky' (voxelwise) | 'smooth' | 'surface' (project onto the cortex, M8)
            // Surface projection exists only for the cortex. Subcortical/cerebellar/brainstem
            // activations remain volumetric in surface mode, using this representation.
            subcortexRepresentation: 'smooth', // 'smooth' (default) | 'blocky'
            clusterMin: 0,            // no cluster-extent filtering unless the user requests it
            smoothing: 0,             // extra Taubin smoothing iterations on the 'smooth' (0.5mm-grid) mesh; 0 = off
            shininess: 200,
            specular: 0.0,   // light-independent glint amount (slider 0..0.6); off = flat matte
            emissive: 1.0,   // full flat colormap colour (scene lights are 0 by default)
            surfaceDepth: 6, // M2: K depth samples pial->white when representation === 'surface' (M8)
            // Surface mode: colour for cortex BELOW threshold. null = discard it so the glass
            // shell shows through (the glass-brain look for a stat map). A colour makes the sheet
            // solid, which is what an atlas figure wants — an unpainted medial wall is then a grey
            // surface rather than a hole you can see the far side of the hemisphere through.
            surfaceBase: null,
            veil: { strength: 0.0, k: 7.4, color: '#ffffff' },   // depth veil OFF by default; raise to fade deep voxels
            // Blob translucency. 1 = the opaque, self-occluding default. Below 1 the voxels stop
            // writing depth so you can genuinely see through them; that necessarily gives up exact
            // front/back sorting between overlapping blobs (the depth veil is the order-independent
            // depth cue and is unaffected).
            opacity: 1.0,
            edges: { enabled: true, color: '#808080', opacity: 1.0, width: 1.9, threshold: 0.003 },
        },
        // Per-NIfTI overrides. Each entry overrides the voxel/colour fields above
        // for one overlay (by index); empty/absent → inherit the globals. The GUI
        // renders one control row per entry; the CLI usually has a single overlay.
        overlays: [],
        glass: { color: '#ffffff', maxOpacity: 0.0, minOpacity: 0.0, fresnelPower: 2.5, celBands: 3 },
        anatomy: { color: '#ffffff', maxOpacity: 0.14, opacity: 1.0 },
        // Higher threshold = fewer/weaker cortex lines (less sulcal density). anatomyWidthMul
        // scales the SUBCORTEX outline (its own pass) relative to the cortex line — 1.0 = uniform
        // with the cortex; set <1 to thin the densely-packed subcortical structures if desired.
        // overVoxels: when true the black cortex outline is drawn over the (opaque) voxels instead
        // of being masked where a blob sits in front. overVoxelOpacity (0..1) is the stroke strength
        // for the buried portion: 1 = full black on top, <1 = a muted/greyed stroke that blends with
        // the voxel it crosses (so the line reads as passing under the blob). Default false = the
        // depth-correct look (voxels occlude the lines behind them).
        // anatomyColor: null = the subcortex line inherits `color`; set it to stroke the subcortical
        // structures in their own colour. silhouette controls the OUTER contours of the cortex and
        // subcortex as separate anatomical groups. Statistical overlays never define either contour,
        // so a thick silhouette cannot follow a jagged voxel blob. `color`/`width` null means "inherit
        // from the fold lines"; with folds on, each anatomical pass draws its folds and contour together.
        outline: { enabled: true, color: '#000000', width: 7.0, threshold: 0.018, anatomyWidthMul: 1.0,
            overVoxels: true, overVoxelOpacity: 0.4, anatomyColor: null,
            silhouette: { enabled: true, color: null, width: null } },
        // Parcellation boundary lines (atlas borders drawn on the cortical surface). `atlas` names a
        // baked/fetched per-vertex label set; width is in device px and is constant at any zoom.
        // The contour is always smoothed by a fixed amount — see scene/parcellation.js for why that
        // is not a parameter and is never done by relabelling vertices.
        // maskMedialWall hides surface vertices the atlas marks as non-cortex, so a map that
        // carries values there (most whole-surface analyses do) does not paint the wall.
        parcellation: { enabled: false, atlas: null, color: '#1a1a1a', width: 2.0, opacity: 1.0,
            medialWall: true, maskMedialWall: false, maskColor: null },
        // Scene lights off by default — voxel colour comes from emissive (full flat
        // colormap) + the light-independent glint, so the colours stay saturated.
        lighting: { directional: 0, ambient: 0, headlight: true },
        // Slight oblique tilt of every view (degrees) — a depth cue without full
        // perspective; keeps a right-handed basis so lighting stays correct.
        tilt: { azimuth: 8, elevation: 6 },
        // Scissor cut-cap: when true, a panel with a slice paints the anatomical (T1) cross-section
        // on the exposed cut face — white/gray matter, like a coronal MRI. Loads a small volume
        // asset (bake_anatomy) on demand. Off by default (unsliced/most figures are unaffected).
        sliceAnatomy: false,
        // Statistical values on that same exposed face. The source NIfTI grid is retained in a
        // compact world-registered texture; a thin max-absolute slab makes oblique cuts legible.
        // This is deliberately independent of the ordinary blocky/smooth/surface representation.
        cutOverlay: { enabled: false, slabMm: 1, interpolation: 'linear', opacity: 0.88 },
        // Inter-voxel shadows (clusters casting onto each other). Off by default —
        // the depth veil + voxel edges carry the depth cue without darkening
        // clusters where they overlap. Re-enable with --shadows.
        shadows: { enabled: false, offset: 0.30, mapSize: 1024 },
    },
    layout: {
        // 'grid' (default) = panels positioned by grid cells; 'free' = Free Canvas,
        // panels positioned by per-panel `place` fractions (see normalizeConfig).
        mode: 'grid',
        grid: { rows: 2, cols: 2, rowWeights: [1, 1], colWeights: [1, 1] },
        // Free-canvas reference design space. w/h pin the aspect the `place` fractions
        // were authored against (so the CLI reproduces identical RELATIVE geometry at
        // any --width/--height); bgAlpha 0..1 is the canvas background opacity (1 = opaque).
        canvas: { w: 1600, h: 1000, bgAlpha: 1 },
        // Whole-canvas pan/zoom (M2). Identity by default so every existing grid render is
        // byte-identical (headless pins s=1); round-trips through buildSpec for Copy-CLI/--spec.
        view: { s: 1, cx: null, cy: null },
        panels: [],
    },
};

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);

/**
 * Resolve the effective voxel/colour style for overlay `i`: the per-overlay
 * overrides in `style.overlays[i]` merged over the global `style` template.
 * Single source of truth so the renderer, colorbar, and controls agree.
 */
export function overlayStyle(config, i = 0) {
    const s = config.style || {};
    const v = s.voxel || {};
    const o = (s.overlays && s.overlays[i]) || {};
    const ov = o.voxel || {};
    return {
        colormap: o.colormap ?? s.colormap,
        colormapMode: o.colormapMode ?? s.colormapMode,
        threshold: o.threshold ?? s.threshold,
        positiveOnly: o.positiveOnly ?? s.positiveOnly,
        gamma: o.gamma ?? s.gamma,
        clim: o.clim ?? s.clim,
        units: { ...(s.units || {}), ...(o.units || {}) },
        representation: ov.representation ?? v.representation,
        subcortexRepresentation: ov.subcortexRepresentation ?? v.subcortexRepresentation,
        clusterMin: ov.clusterMin ?? v.clusterMin,
        opacity: ov.opacity ?? v.opacity,
        smoothing: ov.smoothing ?? v.smoothing,
        shininess: ov.shininess ?? v.shininess,
        specular: ov.specular ?? v.specular,
        emissive: ov.emissive ?? v.emissive,
        surfaceDepth: ov.surfaceDepth ?? v.surfaceDepth,
        surfaceBase: ov.surfaceBase ?? v.surfaceBase,
        veil: { ...(v.veil || {}), ...(ov.veil || {}) },
        // Voxel edges default OFF in surface mode. The edge pass finds depth steps in VOXEL
        // geometry; a continuous cortical sheet has none, so it just traces the threshold boundary
        // and usually reads as noise. A per-overlay setting still wins, so the Edges button (which
        // writes per-overlay) turns them back on for anyone who wants that outline.
        edges: (() => {
            const e = { ...(v.edges || {}), ...(ov.edges || {}) };
            const rep = ov.representation ?? v.representation;
            if (rep === 'surface' && ov.edges?.enabled === undefined) e.enabled = false;
            return e;
        })(),
        cutOverlay: { ...(s.cutOverlay || {}), ...(o.cutOverlay || {}) },
    };
}

/** Mutate config.style.overlays[i] with a (possibly nested) override patch. */
export function setOverlayStyle(config, i, patch) {
    const arr = (config.style.overlays ||= []);
    while (arr.length <= i) arr.push({});
    arr[i] = deepMerge(arr[i] || {}, patch);
    return arr[i];
}

/** Deep-merge `src` onto a clone of `base` (arrays replace, objects merge). */
export function deepMerge(base, src) {
    const out = Array.isArray(base) ? base.slice() : { ...base };
    if (!isObj(src)) return src === undefined ? out : src;
    for (const [k, v] of Object.entries(src)) {
        out[k] = isObj(v) && isObj(out[k]) ? deepMerge(out[k], v) : (Array.isArray(v) ? v.slice() : v);
    }
    return out;
}

const ROLES = new Set(['cortex', 'anatomy', 'voxel']);
const HEMI = new Set(['lh', 'rh', 'both']);
const REPRESENTATIONS = new Set(['blocky', 'smooth', 'surface']);   // M2 (+ 'surface' for M8)
const VOLUME_REPRESENTATIONS = new Set(['blocky', 'smooth']);
const TEMPLATE_KINDS = new Set(['mni', 'custom', 'none']);          // M2

// clim: null | a single number | a [vmin, vmax] pair with vmin < vmax.
const climOk = (c) => c == null || typeof c === 'number'
    || (Array.isArray(c) && c.length === 2 && typeof c[0] === 'number' && typeof c[1] === 'number' && c[0] < c[1]);
const repOk = (r) => r == null || REPRESENTATIONS.has(r);
const volumeRepOk = (r) => r == null || VOLUME_REPRESENTATIONS.has(r);
// Line colours are validated (unlike the older style fields) because a typo'd colour renders as
// black with no clue why — and a whole figure's line-art hangs on them. Absent (null/undefined)
// always passes: validateConfig also runs on partial, un-normalised configs, and a missing field
// simply means "inherit", exactly as climOk/repOk/cutOk treat theirs.
const colorOk = (c) => c == null || (typeof c === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(c));
const widthOk = (w) => w == null || (typeof w === 'number' && w > 0);
const alphaOk = (a) => a == null || (typeof a === 'number' && a >= 0 && a <= 1);
const parcOk = (p) => !p || (colorOk(p.color) && widthOk(p.width)
    && (p.opacity == null || (typeof p.opacity === 'number' && p.opacity >= 0 && p.opacity <= 1)));
const cutOk = (c) => !c || ((c.interpolation == null || c.interpolation === 'linear' || c.interpolation === 'nearest')
    && (c.slabMm == null || (typeof c.slabMm === 'number' && c.slabMm >= 0))
    && (c.opacity == null || (typeof c.opacity === 'number' && c.opacity >= 0 && c.opacity <= 1)));

export function validateConfig(cfg) {
    const errors = [];
    const kind = cfg.template?.kind ?? 'mni';
    if (!TEMPLATE_KINDS.has(kind)) errors.push(`template.kind must be one of ${[...TEMPLATE_KINDS].join('/')}, got '${kind}'`);
    const noTemplate = kind === 'none';
    if (!climOk(cfg.style?.clim)) errors.push('style.clim must be null, a number, or [vmin, vmax] with vmin < vmax');
    if (!repOk(cfg.style?.voxel?.representation)) errors.push(`style.voxel.representation must be one of ${[...REPRESENTATIONS].join('/')}`);
    if (!volumeRepOk(cfg.style?.voxel?.subcortexRepresentation))
        errors.push(`style.voxel.subcortexRepresentation must be one of ${[...VOLUME_REPRESENTATIONS].join('/')}`);
    if (!cutOk(cfg.style?.cutOverlay)) errors.push('style.cutOverlay needs interpolation linear/nearest, slabMm >= 0, and opacity 0..1');
    if (!colorOk(cfg.style?.outline?.color)) errors.push('style.outline.color must be a #rgb/#rrggbb colour');
    if (!colorOk(cfg.style?.outline?.anatomyColor)) errors.push('style.outline.anatomyColor must be null or a #rgb/#rrggbb colour');
    if (!colorOk(cfg.style?.outline?.silhouette?.color)) errors.push('style.outline.silhouette.color must be null or a #rgb/#rrggbb colour');
    if (!widthOk(cfg.style?.outline?.silhouette?.width)) errors.push('style.outline.silhouette.width must be null or a positive number');
    if (!parcOk(cfg.style?.parcellation)) errors.push('style.parcellation needs a #rgb/#rrggbb color, width > 0, and opacity 0..1');
    if (!alphaOk(cfg.style?.voxel?.opacity)) errors.push('style.voxel.opacity must be 0..1');
    if (!alphaOk(cfg.style?.voxel?.edges?.opacity)) errors.push('style.voxel.edges.opacity must be 0..1');
    (cfg.style?.overlays || []).forEach((o, i) => {
        if (!o) return;
        if (!climOk(o.clim)) errors.push(`style.overlays[${i}].clim invalid (null | number | [vmin<vmax])`);
        if (!repOk(o.voxel?.representation)) errors.push(`style.overlays[${i}].voxel.representation invalid`);
        if (!volumeRepOk(o.voxel?.subcortexRepresentation))
            errors.push(`style.overlays[${i}].voxel.subcortexRepresentation invalid`);
        if (!cutOk(o.cutOverlay)) errors.push(`style.overlays[${i}].cutOverlay invalid`);
    });
    const panels = cfg.layout?.panels || [];
    if (!Array.isArray(panels) || panels.length === 0) errors.push('layout.panels must be a non-empty array');
    panels.forEach((p, i) => {
        if (!p.id) errors.push(`panel[${i}] missing id`);
        if (!p.camera) errors.push(`panel[${i}] (${p.id}) missing camera`);
        // A panel is positioned EITHER by a grid cell (grid mode) OR by a free-canvas
        // `place` rectangle (free mode) — exactly one, never both, never neither.
        const hasCell = p.cell && p.cell.row != null && p.cell.col != null;
        const hasPlace = p.place && p.place.w != null && p.place.h != null;
        if (hasCell === hasPlace) errors.push(`panel[${i}] (${p.id}) needs exactly one of cell {row,col} or place {x,y,w,h}`);
        const content = p.content || {};
        (content.roles || []).forEach((r) => { if (!ROLES.has(r)) errors.push(`panel ${p.id}: bad role '${r}'`); });
        if (content.hemisphere && !HEMI.has(content.hemisphere)) errors.push(`panel ${p.id}: bad hemisphere '${content.hemisphere}'`);
        if (content.anatomyHemisphere && !HEMI.has(content.anatomyHemisphere)) errors.push(`panel ${p.id}: bad anatomy hemisphere '${content.anatomyHemisphere}'`);
        for (const key of ['categories', 'anatomyCategories', 'voxelCategories']) {
            if (content[key] != null && (!Array.isArray(content[key]) || content[key].some((x) => typeof x !== 'string')))
                errors.push(`panel ${p.id}: ${key} must be null or an array of category names`);
        }
        if (!repOk(content.representation)) errors.push(`panel ${p.id}: bad representation '${content.representation}'`);
        // 'none' mode has no shell and no hemisphere split: reject cortex/anatomy roles and L/R-only views.
        if (noTemplate) {
            if ((content.roles || []).some((r) => r === 'cortex' || r === 'anatomy'))
                errors.push(`panel ${p.id}: template.kind 'none' has no cortex/anatomy shell — use roles ['voxel']`);
            if (content.hemisphere === 'lh' || content.hemisphere === 'rh')
                errors.push(`panel ${p.id}: template.kind 'none' has no hemisphere split — use hemisphere 'both'`);
        }
    });
    return { ok: errors.length === 0, errors };
}

/** Merge over defaults, fill panel defaults, validate. Throws on invalid. */
export function normalizeConfig(raw = {}) {
    const cfg = deepMerge(DEFAULTS, raw);
    cfg.layout.panels = (cfg.layout.panels || []).map((p) => {
        // A stored `view` is the semantic source of truth. Refresh its load-bearing content fields
        // from the current vocabulary so old saved Free Canvas layouts cannot display the new view
        // name while silently retaining the pre-fix same-side voxel pairing.
        const named = p.view && VIEWS[p.view];
        const oldContent = p.content || {};
        const panelContent = named ? {
            ...named.content,
            // These are genuine per-panel choices rather than anatomical-view semantics.
            ...(oldContent.surface != null ? { surface: oldContent.surface } : {}),
            ...(oldContent.representation != null ? { representation: oldContent.representation } : {}),
        } : oldContent;
        const panelCamera = named ? { ...(p.camera || {}), plane: named.plane } : p.camera;
        return {
            rowSpan: 1, colSpan: 1,
            anatomyOpacity: null,
            // M2: declared per-panel fields the engine already reads — now defaulted so they
            // round-trip losslessly through buildSpec (identity values change no render).
            zoom: 1, rotate: null, slice: null, outline: null,
            framing: { margin: 1.06, fit: 'auto' },
            ...p,
            camera: panelCamera,
            content: { roles: ['cortex', 'voxel'], hemisphere: 'both', categories: null,
                anatomyCategories: null, voxelCategories: null, representation: null,
                surface: null, anatomyStyle: 'glass', anatomyHemisphere: null, ...panelContent },
            framing: { margin: 1.06, fit: 'auto', ...(p.framing || {}) },
        };
    });
    const { ok, errors } = validateConfig(cfg);
    if (!ok) throw new Error('Invalid config:\n  ' + errors.join('\n  '));
    return cfg;
}
