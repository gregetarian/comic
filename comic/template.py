"""Template-bundle manifest and anatomy↔surface alignment validation."""

from __future__ import annotations

import gzip
import json
from pathlib import Path

import numpy as np


def _surface_variants(scene):
    variants = {}
    for hemi, info in (scene.get("cortex") or {}).items():
        def add(name, path):
            if path:
                variants.setdefault(name, {})[hemi] = str(path)
        add("pial", info.get("mesh"))
        add("inflated", info.get("meshInflated"))
        add("white", info.get("meshWhite"))
        for name, path in (info.get("surfaces") or {}).items():
            add(name, path)
    return variants


def validate_template_alignment(data_dir, tolerance_mm=2.5, percentile=95,
                                max_out_of_bounds_fraction=0.01, fail=True):
    """Compare pial vertices with the boundary of the baked hemisphere footprint.

    The documented acceptance rule is: each hemisphere's chosen percentile of nearest-boundary
    distance must be <= ``tolerance_mm``, and fewer than ``max_out_of_bounds_fraction`` of sampled
    surface vertices may fall outside the T1 grid. This catches wrong affines/templates loudly while
    tolerating sub-voxel rasterisation differences at an otherwise matching pial boundary.
    """
    from scipy import ndimage
    import trimesh

    data = Path(data_dir)
    scene = json.loads((data / "scene.json").read_text())
    variants = _surface_variants(scene)
    pial = variants.get("pial") or {}
    meta = json.loads((data / "anat.json").read_text())
    dims, channels = tuple(meta["dims"]), int(meta.get("channels", 1))
    raw = np.frombuffer(gzip.decompress((data / "anat_uint8.bin.gz").read_bytes()), np.uint8)
    expected = int(np.prod(dims)) * channels
    if len(raw) != expected:
        raise ValueError(f"anatomy payload has {len(raw)} bytes, expected {expected}")
    voxels = raw.reshape(-1, channels)
    affine = np.asarray(meta["affine"], dtype=float)
    inv = np.linalg.inv(affine)
    spacing = np.linalg.norm(affine[:3, :3], axis=0)
    results = {}
    for hemi, channel in (("lh", 2), ("rh", 3)):
        path = pial.get(hemi)
        if not path:
            continue
        mask_channel = channel if channels >= 4 else (1 if channels >= 2 else 0)
        mask = voxels[:, mask_channel].reshape(dims, order="F") > (127 if channels >= 2 else 0)
        boundary = mask ^ ndimage.binary_erosion(mask)
        distance = ndimage.distance_transform_edt(~boundary, sampling=spacing)
        mesh = trimesh.load(data / path, force="mesh", process=False)
        step = max(1, len(mesh.vertices) // 5000)
        points = np.asarray(mesh.vertices)[::step]
        ijk = np.rint((inv @ np.column_stack([points, np.ones(len(points))]).T).T[:, :3]).astype(int)
        inside = np.all((ijk >= 0) & (ijk < np.asarray(dims)), axis=1)
        distances = np.full(len(points), np.inf)
        distances[inside] = distance[tuple(ijk[inside].T)]
        finite = distances[np.isfinite(distances)]
        p = float(np.percentile(finite, percentile)) if len(finite) else float("inf")
        results[hemi] = {
            "sampledVertices": int(len(points)),
            "p95Mm" if percentile == 95 else f"p{percentile}Mm": round(p, 4),
            "outOfBoundsFraction": round(float(np.mean(~inside)), 6),
        }
    metric_key = "p95Mm" if percentile == 95 else f"p{percentile}Mm"
    worst = max((x[metric_key] for x in results.values()), default=float("inf"))
    worst_oob = max((x["outOfBoundsFraction"] for x in results.values()), default=1.0)
    passed = bool(results) and worst <= tolerance_mm and worst_oob <= max_out_of_bounds_fraction
    report = {
        "status": "pass" if passed else "fail",
        "method": "pial-to-T1-footprint-boundary",
        "percentile": percentile,
        "toleranceMm": tolerance_mm,
        "worstP95Mm" if percentile == 95 else f"worstP{percentile}Mm": round(float(worst), 4),
        "hemispheres": results,
    }
    if fail and not passed:
        raise ValueError(
            f"template T1/pial alignment failed: p{percentile}={worst:.2f} mm "
            f"(tolerance {tolerance_mm:.2f} mm), out-of-bounds={worst_oob:.3%}")
    return report


def update_template_bundle_manifest(data_dir, *, template_id=None, transform_id=None,
                                    alignment_tolerance_mm=2.5, fail_alignment=True):
    """Write the normalized ``templateBundle`` block into an existing scene.json."""
    data = Path(data_dir)
    scene_path = data / "scene.json"
    scene = json.loads(scene_path.read_text())
    space = scene.get("space", "unknown")
    tid = transform_id or f"{space}-world-v1"
    surfaces = _surface_variants(scene)
    anatomy = None
    if (data / "anat.json").exists() and (data / "anat_uint8.bin.gz").exists():
        anatomy = {"meta": "anat.json", "data": "anat_uint8.bin.gz", "transformId": tid}
    segmentation = None
    if (data / "aseg.json").exists() and (data / "aseg_uint8.bin.gz").exists():
        segmentation = {"meta": "aseg.json", "data": "aseg_uint8.bin.gz", "transformId": tid}
    alignment = (validate_template_alignment(data, tolerance_mm=alignment_tolerance_mm,
                                              fail=fail_alignment)
                 if anatomy and surfaces.get("pial") else None)
    scene["templateBundle"] = {
        "id": template_id or f"{scene.get('templateMode', 'mni')}-{space}",
        "space": space,
        "coordinateSystem": "RAS",
        "transformId": tid,
        "transforms": {"assetWorld": np.eye(4).tolist()},
        "surfaces": surfaces,
        "defaultSurface": "inflated" if "inflated" in surfaces else "pial",
        "anatomy": anatomy,
        "segmentation": segmentation,
        "alignment": alignment,
    }
    scene["hasAnatomy"] = anatomy is not None
    scene["hasWhiteSurface"] = "white" in surfaces
    scene_path.write_text(json.dumps(scene, indent=2))
    return scene["templateBundle"]

