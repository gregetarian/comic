# COMIC

**Publication-ready 3D brain figures, directly in your browser.**

## [Open COMIC](https://gregetarian.github.io/comic/)

No installation is required. Drop in a 3D NIfTI volume, an fsaverage surface map,
or a table containing one value per cortical parcel. The data are processed on your
own computer and are not uploaded to a server.

![Several statistical maps, each with its own colourmap, on one glass brain](figures/clusters_example.png)

## Start here

1. Open the [hosted viewer](https://gregetarian.github.io/comic/).
2. Drop in a map, or click **Demo** to try the bundled examples.
3. Choose the views, surfaces, colours and thresholds you need.
4. Use **Save brain** for the figure, **Save bars** for its legends, or **GIF** for
   a turntable.

The first file upload downloads the Pyodide scientific-Python runtime, approximately
30 MB, and caches it in the browser. The application itself is a static website. Only
its code and template assets are downloaded; the map you load stays in the browser.

## What COMIC is for

COMIC is a figure composer for already-computed human neuroimaging results. It is
designed to make a polished static figure or short animation without requiring the
user to write rendering code.

- Draw 3D NIfTI results as exposed voxel faces, smooth isosurfaces, or values sampled
  onto the cortical sheet.
- Load native fsaverage GIFTI, MGH, MGZ and morphometry maps.
- Paint CSV or TSV parcel values onto the cortex and draw atlas boundaries. Schaefer
  100, 200, 400 and 1000 parcel atlases, each in 7- and 17-network versions, are bundled.
- Combine several overlays, each with its own threshold, colourmap, colour limits,
  transparency and legend.
- Arrange, resize, overlap and rotate panels on a Free Canvas.
- Cut the brain with a plane, sphere or cube and show template T1 anatomy and source-map
  values on the exposed face.
- Export the figure styling and layout as a reusable `figure.json` display recipe.

The application includes a built-in guide and clickable explanations for its controls.
For implementation details, see [METHODS.md](METHODS.md).

## Do I need to install anything?

For ordinary interactive use, **no**. Use the hosted viewer.

| Task | Recommended route | Local requirements |
|---|---|---|
| Make one figure interactively | Hosted viewer | None |
| Serve the interactive viewer from a checkout | `comic open` | Python package; your normal browser |
| Regenerate or batch-render figures | `comic render` or `comic.render(...)` | Python, Playwright and Chromium |
| Rebuild template assets | `comic bake` | Additional maintainer dependencies |

Local scripted rendering is useful when a figure must be regenerated from an analysis,
the same design must be applied to many maps, output is being produced in a notebook or
CI job, or a custom template is required. It is unnecessary for a one-off interactive
figure.

## Optional scripted and batch rendering

COMIC uses one Three.js renderer. The browser displays it directly; the command-line and
Python interfaces run the same renderer in an **invisible headless Chromium process** and
capture its canvas as a PNG. No browser window appears, but Playwright and a Chromium binary
are required. This is not a native Python rasteriser.

Until COMIC has a packaged release, install it from a source checkout:

```bash
git clone https://github.com/gregetarian/comic
cd comic
pip install -e ".[render]"
python -m playwright install chromium
```

The Chromium installation is a one-time download for that Python environment. The bundled
fsaverage/MNI152 template is already included; ordinary rendering does not download MNE or
FreeSurfer data.

### Command line

```bash
# Default eight-view figure. No intensity or cluster cutoff is applied unless requested.
comic render zstat.nii.gz -o figure.png

# Three named views with explicit inferential display thresholds.
comic render zstat.nii.gz -o figure.png \
  --grid 1x3 --views left_lateral,dorsal,right_lateral \
  --threshold 3.1 -k 100 --cmap YlGnBu

# Several independently styled overlays in one figure.
comic render seed.nii.gz network_a.nii.gz network_b.nii.gz \
  --grid 1x3 --views left_lateral,dorsal,right_lateral \
  --cmap Reds,YlGnBu,Purples -o networks.png

# Reuse a layout exported from the browser.
comic render faces.nii.gz language.nii.gz \
  --spec figure.json --crop content -o reused.png
```

Run `comic render -h` for the complete CLI reference. The main brain image is written as
a PNG. Colour bars are written separately by default, and can also be exported as SVG.

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

Evaluating `fig` displays it inline in Jupyter or VS Code. This Python API still uses
headless Chromium internally; it does not open a visible browser window. Reuse one
`gb.RenderSession()` when producing many figures so Chromium starts only once.

## Reusing a browser figure

The browser's **Copy CLI** action downloads `figure.json` and copies matching terminal
and Python commands. The JSON records presentation state, including panel positions,
cameras, cuts, surfaces, colours, thresholds and output dimensions.

It is a self-contained **display recipe**, not a self-contained scientific record. It
does not contain the NIfTI or surface data. Reproducing a published figure therefore
requires:

- the original input maps;
- `figure.json`;
- any non-default template assets; and
- a pinned COMIC release or commit.

Input order binds files to saved overlay styles. See
[Reuse a browser figure with new data](docs/reusing-figure-json.md) for batch rendering,
slot rules and troubleshooting.

## Optional local interactive viewer

```bash
git clone https://github.com/gregetarian/comic
cd comic
pip install -e .
comic open
```

`comic open` serves the static application on `localhost` and opens it in your normal
browser. It does not need Playwright or the separate Chromium download. Uploaded maps are
still processed in that browser through Pyodide, which is fetched from jsDelivr on first
use. This route is mainly useful for development or for pinning the application to a local
checkout; it is not more private than the hosted static site.

## Inputs and limits

- Volumetric inputs must be 3D. Reduce 4D time series to a statistic or label map first.
- The hosted template assumes MNI152-aligned volumes and fsaverage surface correspondence.
  COMIC warns about obvious spatial mismatches but performs no registration.
- The cortical shell and cut anatomy are group templates, not participant anatomy.
- Volume-to-surface projection, smoothing and cut slabs are display operations, not
  statistical analyses.
- Cluster sizes are computed at the load threshold. Raising the live intensity threshold
  does not relabel the surviving components.
- Dense continuous maps may use a coarser smooth display mesh to protect browser memory.
- The brain export is a raster PNG. WebGL output can vary slightly with browser, operating
  system and graphics backend, although the same geometry, configuration and colour rules
  are used in every interface.

Command-line and Python rendering additionally support aligned custom template bundles and
a volume-only mode for non-MNI data. Users are responsible for the alignment and scientific
meaning of custom assets.

## How it works

There is one per-upload Python pipeline and one Three.js renderer:

- In the hosted and locally served viewer, Pyodide executes a byte-identical copy of
  `comic/pipeline.py` inside the browser.
- In the CLI and Python API, CPython executes `comic/pipeline.py` directly.
- Both routes pass the resulting geometry arrays and the same declarative configuration to
  `comic/web/`.
- Interactive use renders in the user's browser. Scripted use renders in headless Chromium.

This shared implementation keeps geometry, colour normalisation and configuration semantics
aligned. It does not imply that PNG files produced by different WebGL backends will be
byte-for-byte identical.

## Development

```bash
pip install -e ".[dev,render]"
python -m playwright install chromium

# Pure JavaScript geometry, visibility and configuration tests
cd comic/web && node --test

# Python tests
cd ../..
pytest
```

Rebuilding the bundled template is a maintainer operation:

```bash
pip install -e ".[bake]"
comic bake
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidance.

## Citation, licence and support

COMIC's original source code is licensed under the [MIT License](LICENSE). Bundled
third-party software, fonts, template assets, atlas data and demonstration maps retain
their own terms, recorded in [NOTICE.md](NOTICE.md). Citation metadata for COMIC are
provided in [CITATION.cff](CITATION.cff).

COMIC is free and always will be. If it saved you an afternoon of fiddling with figures,
you can [buy me a coffee](https://buymeacoffee.com/semilanceata).
