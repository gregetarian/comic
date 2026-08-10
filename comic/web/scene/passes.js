/**
 * passes.js — depth-edge outline pass + its depth materials. Browser side.
 *
 * Renders a layer's view-space depth into a device-resolution target, then a
 * screen-space quad detects depth discontinuities → silhouette lines. Separate
 * passes draw cortex and subcortex line art; per-overlay passes draw faint voxel edges
 * with threshold-aware depth materials so those edges track the live slider.
 *
 * DEPTH-TARGET ENCODING (every material that writes into one of these targets):
 *   R = view-space depth / 500   (the cut cap writes it NEGATED, as its own marker)
 *   G = 1.0 where geometry was drawn, 0.0 where it was not  ← the COVERAGE flag
 * The targets are cleared to DEPTH_CLEAR (R=1 "far", G=0 "empty") rather than to the
 * figure's background colour, so "is this pixel background?" is an exact G test instead
 * of a guess about the clear colour. That is what lets the outer silhouette be separated
 * from the interior folds (uBgMode), and it is why a dark `render.background` no longer
 * makes the clip test read the empty background as a surface sitting in front.
 */
import * as THREE from 'three';
import { sliceUniforms, SLICE_FRAG_PARS, SLICE_VERT_PARS, SLICE_VERT_ASSIGN } from './materials.js';

/** Clear colour for every depth target: red = (R 1, G 0) = "far, no coverage".
 *  A colour primary is a fixed point of the sRGB transfer function, so it survives
 *  whichever colour space three.js picks for the clear regardless of render target. */
export const DEPTH_CLEAR = new THREE.Color(1, 0, 0);
const _prevClear = new THREE.Color();   // scratch for save/restore around a depth-target clear

const screenQuadVert = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy,0.,1.); }`;

// Cortex-outline depth material — sliced so the silhouette follows a Free Canvas cut.
const depthVert = `varying float vDepth;
${SLICE_VERT_PARS}
void main(){ vec4 p = modelViewMatrix*vec4(position,1.); vDepth = -p.z; ${SLICE_VERT_ASSIGN} gl_Position = projectionMatrix*p; }`;
const depthFrag = `varying float vDepth;
${SLICE_FRAG_PARS}
void main(){ if (gbSliceDiscard(vWorldPos)) discard; gl_FragColor = vec4(vDepth/500.,1.,0.,1.); }`;

/** Plain depth material — writes view-Z/500, slice-aware, NO threshold. Used for the
 *  cortex silhouette, and reusable to fold an opaque surface (e.g. the opaque subcortex)
 *  into the edge/outline clip depth so strokes behind it are occluded. `side` should match
 *  the surface's render side (BackSide for the back-wall opaque shell). */
export function makePlainDepthMaterial(side = THREE.DoubleSide) {
    return new THREE.ShaderMaterial({
        vertexShader: depthVert, fragmentShader: depthFrag, side,
        uniforms: sliceUniforms(),
    });
}

const outlineFrag = `
uniform sampler2D tDepth; uniform vec2 uResolution; uniform float uLineWidth, uThreshold, uOpacity; uniform vec3 uColor;
uniform float uVeilApply, uNearZ, uFarZ, uVeilStrength, uVeilK; uniform vec3 uVeilColor;
uniform sampler2D uClipDepth; uniform float uClipApply, uOverVoxelAlpha, uBgMode;
varying vec2 vUv;
void main(){
    vec2 texel = 1.0/uResolution; float w = uLineWidth;
    vec2 t0 = vec2(texel.x*w,0.), t1 = vec2(0.,texel.y*w);
    vec4 C = texture2D(tDepth, vUv);
    vec4 L = texture2D(tDepth, vUv-t0), R = texture2D(tDepth, vUv+t0);
    vec4 U = texture2D(tDepth, vUv+t1), D = texture2D(tDepth, vUv-t1);
    float c = C.r, l = L.r, r = R.r, u = U.r, d = D.r;
    float edge = abs(l-r)+abs(u-d), edge2 = abs(c-l)+abs(c-r)+abs(c-u)+abs(c-d);
    // Near-BINARY strength: any depth step that clears the threshold draws at full opacity and full
    // width; anything below doesn't draw at all. The narrow ramps (just wide enough for edge AA) stop
    // weak/grazing folds rendering as faded half-strength smudges, so every line is uniformly visible.
    float s = max(smoothstep(uThreshold*0.96,uThreshold,edge), smoothstep(uThreshold,uThreshold*1.08,edge2));
    // Silhouette vs interior fold. G is the coverage flag (1 = geometry, 0 = empty background), so a
    // tap touching the background means this discontinuity IS the outer contour. uBgMode:
    //   0 = draw both (the historical single-pass behaviour, and the default)
    //   1 = interior folds only  — the separate silhouette pass owns the outer contour
    //   2 = silhouette only      — that separate pass
    if (uBgMode > 0.5) {
        float minCov = min(min(min(C.g,L.g),min(R.g,U.g)),D.g);
        bool touchesBg = minCov < 0.5;
        if (uBgMode < 1.5) { if (touchesBg) s = 0.0; }
        else if (!touchesBg) s = 0.0;
    }
    // Depth-correct vs voxels: where a voxel is genuinely in front of the nearest surface
    // sample, the line passes UNDER the voxel. uOverVoxelAlpha scales the stroke there:
    // 0 = fully occluded (the voxel hides the line), 1 = drawn at full strength on top,
    // and values in between draw a semi-transparent stroke that blends with the voxel colour
    // (so the buried line reads as a muted/greyed version of the blob it crosses).
    if (uClipApply > 0.5 && s > 0.0) {
        float surfNear = min(min(min(c,l),min(r,u)),d);   // closest surface sample (depth/500)
        float rawClip = texture2D(uClipDepth, vUv).r;
        float vd = abs(rawClip);
        if (vd < surfNear - 0.0008 && vd < 0.999) {
            // The MRI face is an opaque one-way wall: never draw a post-process line through it.
            // Ordinary voxels still honour the configured over-voxel stroke strength.
            if (rawClip < 0.0) s = 0.0;
            else s *= uOverVoxelAlpha;
        }
    }
    vec3 col = uColor;
    // Voxel edges fade with the same depth veil as the voxels (scales with the
    // veil sliders). c*500 reconstructs the view-space depth stored by the pass.
    if (uVeilApply > 0.5) {
        float zf = clamp((c*500.0 - uNearZ)/max(uFarZ-uNearZ,1e-3), 0.0, 1.0);
        float vl = log(1.0+uVeilK*zf)/log(1.0+uVeilK);
        col = mix(uColor, uVeilColor, vl*uVeilStrength);
    }
    gl_FragColor = vec4(col, s*uOpacity);
}`;

/** Threshold-aware depth material — discards voxels below the live threshold so
 *  the voxel edge outline recomputes on the fly. Bound to shared voxel uniforms. */
export function makeThresholdDepthMaterial(sharedUniforms) {
    const s = sharedUniforms;
    return new THREE.ShaderMaterial({
        side: THREE.DoubleSide,
        uniforms: {
            uThreshold: s.uThreshold,
            uPositiveOnly: s.uPositiveOnly,
            uClusterMin: s.uClusterMin,
            uDepthNearZ: s.uDepthNearZ,
            uDepthFarZ: s.uDepthFarZ,
            uDepthCut: s.uDepthCut,
            // share the overlay's slice uniforms so the voxel edges follow the cut too
            uSliceType: s.uSliceType, uSliceMode: s.uSliceMode,
            uSliceNormal: s.uSliceNormal, uSliceOffset: s.uSliceOffset,
            uSliceCenter: s.uSliceCenter, uSliceRadius: s.uSliceRadius,
            uSliceMin: s.uSliceMin, uSliceMax: s.uSliceMax,
        },
        vertexShader: `attribute float aValue; attribute float aClusterSize; varying float vDepth; varying float vT; varying float vC;
            ${SLICE_VERT_PARS}
            void main(){ vec4 p = modelViewMatrix*vec4(position,1.); vDepth=-p.z; vT=aValue; vC=aClusterSize; ${SLICE_VERT_ASSIGN} gl_Position=projectionMatrix*p; }`,
        fragmentShader: `uniform float uThreshold, uPositiveOnly, uClusterMin, uDepthNearZ, uDepthFarZ, uDepthCut; varying float vDepth; varying float vT; varying float vC;
            ${SLICE_FRAG_PARS}
            void main(){ if (gbSliceDiscard(vWorldPos)) discard; if(abs(vT)<uThreshold) discard; if(uPositiveOnly>0.5 && vT<0.0) discard; if(vC<uClusterMin) discard; float gateZf=clamp((vDepth-uDepthNearZ)/max(uDepthFarZ-uDepthNearZ,1e-3),0.0,1.0); float keepDepth=max(0.02,1.0-clamp(uDepthCut,0.0,1.0)); if(uDepthCut>0.0001 && gateZf>keepDepth) discard; gl_FragColor=vec4(vDepth/500.,1.,0.,1.); }`,
    });
}

export class OutlinePass {
    constructor(renderer, scene, width, height, opts = {}) {
        this.renderer = renderer;
        this.scene = scene;
        this.camera = null;
        this.layer = opts.layer ?? 0;
        this.pr = renderer.getPixelRatio();
        const pw = Math.round(width * this.pr), ph = Math.round(height * this.pr);

        this.depthCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 600);
        this.depthTarget = new THREE.WebGLRenderTarget(pw, ph, {
            minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, type: THREE.FloatType,
        });
        this.depthMaterial = opts.depthMaterial || new THREE.ShaderMaterial({
            vertexShader: depthVert, fragmentShader: depthFrag, side: THREE.DoubleSide,
            uniforms: sliceUniforms(),   // cortex outline follows a Free Canvas cut (set per panel)
        });
        const col = new THREE.Color(opts.color ?? 0x000000);
        this.outlineMaterial = new THREE.ShaderMaterial({
            vertexShader: screenQuadVert, fragmentShader: outlineFrag,
            transparent: true, depthTest: false, depthWrite: false,
            uniforms: {
                tDepth: { value: this.depthTarget.texture },
                uResolution: { value: new THREE.Vector2(pw, ph) },
                uLineWidth: { value: opts.width ?? 1.5 },
                uThreshold: { value: opts.threshold ?? 0.004 },
                uColor: { value: new THREE.Vector3(col.r, col.g, col.b) },
                uOpacity: { value: opts.opacity ?? 1.0 },
                // veil: bind to the shared voxel uniforms so edges fade with the
                // voxels and scale with the veil sliders (uVeilApply=1 for voxels).
                uVeilApply: { value: opts.veil ? 1.0 : 0.0 },
                uNearZ: opts.veil ? opts.veil.uNearZ : { value: 0 },
                uFarZ: opts.veil ? opts.veil.uFarZ : { value: 1 },
                uVeilStrength: opts.veil ? opts.veil.uVeilStrength : { value: 0 },
                uVeilK: opts.veil ? opts.veil.uVeilK : { value: 6 },
                uVeilColor: opts.veil ? opts.veil.uVeilColor : { value: new THREE.Color(0xffffff) },
                // Depth-correct clipping against another layer's depth (set by the
                // engine: the cortex outline clips against the voxel depth).
                uClipDepth: { value: null },
                uClipApply: { value: 0.0 },
                // Stroke strength where a voxel is in front of this line. 0 = occluded (default,
                // so the voxel-edge passes keep their old behaviour); the cortex outline sets it.
                uOverVoxelAlpha: { value: 0.0 },
                // 0 = draw silhouette + interior folds together (historical default), 1 = interior
                // only, 2 = silhouette only. Set per frame by the engine.
                uBgMode: { value: opts.bgMode ?? 0.0 },
            },
        });
        this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.outlineMaterial);
        this.quadScene = new THREE.Scene(); this.quadScene.add(this.quad);
        this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    }

    setSize(width, height) {
        const pw = Math.round(width * this.pr), ph = Math.round(height * this.pr);
        this.depthTarget.setSize(pw, ph);
        this.outlineMaterial.uniforms.uResolution.value.set(pw, ph);
    }

    /** Render outline for one viewport (vp in CSS px, GL bottom-left origin). */
    update(camera, x, y, w, h) {
        const r = this.renderer;
        const prevOverride = this.scene.overrideMaterial;
        this.depthCamera.copy(camera);
        r.setRenderTarget(this.depthTarget);
        r.setScissorTest(false);
        // Clear to the fixed far/no-coverage sentinel, NOT to the figure background: the shader's
        // background test must not depend on what colour the user chose. Restored immediately after
        // so renderFrame's own full-canvas clear still paints the real background.
        const prevClear = r.getClearColor(_prevClear), prevAlpha = r.getClearAlpha();
        r.setClearColor(DEPTH_CLEAR, 1);
        r.clear();
        this.depthCamera.layers.set(this.layer);
        this.scene.overrideMaterial = this.depthMaterial;
        r.render(this.scene, this.depthCamera);
        r.setClearColor(prevClear, prevAlpha);
        this.scene.overrideMaterial = prevOverride;
        r.setRenderTarget(null);
        r.setViewport(x, y, w, h);
        r.setScissor(x, y, w, h);
        r.setScissorTest(true);
        r.render(this.quadScene, this.quadCamera);
    }

    /** Free GPU resources. Called when the engine is rebuilt (overlay add/remove). */
    dispose() {
        this.depthTarget.dispose();
        this.depthMaterial.dispose();
        this.outlineMaterial.dispose();
        this.quad.geometry.dispose();
    }
}
