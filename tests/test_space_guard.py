"""Guard: an uploaded volume that is clearly NOT in MNI152 space must raise a LOUD warning
(placement + aseg region classification silently assume MNI), while real MNI stat maps pass
without a peep. The check lives in comic.pipeline._warn_if_not_mni and runs inside load_stat_map.
"""
import sys
import tempfile
import warnings
from pathlib import Path

import numpy as np
import nibabel as nib
import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from comic import pipeline as P

MNI_MSG = "does not look like MNI152 space"


def _write_nifti(shape, affine):
    """Write a tiny NIfTI (a small supra-threshold blob) with the given affine; return its path."""
    data = np.zeros(shape, np.float32)
    data[tuple(slice(s // 2 - 1, s // 2 + 2) for s in shape)] = 5.0   # a few voxels above threshold
    path = Path(tempfile.mkdtemp()) / "vol.nii.gz"
    nib.save(nib.Nifti1Image(data, affine), str(path))
    return str(path)


def _find(*relpaths):
    for r in relpaths:
        p = ROOT / r
        if p.exists():
            return p
    raise FileNotFoundError(relpaths)


def test_non_mni_placement_warns():
    # 2 mm voxels but the origin (anterior commissure) is pinned at a corner, not the brain centre:
    # a native/unnormalised grid. FOV is whole-brain-sized (140 mm) so the AC-interior check fires.
    affine = np.diag([2.0, 2.0, 2.0, 1.0])
    path = _write_nifti((70, 70, 70), affine)
    with pytest.warns(UserWarning, match=MNI_MSG):
        P.load_stat_map(path, "corner_origin.nii.gz", 2.3)


def test_non_mni_voxel_size_warns():
    # 12 mm voxels are outside any plausible MNI stat-map resolution (wrong units / not a brain grid).
    affine = np.diag([12.0, 12.0, 12.0, 1.0])
    path = _write_nifti((20, 20, 20), affine)
    with pytest.warns(UserWarning, match=MNI_MSG):
        P.load_stat_map(path, "huge_voxels.nii.gz", 2.3)


def test_real_mni_fixtures_do_not_warn():
    # Every bundled MNI152 fixture must load silently — the guard must not false-alarm.
    fixtures = [
        _find("test_sphere.nii.gz"),
        _find("comic/web/data/defaults/language.nii.gz"),
        _find("comic/web/data/defaults/default_network.nii.gz"),
        _find("comic/web/data/defaults/faces.nii.gz"),
        _find("comic/web/data/defaults/addiction.nii.gz"),
    ]
    for fx in fixtures:
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            P.load_stat_map(str(fx), fx.name, 2.3)
        mni = [w for w in caught if MNI_MSG in str(w.message)]
        assert not mni, f"{fx.name} wrongly flagged as non-MNI: {[str(w.message) for w in mni]}"


if __name__ == "__main__":
    test_non_mni_placement_warns()
    test_non_mni_voxel_size_warns()
    test_real_mni_fixtures_do_not_warn()
    print("PASS — non-MNI affines warn; all MNI fixtures pass silently")
