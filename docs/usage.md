# Using Comic

For most users, the hosted browser application is the simplest route. The command-line
and Python interfaces are optional tools for reproducible, automated or batch output.

## Browser workflow

Open [Comic](https://gregetarian.github.io/comic/) and drop one of the following onto
the page:

- a 3D NIfTI volume;
- left and/or right fsaverage GIFTI, MGH, MGZ or morphometry files;
- left and/or right HCP fs_LR 32k GIFTI files (`.func.gii`), or one CIFTI `.dscalar.nii`; or
- a CSV, TSV or text table containing one value per atlas parcel.

The processing pipeline runs locally through Pyodide. The application is a static site:
its code and template assets are downloaded, but the data you load are not sent to a
server. The first use also downloads the scientific Python runtime.

Each loaded map gets its own controls for representation, colourmap, threshold, cluster
extent, colour limits, transparency and edges. Several overlays can be shown together.
The upper overlay row takes priority where opaque geometry overlaps.

The Free Canvas layout allows panels to be moved, resized, overlapped, rotated and cut.
Cuts can be planar, spherical or cubic. **Cut MRI** displays the bundled 1-mm template
anatomy on a plane, while **Cut map** samples values from the original statistical grid.

Export the brain image with **Save brain**, its separate legends with **Save bars**, or a
turntable with **GIF**. **Copy CLI** downloads a reusable `figure.json` and copies matching
terminal and Python commands.

## Supported data and atlases

Volumetric inputs must be three-dimensional. Reduce a 4D time series to a statistic,
effect-size or label map before loading it. The hosted template assumes MNI152 alignment.

Native surface inputs must correspond to the bundled fsaverage surface. Lower-resolution
standard icosahedral fsaverage maps are expanded to the bundled surface; arbitrary vertex
counts are rejected rather than silently misregistered.

### HCP fs_LR 32k maps

A map with 32,492 vertices per hemisphere is treated as HCP fs_LR 32k and drawn on a bundled
fs_LR surface, vertex for vertex. It is never resampled to fsaverage. Two forms are accepted:

- one GIFTI per hemisphere, for example `stat.L.func.gii` and `stat.R.func.gii` (`lh`/`rh`
  and BIDS `hemi-L`/`hemi-R` names pair up in the same way); or
- one CIFTI dense scalar file, `stat.dscalar.nii`, which holds both hemispheres. Its first
  map is used, and any subcortical voxels in the file are ignored.

A vertex whose value is NaN, and any vertex a CIFTI file does not model (normally the medial
wall), is drawn in a flat grey "no data" colour at every threshold. Set the colour with
`--no-data-color` or `style.voxel.noDataColor`. Zero is an ordinary value, not "no data".

```bash
comic render stat.dscalar.nii -o figure.png
comic render --surface-map 'lh=stat.L.func.gii,rh=stat.R.func.gii' -o figure.png
comic render --surface-map 'cifti=stat.dscalar.nii,name=Effect' --surface veryinflated -o figure.png
```

While an fs_LR map is loaded, the cortical shell of the whole figure is the fs_LR mesh. It
offers three surfaces: the group-average midthickness (selected by `pial` or `white`, since
fs_LR has no group pial or white surface), `inflated` and `veryinflated`. Both inflated
surfaces are made by smoothing the midthickness in place, so they stay in MNI152 space.

Limits of the fs_LR mesh:

- fs_LR and fsaverage surface maps, including parcel tables, cannot share one figure.
- Atlas boundaries and the medial-wall mask are defined on fsaverage and are unavailable.
- Volumes can still be shown as voxels or isosurfaces beside an fs_LR map, but projecting a
  volume onto the cortex uses the fsaverage surface and will not sit on the fs_LR shell.
- Other densities (164k, 59k) and CIFTI types (`.dtseries.nii`, `.dlabel.nii`) are not read.

Parcel tables may use region names or atlas row order. **Desikan–Killiany DK68** is
bundled, together with Schaefer 100, 200, 400 and 1000 atlases in both 7- and 17-network
versions. A bare 68-value vector is interpreted in the ENIGMA/FreeSurfer DK order: 34 left
hemisphere regions followed by the same 34 right-hemisphere regions. Named DK tables may use
bare bilateral names such as `bankssts`, or hemisphere-qualified forms such as
`lh_bankssts`, `rh_bankssts`, `bankssts-lh` and `bankssts-rh`.

A row count alone cannot distinguish the 7- and 17-network Schaefer variants, so Comic asks
when names do not resolve the ambiguity. Unmatched region names are errors.

## Scripted rendering

Until a packaged release is published, install from a source checkout:

```bash
git clone https://github.com/gregetarian/comic
cd comic
python -m pip install -e ".[render]"
python -m playwright install chromium
```

Playwright launches headless Chromium, captures the Three.js canvas and closes it.
Reuse a render session for large batches so Chromium starts only once.

### Command line

```bash
# Default multi-view figure with no intensity or cluster cutoff.
comic render zstat.nii.gz -o figure.png

# Three named views with explicit display thresholds.
comic render zstat.nii.gz -o figure.png \
  --grid 1x3 --views left_lateral,dorsal,right_lateral \
  --threshold 3.1 -k 100 --cmap YlGnBu

# Several independently coloured overlays.
comic render seed.nii.gz network_a.nii.gz network_b.nii.gz \
  --grid 1x3 --views left_lateral,dorsal,right_lateral \
  --cmap Reds,YlGnBu,Purples -o networks.png

# Reuse a browser composition.
comic render faces.nii.gz language.nii.gz \
  --spec figure.json --crop content -o reused.png
```

Run `comic render -h` for all options. Brain images are written as PNG files. Colour bars
are separate by default and can also be exported as SVG.

### Python and notebooks

```python
import comic as gb

fig = gb.render(
    "zstat.nii.gz",
    views=["left_lateral", "dorsal", "right_lateral"],
    grid="1x3",
    threshold=3.1,
    clusterMin=100,
    cmap="YlGnBu",
)
fig.save("figure.png")
```

Evaluating `fig` displays it inline in Jupyter or VS Code. Inputs may be paths, in-memory
nibabel images, or `(array, affine)` pairs. Use one `gb.RenderSession()` for repeated output.

## Reusing a browser figure

`figure.json` records presentation state, not the input data. Reproducing a figure requires
the JSON, the original maps, any custom template assets and a pinned Comic version or commit.
Input order binds maps to the saved overlay-style slots. New recipes keep processing and
display thresholds separately. Automatic colour limits are derived again from replacement
maps; pinned limits remain fixed unless explicitly overridden.

Use `--input-json` descriptions to preserve an arbitrary mixture of volume, surface and
parcel inputs. The browser supplies these descriptions in its copied command; replace the
filename hints with local paths. `render_spec()` accepts matching Python dictionaries.
Explicit CLI style flags override the recipe, while omitted settings stay as saved.

See [Reusing `figure.json`](reusing-figure-json.md) for batch examples and the complete slot
contract.

## Optional local viewer

```bash
git clone https://github.com/gregetarian/comic
cd comic
python -m pip install -e .
comic open
```

This serves the same static application on `localhost` and opens it in your ordinary
browser. It is mainly useful for development or pinning the viewer to a checkout. It is not
more private than the hosted static site, because both process uploaded data locally.

## Scientific and technical limits

- Comic does not perform registration.
- The cortical shell, internal structures and cut anatomy are group templates.
- Volume-to-surface sampling is a display operation, not surface-based inference.
- Cluster sizes are computed at the load threshold. Raising the live threshold does not
  relabel the surviving components.
- Dense continuous maps may use a coarser smooth mesh to protect browser memory.
- Lowering blob opacity sacrifices exact front-to-back sorting where translucent overlays
  intersect.
- WebGL raster output may vary slightly across browsers, operating systems and graphics
  backends even when geometry and configuration are identical.

Command-line and Python rendering also support aligned custom template bundles and a
volume-only mode for non-MNI data. Users remain responsible for the alignment and scientific
meaning of custom assets.

For implementation detail, see [METHODS.md](../METHODS.md). For development installation and
tests, see [CONTRIBUTING.md](../CONTRIBUTING.md).
