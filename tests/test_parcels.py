"""Parcellation assets: annot normalisation, value-table expansion, and the new style keys.

The baked-asset tests are skipped when comic/web/data/parcels is empty, so a fresh clone that has
not run `comic parcels bake` still passes; the pure-logic tests always run.
"""
import gzip
import json
from pathlib import Path

import numpy as np
import pytest

from comic import parcels as P
from comic.spec import validate

PARCELS = Path(__file__).resolve().parent.parent / "comic" / "web" / "data" / "parcels"


def _baked():
    """Atlases whose payload is actually on disk.

    index.json is committed but the non-redistributable atlases are git-ignored, so on a fresh
    clone (and in CI) the index lists atlases whose .bin.gz was never checked in. Filtering by the
    payload is what keeps these tests honest about what this checkout really has.
    """
    index = PARCELS / "index.json"
    if not index.exists():
        return {}
    listed = json.loads(index.read_text())["atlases"]
    return {k: v for k, v in listed.items() if (PARCELS / f"{k}.bin.gz").exists()}


def _any_atlas():
    names = sorted(_baked())
    if not names:
        pytest.skip("no parcellations baked (run: comic parcels bake)")
    return names[0]


def test_atlas_registry_declares_provenance_for_every_entry():
    # Licensing decides ship-vs-fetch, so an atlas without it is a bug, not a cosmetic gap.
    for name, spec in P.ATLASES.items():
        assert spec["source"] and spec["license"], name
        assert isinstance(spec["shipped"], bool), name
        # Only MIT-licensed atlases may be vendored into the repo.
        if spec["shipped"]:
            assert spec["license"] == "MIT", f"{name} is marked shipped but is {spec['license']!r}"


def test_network_parsed_from_schaefer_names_not_colours():
    assert P.network_of("7Networks_LH_Vis_1") == "Vis"
    assert P.network_of("17Networks_RH_DefaultB_PFCd_2") == "DefaultB"
    assert P.network_of("bankssts") is None          # a non-Schaefer atlas has no network token


def test_baked_atlas_is_ico7_with_normalised_medial_wall():
    name = _any_atlas()
    meta = json.loads((PARCELS / f"{name}.json").read_text())
    buf = gzip.decompress((PARCELS / f"{name}.bin.gz").read_bytes())
    assert meta["nverts"] == P.ICO7_NVERTS
    seen = set()
    for hemi in ("lh", "rh"):
        off, ln = meta[hemi]
        labels = np.frombuffer(buf[off:off + ln], "<i2")
        assert len(labels) == P.ICO7_NVERTS, "only ico7 can index the baked cortex meshes"
        # Exactly one non-cortex marker survives normalisation, whichever of the four the
        # source atlas used (-1 / 0 / 0x7FFFFFFF / a named region).
        assert labels.min() >= -1
        assert (labels < 0).sum() > 1000, "a cortical atlas must leave a medial wall"
        inside = labels[labels >= 0]
        assert inside.max() < len(meta["names"])
        seen.update(inside.tolist())
    # lh and rh occupy disjoint label ranges, so a label identifies a region brain-wide.
    assert len(seen) > 1
    assert len(meta["names"]) == len(meta["colors"]) == len(meta["networks"])


def test_value_table_expands_onto_the_right_vertices():
    name = _any_atlas()
    meta = json.loads((PARCELS / f"{name}.json").read_text())
    names = meta["names"]
    maps = P.values_to_vertex_maps({names[0]: 5.0}, name, PARCELS)

    buf = gzip.decompress((PARCELS / f"{name}.bin.gz").read_bytes())
    off, ln = meta["lh"]
    lh_labels = np.frombuffer(buf[off:off + ln], "<i2")
    assert maps["lh"].shape == (P.ICO7_NVERTS,)
    assert np.all(maps["lh"][lh_labels == 0] == 5.0), "parcel 0 carries its table value"
    assert np.all(maps["lh"][lh_labels < 0] == 0.0), "the medial wall stays at 0"
    # Regions absent from the table are 0, not NaN — a threshold of 0 must hide them cleanly.
    assert np.isfinite(maps["lh"]).all() and np.isfinite(maps["rh"]).all()


def test_bare_name_is_bilateral_but_a_hemi_prefix_is_not():
    # FreeSurfer atlases spell a region identically in both hemispheres, so 'bankssts' is not a
    # unique key. A name→index dict would silently keep only the rh entry and paint half a brain.
    if "aparc" not in _baked():
        pytest.skip("aparc not baked")
    meta = json.loads((PARCELS / "aparc.json").read_text())
    names, hemis = meta["names"], meta["hemis"]
    dup = next(n for n in names if names.count(n) == 2)

    both = P._match_regions(dup, names, hemis)
    assert len(both) == 2 and {hemis[i] for i in both} == {"lh", "rh"}
    left = P._match_regions(f"lh_{dup}", names, hemis)
    assert len(left) == 1 and hemis[left[0]] == "lh"
    assert P._match_regions(f"{dup}_rh", names, hemis) == [i for i in both if hemis[i] == "rh"]

    maps = P.values_to_vertex_maps({f"lh_{dup}": 7.0}, "aparc", PARCELS)
    assert maps["lh"].max() == 7.0 and maps["rh"].max() == 0.0


def test_schaefer_names_are_unique_so_they_match_exactly():
    baked = [n for n in _baked() if n.startswith("schaefer")]
    if not baked:
        pytest.skip("no schaefer atlas baked")
    meta = json.loads((PARCELS / f"{baked[0]}.json").read_text())
    assert len(set(meta["names"])) == len(meta["names"]), "Schaefer names carry LH/RH already"


def test_unmatched_region_names_fail_loudly():
    # Silently dropping rows would produce a figure that looks fine and means nothing.
    name = _any_atlas()
    with pytest.raises(AssertionError, match="not in"):
        P.values_to_vertex_maps({"definitely_not_a_region": 1.0}, name, PARCELS)


def test_value_table_reads_csv_with_and_without_a_header(tmp_path):
    with_header = tmp_path / "a.csv"
    with_header.write_text("region,value\nfoo,1.5\nbar,-2\n")
    assert P.load_value_table(with_header) == {"foo": 1.5, "bar": -2.0}

    headerless = tmp_path / "b.tsv"
    headerless.write_text("foo\t1.5\nbar\t-2\n")
    assert P.load_value_table(headerless) == {"foo": 1.5, "bar": -2.0}


def _cfg(style):
    return {"style": style,
            "layout": {"panels": [{"id": "a", "camera": {"plane": "dorsal"},
                                   "cell": {"row": 0, "col": 0}}]}}


def test_spec_validates_line_colours_like_the_browser_does():
    validate(_cfg({"outline": {"color": "#abc", "anatomyColor": None,
                               "silhouette": {"color": "#123456", "width": 4}}}))
    validate(_cfg({}))                                    # absent = inherit, always fine
    with pytest.raises(ValueError, match="outline.color"):
        validate(_cfg({"outline": {"color": "red"}}))     # names are not accepted, only hex
    with pytest.raises(ValueError, match="silhouette.width"):
        validate(_cfg({"outline": {"silhouette": {"width": 0}}}))


def test_spec_validates_parcellation_block():
    validate(_cfg({"parcellation": {"color": "#1a1a1a", "width": 2.0, "opacity": 1.0}}))
    with pytest.raises(ValueError, match="parcellation.width"):
        validate(_cfg({"parcellation": {"color": "#1a1a1a", "width": -1}}))
