"""Native HCP fs_LR 32k surface maps: painted on the bundled fs_LR mesh vertex-for-vertex (no
resampling to fsaverage), from per-hemisphere GIFTI or a CIFTI dscalar, with NaN / unmodelled
vertices flagged as no data. Pure Python: no browser."""
import gzip
import json
from pathlib import Path

import nibabel as nib
import numpy as np
import pytest
from nibabel import cifti2

from comic import pipeline as P
from comic.fslr import FSLR32K_NVERTS, SOURCES
from comic.inputs import input_descriptors

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "comic" / "web" / "data"
N = FSLR32K_NVERTS


def _init():
    P.init_cortex((DATA / "cortex_surface.bin.gz").read_bytes(), (DATA / "cortex_surface.json").read_text())
    P.init_cortex((DATA / "fslr32k" / "cortex.bin.gz").read_bytes(),
                  (DATA / "fslr32k" / "cortex.json").read_text(), mesh="fslr32k")


def _gii(path, vals):
    arr = nib.gifti.GiftiDataArray(np.asarray(vals, np.float32), intent="NIFTI_INTENT_NONE",
                                   datatype="NIFTI_TYPE_FLOAT32")
    nib.save(nib.gifti.GiftiImage(darrays=[arr]), str(path))
    return str(path)


def _maps(seed=0):
    rng = np.random.default_rng(seed)
    return {h: rng.normal(0, 3, N).astype(np.float32) for h in ("lh", "rh")}


def _buf(meta, hemi, key):
    return np.frombuffer(P.get_all_buffers()[meta["surface"][hemi][key]], np.float32)


def test_bundled_mesh_asset():
    layout = json.loads((DATA / "fslr32k" / "cortex.json").read_text())
    raw = gzip.decompress((DATA / "fslr32k" / "cortex.bin.gz").read_bytes())
    assert layout["space"] == "MNI152" and layout["surface"] == "midthickness"
    for hemi in ("lh", "rh"):
        h = layout[hemi]
        assert h["nverts"] == N and h["ntris"] == 2 * N - 4          # closed genus-0 surface
        assert layout["source"]["files"][hemi]["sha256"] == SOURCES[hemi][1]
        off, ln = h["faces"]
        faces = np.frombuffer(raw[off:off + ln], np.uint32)
        assert faces.max() == N - 1
        for key in ("pial", "inflated", "veryinflated"):
            off, ln = h[key]
            v = np.frombuffer(raw[off:off + ln], np.float32).reshape(-1, 3)
            assert v.shape == (N, 3) and np.isfinite(v).all()
        # the hemispheres sit either side of the midline in MNI world space
        off, ln = h["pial"]
        x = np.frombuffer(raw[off:off + ln], np.float32).reshape(-1, 3)[:, 0].mean()
        assert (x < -20) if hemi == "lh" else (x > 20)


def test_gifti_is_painted_unresampled_with_nan_as_no_data(tmp_path):
    _init()
    maps = _maps()
    given = {h: v.copy() for h, v in maps.items()}
    given["lh"][100:350] = np.nan
    meta = json.loads(P.process_surface(_gii(tmp_path / "t.L.func.gii", given["lh"]),
                                        _gii(tmp_path / "t.R.func.gii", given["rh"]), "t", 0.0))
    assert meta["surfaceOnly"] and meta["cortexMesh"] == "fslr32k" and meta["noDataVertices"] == 250
    for hemi in ("lh", "rh"):
        assert meta["surface"][hemi]["nverts"] == N
    val, nodata = _buf(meta, "lh", "val"), _buf(meta, "lh", "nodata")
    assert not np.isnan(val).any()                                   # NaN never reaches the GPU
    assert np.array_equal(np.flatnonzero(nodata), np.arange(100, 350))
    assert np.array_equal(val[nodata == 0], maps["lh"][nodata == 0])  # bit-exact: no resampling
    assert "nodata" not in meta["surface"]["rh"]                      # staged only where needed
    assert np.array_equal(_buf(meta, "rh", "val"), maps["rh"])
    # the sheet is the fs_LR mesh itself
    pos = _buf(meta, "rh", "pos").reshape(-1, 3)
    assert np.array_equal(pos, P._CORTEX_MESHES["fslr32k"]["rh"]["verts"])


def test_nan_does_not_move_the_colour_scale(tmp_path):
    _init()
    vals = np.linspace(-2, 2, N, dtype=np.float32)
    holes = vals.copy(); holes[::3] = np.nan
    a = json.loads(P.process_surface(_gii(tmp_path / "a.L.func.gii", holes), None, "a", 0.5))
    assert a["diverging"] and 1.9 < a["maxAbsValue"] <= 2.0


def test_cifti_dscalar_leaves_unmodelled_vertices_as_no_data(tmp_path):
    _init()
    maps = _maps(1)
    keep = {"lh": np.arange(0, N, 2), "rh": np.arange(5, N)}
    axes = [cifti2.BrainModelAxis.from_surface(keep[h], N, name=name)
            for h, name in (("lh", "CIFTI_STRUCTURE_CORTEX_LEFT"), ("rh", "CIFTI_STRUCTURE_CORTEX_RIGHT"))]
    # a subcortical voxel model rides along in real dscalars; the surface path must ignore it
    vox = cifti2.BrainModelAxis.from_mask(np.ones((2, 2, 2), bool), affine=np.eye(4),
                                          name="CIFTI_STRUCTURE_THALAMUS_LEFT")
    row = np.concatenate([maps["lh"][keep["lh"]], maps["rh"][keep["rh"]], np.zeros(8, np.float32)])
    img = cifti2.Cifti2Image(np.stack([row, -row]),
                             header=(cifti2.ScalarAxis(["first", "second"]), axes[0] + axes[1] + vox))
    path = tmp_path / "map.dscalar.nii"
    nib.save(img, str(path))

    for src, name in ((str(path), None), (path.read_bytes(), "map.dscalar.nii")):   # CLI path, browser bytes
        meta = json.loads(P.process_surface(src, None, "c", 0.0, name, None))
        assert meta["cortexMesh"] == "fslr32k" and set(meta["surface"]) == {"lh", "rh"}
        assert meta["noDataVertices"] == (N - len(keep["lh"])) + 5
        for hemi in ("lh", "rh"):
            val, nodata = _buf(meta, hemi, "val"), _buf(meta, hemi, "nodata")
            modelled = np.zeros(N, bool); modelled[keep[hemi]] = True
            assert np.array_equal(nodata == 0, modelled)
            assert np.array_equal(val[modelled], maps[hemi][modelled])   # first map, in vertex order
    with pytest.raises(ValueError, match="both hemispheres"):
        P.process_surface(str(path), str(path), "c", 0.0)


def test_mesh_is_chosen_by_vertex_count(tmp_path):
    _init()
    fs5 = np.ones(10242, np.float32); fs5[:10] = np.nan
    meta = json.loads(P.process_surface(_gii(tmp_path / "lh.x.gii", fs5), None, "x", 0.5))
    # fsaverage behaviour is unchanged: template mesh, NaN folded to 0, no fs_LR keys
    assert "cortexMesh" not in meta and "nodata" not in meta["surface"]["lh"]
    assert meta["surface"]["lh"]["nverts"] == 163842
    with pytest.raises(ValueError, match="different meshes"):
        P.process_surface(_gii(tmp_path / "lh.x.gii", fs5), _gii(tmp_path / "rh.y.gii", np.ones(N)), "x", 0.5)
    with pytest.raises(ValueError, match="fsaverage size"):
        P.process_surface(_gii(tmp_path / "lh.z.gii", np.ones(1000)), None, "z", 0.5)


def test_missing_mesh_is_reported_with_the_retry_marker(tmp_path):
    _init()
    saved = P._CORTEX_MESHES.pop("fslr32k")
    try:
        with pytest.raises(RuntimeError, match=r"\[needs-cortex:fslr32k\]"):   # bootstrap.js keys on this
            P.process_surface(_gii(tmp_path / "t.L.func.gii", np.ones(N)), None, "t", 0.5)
    finally:
        P._CORTEX_MESHES["fslr32k"] = saved


def test_cifti_input_descriptors():
    assert input_descriptors(surface_maps=[{"cifti": "m.dscalar.nii"}]) == [{"type": "surface", "cifti": "m.dscalar.nii"}]
    with pytest.raises(ValueError, match="lh or rh"):
        input_descriptors(input_maps=[{"type": "surface"}])
    with pytest.raises(ValueError, match="both hemispheres"):
        input_descriptors(input_maps=[{"type": "surface", "cifti": "m.dscalar.nii", "lh": "a.gii"}])


def test_render_dir_stages_fslr_and_refuses_mixed_meshes(tmp_path):
    import shutil
    from comic.render import prepare_render_dir
    fslr = _gii(tmp_path / "t.L.func.gii", np.ones(N))
    fsavg = _gii(tmp_path / "lh.x.gii", np.ones(10242))
    out = prepare_render_dir(surface_maps=[{"lh": fslr}], threshold=0.5)
    try:
        scene = json.loads((out / "data" / "scene.json").read_text())
        assert scene["overlays"][0]["cortexMesh"] == "fslr32k" and scene["overlays"][0]["name"] == "t"
        assert (out / "data" / "fslr32k" / "cortex.bin.gz").exists()
    finally:
        shutil.rmtree(out, ignore_errors=True)
    with pytest.raises(ValueError, match="cannot mix"):
        prepare_render_dir(surface_maps=[{"lh": fslr}, {"lh": fsavg}], threshold=0.5)
