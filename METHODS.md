# COMIC 2.0 — Methods

How a NIfTI statistical map becomes a rendered glass-brain figure. There is ONE
meshing backend (`comic/pipeline.py`) and ONE rendering engine (the
Three.js viewer under `comic/web/`). The same files run three ways:

- **Browser** (GitHub Pages / `comic open`): uploads are meshed in-browser
  by a byte-identical Pyodide copy of `pipeline.py`; the engine renders live.
- **Standalone CLI** (`comic render`): `pipeline.py` runs in CPython
  in-process, geometry is written as arrays, and the *same* engine is driven
  headlessly in Playwright/Chromium to screenshot a PNG.
- **Python** (`comic.render`, `comic.render_spec`, and `RenderSession`): notebook,
  scripted, and high-throughput entry points over the same renderer.

> This document supersedes the original PyVista/VTK prototype AND the later
> GLB-per-overlay `overlays.py`/`export.py`-overlay path. Per-upload meshing now
> emits raw geometry **arrays**, not GLB, and there is no `overlays.py`.

---

## 1. Data sources & the one-time bake — `bake.py`

The default fsaverage/MNI152 template is baked once (needs the `[bake]` extra:
mne/trimesh/cmap) into `comic/web/data/` as an atomic, validated bundle:

- Cortical **pial**, **white**, and **inflated** surface GLBs per hemisphere (curvature in the
  vertex-colour red channel — currently UNUSED by the glass material).
- Subcortical structure GLBs (one solid-colour mesh each).
- `aseg_uint8.bin.gz` + `aseg.json`: the FreeSurfer `aseg` segmentation as gzipped
  uint8 256³ plus a sidecar (dims, affine) — the volume used for voxel→region
  classification at runtime.
- `colormaps.json`: 256×3 sRGB LUTs sampled from the `cmap` catalogue.
- `anat_uint8.bin.gz` + `anat.json`: native-1-mm AFNI MNI2009c T1 values plus exact
  pial-footprint and hemisphere masks for the one-sided cut MRI surface.
- `scene.json` is the base manifest (no overlays): it records the transform identity,
  available surface variants, cut-anatomy payload, and measured pial↔T1 alignment.
  `template.validate_template_bundle` fails loudly if the bundle is incomplete or outside
  its documented tolerance. `render-config.json` supplies the default preset/style, and
  `demo/` contains a pre-baked instant landing overlay.
- `bake()` also copies `pipeline.py` → `web/pyodide/pipeline.py` so the two stay
  byte-identical (guarded by `tests/test_pyodide_sync.py`).

Space: MNI305 → **MNI152** via the standard FreeSurfer 4×4 affine in `surfaces.py`
(~2 mm; visualisation-grade).

## 2. Stat-map loading & thresholding — `pipeline.load_stat_map`

Loads a NIfTI from a path (CLI) or raw bytes (browser upload). Bytes are written
to a temp file with the extension chosen from the gzip magic (`1f 8b`) so a
mislabelled `.nii` upload still decompresses correctly. The volume is squeezed to
3D (a 4D timeseries raises), then `|value| < threshold → 0` (default z = 2.3).
Non-finite voxels (NaN/±inf) are zeroed before thresholding so they cannot poison
the percentile clim. Returns `(data, affine)`.

## 3. Voxel → structure classification — `pipeline.classify_overlay_voxels`

Each non-zero overlay voxel is mapped to its `aseg` label via an
overlay-ijk → world → `inv(aseg_affine)` → aseg-ijk round-trip and bucketed into a
category: `lh_cortex`, `rh_cortex`, `subcort_l/r`, `cereb_l/r`, `brainstem`. This
lets each panel show only the geometry it should (e.g. a left-lateral panel hides
the right hemisphere) with no downstream string matching.

## 4. Cluster-extent sizing — `pipeline.cluster_sizes`

Connected-component labelling (`scipy.ndimage.label`, 26-connectivity = the FSL
`cluster` default), **positive and negative blobs labelled separately**, assigning
every voxel its cluster's size in voxels.

- Drives the **cluster-extent threshold** (hide clusters smaller than *k* voxels),
  applied live in the shader from the per-vertex cluster-size attribute.
- Sizes are computed at the bake threshold; raising the live intensity threshold
  above it makes displayed cluster sizes an upper bound.

## 5. Voxel meshing — `pipeline.py`

Two representations are produced per structure; the engine chooses one live.

- **Blocky** (`_voxel_mesh`): exposed-face extraction — for each of the 6 axis
  directions emit a quad only where a voxel face abuts empty space. Watertight,
  self-occluding clusters at a fraction of a full hexahedral mesh. Each scalar
  field (signed value, cluster size) is sampled per emitted vertex.
- **Smooth** (`build_smooth_mesh`): sparse connected components target a 0.5 mm
  grid, Gaussian-smooth the occupancy, `marching_cubes(level=0.5)`, transform to
  world via the overlay affine. The value field is **nearest-filled** before
  sampling so boundary vertices keep saturated colour. Tiny clusters that yield no
  marching-cubes surface fall back to the blocky geometry (smooth mode never
  silently hides them). Dense, threshold-zero whole-brain maps select a coarser grid
  under an explicit memory budget instead of manufacturing an impractically large
  uniform 0.5-mm mesh.

`process_nifti(src, name, threshold)` runs the whole chain and returns a JSON
meta string (`name`, `threshold`, `maxAbsValue` = 99th percentile of |value| over
classified voxels, `maxClusterSize`, `diverging` = data has both signs,
`structures` referencing staged buffer indices). The raw geometry arrays
(positions/faces/values/clusters) are staged in `_BUFFERS`. **No colour is emitted
— the JS engine is the single colour authority.**

### 5a. Native surface overlays — `pipeline.process_surface`

A per-vertex fsaverage map (a surface analysis, not a volume) skips voxel meshing
entirely. `load_surface_map(src)` reads one scalar per vertex from a GIFTI (`.gii`),
FreeSurfer `.mgh`/`.mgz`, or FreeSurfer morphometry/curv file (nibabel). `process_surface(
lh_src, rh_src, name, threshold)` loads lh/rh, computes the same `maxAbsValue`/`diverging`
stats from the **supra-threshold** vertices, and stages the baked cortex sheet coloured by
those RAW values via `_stage_surface` (shared with the M8 volume→surface projection; the
shader thresholds live). It requires `init_cortex()`. A **lower-resolution** fsaverage map
(ico1–6, e.g. fsaverage5 = 10242/hemi) is nearest-neighbour **upsampled** to the ico7 template
(`_upsample_to_template`): FreeSurfer's icosahedra are nested, so the low-res vertices ARE the
template's first N vertices, and a KDTree over that prefix maps every ico7 vertex to its nearest
source. A non-icosahedral vertex count raises. (Note: a null hemisphere arrives from Pyodide as
a `JsNull` proxy, not Python `None`, so it is normalised by type name.) The meta has
`surfaceOnly: True`, empty `structures`, and a `surface` block. On the engine side that flag
forces the overlay's visibility gate to the
`surface` variant regardless of the panel/global representation (`visibility.js`), so a
surface overlay **never offers blocky/smooth** — the browser row shows a fixed `surface`
tag instead of the representation selector, and there is no volume cluster-extent `-k`.
CLI: `comic render --surface-map lh=lh.gii,rh=rh.gii[,name=Label] -o out.png` (repeatable;
volume overlays, if any, come first). Browser drag/drop uses the same pipeline and pairs
left/right files by filename. The high-level notebook `comic.render` helper currently accepts
volume inputs; native surface inputs use the CLI or browser path.

## 6. Geometry handoff — `arrays.py` (CLI/Python) & Pyodide (browser)

- Browser: `get_all_buffers()` returns the staged buffers; JS reconstructs typed
  arrays and builds meshes directly.
- CLI/Python: `arrays.write_overlay_arrays(data_dir, meta, buffers, index)`
  concatenates the buffers into `overlay_<i>.bin` and records `bufferLayout`
  ([offset, length] per buffer) + `buffersFile` in `scene.json`'s `overlays` list.
  The viewer's asset-loader slices the `.bin` back into the same per-buffer arrays
  — the exact code path the browser uses for an upload.

## 7. Config — `web/core/config-schema.js`

The single source of truth for a viewer config, driving BOTH the browser and the
headless renderer. `DEFAULTS{render, style, layout}`; `normalizeConfig` deep-merges
over the defaults and validates; `overlayStyle(cfg, i)` resolves the effective
per-overlay style (per-NIfTI overrides in `style.overlays[i]` over the globals);
`validateConfig` enforces load-bearing invariants (every panel has an id + camera
and is positioned by EXACTLY ONE of `cell{row,col}` or `place{x,y,w,h}`).

- `style.voxel.{representation, clusterMin, smoothing, shininess, specular,
  emissive, veil, edges}`, `style.{colormap, colormapMode, threshold,
  positiveOnly, gamma, margin, cortexSurface}`, `glass`, `anatomy`, `outline`,
  `lighting`, `tilt`, `shadows`.
- `layout.{mode:'grid'|'free', grid, canvas{w,h,bgAlpha}, panels[]}`; a panel
  carries `content{roles, hemisphere, categories, representation, anatomyStyle,
  anatomyHemisphere, anatomyCategories, voxelCategories}`, `camera{plane}` or `{pose}`,
  `framing`, per-panel surface choice, and (free mode) `rotate` / `slice`. Explicit
  `voxelCategories` make paired medial views asymmetric by design: left medial cortex is
  paired with right subcortical/cerebellar meshes and voxels, and vice versa; brainstem is
  retained as a midline category.

## 8. Colour — `web/core/colormap.js`

The single colour authority (identical in browser and headless).

- **Normalisation:** power-law (`gamma`, default 0.5 = sqrt). `maxAbs` = the
  per-overlay 99th percentile from `process_nifti`.
- **Mode:** `diverging` (symmetric about 0) vs `sequential`, auto-chosen from the
  data's sign content unless `colormapMode` forces it.
- **Washout guards:** if a *diverging* LUT is used on single-sign data, `t` is
  confined to one half of the LUT so values never collapse onto the white centre
  (`divergingMapOnPositive` → upper half; the mirror `divergingMapOnNegative` →
  lower half).
- Voxels are coloured from the per-vertex value attribute via `colorizeValues`
  (sRGB→linear), so interactive and headless images are identical.

## 9. Rendering engine — `web/scene/*`, `web/app/main.js`

`createEngine` (in `renderer.js`) is the multi-panel multi-overlay engine: per-panel
cameras/scissors, per-overlay materials/layers, `recolor()` via `colormap.js`,
per-panel slice uniforms, draw priority = overlay index. `main.js` is the single
entry for both modes: interactive (boots empty; uploads via Pyodide) and headless
(`?headless=1`: loads overlays from the manifest `.bin` files, renders a few frames,
sets `window.__GB_DONE__` for Playwright; load failures set `window.__GB_ERR__`).

Cameras apply a fixed oblique world-space **tilt** kept right-handed (so lighting
stays correct and L/R laterals mirror). Framing auto-fits each panel; whole-brain
panels can share one world scale. In Free Canvas the RGB MNI-axis gizmo is anchored to
the authored panel rectangle, not the changing projected brain bounds. Glass cortex =
fresnel + cel material; voxels are
opaque `MeshPhong` with shader discards (threshold / clusterMin / positive-only),
an emissive flat-colour term, a logarithmic depth veil, and a light-independent
glint. Outline passes render view-space depth to a float target and detect depth
discontinuities → black cortex silhouette + faint per-voxel edges. Plane, spherical,
and cubic cuts share clipping state across cortex, internal anatomy, and voxel meshes.
The cut-MRI pass samples the bundled 1-mm T1, writes opaque depth on the exposed side,
and is reverse-side culled. A separate cut-map pass samples the retained source NIfTI
texture with nearest/linear interpolation and a max-absolute slab.

### 9a. Line sets, the coverage flag, and the split outer contour

**What was done.** Every line COMIC draws comes from one screen-space filter
(`OutlinePass`, `web/scene/passes.js`): a chosen THREE layer is re-rendered with a depth
material into a float target, and a full-screen quad thresholds a 4-tap depth-discontinuity
metric. Three changes were made to that machinery.

*Coverage flag.* Depth materials now write `G = 1` where geometry was drawn, and the depth
targets are cleared to a fixed sentinel `(R = 1 "far", G = 0 "empty")` instead of to the
figure's background colour. Testing `G < 0.5` is therefore an exact "this tap is empty
background" predicate. **Rationale:** the previous code inferred background from the red
channel via `vd < 0.999`, which is only valid for a white background — with
`render.background = "#000000"` the target cleared to depth 0, i.e. nearer than any surface,
so the over-voxel clip treated empty space as an occluder and dimmed the *entire* cortex
outline whenever clipping was active. **Assumption removed:** that the clear colour encodes
a usable depth. The `R` channel still carries `viewZ/500` unchanged.

*Split silhouette.* `style.outline.silhouette = {enabled, color, width}`. A new pass strokes
only discontinuities whose neighbourhood touches empty background (`uBgMode = 2`), over a
depth buffer composited from **all** visible layers — cortex, subcortex, every overlay's
supra-threshold voxels, and the cut cap — so the contour follows the union of what is drawn
rather than the cortex alone. When it runs, the cortex/subcortex passes switch to
`uBgMode = 1` (interior folds only) so the two never stroke the same pixels in different
colours. **Rationale:** the outer contour and the sulcal/gyral lines were the same pass, so
recolouring, thinning, or disabling the folds also destroyed the brain's outline;
`--no-outline` produced a blank silhouette-less figure.

*Zero-regression gate.* The separate pass is **skipped entirely** when
`silhouette.color` and `silhouette.width` are both null *and* `outline.enabled` is true —
i.e. when it would draw exactly what the single historical pass already draws. Verified: all
four `tests/test_golden_renders.py` jobs render **byte-identical** (mean |Δ| = 0.000000, 0
differing pixels) to the same jobs at `d39d62f`. Note the *committed* baselines are
independently stale — they fail identically at `d39d62f` and at this change — so the
comparison was made against renders produced from a clean checkout, not against
`tests/golden/`.

*Live line colours.* `outline.color`, `outline.anatomyColor` (new; null = inherit
`outline.color`), `silhouette.color` and per-overlay `voxel.edges.color`/`.threshold` are
now pushed by `applyStyle()`. **Rationale:** they were written once at pass construction, so
changing a line colour required a full engine rebuild — which is why the colour fields in
the schema had no UI at all.

**Parameters.** `--borders ATLAS`, `--border-color`, `--border-w`; `--line-color`,
`--anat-line-color`, `--voxel-edge-color`,
`--silhouette-color`, `--silhouette-w` (CLI); the *Lines* control group (browser); the same
keys under `style.outline` for `--spec`/`gb.render(style=...)`. Colours are validated as
`#rgb`/`#rrggbb` in **both** `config-schema.js:validateConfig` and `spec.py:validate`
(null always passes = "inherit"), because a typo'd colour otherwise renders black with no
diagnostic.

**Also fixed.** `applyPanelSlice()` never reached the subcortex outline's depth material, so
on a sliced Free-Canvas panel that outline was computed from uncut geometry; the pass is now
constructed with an explicit, slice-tracked depth material.

**Alternatives considered.** (i) Leaving the contour in the cortex pass and drawing a second
darker contour on top — rejected: the underlying light-coloured contour still fringes
through the anti-aliased edge. (ii) Making the silhouette pass unconditional — rejected: it
perturbs the anti-aliasing ramp of every existing figure for no benefit in the default case.

### 9b. Parcellation boundary lines — `web/core/parcel-field.js`, `web/scene/parcellation.js`

**What was done.** Atlas parcel borders drawn on the cortical surface, as a geodesic
distance-field line rather than an edge filter.

**Method.** For each hemisphere, per-vertex integer labels `L(v)` (−1 = not cortex):

1. **Adjacency** (`buildAdjacency`) in CSR form from the existing triangle index buffer. Topology
   is shared by pial/white/inflated and by every atlas, so it is built once per hemisphere and
   memoised on the geometry.
2. **Colouring** (`colorParcels`): a greedy Welsh–Powell proper colouring of the parcel adjacency
   graph, with the medial wall as one extra virtual parcel. Adjacent parcels get different colours.
3. **Signed fields** (`signedBoundaryFields`): for each of `PLANES = 4` colour bits, the surface
   splits two ways — parcels whose colour has that bit set, and the rest. Each edge joining the two
   sides is an interface crossing at its midpoint, so its endpoints are seeded at **±half the edge
   length**, positive on the bit-set side. Magnitudes propagate by Bellman-Ford over a shrinking
   frontier, capped at `DIST_MAX = 8 mm`; each vertex keeps the sign of its own side.
4. **Contour smoothing** (`smoothFields`): a fixed 4 Laplacian passes over the packed fields.
5. **Render**: the border geometry *shares* the cortex mesh's position and index attributes and
   adds only `aSigned` (a `vec4`), so the layer costs four floats per vertex rather than a second
   copy of the surface. The fragment shader takes the nearest zero crossing across the planes,
   `px = min_b |s_b| / ‖∇s_b‖`, and `alpha = 1 − smoothstep(h − 0.7, h + 0.7, px)`.

**Rationale.** Because a distance field has |∇d| ≈ 1, the screen-space gradient magnitude *is*
mm-per-pixel, so `h` is a true device-pixel half-width — the line holds its thickness at any zoom,
panel size or surface variant, and is analytically anti-aliased. `length(vec2(dFdx, dFdy))` rather
than `fwidth()` because `fwidth` is |dFdx| + |dFdy|, which overestimates the gradient by up to √2
*and varies with the boundary's on-screen orientation*, making diagonal borders visibly thinner
than axis-aligned ones.

**Assumptions.** (i) |∇d| ≈ 1 — true for a geodesic distance field away from the medial axis; it
degrades only at triple junctions where three parcels meet, thickening the line by ≲40% over a few
pixels. (ii) Linear interpolation of `d` across a triangle is accurate near the boundary — holds
because ico7 triangles are ~1 mm and the line is ~1 mm wide. (iii) The atlas and the template are
the same mesh: a vertex-count mismatch **throws** rather than drawing another brain's boundaries.

**Why the field has to be signed — two failed attempts, recorded because both look reasonable.**

*Unsigned, seeded at the midpoint.* Put the boundary at the edge midpoint and seed both endpoints
with half the edge length. Both endpoints then hold the **same positive value**, so the linear
interpolant across the boundary is a plateau at ~0.5 mm rather than a V through zero. The field
never reaches 0, the line never reaches full opacity, and borders render as a faint grey smudge
whose strength varies with local edge length. An unsigned distance field has a *crease* at the
boundary, and linear interpolation across a triangle cannot represent a crease in that triangle's
interior — so no seeding of an unsigned field can be sub-triangle accurate.

*Unsigned, zero on the vertices.* Seeding the zero set onto boundary vertices fixes the opacity,
and was shipped first. But it makes the rendered contour a **dilated vertex set**: quantised to the
mesh, visibly staircased at ~1 mm, with a width that wanders depending on how the band falls. This
is exactly the artefact the distance-field approach was chosen to avoid, reintroduced by the fix
for the previous problem. It was caught by looking at a high-resolution crop, not by reasoning.

*Signed, via graph colouring (shipped).* A sign needs a two-way split, and a many-parcel partition
has no global inside/outside — but each **bit** of a proper colouring is one: adjacent parcels
differ in at least one bit, so every boundary is separated by at least one plane. Signed, the
interpolant runs +½e → −½e and crosses zero exactly at the interface, anywhere inside a triangle.
Four planes are packed into one `vec4`, so this is still a single draw. Planes that separate
nothing stay constant, hence have zero screen gradient, hence are inert — unit-tested.

**Smoothing is fixed, and never touches parcel membership.** An earlier version exposed a `smooth`
parameter driving majority-vote *relabelling* — each vertex taking the modal label of its 1-ring.
That was removed: an atlas's parcel assignment is data, and a viewer editing it to make a line look
nicer misrepresents the atlas. Only the signed *field* is smoothed, which moves the rendered zero
crossing while every vertex keeps the parcel the atlas gave it. It also does not change stroke
width, because the shader measures |s|/‖∇s‖, which is invariant to a local rescaling of `s`. Both
properties are unit-tested (`web/core/parcel-field.test.js`).

**Where the line is painted.** Border meshes are attached to the cortex shells *and* to the M8
surface-projection sheets. These are not the same surface — the sheets are staged on **pial**
vertices while the shell defaults to the mildly-inflated one — so a sheet is in front of the shell
in some places and behind it elsewhere. Carrying a border on both and letting the depth test choose
means the line is always drawn on whichever sheet is frontmost; at one shared colour and full
opacity an overlapping stroke is indistinguishable from a single one. (Attaching only to the shell
was tried first and left the borders largely hidden under the fill.)

**Alternative rejected.** Rendering parcel IDs to a buffer and detecting ID changes in screen space
— the analogue of the existing depth-edge passes — is about a third of the code and reuses
`OutlinePass`. It requires a `flat` varying (GLSL3), which pins every boundary to a triangle edge:
on ico7 at ~3 px/mm that is a ±1.5 px staircase that no amount of smoothing removes, because the
boundary is quantised to the mesh. The distance field is sub-triangle accurate.

### 9c. Parcellation assets and per-parcel values — `parcels.py`

**Atlas assets.** `comic parcels bake` writes, per atlas, a gzipped int16 label array (lh ++ rh)
plus a JSON sidecar of names / colours / hemispheres / Yeo-network tokens. Measured: 26–101 kB per
atlas for both hemispheres, against a 63 MB data directory. Labels index the baked cortex meshes
directly — the bake pipeline preserves fsaverage vertex order bit-exactly (all six cortex GLBs
equal `mni305_to_mni152(read_geometry('?h.pial'))` to max diff 0.0, and pial/white/inflated share
one index buffer), so **one** array serves all three surface variants and no mesh is re-baked.

**`.annot` reading is deliberately not nibabel's.** `nibabel.freesurfer.read_annot` resolves each
vertex's packed-RGB value to a colour-table row with `np.searchsorted` and never verifies the value
was found. A value between two table ids is silently mapped to the wrong region; a value above the
maximum raises `IndexError` (Gordon's fsaverage annot uses `0x7FFFFFFF` for its medial wall and
crashes outright). `parcels.read_annot` does the lookup with an explicit dict and asserts that the
only unmapped values are the known unassigned sentinels.

**Medial-wall normalisation.** The source atlases mark non-cortex four different ways (`-1`, `0`,
`0x7FFFFFFF`, or by region name) and Schaefer's mask differs from FreeSurfer's by 79 vertices. All
are normalised to `-1`, and regions matching
`unknown|medial_wall|background|corpuscallosum|???` are dropped and the remainder renumbered
densely — otherwise comparing two atlases draws a spurious ring around the corpus callosum.

**Per-parcel values.** `--parcel-values table.csv` reads `region,value`, expands it to per-vertex
maps, and feeds the *existing* native-surface overlay path, so parcel fills reuse the whole
colormap/threshold/colorbar pipeline unchanged. Region matching is by the atlas's own name, or by
1-based index when every key is an integer. **Unmatched names raise** rather than warn: silently
dropping rows from a mismatched Schaefer variant yields a figure that looks fine and means nothing.
FreeSurfer atlases spell a region identically in both hemispheres (`bankssts` appears twice in
aparc), so a bare name matches **both** — the bilateral reading a such a table intends — while an
`lh_`/`rh_` prefix or `_lh`/`_rh` suffix selects one. (A plain name→index dict silently kept only
the right-hemisphere entry; caught by `tests/test_parcels.py`.)

**Licensing drives provenance.** Schaefer 2018 (CBIG, MIT, pinned to tag
`v0.14.3-Update_Yeo2011_Schaefer2018_labelname` because earlier revisions shipped erroneous region
names — and the names are what network membership is parsed from) is vendored: 10 atlases, ~800 kB.
FreeSurfer's own atlases (FreeSurfer Software License, not OSI), Yeo 2011 (citation-only) and
Glasser HCP-MMP1 (HCP Open Access Data Use Terms) are **fetched on demand** from the user's own
MNE/FreeSurfer fsaverage install and git-ignored by name. Network membership is parsed from region
names, never from colours: CBIG perturbs each parcel's RGB off its network colour so every parcel
gets a unique packed value, and neighbouring networks' perturbed ranges overlap.

## 10. Headless / Python rendering — `render.py`

`render_to_png(nifti, out_png, *, layout, style, threshold, cmap, ...)` (one path
or a list for a multi-overlay figure): `prepare_render_dir` copies the viewer,
runs `pipeline.py` in-process, writes array overlays, and writes a
`render-config.json`. Playwright Chromium (`--use-angle=swiftshader`) loads
`index.html?headless=1`, waits for `__GB_DONE__` (or raises on `__GB_ERR__`),
screenshots the brain, and optionally writes the colorbar legend as a
`<out>_colorbars.png` sidecar. CLI print defaults (thicker outline, looser margin,
no subcortical shell alpha) are deep-merged UNDER any explicit style flags.
`build_layout(grid, views)` builds a grid layout from `RxC` + row-major view names;
`load_spec(path)` ingests the browser's `figure.json` recipe for `--spec`. The recipe
stores layout/style/size but not image data: positional volume arguments fill
`style.overlays[i]`. The public Python equivalent is
`comic.render_spec("figure.json", volumes)`. Reusing one `RenderSession` amortises the
Chromium startup when the same recipe is applied to many jobs; see
`docs/reusing-figure-json.md`.

The CLI (`core.py cli()`) wraps this: `open`, `bake`, and `render` (NIfTIs `+`,
`--grid`, `--views`, `--spec`, plus per-overlay/global style flags).

## 11. Verification

- **Pyodide parity:** `tests/test_pyodide_sync.py` (byte-identity of the two
  `pipeline.py` copies) + `tests/test_pipeline_parity.py` (CPython geometry matches
  the in-browser ground truth) + `tests/smoketest.py` (Pyodide runs the pipeline).
- **Pure core:** `node --test` over `web/core/*.test.js` guards the load-bearing
  maths — right-handed camera bases, tilt mirror-consistency, framing, grid
  tiling, visibility filters, and the colormap washout guards.
- **CLI arrays:** `tests/test_cli_arrays.py`; **Free Canvas:** `tests/test_free_canvas.py`;
  **headless integration:** `tests/integration_test.py`.

## 12. Paper figures — `paper/make_figures.sh`

All rendered brain figures in the preprint are regenerated by one shell script that
issues one `comic render` per figure (the "figure-as-code" story). Rendered on the
bundled Neurosynth association `z`-maps (`comic/web/data/defaults/`). Common style,
chosen for the cel-shaded look: `--gamma 0.72–0.8` (colour saturation; 0.5 was washed
out), `--veil 0.08` (depth fade-to-white, turned well down so far voxels stay
saturated), the default **inflated** cortex (smooth, bold, continuous curves — the pial
shell was tried but its fine folds make the outline jagged and busy), `--edge-thr 0.018`
`--line-w 7.0` (cortex-outline depth-discontinuity threshold + width; *lower thr = denser
sulcal inking* — the engine default 0.02 with bold width gives the clean major-sulcus
inking, 0.007 was a busy web), `--positive-only`, and `--lines-over-voxels --over-voxel-opacity 0.4`
(new `style.outline.overVoxels` + `overVoxelOpacity` flags: the opaque voxels normally
clip the cortex outline where a blob is in front, *masking* the sulcal lines behind them —
this was the real cause of the "broken lines", not the surface. `overVoxels` draws the
line over the voxels instead; `overVoxelOpacity` (0..1) is the stroke strength for the
buried portion — 1 = full black on top, and 0.4 draws a semi-transparent stroke that
blends with the blob it crosses, so a line running under a voxel reads as a muted/greyed
version of that blob's colour while lines over bare cortex stay bold black. Added to the
shared engine (`web/scene/passes.js` shader + `web/core/config-schema.js` +
`web/scene/renderer.js`), so it also works in the browser; default off/1.0 preserves the
old depth-correct behaviour).

- **`fig-multivolume.png` (hero, `--spec figure.json`).** Four networks, one brain,
  three viewpoints (L-lateral / dorsal / R-lateral), **blocky** voxels. `figure.json`
  is a hand-authored *Free-Canvas* spec (validated by `comic.spec.validate`) with three
  equal `fit:"shared"` panels and per-overlay `overlays[i]` = `{colormap, threshold,
  clim, clusterMin}`: faces→Purples (thr 3.3, k 120), language→OrRd (thr 4.5, k 160),
  addiction→YlGn (thr 2.8, k 70), default-mode→Blues (thr 3.3, k 200). Per-map `k`
  balances visual weight (language is a large network; DMN is speckly). Each `clim` is
  pinned to `[0, positive-99th-pct]` (17.0 / 12.7 / 8.3 / 8.4) so the colorbar reads as
  a **sequential** 0→max bar and the on-brain colour spans the full LUT — needed because
  the faces/language maps carry a small negative tail (≈650–700 voxels) that would
  otherwise flag them "diverging" and give a symmetric ± legend inconsistent with the
  positive-only display.
- **`fig-default-9panel.png` (`--voxels blocky`).** Default-mode map, the default 2×4
  panel set incl. subcortical close-ups; YlGnBu, `--clim 0,8.4`.
- **`fig-layout-2x3.png` (`--voxels smooth`).** Language map, custom 2×3 view grid;
  `inferno` (perceptually-uniform / CVD-safe) with `--colormap-mode sequential
  --clim 0,12.7`. Smooth vs the blocky 9-panel demonstrates both voxel styles.
- **`fig-rotation.png` (`--spec fig_rotation.json`).** Depth demo: the language volume
  (blocky, OrRd) from five yaws (−40°…+40°) in a 5-panel free-canvas strip; illustrates
  that depth/overlap stay legible under rotation (vs a 2D MIP).

Assumptions/notes: renders use the default software-GL (SwiftShader) backend for
cross-machine reproducibility. Run the figures **sequentially** — concurrent
`comic render` processes contend for the SwiftShader context and can exceed the 90 s
`__GB_DONE__` timeout (a blocky 4-overlay hero renders in ≈10 s alone). Alternatives
considered: a straight-lateral hero grid (dropped for the free-canvas spec, which keeps
the paper's `--spec` reproducibility claim); smooth hero (dropped — blocky is more
on-brand for "COMIC"); `magma` single-map hero (dropped — washed out at the chosen
gamma).
