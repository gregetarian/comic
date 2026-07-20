"""The scissor cut-cap anatomy asset (bake_anatomy): a sharp MNI152 T1 volume shipped for the
engine to paint on sliced faces. It carries its own voxel→MNI152-world affine (the space the
overlays live in) and is Fortran-ordered so the WebGL Data3DTexture maps identity."""
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
    assert meta["order"] == "F"            # i-fastest → WebGL Data3DTexture maps identity
    raw = gzip.decompress((DATA / "anat_uint8.bin.gz").read_bytes())
    assert len(raw) == dims[0] * dims[1] * dims[2]   # uint8, one byte per voxel
    vol = np.frombuffer(raw, np.uint8)
    assert vol.max() > 0 and vol.min() == 0    # real tissue + air background


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
