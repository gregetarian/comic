/**
 * anatomy-cap.js — the scissor cut "cap": the anatomical (T1) cross-section drawn on a
 * sliced face, so cutting into the brain reveals white/gray matter like a coronal MRI.
 *
 * The anatomy volume ships as a compact RGBA 3D texture (T1 + whole/left/right cerebral masks)
 * baked from the SAME fsaverage anatomy as the cortical surface. A cap fragment maps its world
 * position back to anatomy voxels and samples the T1. Separate masks keep genuinely dark
 * CSF/ventricle pixels opaque, exclude cerebellum/brainstem from cortex-only panels, and ensure a
 * one-hemisphere view exposes only that hemisphere's cut face.
 *
 * One mesh is re-used per panel: a one-sided plane for plane cuts, or the inward-facing wall of a
 * sphere/box bite. The colour material writes normal scene depth; the paired depth material writes a
 * signed view depth into the outline clip target so later screen-space cortex/voxel lines cannot be
 * painted over the opaque MRI face. GLSL3 (WebGL2 sampler3D).
 */
import * as THREE from 'three';

const VERT = `
in vec3 position;
uniform mat4 modelMatrix, modelViewMatrix, projectionMatrix;
out vec3 vWorld;
out float vViewDepth;
void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vViewDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
}`;

const SAMPLE_GLSL = `
precision highp sampler3D;
uniform sampler3D uAnat;
uniform mat4 uAnatInv;
uniform vec3 uDims;
uniform float uMaskMode, uHemisphere, uAirEps;
in vec3 vWorld;

bool gbSampleAnatomy(out float intensity) {
    vec3 vox = (uAnatInv * vec4(vWorld, 1.0)).xyz;  // world → (i,j,k)
    vec3 tc = (vox + 0.5) / uDims;                  // voxel-centre texcoord
    if (any(lessThan(tc, vec3(0.0))) || any(greaterThan(tc, vec3(1.0)))) return false;
    vec4 sampleRGBA = texture(uAnat, tc);
    intensity = sampleRGBA.r;
    // RGBA: G=both cerebra, B=left, A=right. RG legacy assets have just one whole-brain mask;
    // R legacy assets fall back to intensity. This keeps old saved bundles readable.
    if (uMaskMode > 1.5) {
        float mask = uHemisphere < 0.5 ? sampleRGBA.g
                   : (uHemisphere < 1.5 ? sampleRGBA.b : sampleRGBA.a);
        return mask > 0.5;
    }
    return (uMaskMode > 0.5) ? (sampleRGBA.g > 0.5) : (intensity >= uAirEps);
}`;

const FRAG = `
precision highp float;
${SAMPLE_GLSL}
uniform vec3 uTint;
uniform float uBright, uLo, uHi, uGamma, uSharpen;
out vec4 fragColor;
void main() {
    float a;
    if (!gbSampleAnatomy(a)) discard;
    // Native data are 1 mm. A small six-neighbour unsharp mask restores the edge definition that
    // trilinear 3-D texture sampling otherwise loses when a slice is enlarged to several screen
    // pixels per voxel. It adds no invented spatial detail; it simply avoids the old soft upsample.
    vec3 vox = (uAnatInv * vec4(vWorld, 1.0)).xyz;
    vec3 tc = (vox + 0.5) / uDims;
    vec3 d = 1.0 / uDims;
    float neighbourMean = (
        texture(uAnat, tc + vec3(d.x, 0.0, 0.0)).r +
        texture(uAnat, tc - vec3(d.x, 0.0, 0.0)).r +
        texture(uAnat, tc + vec3(0.0, d.y, 0.0)).r +
        texture(uAnat, tc - vec3(0.0, d.y, 0.0)).r +
        texture(uAnat, tc + vec3(0.0, 0.0, d.z)).r +
        texture(uAnat, tc - vec3(0.0, 0.0, d.z)).r) / 6.0;
    a = clamp(a + uSharpen * (a - neighbourMean), 0.0, 1.0);
    // Window/level like an MRI viewer: map [uLo..uHi] → [0..1] so CSF/sulci go dark, gray matter
    // sits mid, white matter goes bright. The result is a perceptual/sRGB grey level; convert it to linear
    // before the renderer's output transform. Treating it as linear was the main source of the
    // pale, washed-out appearance (a nominal 50% grey displayed at roughly 74%).
    float t = clamp((a - uLo) / max(uHi - uLo, 1e-3), 0.0, 1.0);
    float g = clamp(pow(t, uGamma) * uBright, 0.0, 1.0);
    float linearGrey = g <= 0.04045 ? g / 12.92 : pow((g + 0.055) / 1.055, 2.4);
    fragColor = vec4(uTint * linearGrey, 1.0);
}`;

// Negative red marks "this depth came from the opaque cut cap". The shared outline shader takes
// abs(red) for its depth comparison and always suppresses a line when the nearer sample is negative;
// ordinary voxel depth remains positive and can still honour outline.overVoxelOpacity.
const DEPTH_FRAG = `
precision highp float;
${SAMPLE_GLSL}
in float vViewDepth;
out vec4 fragColor;
void main() {
    float a;
    if (!gbSampleAnatomy(a)) discard;
    fragColor = vec4(-vViewDepth / 500.0, 0.0, 0.0, 1.0);
}`;

const OVERLAY_FRAG = `
precision highp float;
precision highp sampler3D;
${SAMPLE_GLSL}
uniform sampler3D uStat;
uniform sampler2D uLut;
uniform mat4 uStatInv;
uniform vec3 uStatDims, uSliceNormal;
uniform float uSlabMm, uThreshold, uClusterMin, uPositiveOnly;
uniform float uMode, uGamma, uMaxAbs, uHalfMap, uUseClim, uClimLo, uClimHi, uOpacity;
out vec4 fragColor;

bool statAt(vec3 world, out vec2 stat) {
    vec3 vox = (uStatInv * vec4(world, 1.0)).xyz;
    vec3 tc = (vox + 0.5) / uStatDims;
    if (any(lessThan(tc, vec3(0.0))) || any(greaterThan(tc, vec3(1.0)))) return false;
    stat = texture(uStat, tc).rg;
    return true;
}

bool passes(vec2 s) {
    return abs(s.r) >= uThreshold && s.g >= uClusterMin
        && (uPositiveOnly < 0.5 || s.r > 0.0);
}

float valueToT(float v) {
    if (uUseClim > 0.5)
        return pow(clamp((v - uClimLo) / max(uClimHi - uClimLo, 1e-10), 0.0, 1.0), uGamma);
    if (uMode > 0.5) {
        float sn = clamp(abs(v) / max(uMaxAbs, 1e-10), 0.0, 1.0) * sign(v);
        float amp = sign(sn) * pow(abs(sn), uGamma);
        return (amp + 1.0) * 0.5;
    }
    float amp = pow(clamp(abs(v) / max(uMaxAbs, 1e-10), 0.0, 1.0), uGamma);
    if (uHalfMap > 0.5) return 0.5 + 0.5 * amp;
    if (uHalfMap < -0.5) return 0.5 - 0.5 * amp;
    return pow(clamp(v / max(uMaxAbs, 1e-10), 0.0, 1.0), uGamma);
}

void main() {
    float anatomy;
    if (!gbSampleAnatomy(anatomy)) discard;
    vec2 best = vec2(0.0);
    float bestAbs = -1.0;
    vec3 n = length(uSliceNormal) > 0.5 ? normalize(uSliceNormal) : vec3(0.0);
    // Nine fixed samples make the shader deterministic while covering a user-selectable
    // thin slab.  Max-absolute projection preserves compact activation on oblique cuts.
    for (int j = -4; j <= 4; j++) {
        vec2 s;
        vec3 p = vWorld + n * (float(j) / 8.0) * uSlabMm;
        if (statAt(p, s) && passes(s) && abs(s.r) > bestAbs) {
            best = s;
            bestAbs = abs(s.r);
        }
    }
    if (bestAbs < 0.0) discard;
    fragColor = vec4(texture(uLut, vec2(valueToT(best.r), 0.5)).rgb, uOpacity);
}`;

function affineInverse(affine) {
    return new THREE.Matrix4().set(
        affine[0][0], affine[0][1], affine[0][2], affine[0][3],
        affine[1][0], affine[1][1], affine[1][2], affine[1][3],
        affine[2][0], affine[2][1], affine[2][2], affine[2][3],
        affine[3][0], affine[3][1], affine[3][2], affine[3][3]).invert();
}

function linearChannel(c) {
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Build the cap from {data,dims,affine,channels}. Returns the colour mesh plus its mask-aware
 *  depthMaterial, configuration/style functions, and disposer. `layer` is private to the cap. */
export function createAnatomyCap({ data, dims, affine, channels = 1 }, layer, overlayLayer = layer) {
    const tex = new THREE.Data3DTexture(data, dims[0], dims[1], dims[2]);
    tex.format = channels >= 4 ? THREE.RGBAFormat : (channels > 1 ? THREE.RGFormat : THREE.RedFormat);
    tex.type = THREE.UnsignedByteType;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = tex.wrapR = THREE.ClampToEdgeWrapping;
    tex.unpackAlignment = 1;
    tex.needsUpdate = true;

    const uAnatInv = affineInverse(affine);

    const sampleUniforms = {
        uAnat: { value: tex },
        uAnatInv: { value: uAnatInv },
        uDims: { value: new THREE.Vector3(dims[0], dims[1], dims[2]) },
        uMaskMode: { value: channels >= 4 ? 2.0 : (channels > 1 ? 1.0 : 0.0) },
        uHemisphere: { value: 0.0 },
        uAirEps: { value: 0.06 },
    };
    const material = new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: VERT,
        fragmentShader: FRAG,
        side: THREE.DoubleSide,
        depthTest: true,
        depthWrite: true,
        uniforms: {
            ...sampleUniforms,
            uTint: { value: new THREE.Color(0xffffff) },
            uBright: { value: 0.98 },
            uLo: { value: 0.30 },       // window floor (CSF/sulci → dark)
            uHi: { value: 0.98 },       // retain highlight detail instead of clipping upper tissue
            uGamma: { value: 1.08 },
            uSharpen: { value: 0.45 },
        },
    });
    const depthMaterial = new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: VERT,
        fragmentShader: DEPTH_FRAG,
        side: THREE.DoubleSide,
        depthTest: true,
        depthWrite: true,
        uniforms: { ...sampleUniforms },
    });

    // Geometry variants, made once. Plane in z=0 (normal +z); unit sphere / unit box for bites.
    const quad = new THREE.PlaneGeometry(1, 1);
    const sphere = new THREE.SphereGeometry(1, 48, 32);
    const box = new THREE.BoxGeometry(1, 1, 1);

    const mesh = new THREE.Mesh(quad, material);
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = 6;        // after cortex(1)/anatomy(5), before voxels(15) → depth-sorts right
    mesh.layers.set(layer);
    mesh.visible = true;
    mesh.frustumCulled = false;
    // T1 and statistical faces are siblings under an identity group. Parenting the statistical
    // mesh to the scaled/rotated T1 mesh looks convenient, but Three.js then recomputes the child
    // modelMatrix during traversal; explicit sibling matrices are deterministic in every pass.
    const root = new THREE.Group();
    root.visible = false;
    root.add(mesh);

    const _pos = new THREE.Vector3();
    const _normal = new THREE.Vector3();
    const _faceNormal = new THREE.Vector3();
    const _scl = new THREE.Vector3();
    const _q = new THREE.Quaternion();
    const Z = new THREE.Vector3(0, 0, 1);
    const PLANE_SPAN = 320;      // mm — big enough to overshoot the brain on any cut plane
    const overlayRecords = [];

    const setSide = (side) => { material.side = side; depthMaterial.side = side; };

    /** Point the cap at `slice`. The exposed surface is genuinely one-sided: front-face culling,
     *  rather than an approximate camera-position margin, makes the plane disappear at the exact
     *  instant the viewer crosses behind it. */
    function configureForSlice(slice, hemisphere = 'both') {
        if (!slice) return false;
        sampleUniforms.uHemisphere.value = hemisphere === 'lh' ? 1.0 : (hemisphere === 'rh' ? 2.0 : 0.0);
        if (slice.shape === 'plane') {
            const n = _normal.set(slice.normal[0], slice.normal[1], slice.normal[2]).normalize();
            const off = slice.offset || 0;
            // keep retains +N (removed/reveal side −N); bite removes +N (reveal side +N).
            _faceNormal.copy(n).multiplyScalar(slice.mode === 'bite' ? 1 : -1);
            _q.setFromUnitVectors(Z, _faceNormal);
            mesh.geometry = quad;
            setSide(THREE.FrontSide);
            for (const r of overlayRecords) { r.mesh.geometry = quad; r.material.side = THREE.FrontSide; }
            mesh.matrix.compose(_pos.copy(n).multiplyScalar(off), _q, _scl.set(PLANE_SPAN, PLANE_SPAN, 1));
            for (const r of overlayRecords) r.material.uniforms.uSliceNormal.value.copy(_faceNormal);
        } else if (slice.shape === 'sphere') {
            mesh.geometry = sphere;
            setSide(THREE.BackSide);            // inner wall of the removed sphere → a cavity, not a plug
            for (const r of overlayRecords) { r.mesh.geometry = sphere; r.material.side = THREE.BackSide; r.material.uniforms.uSliceNormal.value.set(0, 0, 0); }
            _q.identity();
            mesh.matrix.compose(_pos.set(...slice.center), _q, _scl.setScalar(slice.radius));
        } else if (slice.shape === 'cube') {
            mesh.geometry = box;
            setSide(THREE.BackSide);            // inward-facing walls of the removed box
            for (const r of overlayRecords) { r.mesh.geometry = box; r.material.side = THREE.BackSide; r.material.uniforms.uSliceNormal.value.set(0, 0, 0); }
            _q.identity();
            const c = [(slice.min[0] + slice.max[0]) / 2, (slice.min[1] + slice.max[1]) / 2, (slice.min[2] + slice.max[2]) / 2];
            const s = [slice.max[0] - slice.min[0], slice.max[1] - slice.min[1], slice.max[2] - slice.min[2]];
            mesh.matrix.compose(_pos.set(...c), _q, _scl.set(...s));
        } else {
            return false;
        }
        mesh.matrixWorld.copy(mesh.matrix);
        for (const r of overlayRecords) {
            r.mesh.matrix.copy(mesh.matrix);
            r.mesh.matrixWorld.copy(mesh.matrixWorld);
        }
        return true;
    }

    /** Attach one compact statistical texture per uploaded NIfTI.  These are children of the
     *  T1 mesh so they inherit the exact cut geometry/transform, but live on a separate layer:
     *  the T1 alone remains the opaque depth authority that suppresses buried line art. */
    function setOverlayVolumes(volumes = []) {
        for (const r of overlayRecords.splice(0)) {
            root.remove(r.mesh);
            r.texture.dispose(); r.lut?.dispose(); r.material.dispose();
        }
        volumes.forEach((vol, overlayIndex) => {
            if (!vol || !vol.data || !vol.dims || !vol.affine) return;
            const st = new THREE.Data3DTexture(vol.data, vol.dims[0], vol.dims[1], vol.dims[2]);
            st.format = (vol.channels || 2) > 1 ? THREE.RGFormat : THREE.RedFormat;
            st.type = THREE.FloatType;
            st.minFilter = st.magFilter = THREE.LinearFilter;
            st.wrapS = st.wrapT = st.wrapR = THREE.ClampToEdgeWrapping;
            st.unpackAlignment = 1;
            st.needsUpdate = true;
            const mat = new THREE.RawShaderMaterial({
                glslVersion: THREE.GLSL3,
                vertexShader: VERT,
                fragmentShader: OVERLAY_FRAG,
                side: THREE.FrontSide,
                transparent: true,
                depthTest: true,
                depthWrite: false,
                polygonOffset: true,
                polygonOffsetFactor: -1,
                polygonOffsetUnits: -1,
                uniforms: {
                    ...sampleUniforms,
                    uStat: { value: st },
                    uLut: { value: null },
                    uStatInv: { value: affineInverse(vol.affine) },
                    uStatDims: { value: new THREE.Vector3(...vol.dims) },
                    uSliceNormal: { value: new THREE.Vector3() },
                    uSlabMm: { value: 1 }, uThreshold: { value: 0 }, uClusterMin: { value: 0 },
                    uPositiveOnly: { value: 0 }, uMode: { value: 0 }, uGamma: { value: 0.5 },
                    uMaxAbs: { value: 1 }, uHalfMap: { value: 0 }, uUseClim: { value: 0 },
                    uClimLo: { value: 0 }, uClimHi: { value: 1 }, uOpacity: { value: 0.88 },
                },
            });
            const child = new THREE.Mesh(quad, mat);
            child.matrixAutoUpdate = false;
            child.matrix.copy(mesh.matrix);
            child.layers.set(overlayLayer);
            // Row 0 has display priority in the 3D renderer; draw it last on a depth-tied cap too.
            child.renderOrder = 7 + volumes.length - overlayIndex;
            child.frustumCulled = false;
            child.visible = false;
            root.add(child);
            overlayRecords.push({ overlayIndex, mesh: child, material: mat, texture: st,
                lut: null, cmap: null, styleVisible: false, panelVisible: true });
        });
    }

    function setOverlayStyles(specs = []) {
        for (const r of overlayRecords) {
            const s = specs[r.overlayIndex] || {};
            const u = r.material.uniforms;
            const cut = s.cut || {};
            u.uSlabMm.value = Math.max(0, cut.slabMm ?? 1);
            u.uThreshold.value = Math.max(0, s.threshold ?? 0);
            u.uClusterMin.value = Math.max(0, s.clusterMin ?? 0);
            u.uPositiveOnly.value = s.positiveOnly ? 1 : 0;
            u.uMode.value = s.mode === 'diverging' ? 1 : 0;
            u.uGamma.value = Math.max(0.01, s.gamma ?? 0.5);
            u.uMaxAbs.value = Math.max(1e-10, s.maxAbs ?? 1);
            u.uHalfMap.value = s.divergingMapOnPositive ? 1 : (s.divergingMapOnNegative ? -1 : 0);
            const clim = Array.isArray(s.clim) ? s.clim : null;
            u.uUseClim.value = clim ? 1 : 0;
            if (clim) { u.uClimLo.value = clim[0]; u.uClimHi.value = clim[1]; }
            u.uOpacity.value = Math.max(0, Math.min(1, cut.opacity ?? 0.88));
            const filter = cut.interpolation === 'nearest' ? THREE.NearestFilter : THREE.LinearFilter;
            if (r.texture.minFilter !== filter || r.texture.magFilter !== filter) {
                r.texture.minFilter = r.texture.magFilter = filter;
                r.texture.needsUpdate = true;
            }
            if (s.cmap && s.cmap !== r.cmap) {
                r.lut?.dispose();
                const px = new Float32Array(s.cmap.n * 4);
                for (let i = 0; i < s.cmap.n; i++) {
                    px[i * 4] = linearChannel(s.cmap.lut[i * 3]);
                    px[i * 4 + 1] = linearChannel(s.cmap.lut[i * 3 + 1]);
                    px[i * 4 + 2] = linearChannel(s.cmap.lut[i * 3 + 2]);
                    px[i * 4 + 3] = 1;
                }
                r.lut = new THREE.DataTexture(px, s.cmap.n, 1, THREE.RGBAFormat, THREE.FloatType);
                r.lut.minFilter = r.lut.magFilter = THREE.LinearFilter;
                r.lut.wrapS = THREE.ClampToEdgeWrapping;
                r.lut.needsUpdate = true;
                u.uLut.value = r.lut;
                r.cmap = s.cmap;
            }
            r.styleVisible = !!cut.enabled && !s.hidden && !!u.uLut.value;
            r.mesh.visible = r.styleVisible && r.panelVisible;
        }
    }

    function setOverlayVisibility(predicate) {
        for (const r of overlayRecords) {
            r.panelVisible = !predicate || !!predicate(r.overlayIndex);
            r.mesh.visible = r.styleVisible && r.panelVisible;
        }
    }

    function setStyle({ tint, brightness, gamma, sharpen, airEps } = {}) {
        if (tint != null) material.uniforms.uTint.value.set(tint);
        if (brightness != null) material.uniforms.uBright.value = brightness;
        if (gamma != null) material.uniforms.uGamma.value = gamma;
        if (sharpen != null) material.uniforms.uSharpen.value = sharpen;
        if (airEps != null) material.uniforms.uAirEps.value = airEps;
    }

    function dispose() {
        setOverlayVolumes([]);
        tex.dispose(); material.dispose(); depthMaterial.dispose();
        quad.dispose(); sphere.dispose(); box.dispose();
    }

    return { root, mesh, layer, depthMaterial, configureForSlice, setStyle,
        setOverlayVolumes, setOverlayStyles, setOverlayVisibility, dispose };
}
