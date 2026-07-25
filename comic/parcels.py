"""Cortical parcellations as per-vertex label fields on fsaverage (ico7, 163842 verts/hemi).

The bake pipeline preserves fsaverage vertex order bit-exactly (verified: the baked
cortex_*.glb POSITION accessors equal `mni305_to_mni152(read_geometry('?h.pial'))` with max
diff 0.0, and the pial/white/inflated GLBs share one index buffer). So ONE label array indexes
pial, white and inflated simultaneously, and the browser can attach it to the already-loaded
cortex geometries without re-baking any mesh.

Asset layout, one directory per install (`comic/web/data/parcels/`):
    index.json          {version, atlases: {name: {label, nparcels, source, license, ...}}}
    <name>.json         {nverts, dtype, lh:[off,len], rh:[off,len], names, colors, networks}
    <name>.bin.gz       gzip(int16 lh labels ++ int16 rh labels)

Label convention: **-1 = not cortex** (medial wall / unknown / background), 0..K-1 = an index
into `names`/`colors`. Normalising this is not cosmetic — the four source atlases mark the
medial wall four different ways (-1, 0, 0x7FFFFFFF, and by region name), and Schaefer's mask
differs from FreeSurfer's by 79 vertices, which would otherwise draw a spurious ring around
the corpus callosum when two atlases are compared.

Licensing drives where each atlas comes from. Schaefer is MIT (CBIG) and ships in the repo.
FreeSurfer's own atlases and Glasser are NOT redistributable under an OSI licence, so they are
fetched on demand into the same directory and git-ignored.
"""

from __future__ import annotations

import gzip
import json
import re
import urllib.request
from pathlib import Path

import numpy as np

PARCEL_VERSION = "fsaverage-ico7-v1"
ICO7_NVERTS = 163842

# Pinned CBIG tag. `master` is a moving target and versions before v0.14.3 shipped erroneous
# region names (CBIG's own Update_20190916_README documents the fix), which matters because we
# parse network membership out of those names.
_CBIG_TAG = "v0.14.3-Update_Yeo2011_Schaefer2018_labelname"
_CBIG_URL = ("https://raw.githubusercontent.com/ThomasYeoLab/CBIG/" + _CBIG_TAG
             + "/stable_projects/brain_parcellation/Schaefer2018_LocalGlobal/Parcellations"
             + "/FreeSurfer5.3/fsaverage/label/{hemi}.Schaefer2018_{n}Parcels_{net}Networks_order.annot")

# Anything matching this is "not a cortical parcel" and becomes -1.
_NON_CORTEX = re.compile(r"unknown|medial_?wall|background|corpuscallosum|^\?\?\?$", re.I)
# FreeSurfer's own "no annotation" sentinel, and the INT32_MAX one some third-party
# conversions (e.g. Gordon) use instead.
_RAW_UNASSIGNED = {0, 2147483647}


def _schaefer_entries():
    out = {}
    for n in (100, 200, 400, 1000):
        for net in (7, 17):
            out[f"schaefer{n}_{net}"] = {
                "label": f"Schaefer {n} ({net} networks)",
                "source": "CBIG " + _CBIG_TAG,
                "license": "MIT",
                "shipped": True,
                "urls": {h: _CBIG_URL.format(hemi=h, n=n, net=net) for h in ("lh", "rh")},
            }
    return out


# `fs` entries come from the user's own MNE fsaverage download (mne.datasets.fetch_fsaverage),
# so nothing non-redistributable is ever vendored into the repo.
ATLASES = {
    **_schaefer_entries(),
    "aparc": {"label": "Desikan-Killiany (68)", "source": "FreeSurfer fsaverage",
              "license": "FreeSurfer (not OSI)", "shipped": False, "fs": "aparc"},
    "a2009s": {"label": "Destrieux (148)", "source": "FreeSurfer fsaverage",
               "license": "FreeSurfer (not OSI)", "shipped": False, "fs": "aparc.a2009s"},
    "aparc_sub": {"label": "aparc subdivided (~450)", "source": "FreeSurfer fsaverage",
                  "license": "FreeSurfer (not OSI)", "shipped": False, "fs": "aparc_sub"},
    "yeo7": {"label": "Yeo 7 networks", "source": "FreeSurfer fsaverage (Yeo 2011)",
             "license": "cite Yeo et al. 2011", "shipped": False, "fs": "Yeo2011_7Networks_N1000"},
    "yeo17": {"label": "Yeo 17 networks", "source": "FreeSurfer fsaverage (Yeo 2011)",
              "license": "cite Yeo et al. 2011", "shipped": False, "fs": "Yeo2011_17Networks_N1000"},
    "hcpmmp1": {"label": "Glasser HCP-MMP1 (360)", "source": "fsaverage (Mills 2016 conversion)",
                "license": "HCP Open Access Data Use Terms", "shipped": False, "fs": "HCPMMP1"},
}


def read_annot(path):
    """Read a FreeSurfer .annot as (labels, names, colors); medial wall / unknown → -1.

    Deliberately does NOT use nibabel's default label mapping. `nibabel.freesurfer.read_annot`
    resolves each vertex's packed-RGB annotation value to a colour-table row with
    `np.searchsorted` and never verifies the value was found, which fails two ways on real
    files: a value between two table ids is silently mapped to the wrong region, and a value
    above the table maximum raises IndexError (Gordon's fsaverage annot uses 0x7FFFFFFF for
    its 13,887 medial-wall vertices and crashes outright). An explicit dict plus an assertion
    turns both into either a correct answer or a loud one.
    """
    import nibabel as nib

    raw, ctab, names = nib.freesurfer.read_annot(str(path), orig_ids=True)
    names = [n.decode() if isinstance(n, bytes) else n for n in names]
    ids = np.asarray(ctab)[:, 4].astype(np.int64)

    row_of = {int(v): i for i, v in enumerate(ids)}
    unmapped = set(np.unique(raw).astype(np.int64).tolist()) - set(row_of)
    assert unmapped <= _RAW_UNASSIGNED, f"{path}: annotation values absent from the colour table: {sorted(unmapped)}"

    # Which colour-table rows are real cortical parcels? Drop the non-cortex ones and
    # renumber what survives to a dense 0..K-1.
    keep = [i for i, nm in enumerate(names) if not _NON_CORTEX.search(nm)]
    dense = {row: k for k, row in enumerate(keep)}

    labels = np.full(len(raw), -1, dtype=np.int16)
    for value, row in row_of.items():
        if row in dense:
            labels[raw == value] = dense[row]
    return labels, [names[i] for i in keep], np.asarray(ctab)[keep, :3].astype(int)


def network_of(name):
    """Yeo network token for a Schaefer/Yeo region name, else None.

    Schaefer encodes membership in the name itself ('7Networks_LH_Vis_1',
    '17Networks_LH_DefaultB_PFCd_2'), which is exact. The colour table cannot be used for
    this: CBIG perturbs each parcel's RGB off the network colour so every parcel gets a
    unique packed value, and the perturbed ranges of neighbouring networks overlap.
    """
    m = re.match(r"^\d+Networks_(?:LH|RH)_([A-Za-z]+)", name)
    return m.group(1) if m else None


def _fetch(url):
    with urllib.request.urlopen(url, timeout=120) as r:
        return r.read()


def _fsaverage_label_dir():
    import mne
    fs = Path(mne.datasets.fetch_fsaverage(verbose=False))
    for candidate in (fs / "label", fs / "fsaverage" / "label"):
        if candidate.exists():
            return candidate
    raise FileNotFoundError(f"no fsaverage label/ directory under {fs}")


def _annot_paths(name, cache):
    """Resolve one atlas to {hemi: path}, downloading into `cache` when it is a URL atlas."""
    spec = ATLASES[name]
    if "fs" in spec:
        d = _fsaverage_label_dir()
        return {h: d / f"{h}.{spec['fs']}.annot" for h in ("lh", "rh")}
    cache.mkdir(parents=True, exist_ok=True)
    out = {}
    for hemi, url in spec["urls"].items():
        p = cache / f"{hemi}.{name}.annot"
        if not p.exists():
            print(f"  fetching {hemi} {name} …")
            p.write_bytes(_fetch(url))
        out[hemi] = p
    return out


def bake_parcellation(name, out_dir, cache=None):
    """Write <name>.bin.gz + <name>.json for one atlas. Returns its index entry."""
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    paths = _annot_paths(name, Path(cache) if cache else out / "_cache")

    blob, layout, names, colors, hemis = bytearray(), {}, None, None, []
    for hemi in ("lh", "rh"):
        labels, hemi_names, hemi_colors = read_annot(paths[hemi])
        assert len(labels) == ICO7_NVERTS, (
            f"{name} {hemi}: {len(labels)} vertices, expected fsaverage ico7 ({ICO7_NVERTS}). "
            "Only ico7 annots can index the baked cortex meshes.")
        # lh and rh carry separate region lists; concatenate so a label index is unique
        # across the whole brain (rh indices are offset by len(lh names)).
        if names is None:
            names, colors = list(hemi_names), hemi_colors.tolist()
        else:
            labels = np.where(labels >= 0, labels + len(names), -1).astype(np.int16)
            names += list(hemi_names)
            colors += hemi_colors.tolist()
        hemis += [hemi] * len(hemi_names)
        b = np.ascontiguousarray(labels, dtype="<i2").tobytes()
        layout[hemi] = [len(blob), len(b)]
        blob.extend(b)

    (out / f"{name}.bin.gz").write_bytes(gzip.compress(bytes(blob), 9))
    (out / f"{name}.json").write_text(json.dumps({
        "nverts": ICO7_NVERTS, "dtype": "int16", **layout,
        "names": names, "colors": colors, "hemis": hemis,
        "networks": [network_of(n) for n in names],
    }))
    spec = ATLASES[name]
    size = (out / f"{name}.bin.gz").stat().st_size
    print(f"  baked {name}: {len(names)} parcels, {size/1024:.0f} kB")
    return {"label": spec["label"], "nparcels": len(names), "source": spec["source"],
            "license": spec["license"], "shipped": spec["shipped"], "bytes": size}


def load_value_table(path):
    """Read a CSV/TSV of `region,value` into {region: float}.

    Takes the first two columns and skips a header row if its second field is not numeric, so
    the usual exports (`region,value`, `label,beta`, `name,t`) all just work. Delimiter is
    sniffed between comma and tab.
    """
    import csv

    text = Path(path).read_text().strip().splitlines()
    assert text, f"{path} is empty"
    delim = "\t" if text[0].count("\t") > text[0].count(",") else ","
    rows = [r for r in csv.reader(text, delimiter=delim) if len(r) >= 2]
    try:
        float(rows[0][1])
    except ValueError:
        rows = rows[1:]                       # that first row was a header
    return {r[0].strip(): float(r[1]) for r in rows}


def _match_regions(key, names, hemis):
    """Indices of the regions a table key refers to; [] if none.

    FreeSurfer-style atlases name the SAME region identically in both hemispheres
    ('bankssts' appears twice in aparc), so a name is not a unique key. A bare name therefore
    matches BOTH hemispheres — which is what a table of bilateral values means — while an
    'lh_'/'rh_' prefix or '_lh'/'_rh' suffix selects one. Schaefer/Yeo names already carry LH/RH,
    so they match exactly and this never fires.
    """
    k = key.strip()
    want = None
    low = k.lower()
    for pre in ("lh_", "lh-", "left_"):
        if low.startswith(pre):
            want, k = "lh", k[len(pre):]
            break
    else:
        for pre in ("rh_", "rh-", "right_"):
            if low.startswith(pre):
                want, k = "rh", k[len(pre):]
                break
        else:
            for suf in ("_lh", "-lh"):
                if low.endswith(suf):
                    want, k = "lh", k[:-len(suf)]
                    break
            else:
                for suf in ("_rh", "-rh"):
                    if low.endswith(suf):
                        want, k = "rh", k[:-len(suf)]
                        break
    exact = [i for i, n in enumerate(names) if n == key.strip()]
    if exact:
        return exact                     # the atlas's own spelling always wins
    return [i for i, n in enumerate(names) if n == k and (want is None or hemis[i] == want)]


def values_to_vertex_maps(values, atlas, parcels_dir):
    """Expand {region: value} into per-vertex fsaverage maps: {'lh': (163842,), 'rh': (163842,)}.

    Regions are matched by exact name against the atlas's own region list, or — when every key
    parses as an integer — by 1-based parcel index. Unmatched keys are an ERROR, not a warning:
    silently dropping half a table because the names came from a different Schaefer variant would
    produce a figure that looks fine and means nothing. Parcels absent from the table (and the
    medial wall) are left at 0, i.e. transparent at any threshold >= 0.
    """
    d = Path(parcels_dir)
    meta = json.loads((d / f"{atlas}.json").read_text())
    buf = gzip.decompress((d / f"{atlas}.bin.gz").read_bytes())
    names = meta["names"]

    per_parcel = np.zeros(len(names), dtype=np.float32)
    keys = list(values)
    if keys and all(k.lstrip("+-").isdigit() for k in keys):
        for k, v in values.items():
            i = int(k) - 1
            assert 0 <= i < len(names), f"parcel index {k} out of range 1..{len(names)} for {atlas}"
            per_parcel[i] = v
    else:
        for k, v in values.items():
            hits = _match_regions(k, names, meta["hemis"])
            assert hits, (f"region {k!r} is not in {atlas}. Expected names like {names[:2]}; "
                          "prefix with lh_/rh_ to target one hemisphere")
            for i in hits:
                per_parcel[i] = v

    out = {}
    for hemi in ("lh", "rh"):
        off, ln = meta[hemi]
        labels = np.frombuffer(buf[off:off + ln], "<i2")
        vals = np.zeros(len(labels), dtype=np.float32)
        inside = labels >= 0
        vals[inside] = per_parcel[labels[inside]]
        out[hemi] = vals
    return out


def bake_parcellations(out_dir, names=None, cache=None):
    """Bake `names` (default: every shipped atlas) and rewrite index.json.

    index.json accumulates: baking one extra atlas locally never drops the ones already there.
    """
    out = Path(out_dir)
    names = list(names) if names else [k for k, v in ATLASES.items() if v["shipped"]]
    unknown = [n for n in names if n not in ATLASES]
    assert not unknown, f"unknown parcellation(s): {unknown}. Known: {sorted(ATLASES)}"

    index_path = out / "index.json"
    index = json.loads(index_path.read_text())["atlases"] if index_path.exists() else {}
    # Drop entries whose payload is gone (e.g. a locally-baked, git-ignored atlas on a fresh
    # clone) so the viewer's picker never offers something that cannot load.
    index = {k: v for k, v in index.items() if (out / f"{k}.bin.gz").exists()}
    for name in names:
        index[name] = bake_parcellation(name, out, cache=cache)
    out.mkdir(parents=True, exist_ok=True)
    index_path.write_text(json.dumps({"version": PARCEL_VERSION, "atlases": index}, indent=2))
    print(f"Parcellations -> {out} ({len(index)} available)")
    return index
