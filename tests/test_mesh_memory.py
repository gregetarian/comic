"""Guard: build_smooth_mesh's per-component 0.5 mm upsample is ~64x volume at 2 mm, so a
pathologically large low-threshold component can allocate several GB and OOM the browser tab.
The guard caps the upsampled voxel count per component (coarsening that one component) while
leaving normal maps byte-identical.
"""
import sys
import warnings
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from comic import pipeline as P

AFF_2MM = np.diag([2.0, 2.0, 2.0, 1.0])   # 2 mm iso -> zoom = 4 -> 64x upsample per component


def _blob(shape, box):
    """A filled rectangular component set to a supra-threshold value, padded by background so
    marching cubes has a level to cross. Returns (mask, signed_data)."""
    mask = np.zeros(shape, bool)
    mask[box] = True
    return mask, np.where(mask, 3.0, 0.0).astype(np.float32)


def test_normal_small_blob_is_byte_identical():
    # A small component upsamples to ~0.2M voxels, far under the cap: the guard must be inert and
    # produce exactly the same geometry as it would with the cap disabled (pre-guard behaviour).
    mask, sig = _blob((30, 30, 30), np.s_[5:15, 5:15, 5:15])

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        out = P.build_smooth_mesh(mask, sig, AFF_2MM)
    assert not [w for w in caught if "smooth mesh" in str(w.message)], "guard tripped on a normal blob"

    saved = P.SMOOTH_MAX_UPSAMPLED_VOXELS
    P.SMOOTH_MAX_UPSAMPLED_VOXELS = float("inf")   # cap disabled == pre-guard code path
    try:
        ref = P.build_smooth_mesh(mask, sig, AFF_2MM)
    finally:
        P.SMOOTH_MAX_UPSAMPLED_VOXELS = saved

    assert len(out[0]) > 0
    for a, b in zip(out, ref):
        assert a.dtype == b.dtype and a.shape == b.shape and a.tobytes() == b.tobytes()


def test_large_blob_degrades_below_cap_but_keeps_geometry():
    # A modest blob upsamples to ~5.5M voxels; lower the cap so it trips, then confirm the guard
    # warns, still returns geometry, and returns FEWER vertices than the uncapped (finer) mesh.
    mask, sig = _blob((44, 44, 44), np.s_[2:42, 2:42, 2:42])

    saved = P.SMOOTH_MAX_UPSAMPLED_VOXELS
    P.SMOOTH_MAX_UPSAMPLED_VOXELS = float("inf")
    try:
        fine = P.build_smooth_mesh(mask, sig, AFF_2MM)
    finally:
        P.SMOOTH_MAX_UPSAMPLED_VOXELS = saved

    P.SMOOTH_MAX_UPSAMPLED_VOXELS = 1_000_000
    try:
        with pytest.warns(UserWarning, match="smooth mesh"):
            coarse = P.build_smooth_mesh(mask, sig, AFF_2MM)
    finally:
        P.SMOOTH_MAX_UPSAMPLED_VOXELS = saved

    assert len(coarse[0]) > 0, "degraded component produced no geometry"
    assert len(coarse[0]) < len(fine[0]), "cap should coarsen (fewer vertices) than the fine mesh"
    # faces index into the returned vertices (valid mesh)
    assert coarse[1].max() < len(coarse[0])


def test_pathological_blob_trips_default_cap():
    # A near-whole-brain low-threshold blob upsamples to ~65M voxels at 2 mm, over the real 40M
    # default cap: the guard must fire and still yield a surface (rather than OOM / crash).
    mask, sig = _blob((95, 113, 95), np.s_[2:93, 2:111, 2:93])   # ~65M upsampled -> over 40M cap
    with pytest.warns(UserWarning, match="smooth mesh"):
        v, f, vals, clu = P.build_smooth_mesh(mask, sig, AFF_2MM)
    assert len(v) > 0 and f.max() < len(v)


if __name__ == "__main__":
    test_normal_small_blob_is_byte_identical()
    test_large_blob_degrades_below_cap_but_keeps_geometry()
    test_pathological_blob_trips_default_cap()
    print("PASS — normal blobs byte-identical; large blobs cap + keep geometry")
