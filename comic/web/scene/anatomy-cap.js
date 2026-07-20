/**
 * anatomy-cap.js — the scissor cut "cap": the anatomical (T1) cross-section drawn on a
 * sliced face, so cutting into the brain reveals white/gray matter like a coronal MRI.
 *
 * The anatomy volume ships as a compact 3D texture (bake.py bake_anatomy: fsaverage brain.mgz,
 * conformed 128^3, the SAME affine the classifier uses). A cap fragment reconstructs its world
 * position, maps world → volume voxel via inv(affine), and samples the tissue value; air/outside
 * samples are discarded so only real tissue paints the cut. One mesh whose geometry + transform we
 * set per slice: a plane quad for a plane cut, an inverted sphere/box for a sphere/cube bite (the
 * BackSide inner wall = the crater you look into). Opaque, depth-writing, so voxels/cortex in front
 * occlude it correctly. GLSL3 (WebGL2 sampler3D).
 */
import * as THREE from 'three';

const VERT = `
in vec3 position;
uniform mat4 modelMatrix, modelViewMatrix, projectionMatrix;
out vec3 vWorld;
void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = `
precision highp float;
precision highp sampler3D;
uniform sampler3D uAnat;
uniform mat4 uAnatInv;
uniform vec3 uDims, uTint;
uniform float uBright, uAirEps, uLo, uHi, uGamma;
in vec3 vWorld;
out vec4 fragColor;
void main() {
    vec3 vox = (uAnatInv * vec4(vWorld, 1.0)).xyz;   // world → (i,j,k)
    vec3 tc = (vox + 0.5) / uDims;                   // voxel-centre texcoord
    if (any(lessThan(tc, vec3(0.0))) || any(greaterThan(tc, vec3(1.0)))) discard;
    float a = texture(uAnat, tc).r;                  // 0..1 tissue intensity
    // Footprint mask: below uAirEps is true air / outside the brain → discard (transparent), so the
    // slice is bounded by the brain's cross-section outline. uAirEps is LOW so CSF/ventricles are
    // kept (and windowed dark), not punched out.
    if (a < uAirEps) discard;
    // Window/level like an MRI viewer: map [uLo..uHi] → [0..1] so CSF/sulci go dark, gray matter
    // sits mid, white matter goes bright — punchy, legible contrast (a plain stretch left it mush).
    float t = clamp((a - uLo) / max(uHi - uLo, 1e-3), 0.0, 1.0);
    float g = clamp(pow(t, uGamma) * uBright, 0.0, 1.0);
    fragColor = vec4(uTint * g, 1.0);
}`;

/** Build the cap from a loaded anatomy volume { data:Uint8Array, dims:[i,j,k], affine:4x4 row-major }.
 *  Returns { mesh, layer, configureForSlice, setStyle, dispose }. `layer` is a private render layer
 *  the main camera enables (kept out of the outline/edge depth passes). */
export function createAnatomyCap({ data, dims, affine }, layer) {
    const tex = new THREE.Data3DTexture(data, dims[0], dims[1], dims[2]);
    tex.format = THREE.RedFormat;
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

    const material = new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: VERT,
        fragmentShader: FRAG,
        side: THREE.DoubleSide,
        depthTest: true,
        depthWrite: true,
        uniforms: {
            uAnat: { value: tex },
            uAnatInv: { value: uAnatInv },
            uDims: { value: new THREE.Vector3(dims[0], dims[1], dims[2]) },
            uTint: { value: new THREE.Color(0xffffff) },
            uBright: { value: 1.0 },
            uAirEps: { value: 0.06 },   // footprint mask: only true air/outside is transparent
            uLo: { value: 0.28 },       // window floor (CSF/sulci → dark) — tuned for MNI152 T1
            uHi: { value: 0.82 },       // window ceiling (white matter → bright)
            uGamma: { value: 1.15 },    // >1 darkens midtones → more contrast, less washed
        },
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
    const _scl = new THREE.Vector3();
    const _q = new THREE.Quaternion();
    const Z = new THREE.Vector3(0, 0, 1);
    const PLANE_SPAN = 320;      // mm — big enough to overshoot the brain on any cut plane

    /** Point the cap at `slice` for a camera at `camPos` ([x,y,z] world). Returns true if it should
     *  render from this viewpoint, false to hide it (a plane's cut face shows ONLY from the side the
     *  cut revealed — the removed/empty side — so it never bleeds through from behind the brain). */
    function configureForSlice(slice, camPos) {
        if (!slice) return false;
        if (slice.shape === 'plane') {
            const n = _pos.set(slice.normal[0], slice.normal[1], slice.normal[2]).normalize();
            // gbSliceDiscard keeps dot(x,N) > offset for 'keep' (empty side = −N) and dot(x,N) <
            // offset for 'bite' (empty side = +N). The revealed face is only visible from that empty
            // side; if the camera is on the KEPT side, the brain is in front of the face → hide it.
            const camDot = camPos ? (camPos[0] * n.x + camPos[1] * n.y + camPos[2] * n.z) : 0;
            const off = slice.offset || 0;
            // Margin (~a brain half-width) so the face stays visible across oblique angles and only
            // hides once the camera is well onto the KEPT side (looking at the intact brain).
            const M = 65;
            const onRevealSide = (slice.mode === 'bite') ? (camDot > off - M) : (camDot < off + M);
            if (camPos && !onRevealSide) return false;
            _q.setFromUnitVectors(Z, n);
            mesh.geometry = quad;
            material.side = THREE.DoubleSide;   // camera-side gated above, so no culling needed
            mesh.matrix.compose(n.clone().multiplyScalar(off), _q, _scl.set(PLANE_SPAN, PLANE_SPAN, 1));
        } else if (slice.shape === 'sphere') {
            mesh.geometry = sphere;
            material.side = THREE.FrontSide;   // near-facing wall → reads as a solid plug of tissue
            _q.identity();
            mesh.matrix.compose(_pos.set(...slice.center), _q, _scl.setScalar(slice.radius));
        } else if (slice.shape === 'cube') {
            mesh.geometry = box;
            material.side = THREE.FrontSide;
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
        tex.dispose(); material.dispose();
        quad.dispose(); sphere.dispose(); box.dispose();
    }

    return { mesh, layer, configureForSlice, setStyle, dispose };
}
