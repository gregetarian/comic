# Contributing to COMIC

Thanks for your interest in improving COMIC. This guide covers the dev setup,
how to run the test suite, and two load-bearing invariants that every change
must preserve.

## Dev install

```bash
pip install -e ".[render,dev]"
python -m playwright install chromium
```

The `render` extra pulls in the headless render backend; `dev` pulls in the test
tooling. `playwright install chromium` provisions the browser used by the
end-to-end viewer tests.

## Running the tests

```bash
pytest -q                    # Python unit + integration tests
node --test comic/web/core/  # JS core tests (colormap, colormap-gen, …)
ruff check                   # lint
```

Run all three before opening a pull request.

## Load-bearing invariants

These two invariants keep the CLI, the headless renderer, and the in-browser
viewer producing identical output. A change that breaks either is a bug, even if
the tests happen to pass locally.

### 1. `comic/pipeline.py` is byte-identical to `comic/web/pyodide/pipeline.py`

The meshing pipeline runs live in two places: in-process for the CLI/renderer,
and in the browser via Pyodide. Both must run the *same* code. The Pyodide copy
is a byte-for-byte duplicate of the canonical `comic/pipeline.py`.

- The canonical source is `comic/pipeline.py`. **Edit only this file.**
- Regenerate the Pyodide copy with `comic bake` (it copies `pipeline.py` into
  `comic/web/pyodide/`).
- `tests/test_pyodide_sync.py` guards the invariant and will fail if the two
  files drift.

Never hand-edit `comic/web/pyodide/pipeline.py`.

### 2. JS is the single colour authority

There is exactly one value→colour code path, and it lives in JavaScript:
`colorizeValues` in `comic/web/core/colormap.js`. Every value that becomes a
pixel — voxels, colorbars, the CLI render — resolves its colour through that
function.

- Do not add a parallel Python (or other) colormapping path.
- Do not duplicate the map lookup / normalisation logic elsewhere.
- New colormaps are baked to data and consumed by `colorizeValues`; the
  colouring math stays in that single function.
