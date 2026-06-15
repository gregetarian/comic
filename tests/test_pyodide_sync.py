"""The browser's Pyodide copy of the pipeline must be byte-identical to the canonical
one, so there is genuinely ONE pipeline source. `braincel bake` keeps them in sync."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def test_pyodide_pipeline_in_sync():
    canonical = (ROOT / "braincel" / "pipeline.py").read_bytes()
    shipped = (ROOT / "braincel" / "web" / "pyodide" / "pipeline.py").read_bytes()
    assert canonical == shipped, (
        "web/pyodide/pipeline.py has drifted from braincel/pipeline.py — run `braincel bake`")
    print("PASS — web/pyodide/pipeline.py is byte-identical to braincel/pipeline.py")


if __name__ == "__main__":
    test_pyodide_pipeline_in_sync()
