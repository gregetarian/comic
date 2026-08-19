/**
 * materials.js — config-driven material factories. Browser (three.js) side.
 *
 * - Glass cortex: fresnel transparency + cel shading (view-space headlight).
 * - Anatomy: matte Lambert (occludes voxels behind it; no specular).
 * - Voxel: shiny Phong, OPAQUE (self-occluding "100" look, no transparent pass
 *   snap), with injected threshold-discard + logarithmic depth veil (a colour
 *   effect that tints deep voxels toward the brain colour).
 *
 * Voxel uniforms are created PER ENGINE (not a module global) so multiple
 * configs can coexist (e.g. a headless render in the same process).
 */
import * as THREE from 'three';

// ---- Slicing (Free Canvas) ----------------------------------------------
// A per-panel SDF "cut" shared by EVERY material (voxel, glass, anatomy, and the
// two depth materials in passes.js) so the whole brain slices together and the
// edge/outline passes follow the cut. THREE.clippingPlanes can't do this (materials
// are shared across panels, and it can't express a sphere/box BITE), so we inject a
// world-space discard. uSliceType 0 = off (default), so unsliced panels are untouched.
export function sliceUniforms() {
    return {
        uSliceType: { value: 0 },   // 0 none · 1 plane · 2 sphere · 3 cube
        uSliceMode: { value: 0 },   // 0 keep (show region) · 1 bite (remove region)
        uSliceNormal: { value: new THREE.Vector3(0, 0, 1) },
        uSliceOffset: { value: 0 },
        uSliceCenter: { value: new THREE.Vector3(0, 0, 0) },
        uSliceRadius: { value: 0 },
        uSliceMin: { value: new THREE.Vector3(0, 0, 0) },
        uSliceMax: { value: new THREE.Vector3(0, 0, 0) },
    };
}
// Fragment-stage declarations + the discard predicate (global scope, so it can be
// prepended before main()). Coordinates are world mm (== vertex position; meshes at identity).
export const SLICE_FRAG_PARS = `
uniform float uSliceType, uSliceMode, uSliceOffset, uSliceRadius;
uniform vec3 uSliceNormal, uSliceCenter, uSliceMin, uSliceMax;
varying vec3 vWorldPos;
bool gbSliceDiscard(vec3 p){
    if (uSliceType < 0.5) return false;
    bool ins;
    if (uSliceType < 1.5) ins = dot(p, normalize(uSliceNormal)) > uSliceOffset;
    else if (uSliceType < 2.5) ins = length(p - uSliceCenter) < uSliceRadius;
    else ins = all(greaterThan(p, uSliceMin)) && all(lessThan(p, uSliceMax));
    return (uSliceMode < 0.5) ? !ins : ins;
}`;
export const SLICE_VERT_PARS = `varying vec3 vWorldPos;`;
export const SLICE_VERT_ASSIGN = `vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;`;

// ---- Glass cortex --------------------------------------------------------
const glassVert = `
varying vec3 vNormal;
varying vec3 vViewDir;
varying float vViewZ;
${SLICE_VERT_PARS}
void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vViewDir = normalize(-mvPosition.xyz);
    vViewZ = -mvPosition.z;
    ${SLICE_VERT_ASSIGN}
    gl_Position = projectionMatrix * mvPosition;
}`;
const glassFrag = `
uniform vec3 uColor;
uniform float uFresnelPower, uMinOpacity, uMaxOpacity, uCelBands;
uniform vec3 uLightDir;
uniform sampler2D uFrontDepth;
uniform float uFrontDepthApply, uFrontDepthTolerance;
uniform vec2 uFrontViewportOrigin, uFrontViewportSize, uFrontTextureSize;
varying vec3 vNormal;
varying vec3 vViewDir;
varying float vViewZ;
${SLICE_FRAG_PARS}
void main() {
    if (gbSliceDiscard(vWorldPos)) discard;
    if (uFrontDepthApply > 0.5) {
        vec2 uv = (gl_FragCoord.xy - uFrontViewportOrigin) / max(uFrontViewportSize, vec2(1.0));
        vec2 tc = clamp(uv, vec2(0.0), vec2(1.0));
        vec2 dt = 1.0 / max(uFrontTextureSize, vec2(1.0));
        vec4 front = texture2D(uFrontDepth, tc);
        if (front.g > 0.5) {
            // At triangle/fold boundaries the centre texel can belong to the neighbouring,
            // slightly nearer triangle. Accept the farthest COVERED sample in a one-texel cross.
            // This is conservative only at the boundary and prevents white pinholes/corner chips;
            // a genuinely hidden fold remains behind all five local front-depth samples.
            float nearestZ = front.r * 500.0;
            vec4 q = texture2D(uFrontDepth, clamp(tc + vec2(dt.x,0.0), vec2(0.0), vec2(1.0))); if(q.g>0.5) nearestZ=max(nearestZ,q.r*500.0);
            q = texture2D(uFrontDepth, clamp(tc - vec2(dt.x,0.0), vec2(0.0), vec2(1.0))); if(q.g>0.5) nearestZ=max(nearestZ,q.r*500.0);
            q = texture2D(uFrontDepth, clamp(tc + vec2(0.0,dt.y), vec2(0.0), vec2(1.0))); if(q.g>0.5) nearestZ=max(nearestZ,q.r*500.0);
            q = texture2D(uFrontDepth, clamp(tc - vec2(0.0,dt.y), vec2(0.0), vec2(1.0))); if(q.g>0.5) nearestZ=max(nearestZ,q.r*500.0);
            if (vViewZ > nearestZ + uFrontDepthTolerance) discard;
        }
    }
    vec3 n = gl_FrontFacing ? normalize(vNormal) : -normalize(vNormal);
    vec3 v = normalize(vViewDir);
    float fresnel = pow(1.0 - abs(dot(v, n)), uFresnelPower);
    float alpha = mix(uMinOpacity, uMaxOpacity, fresnel);
    float intensity = 0.5 * dot(n, normalize(uLightDir)) + 0.5;
    intensity = floor(intensity * uCelBands + 0.001) / uCelBands;
    gl_FragColor = vec4(uColor * mix(0.3, 1.0, intensity), alpha);
}`;

export function makeGlassMaterial(glass = {}) {
    const control = Math.max(0, glass.maxOpacity ?? 0.08);
    const maxOpacity = Math.min(1, control);
    const minOpacity = control > 1
        ? Math.min(1, control - 1)
        : Math.min(maxOpacity, glass.minOpacity ?? 0.0);
    return new THREE.ShaderMaterial({
        vertexShader: glassVert,
        fragmentShader: glassFrag,
        transparent: true,
        depthWrite: true,
        side: THREE.FrontSide,
        // The cortex is a translucent, heavily folded sheet. At oblique views several fold edges
        // can land on the same output pixel; ordinary one-sample alpha coverage makes those
        // intersections visibly staircase as cortex alpha rises. The viewer is already created
        // with MSAA, so alpha-to-coverage lets fragment alpha resolve across the multisamples,
        // smoothing those stacked fold boundaries without changing the opacity curve itself.
        alphaToCoverage: false,
        polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
        uniforms: {
            uColor: { value: new THREE.Color(glass.color ?? 0xffffff) },
            uFresnelPower: { value: glass.fresnelPower ?? 2.5 },
            uMinOpacity: { value: minOpacity },
            uMaxOpacity: { value: maxOpacity },
            uCelBands: { value: glass.celBands ?? 3.0 },
            uLightDir: { value: new THREE.Vector3(0, 0, 1) },
            uFrontDepth: { value: null },
            uFrontDepthApply: { value: 0.0 },
            uFrontDepthTolerance: { value: 0.6 },
            uFrontViewportOrigin: { value: new THREE.Vector2(0, 0) },
            uFrontViewportSize: { value: new THREE.Vector2(1, 1) },
            uFrontTextureSize: { value: new THREE.Vector2(1, 1) },
            ...sliceUniforms(),
        },
    });
}

// ---- Anatomy (white glass shell) -----------------------------------------
export function makeAnatomyMaterial(anatomy = {}) {
    return makeGlassMaterial({
        color: anatomy.color ?? 0xffffff,
        maxOpacity: anatomy.maxOpacity ?? 0.14,
        fresnelPower: anatomy.fresnelPower ?? 2.0,
    });
}

// ---- Anatomy: OPAQUE shell (per-panel option) ----------------------------
const anatomyOpaqueFrag = `
uniform vec3 uColor;
uniform float uCelBands;
uniform vec3 uLightDir;
varying vec3 vNormal;
varying vec3 vViewDir;
${SLICE_FRAG_PARS}
void main() {
    if (gbSliceDiscard(vWorldPos)) discard;
    vec3 n = gl_FrontFacing ? normalize(vNormal) : -normalize(vNormal);
    float intensity = 0.5 * dot(n, normalize(uLightDir)) + 0.5;
    intensity = floor(intensity * uCelBands + 0.001) / uCelBands;
    gl_FragColor = vec4(uColor * mix(0.97, 1.0, intensity), 1.0);
}`;

export function makeOpaqueAnatomyMaterial(anatomy = {}) {
    return new THREE.ShaderMaterial({
        vertexShader: glassVert,
        fragmentShader: anatomyOpaqueFrag,
        transparent: false,
        depthWrite: true,
        depthTest: true,
        colorWrite: false,
        side: THREE.BackSide,
        polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2,
        uniforms: {
            uColor: { value: new THREE.Color(anatomy.opaqueColor ?? 0xffffff) },
            uCelBands: { value: anatomy.celBands ?? 3.0 },
            uLightDir: { value: new THREE.Vector3(0, 0, 1) },
            ...sliceUniforms(),
        },
    });
}

// ---- Voxel (shiny, opaque, threshold + depth veil) -----------------------
export function makeSharedVoxelUniforms(style = {}) {
    const v = style.voxel || {};
    const veil = v.veil || {};
    return {
        uThreshold: { value: 0.0 },
        uMaxAbs: { value: 1.0 },
        uPositiveOnly: { value: style.positiveOnly ? 1.0 : 0.0 },
        uClusterMin: { value: v.clusterMin ?? 0.0 },
        uNearZ: { value: 200.0 },
        uFarZ: { value: 400.0 },
        uDepthNearZ: { value: 200.0 },
        uDepthFarZ: { value: 400.0 },
        uDepthCut: { value: v.depthCut ?? 0.0 },
        uVeilStrength: { value: veil.strength ?? 0.40 },
        uVeilColor: { value: new THREE.Color(veil.color ?? 0xffffff) },
        uVeilK: { value: veil.k ?? 6.0 },
        uEmissiveBoost: { value: v.emissive ?? 0.6 },
        uGlintAmt: { value: v.specular ?? 0.10 },
        uGlintPow: { value: v.shininess ?? 80 },
        uBaseApply: { value: 0.0 },
        uMaskApply: { value: 0.0 },
        uMaskColor: { value: new THREE.Color(0xdcdcdc) },
        uBaseColor: { value: new THREE.Color(0xcccccc) },
        ...sliceUniforms(),
    };
}

export function makeVoxelMaterial(style = {}, shared) {
    const v = style.voxel || {};
    const mat = new THREE.MeshPhongMaterial({
        vertexColors: true,
        side: THREE.DoubleSide,
        specular: new THREE.Color(0, 0, 0),
        shininess: 1,
    });
    mat.transparent = false;
    mat.depthWrite = true;
    mat.depthTest = true;
    mat.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, shared);
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>',
                `#include <common>\n attribute float aValue;\n attribute float aClusterSize;\n varying float vThreshValue;\n varying float vClusterSize;\n varying float vViewZ;\n ${SLICE_VERT_PARS}`)
            .replace('#include <begin_vertex>',
                `#include <begin_vertex>\n vThreshValue = aValue;\n vClusterSize = aClusterSize;`)
            .replace('#include <project_vertex>',
                `#include <project_vertex>\n vViewZ = -mvPosition.z;\n ${SLICE_VERT_ASSIGN}`);
        shader.fragmentShader =
            `uniform float uThreshold, uMaxAbs, uPositiveOnly, uClusterMin, uNearZ, uFarZ, uDepthNearZ, uDepthFarZ, uDepthCut, uVeilStrength, uVeilK, uEmissiveBoost, uGlintAmt, uGlintPow;\n             uniform vec3 uVeilColor;\n             varying float vThreshValue; varying float vClusterSize; varying float vViewZ;\n             ${SLICE_FRAG_PARS}\n` + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>',
            `#include <color_fragment>
             if (gbSliceDiscard(vWorldPos)) discard;
             if (abs(vThreshValue) < uThreshold) discard;
             if (uPositiveOnly > 0.5 && vThreshValue < 0.0) discard;
             if (vClusterSize < uClusterMin) discard;
             float gateZf = clamp((vViewZ - uDepthNearZ) / max(uDepthFarZ - uDepthNearZ, 1e-3), 0.0, 1.0);
             float keepDepth = max(0.02, 1.0 - clamp(uDepthCut, 0.0, 1.0));
             if (uDepthCut > 0.0001 && gateZf > keepDepth) discard;
             float zf = clamp((vViewZ - uNearZ) / max(uFarZ - uNearZ, 1e-3), 0.0, 1.0);
             float veil = log(1.0 + uVeilK * zf) / log(1.0 + uVeilK);
             diffuseColor.rgb = mix(diffuseColor.rgb, uVeilColor, veil * uVeilStrength);
             totalEmissiveRadiance += diffuseColor.rgb * uEmissiveBoost;`);
        shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>',
            `{
                vec3 Hg = normalize(vec3(-0.3, 0.4, 1.0) + vec3(0.0, 0.0, 1.0));
                float g = pow(max(dot(normal, Hg), 0.0), max(uGlintPow, 1.0)) * uGlintAmt;
                outgoingLight += vec3(g);
             }
             #include <opaque_fragment>`);
    };
    return mat;
}

export function makeSurfaceMaterial(style = {}, shared) {
    const mat = new THREE.MeshPhongMaterial({
        vertexColors: true, side: THREE.FrontSide,
        specular: new THREE.Color(0, 0, 0), shininess: 1,
    });
    mat.transparent = false; mat.depthWrite = true; mat.depthTest = true;
    mat.polygonOffset = true; mat.polygonOffsetFactor = -1; mat.polygonOffsetUnits = -4;
    mat.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, shared);
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>',
                `#include <common>\n attribute float aValue;\n attribute float aMask;\n varying float vThreshValue;\n varying float vMask;\n varying float vViewZ;\n ${SLICE_VERT_PARS}`)
            .replace('#include <begin_vertex>',
                `#include <begin_vertex>\n vThreshValue = aValue;\n vMask = aMask;`)
            .replace('#include <project_vertex>',
                `#include <project_vertex>\n vViewZ = -mvPosition.z;\n ${SLICE_VERT_ASSIGN}`);
        shader.fragmentShader =
            `uniform float uThreshold, uMaxAbs, uPositiveOnly, uNearZ, uFarZ, uDepthNearZ, uDepthFarZ, uDepthCut, uVeilStrength, uVeilK, uEmissiveBoost, uGlintAmt, uGlintPow;\n             uniform vec3 uVeilColor, uBaseColor;\n             uniform float uBaseApply, uMaskApply;\n             uniform vec3 uMaskColor;\n             varying float vThreshValue; varying float vMask; varying float vViewZ;\n             ${SLICE_FRAG_PARS}\n` + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>',
            `#include <color_fragment>
             if (gbSliceDiscard(vWorldPos)) discard;
             float gateZf = clamp((vViewZ - uDepthNearZ) / max(uDepthFarZ - uDepthNearZ, 1e-3), 0.0, 1.0);
             float keepDepth = max(0.02, 1.0 - clamp(uDepthCut, 0.0, 1.0));
             if (uDepthCut > 0.0001 && gateZf > keepDepth) discard;
             bool gbMasked = uMaskApply > 0.5 && vMask < 0.5;
             bool gbSub = abs(vThreshValue) < uThreshold
                       || (uPositiveOnly > 0.5 && vThreshValue < 0.0);
             if (gbMasked) {
                 diffuseColor.rgb = uMaskColor;
             } else if (gbSub) {
                 if (uBaseApply < 0.5) discard;
                 diffuseColor.rgb = uBaseColor;
             }
             float zf = clamp((vViewZ - uNearZ) / max(uFarZ - uNearZ, 1e-3), 0.0, 1.0);
             float veil = log(1.0 + uVeilK * zf) / log(1.0 + uVeilK);
             diffuseColor.rgb = mix(diffuseColor.rgb, uVeilColor, veil * uVeilStrength);
             totalEmissiveRadiance += diffuseColor.rgb * uEmissiveBoost;`);
        shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>',
            `{
                vec3 Hg = normalize(vec3(-0.3, 0.4, 1.0) + vec3(0.0, 0.0, 1.0));
                float g = pow(max(dot(normal, Hg), 0.0), max(uGlintPow, 1.0)) * uGlintAmt;
                outgoingLight += vec3(g);
             }
             #include <opaque_fragment>`);
    };
    return mat;
}
