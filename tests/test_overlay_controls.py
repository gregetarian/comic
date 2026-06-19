"""Per-overlay show/hide + propagate button (headless Chromium, offline ?baked=1).

show/hide: the 👁 button toggles config.style.overlays[i].hidden and the renderer drops
that overlay's voxels live (no rebuild). propagate (⇶): gated to >1 volume, so with a
single overlay it must be ABSENT (it reuses setOverlayStyle across all overlays — the same
machinery the dropdown/Randomise use — so the multi-overlay apply is covered by those)."""
import functools, http.server, socketserver, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent / "comic" / "web"


def main():
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT))
    httpd = socketserver.TCPServer(("127.0.0.1", 0), h)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    port = httpd.server_address[1]
    errs = []; ok = True
    def check(n, c):
        nonlocal ok; ok &= bool(c); print(f"  {'OK ' if c else 'BAD'} {n}")

    # any of overlay 0's voxel meshes currently visible?
    VOX_VIS = "window.__engine().sceneModel.meshes.some(m=>m.meta.role==='voxel'&&(m.meta.overlay??0)===0&&m.mesh.visible)"

    with sync_playwright() as p:
        b = p.chromium.launch(headless=True)
        pg = b.new_page(viewport={"width": 1400, "height": 900})
        pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        pg.on("pageerror", lambda e: errs.append("PAGEERR " + str(e)))
        pg.goto(f"http://127.0.0.1:{port}/index.html?baked=1")
        pg.wait_for_function("window.__engine && window.__engine() && window.__engine().overlays.length>=1", timeout=60000)
        pg.wait_for_timeout(500)

        check("show/hide 👁 button present", pg.evaluate("!!document.querySelector('.overlay-row .eye')"))
        check("propagate ⇶ button ABSENT with a single overlay (gated to >1)",
              pg.evaluate("document.querySelectorAll('.overlay-row .propagate').length") == 0)

        check("overlay voxels visible initially", pg.evaluate(VOX_VIS))
        pg.click(".overlay-row .eye"); pg.wait_for_timeout(200)
        check("hidden flag set after clicking 👁", pg.evaluate("!!window.__engine().config.style.overlays[0].hidden"))
        check("overlay voxels hidden after 👁", not pg.evaluate(VOX_VIS))
        pg.click(".overlay-row .eye"); pg.wait_for_timeout(200)
        check("overlay voxels shown again after second 👁", pg.evaluate(VOX_VIS))
        check("hidden flag cleared", not pg.evaluate("!!window.__engine().config.style.overlays[0].hidden"))
        b.close()
    httpd.shutdown()

    bad = [e for e in errs if "favicon" not in e.lower()]
    if bad: print("ERRORS:", *bad[:6], sep="\n  - ")
    ok = ok and not bad
    print("\n" + ("PASS — per-overlay show/hide toggles voxel visibility live; propagate gated to >1 volume"
                  if ok else "FAIL"))
    raise SystemExit(0 if ok else 1)


if __name__ == "__main__":
    main()
