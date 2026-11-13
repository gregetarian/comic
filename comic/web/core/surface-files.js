/**
 * surface-files.js — pure upload-file routing. No DOM, no THREE.
 *
 * Splits dropped/selected files into NIfTI volumes vs native fsaverage SURFACE maps
 * (per-vertex .gii/.mgh/.mgz, or an extension-less FreeSurfer morph file whose name
 * carries an lh/rh marker), and pairs surface files into lh/rh overlays by filename.
 */

export const VOL_RE = /\.nii(\.gz)?$|\.gz$/i;
const SURF_EXT_RE = /\.(dscalar\.nii|gii|mgh|mgz)$/i;
/** A CIFTI-2 dense scalar: ends in .nii but is a per-vertex fs_LR surface map, both hemispheres. */
export const isCiftiScalar = (name) => /\.dscalar\.nii$/i.test(name);
// HCP-style single-letter hemisphere token (`stat.L.func.gii`), in addition to lh/rh + BIDS.
const HCP_L_RE = /(^|[._-])l(?=[._-])/, HCP_R_RE = /(^|[._-])r(?=[._-])/;
const HEMI_RE = /(^|[._-])(lh|rh)([._-]|$)|hemi-[lr](?![a-z])/i;   // \b fails before '_' (a word char)

/** True for a native surface map: a surface extension, or an lh/rh-marked non-NIfTI (morph). */
/** A table of per-parcel values (one number per atlas parcel), not a per-vertex surface map. */
export const PARCEL_VALUE_RE = /\.(csv|tsv|txt)$/i;
export const isParcelValueFile = (name) => PARCEL_VALUE_RE.test(name);

export function isSurfaceFile(name) {
    if (SURF_EXT_RE.test(name)) return true;
    // A hemi marker alone is not enough: `lh_schaefer_values.csv` is a parcel value table, and
    // routing it into process_surface would hand a CSV to a GIFTI reader.
    if (PARCEL_VALUE_RE.test(name)) return false;
    return HEMI_RE.test(name) && !VOL_RE.test(name);
}

/** 'lh' | 'rh' | null from a filename (lh/rh tokens or BIDS hemi-L/hemi-R). */
export function detectHemi(name) {
    const n = name.toLowerCase();
    if (/(^|[._-])lh([._-]|$)/.test(n) || /hemi-l(?![a-z])/.test(n)) return 'lh';
    if (/(^|[._-])rh([._-]|$)/.test(n) || /hemi-r(?![a-z])/.test(n)) return 'rh';
    // The bare L/R token is the weakest marker, and only ever means a hemisphere on a GIFTI.
    if (/\.gii$/.test(n)) {
        if (HCP_L_RE.test(n)) return 'lh';
        if (HCP_R_RE.test(n)) return 'rh';
    }
    return null;
}

/** Hemi-stripped base name — lh.X.gii and rh.X.gii share a key so they pair. */
function pairKey(name) {
    return name.toLowerCase()
        .replace(/(^|[._-])(lh|rh)([._-]|$)/, '$1$3').replace(/hemi-[lr]\b/, 'hemi')
        .replace(/\.gii$/.test(name.toLowerCase()) ? /(^|[._-])[lr](?=[._-])/ : /$^/, '$1')
        .replace(SURF_EXT_RE, '').replace(/[._-]+/g, '.');
}

/** A display name for a surface overlay: strip the surface extension + lh/rh marker. */
export function surfaceOverlayName(g) {
    const src = (g.cifti || g.lh || g.rh).name;
    const hcp = /\.gii$/i.test(src) && detectHemi(src) && !/(^|[._-])(lh|rh)([._-]|$)|hemi-[lr](?![a-z])/i.test(src);
    return src.replace(SURF_EXT_RE, '').replace(/(^|[._-])(lh|rh)([._-]|$)/i, '$1')
        .replace(hcp ? /(^|[._-])[lr](?=[._-])/i : /$^/, '$1').replace(hcp ? /[._-](func|shape)$/i : /$^/, '')
        .replace(/[._-]{2,}/g, '.').replace(/^[._-]+|[._-]+$/g, '') || 'surface';
}

/** Group surface files into { lh, rh } pairs by base name. A file with no detectable
 *  hemisphere (or a lone hemisphere) goes into the lh slot (rendered as a single hemi). */
export function groupSurfaceFiles(files) {
    const groups = new Map();
    for (const f of files) {
        // A CIFTI dscalar is a whole overlay on its own (both hemispheres in one file).
        if (isCiftiScalar(f.name)) { groups.set('cifti:' + groups.size + ':' + f.name, { lh: null, rh: null, cifti: f }); continue; }
        const key = pairKey(f.name);
        if (!groups.has(key)) groups.set(key, { lh: null, rh: null });
        const g = groups.get(key);
        if (detectHemi(f.name) === 'rh') g.rh = g.rh || f; else g.lh = g.lh || f;
    }
    return [...groups.values()];
}
