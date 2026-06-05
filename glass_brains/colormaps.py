"""Export colormaps from the `cmap` package to a JSON LUT the viewer reads.

JS holds no hardcoded colormaps; it samples these LUTs. Each entry carries its
`cmap` category (sequential/diverging/...), which drives the automatic
sequential-vs-diverging default and the positive-data washout guard.
"""

import json
import numpy as np
import cmap as cmaplib

# Every *continuous* matplotlib colormap (sequential / diverging / cyclic /
# miscellaneous). The 12 qualitative maps (tab10, Set1, Pastel*, Accent, …) are
# left out on purpose: they're categorical, so they make meaningless continuous
# overlays + colorbars and would pollute the Randomise pool. The _r reverses are
# added automatically below, giving ~156 maps. Every name resolves in the `cmap`
# package, which also supplies each base map's category.
MPL_CONTINUOUS = [
    # ColorBrewer + matplotlib sequential/diverging (incl. RdPu / PuRd)
    "Blues", "BrBG", "BuGn", "BuPu", "CMRmap", "GnBu", "Grays", "Greens", "Greys",
    "OrRd", "Oranges", "PRGn", "PiYG", "PuBu", "PuBuGn", "PuOr", "PuRd", "Purples",
    "RdBu", "RdGy", "RdPu", "RdYlBu", "RdYlGn", "Reds", "Spectral", "Wistia",
    "YlGn", "YlGnBu", "YlOrBr", "YlOrRd",
    # perceptually-uniform, cyclic, and the classic/miscellaneous maps
    "afmhot", "autumn", "berlin", "binary", "bone", "brg", "bwr", "cividis", "cool",
    "coolwarm", "copper", "cubehelix", "flag", "gist_earth", "gist_gray", "gist_grey",
    "gist_heat", "gist_ncar", "gist_rainbow", "gist_stern", "gist_yarg", "gist_yerg",
    "gnuplot", "gnuplot2", "gray", "grey", "hot", "hsv", "inferno", "jet", "magma",
    "managua", "nipy_spectral", "ocean", "pink", "plasma", "prism", "rainbow",
    "seismic", "spring", "summer", "terrain", "turbo", "twilight", "twilight_shifted",
    "vanimo", "viridis", "winter",
]


def export_colormaps(out_path, names=None, n=256):
    """Write {n, maps:{name:{lut:[[r,g,b],...] sRGB 0..1, category}}} to out_path.

    Default = every matplotlib continuous colormap plus its _r reverse (~156).
    Pass names="all" for the entire `cmap` catalog, or an explicit list of names.
    """
    cat = cmaplib.Catalog()
    if names is None:
        names = MPL_CONTINUOUS + [nm + "_r" for nm in MPL_CONTINUOUS]
    elif names == "all":
        names = sorted(set(cat))

    def category(name):
        # _r reverses are not separate catalog entries — inherit the base map's
        # category (else e.g. RdBu_r would be mis-labelled sequential, breaking the
        # diverging picker group + the positive-data washout guard).
        base = name[:-2] if name.endswith("_r") else name
        try:
            return cat[base].category
        except Exception:
            return "sequential"

    x = np.linspace(0.0, 1.0, n)
    maps = {}
    for name in names:
        lut = np.asarray(cmaplib.Colormap(name)(x))[:, :3]  # (n,3) sRGB 0..1
        maps[name] = {"lut": np.round(lut, 4).tolist(), "category": category(name)}

    with open(out_path, "w") as f:
        json.dump({"n": n, "maps": maps}, f)
    print(f"Exported {len(maps)} colormaps -> {out_path}")
    return list(maps)
