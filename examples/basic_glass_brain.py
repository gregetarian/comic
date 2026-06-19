"""Basic glass brain — serve the interactive viewer locally.

Drop a NIfTI into the browser to render it (processed in-browser via Pyodide, no backend).
`Comic` itself is the bake-only template loader; display config lives in the viewer.
"""

from comic import open_viewer

open_viewer()
