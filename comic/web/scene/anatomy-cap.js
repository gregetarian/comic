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
uniform float uBright, uLo, uHi, uGamma;
out vec4 fragColor;
void main() {
    float a;
    if (!gbSampleAnatomy(a)) discard;
    // Window/level like an MRI viewer: map [uLo..uHi] → [0..1] so CSF/sulci go dark, gray matter
    // sits mid, white matter goes bright — punchy, legible contrast (a plain stretch left it mush).
    float t = clamp((a - uLo) / max(uHi - uLo, 1e-3), 0.0, 1.0);
    float g = clamp(pow(t, uGamma) * uBright, 0.0, 1.0);
    fragColor = vec4(uTint * g, 1.0);
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

/** Build the cap from {data,dims,affine,channels}. Returns the colour mesh plus its mask-aware
 *  depthMaterial, configuration/style functions, and disposer. `layer` is private to the cap. */
export function createAnatomyCap({ data, dims, affine, channels = 1 }, layer) {
    const tex = new THREE.Data3DTexture(data, dims[0], dims[1], dims[2]);
    tex.format = channels >= 4 ? THREE.RGBAFormat : (channels > 1 ? THREE.RGFormat : THREE.RedFormat);
    tex.type = THREE.UnsignedByteType;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = tex.wrapR = THREE.ClampToEdgeWrapping;
    tex.unpackAlignment = 1;
    tex.needsUpdate = true;

    const a = affine;
    const A = new THREE.Matrix4().set(
        a[0][0], a[0][1], a[0][2], a[0][3],
        a[1][0], a[1][1], a[1][2], a[1][3],
        a[2][0], a[2][1], a[2][2], a[2][3],
        a[3][0], a[3][1], a[3][2], a[3][3]);
    const uAnatInv = A.clone().invert();

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
            uBright: { value: 1.0 },
            uLo: { value: 0.28 },       // window floor (CSF/sulci → dark) — tuned for fsaverage T1
            uHi: { value: 0.82 },       // window ceiling (white matter → bright)
            uGamma: { value: 1.15 },    // >1 darkens midtones → more contrast, less washed
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
    mesh.visible = false;
    mesh.frustumCulled = false;

    const _pos = new THREE.Vector3();
    const _normal = new THREE.Vector3();
    const _faceNormal = new THREE.Vector3();
    const _scl = new THREE.Vector3();
    const _q = new THREE.Quaternion();
    const Z = new THREE.Vector3(0, 0, 1);
    const PLANE_SPAN = 320;      // mm — big enough to overshoot the brain on any cut plane

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
            mesh.matrix.compose(_pos.copy(n).multiplyScalar(off), _q, _scl.set(PLANE_SPAN, PLANE_SPAN, 1));
        } else if (slice.shape === 'sphere') {
            mesh.geometry = sphere;
            setSide(THREE.BackSide);            // inner wall of the removed sphere → a cavity, not a plug
            _q.identity();
            mesh.matrix.compose(_pos.set(...slice.center), _q, _scl.setScalar(slice.radius));
        } else if (slice.shape === 'cube') {
            mesh.geometry = box;
            setSide(THREE.BackSide);            // inward-facing walls of the removed box
            _q.identity();
            const c = [(slice.min[0] + slice.max[0]) / 2, (slice.min[1] + slice.max[1]) / 2, (slice.min[2] + slice.max[2]) / 2];
            const s = [slice.max[0] - slice.min[0], slice.max[1] - slice.min[1], slice.max[2] - slice.min[2]];
            mesh.matrix.compose(_pos.set(...c), _q, _scl.set(...s));
        } else {
            return false;
        }
        mesh.matrixWorld.copy(mesh.matrix);
        return true;
    }

    function setStyle({ tint, brightness, gamma, airEps } = {}) {
        if (tint != null) material.uniforms.uTint.value.set(tint);
        if (brightness != null) material.uniforms.uBright.value = brightness;
        if (gamma != null) material.uniforms.uGamma.value = gamma;
        if (airEps != null) material.uniforms.uAirEps.value = airEps;
    }

    function dispose() {
        tex.dispose(); material.dispose(); depthMaterial.dispose();
        quad.dispose(); sphere.dispose(); box.dispose();
    }

    return { mesh, layer, depthMaterial, configureForSlice, setStyle, dispose };
}
