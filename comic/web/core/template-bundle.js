/** Normalize/validate template asset bundles. Pure: no fetch, DOM, or THREE. */

const legacySurfaces = (manifest) => {
    const out = {};
    for (const [hemi, info] of Object.entries(manifest.cortex || {})) {
        const add = (variant, path) => {
            if (!path) return;
            (out[variant] ||= {})[hemi === 'lh' ? 'lh' : 'rh'] = path;
        };
        add('pial', info.mesh);
        add('inflated', info.meshInflated);
        add('white', info.meshWhite);
        for (const [variant, path] of Object.entries(info.surfaces || {})) add(variant, path);
    }
    return out;
};

export function normalizeTemplateBundle(manifest = {}) {
    const raw = manifest.templateBundle || {};
    const surfaces = Object.keys(raw.surfaces || {}).length ? raw.surfaces : legacySurfaces(manifest);
    return {
        id: raw.id || `${manifest.templateMode || 'mni'}:${manifest.space || 'unknown'}`,
        space: raw.space || manifest.space || 'unknown',
        coordinateSystem: raw.coordinateSystem || 'RAS',
        transformId: raw.transformId || null,
        surfaces,
        defaultSurface: raw.defaultSurface || (surfaces.inflated ? 'inflated' : 'pial'),
        anatomy: raw.anatomy || (manifest.hasAnatomy ? {
            meta: 'anat.json', data: 'anat_uint8.bin.gz', transformId: raw.transformId || null,
        } : null),
        segmentation: raw.segmentation || (manifest.aseg ? manifest.aseg : null),
        transforms: raw.transforms || {},
        alignment: raw.alignment || null,
        legacy: !manifest.templateBundle,
    };
}

export function validateTemplateBundle(manifest = {}) {
    const bundle = normalizeTemplateBundle(manifest);
    const errors = [], variants = Object.keys(bundle.surfaces);
    if (!bundle.space) errors.push('template bundle is missing its world space');
    if (!bundle.coordinateSystem) errors.push('template bundle is missing its coordinate system');
    if (!variants.length && manifest.templateMode !== 'none') errors.push('template bundle has no cortical surfaces');
    if (variants.length && !bundle.surfaces.pial) errors.push('template bundle must provide a pial surface');
    for (const [variant, hemis] of Object.entries(bundle.surfaces)) {
        if (!hemis || (!hemis.lh && !hemis.rh)) errors.push(`surface '${variant}' has no hemisphere asset`);
    }
    const ids = [bundle.anatomy?.transformId, bundle.segmentation?.transformId]
        .filter(Boolean);
    if (bundle.transformId && ids.some((id) => id !== bundle.transformId))
        errors.push('surface/anatomy/segmentation transform identities do not match');
    if (bundle.alignment?.status === 'fail') {
        const p95 = bundle.alignment.worstP95Mm;
        errors.push(`template anatomy/surface alignment failed${p95 != null ? ` (p95 ${p95} mm)` : ''}`);
    }
    return { ok: errors.length === 0, errors, bundle };
}

