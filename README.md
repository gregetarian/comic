# COMIC 2.0

A **volumetric** glass-brain viewer + headless figure renderer for 3D neuroimaging
results — **clusters, statistical blobs, parcellations** — in **MNI152 space**, with a
cel-shaded comic aesthetic: a translucent fresnel cortex, opaque self-occluding stat
voxels, live-threshold silhouette edges, and a depth "veil" that fades deep voxels
toward white. It can render **the volume itself** (voxel cubes or marching-cubes
isosurfaces), sample a volume onto the cortical sheet, or display native fsaverage
surface maps.

### ▶ Try it in your browser (no install): **https://gregetarian.github.io/comic/**
Drag in a NIfTI and it renders — the whole pipeline runs client-side via Pyodide, no backend.

**Plot multiple volumes at once, each with its own colormap and colorbar** — overlay
several clusters / contrasts / network clades in one figure (top row drawn on top).

One Python pipeline turns a NIfTI stat map into per-structure geometry; a single
config-driven Three.js viewer renders multi-panel views **interactively in the browser**
(locally or on GitHub Pages — meshing client-side via Pyodide) or **headlessly to a PNG**
(`comic render`, same pipeline in-process) — so the figure matches the interactive
view pixel-for-pixel.

![Five cluster volumes, each its own colour, on one glass brain](figures/clusters_example.png)

---

## Features

- **Volume or surface display** — draw NIfTI values as exposed voxel faces, smooth
  marching-cubes geometry, or a pial-to-white cortical projection. Native fsaverage
  GIFTI/MGH/MGZ maps can be drawn directly on pial, white, or inflated surfaces.
- **One config, two renderers** — the same declarative config drives the
  interactive browser viewer and the headless PNG renderer.
- **Multiple volumes at once, distinct colorbars** — load several NIfTIs; each gets its
  own control row **and its own colormap + colorbar**. **Row order = draw priority**: the
  top row draws on top where overlays overlap. Add with **`+ map`**, remove with **✕**.
- **Fully customisable layouts** — any grid of any anatomical views
  (`left_lateral`, `right_medial`, `dorsal`/`axial`, `anterior`/`frontal`,
  subcortical close-ups, …), 2×2 to N×M, from the CLI.
- **Free Canvas** — a "Canva for brains" mode: drop panels anywhere on a free
  2D canvas, **move / resize / overlap** them, **rotate** each view with the hover
  MNI-axis gizmo (or shift-drag free orbit), **slice** any panel (a plane cut or a sphere/cube
  **"bite"** out of the whole brain), and toggle a **transparent background**. It
  still **Copy-CLI**s to a self-contained `--spec figure.json` that reproduces the
  figure headlessly, pixel-faithful.
- **Statistical controls** — voxelwise threshold, **cluster-extent threshold**
  (drop clusters below *k* voxels), positive-only.
- **Unthresholded whole-brain maps** — set the upload threshold to **0**. COMIC retains the
  continuous map, automatically disables the cluster cutoff for that overlay, and uses an
  adaptive smooth-mesh resolution for dense 2–3 mm volumes so the browser does not manufacture
  hundreds of megabytes of redundant 0.5 mm geometry. Sparse maps keep the original fine mesh.
- **Faithful colour** — all ~156 matplotlib colormaps (every continuous map +
  its `_r` reverse, RdPu/PuRd and the rest), auto sequential-vs-diverging
  selection, and a positive-data washout guard; an on-screen colorbar (one per
  overlay) runs the *same* shader pipeline so it matches the voxels. Step through
  maps per overlay with **‹ ›**, or **Randomise** every loaded volume at once.
  Colorbars are **off by default**; toggle them on with the **Colorbar** button
  (or hide with the `✕`) so a stack of bars never squashes the brains.
- **Blocky or smooth** voxels, pial or inflated cortex; an optional **`smooth+`** pass
  (size-preserving Laplacian) that rounds rough cluster surfaces — most visible on
  large/irregular blobs.
- **Clickable help on every control** — tap a parameter's label (above its slider) or
  the small **ⓘ** next to a toggle for a one-line explanation.
- **Shared world scale** so every brain renders at the same physical size across
  a figure, plus **per-panel zoom** (hover a panel for `+ / –`).
- **Save brain** / **Save bars** — the brains export at full resolution with no
  colorbars (never squashed); the colorbars export as a separate legend image you
  place yourself.
- **Comic SFX** — because brains rendered like comic panels deserve the
  occasional *BOOM!* (toggle the **Kapow** checkbox).

---

## Install

```bash
git clone https://github.com/gregetarian/comic
cd comic
pip install -e .                 # runtime: nibabel/numpy/scipy/scikit-image (the pipeline)

# Headless figure rendering (comic render):
pip install -e ".[render]"
python -m playwright install chromium

# Only to RE-BAKE the fsaverage template (comic bake) — most users never need this:
pip install -e ".[bake]"         # adds trimesh/mne/cmap
```

The fsaverage template is **pre-baked** and committed under `comic/web/data/`,
so normal use needs no `mne`/fsaverage download — only `comic bake` fetches
fsaverage via MNE (cached under `~/mne_data/`).

---

## Browser figure → reproducible code

The browser's **Copy CLI** button turns the current Free Canvas figure into a reusable
recipe:

1. Arrange the panels, rotations, cuts, surfaces, colours, thresholds, and output size
   in the browser.
2. Click **Copy CLI**. COMIC downloads **`figure.json`** and copies a ready-to-run
   terminal command containing every loaded volume.
3. Keep `figure.json` beside your analysis. It contains the figure recipe, **not the
   image data**. Supply the NIfTIs when rendering.

For one volume:

```bash
comic render my_map.nii.gz --spec figure.json -o my_figure.png --crop content
```

For several overlays, pass one volume per saved style slot, in the same order as the
overlay rows in the browser:

```bash
comic render first_map.nii.gz second_map.nii.gz third_map.nii.gz \
  --spec figure.json -o my_figure.png --crop content
```

The equivalent Python is one line:

```python
import comic as gb
gb.render_spec("figure.json", ["first_map.nii.gz", "second_map.nii.gz", "third_map.nii.gz"]).save("my_figure.png")
```

Input order is the contract: the first file receives `style.overlays[0]`, the second
receives `style.overlays[1]`, and so on. New browser exports also include a human-readable
top-level `inputs` list so the original slot names are visible in the JSON. See
**[Reuse a browser figure with new data](docs/reusing-figure-json.md)** for installation,
batch rendering with one persistent browser, output/cropping behaviour, and troubleshooting.

---

## Quickstart

```bash
# Interactive viewer — serves the local site + opens the browser. Drag NIfTIs in;
# they're meshed in-browser via Pyodide (identical to the GitHub Pages site).
comic open

# Headless figure → PNG (default: 9-panel, YlGnBu, smooth voxels). Writes a clean
# full-size brain PNG + a separate <out>_colorbars.png legend.
comic render zstat.nii.gz -o figure.png

# Custom layout: L/R lateral on top, axial + frontal on the bottom; extra smoothing.
comic render zstat.nii.gz -o figure.png \
    --grid 2x2 --views left_lateral,right_lateral,axial,frontal \
    --cmap YlGnBu -k 100 --smooth 6 --width 1600 --height 1000

# Multiple volumes in ONE figure — each map is its own overlay with its own colormap +
# colorbar (seed-based connectivity / multi-network). Pass several NIfTIs; each gets a
# distinct default colormap, in argument order.
comic render seed.nii.gz networkA.nii.gz networkB.nii.gz -o multi.png \
    --grid 1x3 --views left_lateral,dorsal,right_lateral -k 100

# Reuse a browser Free-Canvas figure with different data. File order binds to the
# browser's overlay rows: first file -> first colour/style, second -> second, etc.
comic render faces.nii.gz language.nii.gz \
    --spec figure.json -o figure.png --crop content

# Re-bake the fsaverage template assets into web/data/ (one-time; needs the [bake] extra)
comic bake
```

> **Hosted:** the same viewer is a static site at `comic/web/`, deployed to
> GitHub Pages — upload a NIfTI in the browser, no install required.

---

## The interactive viewer

The control bar is split into a **global surface row** and **one row per loaded
map**. Every slider has a type-in box; **tap a parameter's label (or the ⓘ next to a
toggle) for a one-line explanation.**

**Surface row (applies to the whole figure):**

- **`+ map`** — load one or more NIfTI volumes or fsaverage surface maps (processed
  in-browser via Pyodide; the first upload fetches the ~30 MB scientific stack once).
  Each appends a new overlay row.
- **Demo** — load the example Neurosynth maps (faces · addiction · default-network ·
  language), meshed in-browser — a one-click showcase on the otherwise empty canvas.
- **Copy CLI** — for Free Canvas, multi-overlay, or per-panel-zoom figures, download
  `figure.json` and copy ready terminal/Python commands with every map in slot order.
- **layout** — switch 4-panel / 9-panel / overview / **Free Canvas** (see below).
- **Save brain** — high-res, print-tuned capture of the brains only (no colorbars,
  full canvas — never squashed by a stack of bars).
- **Save bars** — the colorbars on their own as a separate legend image.
- **Colorbar** — show/hide the on-screen colorbars (off by default; also the `✕` on the bars).
- **Randomise** — give every loaded volume a different random colormap (one click).
- **Inflate / Outline** — inflated vs pial cortex; black silhouette on/off.
- **cortex α / edge thr / line w** — cortex glass opacity, sulcal-line density, line width.
- **Light: direct / ambient** — scene lighting (off by default; voxel colour
  comes from emissive + a light-independent glint).
- **Minimise** — the chevron at the top-right of the control strip collapses the whole
  panel to a thin bar, handing the freed height back to the brains; click again to restore.

**Per-overlay row (one per NIfTI):**

- name + **✕** to remove · **colormap** (own colorbar; **‹ ›** to step through them) · **Smooth** (blocky↔smooth) ·
  **thr** (threshold) · **cluster k** (cluster-extent) · **smooth+** (size-preserving
  surface smoothing of the smooth mesh; 0 = off) · **+only** ·
  **Edges** + **edge w** · **veil / veil log** (depth fade) ·
  **emissive / specular / shine**.
- **Row order = display priority** — drag-free: the higher row wins where
  overlays overlap.

**On the panels themselves:**

- **Hover a panel** → a small **`+ / –`** appears top-left to rescale just that view.
- **Kapow** (top-right checkbox) → comic SFX on click, for fun.

### Free Canvas

Pick **Free Canvas** in the layout menu (it seeds from your current layout, so the
switch is seamless) to turn the figure into a free 2D canvas of brain panels:

- **Move / resize** — drag a panel's brain (or its header bar) to move it; drag the
  bottom-right **corner** to resize. Panels can overlap; **⤒** brings one to the front.
- **Rotate** — hover a panel for a Blender-style MNI gizmo anchored just outside its
  fixed pane (it does not chase the brain silhouette as the view turns):
  **X red, Y green, Z blue**. Drag an arrow to lock rotation to that fixed world axis;
  click an endpoint to snap to its orthogonal view. Arrow keys adjust the focused axis
  by 5° (shift = 15°). **Shift-drag** remains available for free orbit.
- **View** — the per-panel dropdown picks any named view (lateral/medial, anterior,
  dorsal/axial, ventral, subcortical L/R, …).
- **Slice (`✂`)** — cycles a cut on that panel: axial / coronal / sagittal plane →
  **sphere bite** → **cube bite**. The cut goes through the *whole* brain (cortex shell
  and overlay together) and the outlines follow it. Two handles appear — drag the
  **orange** dot to move the cut (shift-drag for depth), the **teal** dot to resize it.
- **Cut MRI** — paints an opaque, sharpened native-1-mm AFNI MNI2009c T1 cross-section on
  the exposed face, clipped to the exact pial footprint. It disappears when viewed from
  behind and occludes cortex/voxel line-art behind the cut.
- **Cut map** — samples the original thresholded NIfTI grid in a thin max-absolute slab and
  composites its current colormap over the T1 face. It honors each map's live threshold,
  cluster cutoff, sign mode, and draw priority. **Map depth** is how far around the cut to
  search for activation (0 mm means exactly on the plane); **map pixels** chooses smooth or
  voxel-sharp resampling. Neither option changes the anatomical MRI. Ordinary 3D voxel meshes
  remain geometrically clipped separately.
- **Panel surface** — the panel menu can independently select pial, inflated, white, any
  template-provided custom surface, or hide the cortex without changing the map representation.
- **Map surface mode** — cortical voxels project onto the cortex. Voxels classified inside
  subcortex/cerebellum/brainstem stay volumetric because there is no corresponding cortical
  sheet; the adjacent **subcort: smooth / blocky** selector controls their fallback. In paired
  cortex+subcortex views those voxels follow the displayed subcortical half, not the cortex half.
- **Toolbar** — seed an *R × C* grid of panels, **+ panel**, or tick **transparent**
  for a transparent figure background (exports a transparent PNG).
- **Copy CLI** — emits `comic render … --spec figure.json`, including every loaded map,
  and downloads `figure.json`; replace the filenames with paths if needed and run it.

> Slicing supports arbitrary plane normals / sphere centres / cube bounds in the
> `figure.json` (and `--spec`); the editor's `✂` offers the common presets one click
> at a time. Overlapping panels paint in z-order (no cross-panel alpha blending).

## CLI reference

`comic render` takes **one or more** NIfTIs — each map becomes its own overlay
(its own colormap + colorbar; argument order = overlay/draw order), so a single command
renders a multi-volume figure. It is fully parameterised — `--grid RxC`, `--views ...`
(row-major; `_` = blank cell; aliases like `axial=dorsal`, `frontal=anterior`), or
**`--spec figure.json`** for a browser figure (a reusable recipe containing layout,
style, and size, as emitted by the browser's *Copy CLI*; it overrides `--grid/--views`;
with multiple maps the i-th map fills `style.overlays[i]`),
plus `--bg-alpha 0` for a transparent PNG, plus style flags:
`--surface`, `--voxels`, `--smooth` (extra surface smoothing),
`--cmap`, `-k/--cluster-size`, `--threshold`, `--veil`, `--veil-k`, `--emissive`, `--specular`, `--shininess`,
`--directional`, `--ambient`, `--cortex-alpha`, `--edge-thr`, `--line-w`,
`--voxel-edge-w`, `--margin`, `--colorbar/--no-colorbar`, `--colorbar-font`,
`--colorbar-fontsize`, `--shadows/--no-shadows`, `--positive-only`,
`--no-edges`, `--no-outline`, `--no-subcortical`, and output `--width`,
`--height`, `--scale`. Run `comic render -h` for the full list.

---

## Scope & limitations

- **The hosted volume workflow assumes MNI152 alignment.** COMIC warns about clear
  mismatches but does not register data. Headless/Python rendering also supports a custom
  template bundle or `--no-template` volume-only rendering in the map's own space.
- **Volume inputs are 3D.** NIfTI maps may be thresholded or continuous (threshold `0`),
  but 4D timeseries must first be reduced to a 3D statistic/label map. Native fsaverage
  surface overlays are supported separately as GIFTI, MGH, MGZ, or morphometry files.
- **Surface projection is for display.** Sampling a volume between pial and white is not a
  substitute for a surface-based statistical analysis. Subcortical, cerebellar, and
  brainstem values remain smooth or blocky volumes because they have no cortical sheet.
- **Bundled anatomy is group anatomy.** The standard shell, internal meshes, and 1-mm cut
  T1 are aligned template assets, not a subject-specific reconstruction. Custom template
  users are responsible for supplying mutually aligned surfaces, anatomy, segmentation,
  and maps.
- **The cut MRI cannot add resolution to a statistical map.** Cut-map values are sampled
  from the source NIfTI grid (nearest or linear, optionally through a thin max-absolute slab).
- **First browser upload downloads ~30 MB** (the Pyodide scientific stack) before the
  first map renders; cached afterwards. The viewer **boots empty** — upload your own NIfTIs,
  or click **Demo** (or open `?demo=1`) to mesh the example Neurosynth maps in-browser.

---

## How it works

See [METHODS.md](METHODS.md) for the full pipeline: surface/subcortical
extraction and MNI305→MNI152 alignment, per-structure voxel meshing (blocky
exposed-face quads + smooth marching-cubes), colormap normalisation and the
washout guard, connected-component cluster sizing, and the Three.js render
pipeline (fresnel glass, opaque depth-veiled voxels, light-independent glint,
depth-edge silhouette passes, headless Playwright capture).

```
comic/
  pipeline.py      THE backend: NIfTI → per-structure geometry ARRAYS. Pure
                   numpy/scipy/scikit-image/nibabel — the SAME file runs in CPython
                   (CLI) and in Pyodide (browser, a byte-identical copy in web/pyodide/).
  arrays.py        write a processed overlay as one .bin + bufferLayout (for the CLI render)
  core.py          Comic (template loader for the bake) + `open`/`bake`/`render` CLI
  render.py        headless layout builder + Playwright PNG renderer (in-process pipeline)
  bake.py          one-time fsaverage template bake → web/data/ (needs the [bake] extra)
  surfaces.py / subcortical.py / colormaps.py / export.py   bake-only (mne/trimesh/cmap)
  web/             THE single Three.js viewer — served by Pages, by `comic open`,
                   and shipped in the wheel:
    index.html · app/main.js (one shell; ?headless=1 for render)
    core/          pure, unit-tested geometry/visibility/colour (node --test)
    scene/         materials, passes, renderer, asset-loader (GLB template + array overlays)
    controls/      UI bindings, colorbar, Copy-CLI, comic SFX
    pyodide/       bootstrap.js + pipeline.py (copy of comic/pipeline.py)
    data/          baked template (cortex/subcortical GLB, colormaps, aseg) + demo + nibabel wheel
```

**One backend, one renderer, three ways to run it.** `comic/pipeline.py` is the
only per-upload meshing code; `comic/web/` is the only viewer. They power:
`comic render` (headless PNG, pipeline in-process), `comic open` (local
interactive — serves `web/`, meshing in-browser via Pyodide), and the GitHub Pages site
(the same `web/`). The fixed fsaverage template is baked once (`comic bake`) and
committed under `web/data/`.

## Development

```bash
# Pure-core JS unit tests (no browser needed)
cd comic/web && node --test

# Python + headless-browser tests (Playwright):
python tests/test_pipeline_parity.py   # CPython pipeline == browser ground truth
python tests/test_cli_arrays.py        # render uses array overlays, not GLB
python tests/test_pyodide_sync.py      # web/pyodide/pipeline.py == comic/pipeline.py
python tests/test_smoothing.py         # smooth+ moves vertices, scales, restores, preserves aValue
python tests/test_free_canvas.py       # Free Canvas: move/resize/rotate/view/slice + --spec round-trip
python tests/smoketest.py              # Pyodide boots + meshes the demo in a browser
python tests/integration_test.py       # full app: demo, upload, preset switch, remove
```

> `comic open` serves `web/` and opens it; `render`/`bake` are the headless +
> asset-bake commands. The fsaverage download (`bake`) and figure rendering (`render`)
> need the `[bake]` / `[render]` extras respectively.

---

## License

MIT — see [LICENSE](LICENSE).
