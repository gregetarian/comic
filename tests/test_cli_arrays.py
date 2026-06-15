"""CLI render stages overlays as ARRAYS (overlay_0.bin + meta in scene.json), not GLB.
Template cortex/subcortical GLBs remain (baked once). Fast: no headless browser."""
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from braincel.render import prepare_render_dir


def test_cli_render_uses_arrays():
    nifti = ROOT / "test_sphere.nii.gz"
    d = prepare_render_dir(str(nifti), threshold=2.3)
    try:
        data = d / "data"
        assert (data / "overlay_0.bin").exists(), "expected array overlay overlay_0.bin"
        scene = json.loads((data / "scene.json").read_text())
        assert len(scene["overlays"]) == 1
        ov = scene["overlays"][0]
        assert ov["buffersFile"] == "overlay_0.bin"
        assert ov["bufferLayout"] and "structures" in ov
        # No GLB overlay path (the old format wrote data/overlay/*.glb)
        assert not (data / "overlay").exists(), "old GLB overlay dir should not exist"
        glbs = list(data.rglob("*.glb"))
        assert glbs, "template cortex/subcortical GLBs should still be present"
        assert all("cortex" in g.name or "subcortical" in str(g) for g in glbs), [g.name for g in glbs]
        print("PASS — CLI render stages array overlays (overlay_0.bin); template GLBs only, no overlay GLB")
    finally:
        shutil.rmtree(d, ignore_errors=True)


def test_cli_render_multi_overlay():
    """Several NIfTIs -> one overlay each (overlay_<i>.bin), distinct per-map meta, and a
    per-overlay threshold list. Guards the buffer-handoff: get_all_buffers() must be grabbed
    for each map BEFORE the next process_nifti clears _BUFFERS (else overlays cross-contaminate)."""
    a = ROOT / "braincel" / "web" / "data" / "defaults" / "faces.nii.gz"
    b = ROOT / "braincel" / "web" / "data" / "defaults" / "language.nii.gz"
    d = prepare_render_dir([str(a), str(b)], threshold=[2.3, 3.5])
    try:
        data = d / "data"
        scene = json.loads((data / "scene.json").read_text())
        assert len(scene["overlays"]) == 2, f"expected 2 overlays, got {len(scene['overlays'])}"
        assert (data / "overlay_0.bin").exists() and (data / "overlay_1.bin").exists()
        assert scene["overlays"][0]["buffersFile"] == "overlay_0.bin"
        assert scene["overlays"][1]["buffersFile"] == "overlay_1.bin"
        # distinct maps -> distinct names AND distinct buffer bytes (no cross-contamination)
        assert scene["overlays"][0]["name"] != scene["overlays"][1]["name"]
        b0 = (data / "overlay_0.bin").read_bytes(); b1 = (data / "overlay_1.bin").read_bytes()
        assert b0 != b1, "the two overlays' buffers are identical — buffer handoff is broken"
        print("PASS — multi-overlay CLI render stages overlay_0.bin + overlay_1.bin with distinct per-map geometry")
    finally:
        shutil.rmtree(d, ignore_errors=True)


def test_overlay_names():
    """names= sets each overlay's display name (the colorbar label), overriding the filename."""
    a = ROOT / "braincel" / "web" / "data" / "defaults" / "faces.nii.gz"
    b = ROOT / "braincel" / "web" / "data" / "defaults" / "language.nii.gz"
    d = prepare_render_dir([str(a), str(b)], threshold=[2.3, 3.5], names=["Clade 1 — DMN", "Clade 2 — language"])
    try:
        scene = json.loads((d / "data" / "scene.json").read_text())
        assert scene["overlays"][0]["name"] == "Clade 1 — DMN", scene["overlays"][0]["name"]
        assert scene["overlays"][1]["name"] == "Clade 2 — language", scene["overlays"][1]["name"]
        print("PASS — names= sets per-overlay colorbar labels")
    finally:
        shutil.rmtree(d, ignore_errors=True)


if __name__ == "__main__":
    test_cli_render_uses_arrays()
    test_cli_render_multi_overlay()
    test_overlay_names()
