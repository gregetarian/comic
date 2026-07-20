"""The scissor cut-cap anatomy asset (bake_anatomy): a sharp MNI152 T1 volume shipped for the
engine to paint on sliced faces. The bundled asset is baked from the same fsaverage anatomy as the
cortex, carries the same surface-RAS→MNI152 transform, and interleaves a filled footprint so dark
CSF/ventricle pixels remain opaque."""
import gzip
import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "comic" / "web" / "data"


def test_anatomy_asset_present_and_shaped():
    meta = json.loads((DATA / "anat.json").read_text())
    dims = meta["dims"]
    assert len(dims) == 3 and all(80 < n <= 256 for n in dims)   # a brain-sized 3D grid
    assert meta["order"] == "F-interleaved"  # i-fastest voxels, adjacent RG channels
    assert meta["channels"] == 4
    assert meta["channelOrder"] == ["t1", "cerebrum", "leftCerebrum", "rightCerebrum"]
    assert meta["surfaceMatched"] is True
    assert meta["hemisphereAware"] is True
    assert meta["footprint"] == "pial-envelope"
    assert meta["kind"].startswith("fsaverage brain.mgz")
    raw = gzip.decompress((DATA / "anat_uint8.bin.gz").read_bytes())
    assert len(raw) == dims[0] * dims[1] * dims[2] * 4
    rgba = np.frombuffer(raw, np.uint8).reshape(-1, 4)
    vol, mask, left, right = rgba[:, 0], rgba[:, 1], rgba[:, 2], rgba[:, 3]
    assert vol.max() > 0 and vol.min() == 0    # real tissue + air background
    assert set(np.unique(mask)).issubset({0, 255}) and mask.max() == 255 and mask.min() == 0
    assert np.array_equal(mask > 0, (left > 0) | (right > 0))
    assert np.any(left > 0) and np.any(right > 0)
    # At least some included cerebral pixels fall below the display window floor: these render as
    # opaque black CSF/ventricles, not transparent holes that expose cortex lines/background.
    assert np.any((vol < round(0.28 * 255)) & (mask == 255))


def test_anatomy_affine_is_mm_scale_world():
    meta = json.loads((DATA / "anat.json").read_text())
    A = np.array(meta["affine"])
    assert A.shape == (4, 4) and np.isfinite(np.linalg.inv(A)).all()   # invertible (world→voxel)
    vox = np.sqrt((A[:3, :3] ** 2).sum(axis=0))                        # voxel size per axis (mm)
    assert np.all((vox > 0.4) & (vox < 3.0)), vox                      # plausible mm anatomical grid


if __name__ == "__main__":
    test_anatomy_asset_present_and_shaped()
    test_anatomy_affine_is_mm_scale_world()
    print("PASS — anatomy cut-cap asset")
