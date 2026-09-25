"""Categorical NIfTI atlases must never be interpreted as continuous statistics."""
import json

import nibabel as nib
import numpy as np

from comic import pipeline as P


def _save(tmp_path, name, data):
    path = tmp_path / name
    # Small test volume avoids whole-brain origin checks while retaining sensible mm units.
    nib.save(nib.Nifti1Image(np.asarray(data, np.float32), np.diag([2.0, 2.0, 2.0, 1.0])), path)
    return path


def test_aal_named_integer_nifti_is_categorical_even_with_low_label_ids(tmp_path):
    data = np.zeros((12, 12, 12), np.float32)
    data[2:5, 2:5, 2:5] = 1
    data[6:9, 6:9, 6:9] = 2
    path = _save(tmp_path, "AAL_test.nii.gz", data)

    meta = json.loads(P.process_nifti(str(path), path.name, threshold=2.3, classify=False))
    assert meta["categoricalAtlas"] is True
    assert meta["atlasLabels"] == [1, 2]
    assert meta["atlasRegionCount"] == 2
    assert meta["threshold"] == 0.5       # upload threshold must not delete region label 1
    assert "cutVolume" not in meta        # scalar interpolation of IDs would be invalid

    buffers = P.get_all_buffers()
    entries = list(meta["structures"].values())
    assert {e["sourceLabel"] for e in entries} == {1, 2}
    assert {e["parcelIndex"] for e in entries} == {1, 2}
    for e in entries:
        vals = np.frombuffer(buffers[e["blocky"]["val"]], np.float32)
        assert np.unique(vals).tolist() == [float(e["parcelIndex"])]


def test_unhinted_integer_stat_map_is_not_misclassified_when_it_has_few_levels(tmp_path):
    data = np.zeros((12, 12, 12), np.float32)
    for value in range(1, 8):
        data[value, 3:5, 3:5] = value
    path = _save(tmp_path, "integer_effect.nii.gz", data)

    meta = json.loads(P.process_nifti(str(path), path.name, threshold=2.3, classify=False))
    assert not meta.get("categoricalAtlas", False)
    assert meta["threshold"] == 2.3
    assert "cutVolume" in meta
