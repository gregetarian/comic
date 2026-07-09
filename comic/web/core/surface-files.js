/**
 * surface-files.js — pure upload-file routing. No DOM, no THREE.
 *
 * Splits dropped/selected files into NIfTI volumes vs native fsaverage SURFACE maps
 * (per-vertex .gii/.mgh/.mgz, or an extension-less FreeSurfer morph file whose name
 * carries an lh/rh marker), and pairs surface files into lh/rh overlays by filename.
 */

export const VOL_RE = /\.nii(\.gz)?$|\.gz$/i;
const SURF_EXT_RE = /\.(gii|mgh|mgz)$/i;
const HEMI_RE = /(^|[._-])(lh|rh)([._-]|$)|hemi-[lr](?![a-z])/i;   // \b fails before '_' (a word char)

/** True for a native surface map: a surface extension, or an lh/rh-marked non-NIfTI (morph). */
export function isSurfaceFile(name) {
    if (SURF_EXT_RE.test(name)) return true;
    return HEMI_RE.test(name) && !VOL_RE.test(name);
}

/** 'lh' | 'rh' | null from a filename (lh/rh tokens or BIDS hemi-L/hemi-R). */
export function detectHemi(name) {
    const n = name.toLowerCase();
    if (/(^|[._-])lh([._-]|$)/.test(n) || /hemi-l(?![a-z])/.test(n)) return 'lh';
    if (/(^|[._-])rh([._-]|$)/.test(n) || /hemi-r(?![a-z])/.test(n)) return 'rh';
    return null;
}

/** Hemi-stripped base name — lh.X.gii and rh.X.gii share a key so they pair. */
function pairKey(name) {
    return name.toLowerCase()
        .replace(/(^|[._-])(lh|rh)([._-]|$)/, '$1$3').replace(/hemi-[lr]\b/, 'hemi')
        .replace(SURF_EXT_RE, '').replace(/[._-]+/g, '.');
}

/** A display name for a surface overlay: strip the surface extension + lh/rh marker. */
export function surfaceOverlayName(g) {
    const src = (g.lh || g.rh).name;
    return src.replace(SURF_EXT_RE, '').replace(/(^|[._-])(lh|rh)([._-]|$)/i, '$1')
        .replace(/^[._-]+|[._-]+$/g, '') || 'surface';
}

/** Group surface files into { lh, rh } pairs by base name. A file with no detectable
 *  hemisphere (or a lone hemisphere) goes into the lh slot (rendered as a single hemi). */
export function groupSurfaceFiles(files) {
    const groups = new Map();
    for (const f of files) {
        const key = pairKey(f.name);
        if (!groups.has(key)) groups.set(key, { lh: null, rh: null });
        const g = groups.get(key);
        if (detectHemi(f.name) === 'rh') g.rh = g.rh || f; else g.lh = g.lh || f;
    }
    return [...groups.values()];
}
