"""M9: custom / non-MNI template. bake_template() writes a template the engine consumes, and
`render --template DIR` overlays it onto the engine (visualisation-grade, bring-your-own-aligned)."""
import json
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
import trimesh
import nibabel as nib
import pytest

from comic.bake import bake_template
from comic.template import validate_template_alignment

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "comic" / "web" / "data"
SPHERE = str(ROOT / "test_sphere.nii.gz")
PNG = b"\x89PNG\r\n\x1a\n"


def test_bake_template_writes_custom_assets(tmp_path):
    ico = trimesh.creation.icosphere(subdivisions=2, radius=60.0)
    surfaces = {"lh": (ico.vertices - [30, 0, 0], ico.faces),
                "rh": (ico.vertices + [30, 0, 0], ico.faces)}
    aseg = np.zeros((8, 8, 8), np.uint8)
    aseg[2:6, 2:6, 2:6] = 3                       # label 3 -> lh_cortex
    out = bake_template(tmp_path / "tpl", surfaces, aseg=aseg, aseg_affine=np.eye(4),
                        labels={3: "lh_cortex"}, space="toy")
    data = Path(out) / "data"
    assert (data / "cortex_lh.glb").exists() and (data / "cortex_rh.glb").exists()
    scene = json.loads((data / "scene.json").read_text())
    assert scene["space"] == "toy" and scene["templateMode"] == "custom"
    assert scene["templateBundle"]["surfaces"]["pial"]["lh"] == "cortex_lh.glb"
    aj = json.loads((data / "aseg.json").read_text())
    assert aj["categories"] == {"3": "lh_cortex"} and aj["structureCategories"] == ["lh_cortex"]


def test_custom_bundle_carries_surface_variants_t1_and_alignment_qa(tmp_path):
    left = trimesh.creation.icosphere(subdivisions=2, radius=15.0)
    right = left.copy()
    left.apply_translation([-18, 0, 0]); right.apply_translation([18, 0, 0])
    pial = {"lh": left, "rh": right}
    white = {h: m.copy() for h, m in pial.items()}
    for m in white.values():
        m.apply_scale(0.82)
    custom = {"veryInflated": {h: m.copy() for h, m in pial.items()}}
    for m in custom["veryInflated"].values():
        m.apply_scale(1.08)

    affine = np.eye(4); affine[:3, 3] = -40
    t1 = nib.Nifti1Image(np.full((80, 80, 80), 180, np.float32), affine)
    out = bake_template(tmp_path / "bundle", pial, white=white, custom_surfaces=custom,
                        t1=t1, space="toyRAS", transform_id="toy-world-v2",
                        alignment_tolerance_mm=3.0)
    data = Path(out) / "data"
    scene = json.loads((data / "scene.json").read_text())
    bundle = scene["templateBundle"]
    assert set(bundle["surfaces"]) == {"pial", "white", "veryInflated"}
    assert bundle["anatomy"]["transformId"] == bundle["transformId"] == "toy-world-v2"
    assert bundle["alignment"]["status"] == "pass"
    assert (data / "cortex_lh_white.glb").exists()
    assert (data / "cortex_rh_veryInflated.glb").exists()

    # A shifted anatomy affine must fail loudly, not silently claim the same named space.
    meta_path = data / "anat.json"
    meta = json.loads(meta_path.read_text())
    meta["affine"][0][3] += 25
    meta_path.write_text(json.dumps(meta))
    with pytest.raises(ValueError, match="alignment failed"):
        validate_template_alignment(data, tolerance_mm=3.0, fail=True)


def test_render_against_custom_template(tmp_path):
    # A custom template dir = the bundled assets tagged 'custom' — proves prepare_render_dir's
    # template overlay + render against a custom scene/aseg (the exact shape bake_template emits).
    tpl = tmp_path / "tpl"
    (tpl / "data" / "subcortical").mkdir(parents=True)
    for f in DATA.glob("*"):
        if f.is_file():
            shutil.copy2(f, tpl / "data" / f.name)
    for f in (DATA / "subcortical").glob("*"):
        shutil.copy2(f, tpl / "data" / "subcortical" / f.name)
    sc = json.loads((tpl / "data" / "scene.json").read_text())
    sc["templateMode"] = "custom"; sc["space"] = "customMNI"
    (tpl / "data" / "scene.json").write_text(json.dumps(sc))

    out = tmp_path / "fig.png"
    r = subprocess.run(
        [sys.executable, "-m", "comic.core", "render", SPHERE, "-o", str(out),
         "--template", str(tpl), "--grid", "1x1", "--views", "left_lateral",
         "--width", "400", "--height", "320", "--scale", "1", "--no-colorbar"],
        capture_output=True, text=True)
    assert r.returncode == 0, r.stderr[-2000:]
    assert out.exists() and out.read_bytes()[:8] == PNG
