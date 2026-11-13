"""Bundled HCP fs_LR 32k cortical mesh (32,492 vertices per hemisphere).

Maps computed on the HCP "grayordinate" surface (GIFTI ``.func.gii`` / CIFTI ``.dscalar.nii``)
index the fs_LR mesh, whose vertices have no simple relation to fsaverage. Rather than resample
such maps, Comic ships the fs_LR mesh itself and paints them vertex-for-vertex.

One asset serves both runtimes: ``web/data/fslr32k/cortex.bin.gz`` + ``cortex.json``.

    per hemisphere:  pial          float32 (n, 3)   group-average MIDTHICKNESS, MNI152 world mm
                     inflated      float32 (n, 3)   Comic's in-place inflation of that surface
                     veryinflated  float32 (n, 3)   the same, taken much further (sulci gone)
                     faces         uint32  (m, 3)

The pipeline reads ``pial`` + ``faces`` through the ordinary ``init_cortex`` (so the key keeps
that name even though the surface is the midthickness: fs_LR ships no group pial/white pair);
the viewer builds the cortex shell from the same arrays. The inflated surfaces are derived exactly
as the fsaverage one is (Laplacian smoothing, rescaled about the centroid), so it stays in MNI
space and volumes still line up with them. The HCP's own inflated surfaces are centred on the
origin per hemisphere and would not.

Run:  python -m comic.fslr          (maintainer task; needs the [bake] extra and network access)
"""

import gzip
import hashlib
import json
from pathlib import Path

import numpy as np

FSLR32K = "fslr32k"
FSLR32K_NVERTS = 32492
FSLR32K_VERSION = "fslr32k-midthickness-v1"
# The 32k mesh has ~5x fewer vertices than fsaverage ico7, so each Laplacian pass moves a vertex
# further in mm. Fewer passes give the same "slightly inflated" look as the fsaverage asset.
INFLATE_ITERATIONS = 8
VERY_INFLATE_ITERATIONS = 60

_TF = "https://templateflow.s3.amazonaws.com/tpl-fsLR/"
SOURCES = {
    "lh": ("tpl-fsLR_den-32k_hemi-L_midthickness.surf.gii",
           "036a8b6c84fa4b581b7ad7b36d99190b57ad6755c9d7ef7adc3e9ffc6448f1af"),
    "rh": ("tpl-fsLR_den-32k_hemi-R_midthickness.surf.gii",
           "9d2cef05096c433b134870456abebe7ff201cdda60ce5741d7b794018eeccda7"),
}


def _fetch(name, sha256, source_dir=None):
    """Return the verified bytes of one TemplateFlow file (from `source_dir` when given)."""
    if source_dir is not None:
        raw = (Path(source_dir) / name).read_bytes()
    else:
        import urllib.request
        with urllib.request.urlopen(_TF + name, timeout=120) as r:
            raw = r.read()
    got = hashlib.sha256(raw).hexdigest()
    if got != sha256:
        raise ValueError(f"{name}: sha256 {got} does not match the pinned {sha256}")
    return raw


def _read_surface(raw):
    import nibabel as nib
    g = nib.gifti.GiftiImage.from_bytes(raw)
    verts = np.asarray(g.get_arrays_from_intent("NIFTI_INTENT_POINTSET")[0].data, np.float32)
    faces = np.asarray(g.get_arrays_from_intent("NIFTI_INTENT_TRIANGLE")[0].data, np.uint32)
    return verts, faces


def bake_fslr32k(out_dir=None, source_dir=None):
    """Write web/data/fslr32k/cortex.{bin.gz,json} from the pinned TemplateFlow midthickness."""
    from .surfaces import inflate_surfaces, to_trimesh
    out = Path(out_dir) if out_dir else Path(__file__).resolve().parent / "web" / "data"
    out = out / FSLR32K
    out.mkdir(parents=True, exist_ok=True)

    blob, layout = bytearray(), {
        "mesh": FSLR32K, "version": FSLR32K_VERSION, "space": "MNI152",
        "surface": "midthickness",
        "inflateIterations": {"inflated": INFLATE_ITERATIONS, "veryinflated": VERY_INFLATE_ITERATIONS},
        "source": {"template": "TemplateFlow tpl-fsLR (HCP Pipelines standard mesh atlases)",
                   "files": {h: {"name": n, "sha256": s} for h, (n, s) in SOURCES.items()}},
    }

    def put(arr):
        off = len(blob); blob.extend(np.ascontiguousarray(arr).tobytes()); return [off, len(blob) - off]

    for hemi, (name, sha) in SOURCES.items():
        verts, faces = _read_surface(_fetch(name, sha, source_dir))
        if len(verts) != FSLR32K_NVERTS:
            raise ValueError(f"{name}: {len(verts)} vertices, expected {FSLR32K_NVERTS}")
        mesh = to_trimesh(verts, faces)
        if mesh.volume <= 0:
            raise ValueError(f"{name}: faces are not wound outward")
        inflated = inflate_surfaces({hemi: mesh}, iterations=INFLATE_ITERATIONS)[hemi]
        very = inflate_surfaces({hemi: mesh}, iterations=VERY_INFLATE_ITERATIONS)[hemi]
        layout[hemi] = {
            "nverts": int(len(verts)), "ntris": int(len(faces)),
            "pial": put(verts.astype(np.float32)),
            "inflated": put(np.asarray(inflated.vertices, np.float32)),
            "veryinflated": put(np.asarray(very.vertices, np.float32)),
            "faces": put(faces.astype(np.uint32)),
        }
    # mtime=0 keeps the archive byte-stable across re-bakes of identical input.
    (out / "cortex.bin.gz").write_bytes(gzip.compress(bytes(blob), 9, mtime=0))
    (out / "cortex.json").write_text(json.dumps(layout, indent=1))
    print(f"Baked fs_LR 32k mesh -> {out / 'cortex.bin.gz'}")
    return out / "cortex.bin.gz"


if __name__ == "__main__":
    bake_fslr32k()
