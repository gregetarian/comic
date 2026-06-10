"""Render a statistical overlay to a PNG headlessly (needs the `[render]` extra + Chromium).

Replace the path with your own z/t-stat NIfTI in MNI152 space. For the interactive viewer
instead, call open_viewer() and drag the NIfTI into the browser.
"""

from glass_brains.render import build_layout, render_to_png

render_to_png(
    "your_stat_map.nii.gz", "figure.png",
    layout=build_layout("2x2", ["left_lateral", "right_lateral", "axial", "frontal"]),
    threshold=2.3,
)

# Interactive instead (drag the NIfTI into the browser):
#   from glass_brains import open_viewer
#   open_viewer()
