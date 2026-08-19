/**
 * asset-loader.js — static/in-browser variant.
 *
 * Two responsibilities, split because the data now comes from two places:
 *   loadBaseScene(base)  — the FIXED fsaverage template (cortex + subcortical),
 *                          baked to GLB and loaded once, exactly as the server app did.
 *   buildOverlayMeshes() — the PER-UPLOAD overlay, built straight into THREE
 *                          BufferGeometries from the Pyodide pipeline's raw arrays
 *                          (no GLB, no trimesh round-trip).
 *
 * Every mesh is tagged with the same metadata the renderer expects
 * (role / hemisphere / structure / category / variant), so renderer.js is verbatim.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js?v=edge-v1';
import { hemiOfCategory, categoryOfStructure } from '../core/mesh-meta.js?v=edge-v1';
import { asF32, asU32, sliceBuffers } from '../core/buffers.js?v=edge-v1';
import { validateTemplateBundle } from '../core/template-bundle.js?v=edge-v1';

const gltfLoader = new GLTFLoader();
const loadGLB = (url) => new Promise((res, rej) => gltfLoader.load(url, res, undefined, rej));

function firstMesh(obj) {
    if (obj.isMesh) return obj;
    for (const c of obj.children) { const m = firstMesh(c); if (m) return m; }
    return null;
}

function bboxOf(mesh) {
    mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox;
    return { min: [bb.min.x, bb.min.y, bb.min.z], max: [bb.max.x, bb.max.y, bb.max.z] };
}

/** Per-vertex value attribute (drives threshold + JS colorization) + writable colour. */
function attachValues(geometry, values) {
    geometry.setAttribute('aValue', new THREE.BufferAttribute(values, 1));
    const n = geometry.attributes.position.count;
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    return values;
}

/** Per-vertex cluster size (live cluster-extent filter). */
function attachClusters(geometry, clusters) {
    const n = geometry.attributes.position.count;
    const arr = new Float32Array(n);
    if (clusters && clusters.length === n) arr.set(clusters);
    else arr.fill(1e9);   // unknown ⇒ never hidden by the cluster threshold
    geometry.setAttribute('aClusterSize', new THREE.BufferAttribute(arr, 1));
}

/** Load the fixed cortex + subcortical template from baked GLBs under `base`. */
// Anatomy volume for the scissor cut-cap (bake_anatomy): fetch the gzipped uint8 3D texture +
// its sidecar, gunzip in-browser (DecompressionStream), and hand back {data,dims,affine}. Memoised
// so it's fetched once per session and survives engine rebuilds. Throws if the asset isn't baked.
let _anatCache = null;
// Bump when the baked anatomy asset changes (resolution/content) — the query string busts any
// stale copy in the browser's HTTP cache (e.g. a prior 128^3 bake), independent of server headers.
const ANAT_VER = 'afni-mni2009c-1mm-v7';
export function loadAnatomyVolume(base = 'data/', bundle = null) {
    if (!_anatCache) _anatCache = (async () => {
        const asset = bundle?.anatomy || {};
        const metaPath = asset.meta || 'anat.json', dataPath = asset.data || 'anat_uint8.bin.gz';
        const meta = await fetch(base + metaPath + '?' + ANAT_VER).then((r) => { if (!r.ok) throw new Error(`anatomy asset not baked (${metaPath} missing)`); return r.json(); });
        const gz = await fetch(base + dataPath + '?' + ANAT_VER).then((r) => r.arrayBuffer());
        const stream = new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'));
        const buf = await new Response(stream).arrayBuffer();
        return { data: new Uint8Array(buf), dims: meta.dims, affine: meta.affine,
                 channels: meta.channels || 1, transformId: meta.transformId || asset.transformId || null };
    })();
    return _anatCache;
}

// Parcellations (comic/parcels.py bakes these). Same shape as loadAnatomyVolume — memoised
// promise, sidecar JSON + gzipped binary, native DecompressionStream, loud on a missing asset —
// but keyed by atlas name so several can coexist. ~26–103 kB each, so they are fetched on demand
// rather than shipped inside the 7 MB cortex GLBs.
const _parcelCache = new Map();
let _parcelIndex = null;
const PARCEL_VER = 'fsaverage-ico7-v1';

/** {version, atlases:{name:{label,nparcels,…}}} — what this install can draw. */
export function loadParcellationIndex(base = 'data/') {
    if (!_parcelIndex) _parcelIndex = fetch(base + 'parcels/index.json?' + PARCEL_VER)
        .then((r) => (r.ok ? r.json() : { version: PARCEL_VER, atlases: {} }));
    return _parcelIndex;
}

/** One atlas → {lh, rh} Int16Array per-vertex labels (-1 = medial wall), + names/colors. */
export function loadParcellation(name, base = 'data/') {
    if (!_parcelCache.has(name)) _parcelCache.set(name, (async () => {
        const meta = await fetch(`${base}parcels/${name}.json?${PARCEL_VER}`)
            .then((r) => { if (!r.ok) throw new Error(`parcellation '${name}' is not baked — run: comic parcels bake ${name}`); return r.json(); });
        const gz = await fetch(`${base}parcels/${name}.bin.gz?${PARCEL_VER}`).then((r) => r.arrayBuffer());
        const buf = await new Response(new Blob([gz]).stream()
            .pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
        const cut = (h) => new Int16Array(buf.slice(meta[h][0], meta[h][0] + meta[h][1]));
        return { lh: cut('lh'), rh: cut('rh'), names: meta.names, colors: meta.colors,
                 networks: meta.networks, nverts: meta.nverts };
    })());
    return _parcelCache.get(name);
}

export async function loadBaseScene(base = 'data/') {
    const manifest = await fetch(base + 'scene.json').then((r) => r.json());
    const checked = validateTemplateBundle(manifest);
    if (!checked.ok) throw new Error('Invalid template bundle:\n  ' + checked.errors.join('\n  '));
    const templateBundle = checked.bundle;
    const meshes = [];
    const push = (mesh, meta, values = null) => {
        if (!mesh.geometry.attributes.normal) mesh.geometry.computeVertexNormals();
        meshes.push({ mesh, meta, values, aabb: bboxOf(mesh) });
    };

    // Keep the historical pial/inflated, lh/rh creation order exactly: transparent/depth-tied
    // rendering uses stable object IDs as its final sort key, so changing load order can thicken
    // thousands of outline pixels even when the added variants are hidden. Extra variants load
    // afterward and therefore cannot perturb existing unsliced/headless output.
    const surfaces = templateBundle.surfaces || {};
    const coreVariants = ['pial', 'inflated'].filter((v) => surfaces[v]);
    const extraVariants = Object.keys(surfaces).filter((v) => !coreVariants.includes(v));
    const ordered = [];
    for (const hemi of ['lh', 'rh']) for (const variant of coreVariants) {
        const path = surfaces[variant]?.[hemi];
        if (path) ordered.push([variant, hemi, path]);
    }
    for (const variant of extraVariants) for (const hemi of ['lh', 'rh']) {
        const path = surfaces[variant]?.[hemi];
        if (path) ordered.push([variant, hemi, path]);
    }
    for (const [variant, hemi, path] of ordered) {
            const hk = hemi === 'lh' ? 'lh' : 'rh';
            const baseMeta = { role: 'cortex', hemisphere: hk, structure: `cortex_${hemi}`,
                category: `${hemi}_cortex`, variant };
            push(firstMesh((await loadGLB(base + path)).scene), baseMeta);
    }
    for (const [name, info] of Object.entries(manifest.subcortical || {})) {
        const m = firstMesh((await loadGLB(base + info.mesh)).scene);
        const cat = categoryOfStructure(name);
        push(m, { role: 'anatomy', hemisphere: hemiOfCategory(cat), structure: name, category: cat, variant: null });
    }
    return { meshes, manifest, templateBundle };
}

/** Fetch a static overlay's `.bin` and slice it back into per-buffer Uint8Arrays via
 *  the meta's `bufferLayout` ([offset,length] per buffer index). Used for the baked
 *  demo (data/demo/) and for the CLI render (one overlay_<i>.bin) — the same arrays a
 *  live Pyodide upload produces, so all three paths feed buildOverlayMeshes() identically. */
export async function loadOverlayArrays(base, meta, cacheTag = '') {
    const file = meta.buffersFile || 'buffers.bin';
    const sep = file.includes('?') ? '&' : '?';
    const url = base + file + (cacheTag ? `${sep}${cacheTag}` : '');
    const buf = await fetch(url).then((r) => r.arrayBuffer());
    return sliceBuffers(buf, meta.bufferLayout);
}

/** Build one overlay's tagged THREE meshes from the Pyodide pipeline output.
 *  @param meta    one overlay's meta object (from pipeline.process_nifti)
 *  @param buffers array of Uint8Array, indexed by meta.structures[cat][variant].{pos,idx,val,clu}
 *  @param oi      overlay index (display row / layer)
 *  @returns array of { mesh, meta, values, aabb } tagged like the GLB overlay meshes */
export function buildOverlayMeshes(meta, buffers, oi) {
    const out = [];
    for (const [cat, variants] of Object.entries(meta.structures || {})) {
        const hemi = hemiOfCategory(cat);
        for (const variant of ['blocky', 'smooth']) {
            const d = variants[variant];
            if (!d) continue;
            const positions = asF32(buffers[d.pos]);
            const index = asU32(buffers[d.idx]);
            const values = asF32(buffers[d.val]);
            const clusters = asF32(buffers[d.clu]);

            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            g.setIndex(new THREE.BufferAttribute(index, 1));
            attachValues(g, values);
            attachClusters(g, clusters);
            g.computeVertexNormals();

            const mesh = new THREE.Mesh(g);   // material assigned by the engine
            out.push({
                mesh,
                meta: { role: 'voxel', overlay: oi, hemisphere: hemi, structure: `${meta.name}_${cat}`, category: cat, variant },
                values,
                aabb: bboxOf(mesh),
            });
        }
    }
    // Surface-projection meshes (M8): the cortex sheet per hemi, sampled from this volume. Same
    // voxel role + per-vertex aValue path (so recolor colours them through the LUT), variant
    // 'surface' (shown only when representation === 'surface'), + an aCurv attribute for the
    // surface material's curvature-grey fallback below threshold.
    for (const hemi of ['lh', 'rh']) {
        const d = meta.surface && meta.surface[hemi];
        if (!d) continue;
        const values = asF32(buffers[d.val]);
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(asF32(buffers[d.pos]), 3));
        g.setIndex(new THREE.BufferAttribute(asU32(buffers[d.idx]), 1));
        attachValues(g, values);
        attachClusters(g, asF32(buffers[d.clu]));
        g.setAttribute('aCurv', new THREE.BufferAttribute(asF32(buffers[d.crv]), 1));
        // 1 = show. An atlas overwrites this with its cortex mask (see renderer.setParcellation).
        g.setAttribute('aMask', new THREE.BufferAttribute(new Float32Array(values.length).fill(1), 1));
        g.computeVertexNormals();
        const mesh = new THREE.Mesh(g);
        out.push({
            mesh,
            meta: { role: 'voxel', overlay: oi, hemisphere: hemi,
                    structure: `${meta.name}_${hemi}_cortex`, category: `${hemi}_cortex`, variant: 'surface',
                    // A native surface overlay (process_surface) has ONLY this variant — no blocky/smooth.
                    // Tagging it lets visibility force the 'surface' gate so it always shows.
                    surfaceOnly: !!meta.surfaceOnly },
            values,
            aabb: bboxOf(mesh),
        });
    }
    return out;
}

/** Rehydrate the compact two-channel statistical texture retained by process_nifti.
 *  Channel R is the thresholded value and G is cluster size; the descriptor's affine
 *  maps texture voxels into the same world space as the cortex and baked T1. */
export function buildCutVolume(meta, buffers) {
    const d = meta && meta.cutVolume;
    if (!d || d.buffer == null || !buffers[d.buffer]) return null;
    return {
        data: asF32(buffers[d.buffer]),
        dims: d.dims,
        affine: d.affine,
        channels: d.channels || 2,
        order: d.order || 'x-fastest-interleaved',
    };
}
