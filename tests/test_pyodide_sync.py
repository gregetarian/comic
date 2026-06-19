"""The browser's Pyodide copy of the pipeline must be byte-identical to the canonical
one, so there is genuinely ONE pipeline source. `comic bake` keeps them in sync."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def test_pyodide_pipeline_in_sync():
    canonical = (ROOT / "comic" / "pipeline.py").read_bytes()
    shipped = (ROOT / "comic" / "web" / "pyodide" / "pipeline.py").read_bytes()
    assert canonical == shipped, (
        "web/pyodide/pipeline.py has drifted from comic/pipeline.py — run `comic bake`")
    print("PASS — web/pyodide/pipeline.py is byte-identical to comic/pipeline.py")


if __name__ == "__main__":
    test_pyodide_pipeline_in_sync()
