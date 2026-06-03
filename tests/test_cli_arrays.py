"""CLI render stages overlays as ARRAYS (overlay_0.bin + meta in scene.json), not GLB.
Template cortex/subcortical GLBs remain (baked once). Fast: no headless browser."""
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from glass_brains.render import prepare_render_dir


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


if __name__ == "__main__":
    test_cli_render_uses_arrays()
