"""Bake the fixed fsaverage template assets into comic/web/data/.

These do NOT depend on a user's upload, so we compute them once (with the full Python
stack — mne/trimesh/cmap, the `[bake]` extra) and commit them as static files. At
runtime the browser (Pyodide) and the CLI render both load them directly; only the
per-NIfTI meshing runs live (comic/pipeline.py, the same in both).

Outputs (web/data/): cortex_{lh,rh}{,_inflated}.glb, subcortical/*.glb, colormaps.json,
scene.json (base, no overlays), render-config.json, aseg_uint8.bin.gz + aseg.json,
demo/{meta.json,buffers.bin}. Also copies the canonical pipeline.py into web/pyodide/.

Run:  comic bake     (or  python -m comic.bake)
"""

import gzip
import json
import shutil
from pathlib import Path

import numpy as np

PKG = Path(__file__).resolve().parent           # comic/
WEB = PKG / "web"
DATA = WEB / "data"


def bake(demo_nifti=None):
    from .core import Comic
    from .surfaces import inflate_surfaces, load_hemisphere, mni305_to_mni152, to_trimesh
    from .export import export_mesh, export_mesh_with_scalars, write_scene_json
    from .colormaps import export_colormaps
    from . import pipeline as P

    DATA.mkdir(parents=True, exist_ok=True)
    (DATA / "subcortical").mkdir(exist_ok=True)

    print("Loading fsaverage template (surfaces + subcortical via mne)…")
    gb = Comic(include_subcortical=True)

    # cortex: pial + slightly-inflated, curvature encoded in vertex-colour red
    inflated = inflate_surfaces(gb.surfaces)
    cortex_paths = {}
    import mne
    import nibabel as nib
    fs = Path(mne.datasets.fetch_fsaverage(verbose=False))
    surf_dir = fs / "surf"
    if not surf_dir.exists():
        surf_dir = fs / "fsaverage" / "surf"
    for hemi, mesh in gb.surfaces.items():
        export_mesh_with_scalars(mesh, DATA / f"cortex_{hemi}.glb", scalar_name="curvature")
        export_mesh_with_scalars(inflated[hemi], DATA / f"cortex_{hemi}_inflated.glb", scalar_name="curvature")
        white_v, white_f = nib.freesurfer.read_geometry(str(surf_dir / f"{hemi}.white"))
        _, _, curv = load_hemisphere(surf_dir, hemi)
        white_mesh = to_trimesh(mni305_to_mni152(white_v), white_f, {"curvature": curv})
        export_mesh_with_scalars(white_mesh, DATA / f"cortex_{hemi}_white.glb", scalar_name="curvature")
        cortex_paths[hemi] = {
            "mesh": f"cortex_{hemi}.glb",
            "meshInflated": f"cortex_{hemi}_inflated.glb",
            "meshWhite": f"cortex_{hemi}_white.glb",
        }

    # subcortical: one solid-colour GLB each
    subcort_paths = {}
    for nm, mesh in gb.subcortical.items():
        safe = nm.lower().replace("-", "_").replace(" ", "_")
        rel = f"subcortical/{safe}.glb"
        color = gb.subcortical_colors.get(nm, (0.6, 0.6, 0.6))
        vc = (np.array([*color, 1.0]) * 255).astype(np.uint8)
        export_mesh(mesh, DATA / rel, vertex_colors=np.tile(vc, (len(mesh.vertices), 1)))
        subcort_paths[nm] = rel

    write_scene_json(DATA, cortex_meshes=cortex_paths, subcortical_meshes=subcort_paths,
                     subcortical_colors=gb.subcortical_colors, overlays=None)
    export_colormaps(DATA / "colormaps.json")
    # clusterMin defaults to 0 (not the FSL-ish 105): a general tool must not silently
    # hide arbitrary uploads (or the small demo).
    (DATA / "render-config.json").write_text(json.dumps(
        {"preset": "ninePanel", "style": {"colormap": "YlGnBu", "voxel": {"clusterMin": 0}}}, indent=2))

    # aseg (for in-browser voxel classification): gzipped uint8 256^3 C-order + sidecar.
    aseg = np.asarray(gb._aseg_data)
    assert aseg.max() < 256, f"aseg has labels >= 256 ({aseg.max()}); need a wider dtype"
    aseg_gz = gzip.compress(aseg.astype(np.uint8).tobytes(order="C"), compresslevel=9)
    (DATA / "aseg_uint8.bin.gz").write_bytes(aseg_gz)
    # Ship the category tables AS DATA so init_aseg is data-driven (a custom seg carries its own; M9).
    (DATA / "aseg.json").write_text(json.dumps(
        {"dims": list(aseg.shape), "dtype": "uint8", "order": "C", "affine": gb._aseg_affine.tolist(),
         "categories": {str(k): v for k, v in P.ASEG_CATEGORIES.items()},
         "structureCategories": list(P.STRUCTURE_CATEGORIES),
         "hasWhiteSurface": False}, indent=2))

    # keep the browser's Pyodide copy byte-identical to the canonical pipeline
    shutil.copy2(PKG / "pipeline.py", WEB / "pyodide" / "pipeline.py")

    # demo overlay (instant landing render, no Pyodide) — run through the SAME pipeline
    demo_nifti = Path(demo_nifti or (PKG.parent / "test_sphere.nii.gz"))
    P.init_aseg(aseg_gz, (DATA / "aseg.json").read_text())
    meta = json.loads(P.process_nifti(str(demo_nifti), demo_nifti.name, 2.3))
    blob = bytearray()
    layout = []
    for buf in P.get_all_buffers():
        layout.append([len(blob), len(buf)])
        blob.extend(buf)
    meta["bufferLayout"] = layout
    meta["buffersFile"] = "buffers.bin"
    (DATA / "demo").mkdir(exist_ok=True)
    (DATA / "demo" / "meta.json").write_text(json.dumps(meta))
    (DATA / "demo" / "buffers.bin").write_bytes(bytes(blob))

    # A complete template bundle is atomic: surfaces, cut T1, segmentation, projection sidecar,
    # transform identity, and measured alignment all ship together.
    bake_anatomy(DATA)
    bake_surface_sidecar(DATA)
    from .template import update_template_bundle_manifest
    update_template_bundle_manifest(DATA, template_id="fsaverage-mni152-v1",
                                    transform_id="fsaverage-mni152-v1")
    print(f"Baked template + demo -> {DATA}")


def bake_template(out_dir, surfaces, *, inflated=None, white=None, custom_surfaces=None,
                  t1=None, aseg=None, aseg_affine=None, labels=None,
                  structure_categories=None, subcortical=None, subcortical_colors=None,
                  space="custom", has_white_surface=False, transform_id=None,
                  alignment_tolerance_mm=2.5):
    """Bake a CUSTOM template into <out_dir>/data/ (the shape `render --template DIR` overlays).

    `surfaces` is {hemi: trimesh OR (verts, faces[, curv])} — bring-your-own cortical surfaces in
    ANY space (visualisation-grade: the user supplies maps already aligned to this template; we do
    not register). `aseg` (a uint8 label volume) + `labels` (int -> category name) + `aseg_affine`
    drive voxel classification; omit them for a shell-only template (render with --no-template, or
    a classifying aseg is required for hemisphere/subcortical views). Reuses the fsaverage exporters,
    so a custom template feeds the SAME engine. Returns out_dir."""
    import shutil
    from .export import export_mesh, export_mesh_with_scalars, write_scene_json
    from .surfaces import to_trimesh

    out = Path(out_dir)
    data = out / "data"
    data.mkdir(parents=True, exist_ok=True)
    (data / "subcortical").mkdir(exist_ok=True)

    def _mesh(s):
        if hasattr(s, "vertices"):
            return s
        v, f = np.asarray(s[0]), np.asarray(s[1])
        curv = np.asarray(s[2]) if len(s) > 2 and s[2] is not None else np.zeros(len(v), np.float32)
        return to_trimesh(v, f, {"curvature": curv})

    cortex_paths = {}
    for hemi, s in surfaces.items():
        export_mesh_with_scalars(_mesh(s), data / f"cortex_{hemi}.glb", scalar_name="curvature")
        cortex_paths[hemi] = {"mesh": f"cortex_{hemi}.glb"}
        if inflated and hemi in inflated:
            export_mesh_with_scalars(_mesh(inflated[hemi]), data / f"cortex_{hemi}_inflated.glb", scalar_name="curvature")
            cortex_paths[hemi]["meshInflated"] = f"cortex_{hemi}_inflated.glb"
        if white and hemi in white:
            export_mesh_with_scalars(_mesh(white[hemi]), data / f"cortex_{hemi}_white.glb", scalar_name="curvature")
            cortex_paths[hemi]["meshWhite"] = f"cortex_{hemi}_white.glb"
        for variant, by_hemi in (custom_surfaces or {}).items():
            if hemi not in by_hemi:
                continue
            safe = ''.join(c if c.isalnum() or c in '-_' else '_' for c in variant)
            rel = f"cortex_{hemi}_{safe}.glb"
            export_mesh_with_scalars(_mesh(by_hemi[hemi]), data / rel, scalar_name="curvature")
            cortex_paths[hemi].setdefault("surfaces", {})[variant] = rel

    subcort_paths = {}
    for nm, m in (subcortical or {}).items():
        mesh = _mesh(m)
        safe = nm.lower().replace("-", "_").replace(" ", "_")
        rel = f"subcortical/{safe}.glb"
        color = (subcortical_colors or {}).get(nm, (0.6, 0.6, 0.6))
        vc = (np.array([*color, 1.0]) * 255).astype(np.uint8)
        export_mesh(mesh, data / rel, vertex_colors=np.tile(vc, (len(mesh.vertices), 1)))
        subcort_paths[nm] = rel

    write_scene_json(data, cortex_meshes=cortex_paths, subcortical_meshes=subcort_paths or None,
                     subcortical_colors=subcortical_colors, space=space, template_mode="custom",
                     has_white_surface=has_white_surface or bool(white))

    if aseg is not None:
        aseg = np.asarray(aseg)
        assert aseg.max() < 256, f"aseg labels must be < 256 for uint8 (got {aseg.max()})"
        (data / "aseg_uint8.bin.gz").write_bytes(gzip.compress(aseg.astype(np.uint8).tobytes(order="C"), 9))
        cats = {str(int(k)): v for k, v in (labels or {}).items()}
        (data / "aseg.json").write_text(json.dumps({
            "dims": list(aseg.shape), "dtype": "uint8", "order": "C",
            "affine": (np.asarray(aseg_affine).tolist() if aseg_affine is not None else np.eye(4).tolist()),
            "categories": cats, "structureCategories": structure_categories or sorted(set(cats.values())),
            "hasWhiteSurface": has_white_surface or bool(white),
            "transformId": transform_id or f"{space}-world-v1"}))

    if t1 is not None:
        bake_anatomy(data, t1, footprint_surfaces={h: _mesh(s) for h, s in surfaces.items()},
                     transform_id=transform_id or f"{space}-world-v1")

    cm = DATA / "colormaps.json"          # self-contained bundle (a browser .zip can ship its own)
    if cm.exists():
        shutil.copy2(cm, data / "colormaps.json")
    from .template import update_template_bundle_manifest
    update_template_bundle_manifest(
        data, template_id=f"custom-{space}", transform_id=transform_id or f"{space}-world-v1",
        alignment_tolerance_mm=alignment_tolerance_mm, fail_alignment=True)
    print(f"Baked custom template -> {data} (space={space}, {len(cortex_paths)} hemis, "
          f"{'aseg' if aseg is not None else 'no aseg'})")
    return out


def _find_cut_anatomy(explicit=None):
    """Return (image, voxel_to_world, kind, surface_matched, surface_dir) for the cut-cap T1.

    The bundled cortex is the fsaverage pial surface transformed from FreeSurfer surface RAS
    (MNI305) into MNI152. Therefore the only anatomy that can match it exactly is fsaverage's own
    native MRI grid, transformed by that SAME matrix. Prefer T1.mgz: it is the higher-dynamic-range
    source image on that grid, while brain.mgz is an already intensity-normalised/skull-stripped
    derivative that looks noticeably softer when enlarged on a cut face. The exact pial footprint
    still supplies the brain mask. A generic MNI152 atlas shares a coordinate label but not the same
    cortical boundary. An explicit image remains supported for custom/template work and uses its own
    voxel-to-world affine; callers are then responsible for surface registration."""
    import nibabel as nib
    if explicit:
        if hasattr(explicit, "dataobj") and hasattr(explicit, "affine"):
            img = explicit
            return img, np.asarray(img.affine, np.float64), "custom in-memory T1", False, None
        p = Path(explicit)
        if not p.exists():
            raise FileNotFoundError(f"cut anatomy not found: {p}")
        img = nib.load(str(p))
        return img, img.affine.astype(np.float64), f"custom ({p.name})", False, None

    import mne
    from .surfaces import MNI305_TO_MNI152
    fs = Path(mne.datasets.fetch_fsaverage(verbose=False))
    candidates = [
        fs / "mri" / "T1.mgz", fs / "fsaverage" / "mri" / "T1.mgz",
        fs / "mri" / "brain.mgz", fs / "fsaverage" / "mri" / "brain.mgz",
    ]
    for p in candidates:
        if not p.exists():
            continue
        img = nib.load(str(p))
        # FreeSurfer surface vertices live in tkregister/surface RAS, not arbitrary scanner RAS.
        # Mapping the volume through vox2ras_tkr and the exact surface MNI305→MNI152 transform
        # makes the cut image and pial GLBs members of one template, not merely similarly named.
        vox2surf = np.asarray(img.header.get_vox2ras_tkr(), dtype=np.float64)
        surf_dir = p.parent.parent / "surf"
        return (img, MNI305_TO_MNI152 @ vox2surf,
                f"fsaverage {p.name} (surface-matched)", True,
                surf_dir if surf_dir.exists() else None)
    raise FileNotFoundError("fsaverage T1/brain MRI is unavailable; install/fetch the MNE fsaverage data")


def bake_anatomy(out_dir=None, t1_path=None, downsample=1, *, footprint_surfaces=None,
                 transform_id=None):
    """Bake a surface-matched T1 as a 3D-texture asset for the scissor cut-cap (the anatomical
    cross-section — white/gray matter — shown on a sliced face, like an AFNI/MRIcron slice).

    By default this uses **fsaverage T1.mgz**, the native anatomy on the grid that generated the
    bundled pial surfaces, and applies the identical surface-RAS→MNI152 transform. This is stricter than choosing
    an unrelated atlas merely because it is also labelled MNI152. An explicit `t1_path` uses its own
    affine for custom-template work. Native dark voxels are preserved behind a separate filled brain
    footprint, so CSF/ventricles render black and opaque instead of becoming holes. The bundled
    fsaverage asset also carries separate left/right cerebral masks voxelised from the exact pial
    meshes: this excludes cerebellum/brainstem that are not enclosed by the rendered shell, and lets
    a one-hemisphere panel reveal only its own cut face. `downsample` 1 = native 1 mm. Writes RGBA
    (T1, both-cerebra, left, right) + anat.json. Standalone: other assets untouched."""
    from scipy import ndimage
    out = Path(out_dir) if out_dir else DATA

    img, aff, kind, surface_matched, surface_dir = _find_cut_anatomy(t1_path)
    surface_matched = surface_matched or bool(footprint_surfaces)
    if transform_id is None and surface_dir is not None:
        transform_id = "fsaverage-mni152-v1"

    t1 = np.asarray(img.dataobj)
    if t1.ndim == 4:
        t1 = t1[..., 0]                                          # AFNI templates can be multi-brick
    t1 = t1.astype(np.float32)
    # A separate footprint is essential: intensity==0 can mean internal CSF/ventricle as well as
    # outside air. For the bundled template, voxelise the exact pial meshes. The MRI contains
    # scalp/cerebellum/brainstem too, but those structures are NOT inside the pial cortex; using intensity
    # or an atlas label alone therefore paints a cut slab outside the displayed shell.
    hemi_aware = surface_dir is not None or bool(footprint_surfaces)
    if hemi_aware:
        import trimesh
        from .surfaces import load_hemisphere, mni305_to_mni152
        world_to_voxel = np.linalg.inv(aff)
        footprints = {}
        for hemi in ("lh", "rh"):
            if footprint_surfaces and hemi in footprint_surfaces:
                source = footprint_surfaces[hemi]
                pial = (source if hasattr(source, "vertices") else
                        trimesh.Trimesh(vertices=np.asarray(source[0]), faces=np.asarray(source[1]),
                                        process=False))
            else:
                verts, faces, _ = load_hemisphere(surface_dir, hemi)
                pial = trimesh.Trimesh(vertices=mni305_to_mni152(verts), faces=faces, process=False)
            if not pial.is_watertight:
                raise ValueError(f"{hemi} pial surface is not watertight; cannot bake a cut footprint")
            # A sub-millimetre world grid maps densely into the slightly rotated 1 mm MRI grid.
            # Fill in pial space first, then close one-voxel sampling seams after the affine mapping.
            points = pial.voxelized(pitch=0.85).fill().points
            ijk = np.rint((world_to_voxel @ np.column_stack(
                [points, np.ones(len(points))]).T).T[:, :3]).astype(int)
            in_bounds = np.all((ijk >= 0) & (ijk < np.asarray(t1.shape)), axis=1)
            hemi_mask = np.zeros(t1.shape, dtype=bool)
            hemi_mask[tuple(ijk[in_bounds].T)] = True
            hemi_mask = ndimage.binary_closing(hemi_mask, iterations=1)
            footprints[hemi] = ndimage.binary_fill_holes(hemi_mask)
        left, right = footprints["lh"], footprints["rh"]
        mask = left | right
    else:
        # A custom T1 without a supplied segmentation can still render a reliable whole footprint,
        # but cannot claim hemisphere-aware clipping. Both panel masks therefore equal the whole.
        mask = ndimage.binary_fill_holes(t1 > 0)
        left = right = mask

    # Crop empty margins while preserving 1 mm detail. This cuts GPU memory substantially versus a
    # full 256^3 RG texture; translating the affine keeps voxel centres in the same world positions.
    nz = np.argwhere(mask)
    if not len(nz):
        raise ValueError("cut anatomy contains no non-zero brain voxels")
    pad = 2
    lo = np.maximum(nz.min(axis=0) - pad, 0)
    hi = np.minimum(nz.max(axis=0) + pad + 1, np.asarray(t1.shape))
    sl = tuple(slice(int(a), int(b)) for a, b in zip(lo, hi))
    t1, mask, left, right = t1[sl], mask[sl], left[sl], right[sl]
    aff = aff.copy()
    aff[:3, 3] = (aff @ np.r_[lo, 1.0])[:3]

    # Window against the cerebral footprint, not the whole T1. In particular T1.mgz retains scalp;
    # letting those bright non-brain voxels set the scale makes the exposed cortex pale and flat.
    tissue = t1[mask & (t1 > 0)]
    hi = float(np.percentile(tissue, 99.5)) if tissue.size else float(t1.max())
    t1 = np.clip(t1 / max(hi, 1.0) * 255.0, 0, 255)              # robust normalise to 0..255

    d = int(downsample)
    if d > 1:
        dims = [(s - 1) // d + 1 for s in t1.shape]
        idx = (np.indices(dims).reshape(3, -1) * d).astype(np.float32)
        vol = ndimage.map_coordinates(t1, idx, order=1, mode="constant", cval=0.0).reshape(dims)
        msk = ndimage.map_coordinates(mask.astype(np.uint8), idx, order=0,
                                      mode="constant", cval=0).reshape(dims).astype(bool)
        lhs = ndimage.map_coordinates(left.astype(np.uint8), idx, order=0,
                                      mode="constant", cval=0).reshape(dims).astype(bool)
        rhs = ndimage.map_coordinates(right.astype(np.uint8), idx, order=0,
                                      mode="constant", cval=0).reshape(dims).astype(bool)
        aff = aff.copy(); aff[:3, :3] *= d                       # clean scale, origin unchanged
    else:
        dims, vol, msk, lhs, rhs = list(t1.shape), t1, mask, left, right
    vol = vol.astype(np.uint8)

    # Interleave RGBA after Fortran-ravelling each channel: voxel i varies fastest for WebGL, while
    # the four bytes for each voxel stay adjacent (R=T1, G=both, B=left, A=right).
    packed = np.empty(vol.size * 4, np.uint8)
    packed[0::4] = vol.ravel(order="F")
    packed[1::4] = (msk.astype(np.uint8) * 255).ravel(order="F")
    packed[2::4] = (lhs.astype(np.uint8) * 255).ravel(order="F")
    packed[3::4] = (rhs.astype(np.uint8) * 255).ravel(order="F")
    (out / "anat_uint8.bin.gz").write_bytes(gzip.compress(packed.tobytes(), 9))
    (out / "anat.json").write_text(json.dumps(
        {"dims": list(dims), "dtype": "uint8", "channels": 4,
         "channelOrder": ["t1", "cerebrum", "leftCerebrum", "rightCerebrum"],
         "order": "F-interleaved", "affine": aff.tolist(), "kind": kind,
         "surfaceMatched": surface_matched, "hemisphereAware": hemi_aware,
         "footprint": "pial-envelope" if hemi_aware else "intensity-envelope",
         "transformId": transform_id}))
    sp = out / "scene.json"                                      # advertise availability to the viewer/CLI
    sc = json.loads(sp.read_text())
    if not sc.get("hasAnatomy"):
        sc["hasAnatomy"] = True
        sp.write_text(json.dumps(sc))
    print(f"Baked anatomy [{kind}] -> {out/'anat_uint8.bin.gz'} (dims {dims}, "
          f"{(out/'anat_uint8.bin.gz').stat().st_size/1e6:.2f} MB)")
    return out / "anat_uint8.bin.gz"


def bake_surface_sidecar(out_dir=None):
    """Bake the cortical-surface sidecar for surface-projection mode (M8): per hemisphere, the
    pial vertices (MNI152) + faces + curvature + the inward offset to the white surface (so the
    pipeline can K-depth line-sample a volume across the cortical ribbon). Standalone — does NOT
    regenerate the cortex/subcortical GLBs, so it leaves existing baked assets byte-identical.
    """
    import mne
    import nibabel as nib
    from .surfaces import load_hemisphere, mni305_to_mni152
    out = Path(out_dir) if out_dir else DATA
    fs = Path(mne.datasets.fetch_fsaverage(verbose=False))
    surf = fs / "surf"
    if not surf.exists():
        surf = fs / "fsaverage" / "surf"

    blob = bytearray()
    layout = {}
    for hemi in ("lh", "rh"):
        pial, faces, curv = load_hemisphere(surf, hemi)
        white, _ = nib.freesurfer.read_geometry(str(surf / f"{hemi}.white"))
        pial152 = mni305_to_mni152(pial).astype(np.float32)
        inward = (mni305_to_mni152(white).astype(np.float32) - pial152).astype(np.float32)
        h = {"nverts": int(len(pial152)), "ntris": int(len(faces))}
        for name, arr, dt in [("pial", pial152, np.float32), ("inward", inward, np.float32),
                              ("faces", np.asarray(faces), np.uint32), ("curv", np.asarray(curv), np.float32)]:
            b = np.ascontiguousarray(arr, dtype=dt).tobytes()
            h[name] = [len(blob), len(b)]
            blob.extend(b)
        layout[hemi] = h
    (out / "cortex_surface.bin.gz").write_bytes(gzip.compress(bytes(blob), 9))
    (out / "cortex_surface.json").write_text(json.dumps(layout))
    sp = out / "scene.json"      # advertise availability so the viewer/CLI can offer surface mode
    sc = json.loads(sp.read_text()); sc["hasWhiteSurface"] = True; sp.write_text(json.dumps(sc))
    print(f"Baked surface sidecar -> {out/'cortex_surface.bin.gz'} "
          f"(lh {layout['lh']['nverts']} + rh {layout['rh']['nverts']} verts)")
    return out / "cortex_surface.bin.gz"


if __name__ == "__main__":
    bake()
