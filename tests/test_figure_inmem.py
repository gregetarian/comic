"""In-memory inputs to the notebook API (`comic.figure.render`).

Browser-free: exercises only the `_to_paths` materialization that lets `gb.render`
accept a nibabel image or an (array, affine) pair as well as a path. The actual
headless render is covered by tests/test_figure_api.py.
"""
import os

import numpy as np
import nibabel as nib

from comic.figure import _to_paths


def _mni_image():
    aff = np.array([[-2, 0, 0, 90], [0, 2, 0, -126], [0, 0, 2, -72], [0, 0, 0, 1]], float)
    data = (np.random.default_rng(0).random((12, 12, 12)) * 5).astype(np.float32)
    return nib.Nifti1Image(data, aff), data, aff


def test_nibabel_image_and_array_affine_round_trip():
    img, data, aff = _mni_image()
    paths, tmp = _to_paths([img, (data, aff)])          # nibabel image + (array, affine)
    assert len(paths) == 2 and len(tmp) == 2
    for p in paths:
        back = nib.load(p)
        assert np.allclose(back.get_fdata(dtype=np.float32), data)
        assert np.allclose(back.affine, aff)
    for p in tmp:
        os.unlink(p)


def test_path_passes_through_without_a_tempfile(tmp_path):
    img, _, _ = _mni_image()
    real = tmp_path / "m.nii.gz"
    nib.save(img, str(real))
    paths, tmp = _to_paths([str(real)])                 # a real path stays a path, no temp
    assert paths == [str(real)]
    assert tmp == []
