"""UI defaults guard (headless Chromium, offline — no Pyodide):
  1. the viewer boots EMPTY (no auto-loaded maps) when given no ?demo / ?baked param;
  2. colorbars are OFF by default even with an overlay present, and the Colorbar button toggles them on;
  3. the Demo button exists;
  4. the Minimise chevron collapses the control rows (body.ctrl-min) and restores them;
  5. the colormap picker ships the full set (~150) incl RdPu/PuRd + reversed (_r) variants;
  6. the per-overlay ‹ › stepper cycles the colormap, and the Randomise button reassigns it.
Uses ?baked=1 (the pre-baked fixture overlay) so an overlay is present without booting Pyodide.
"""
import functools, http.server, socketserver, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent / "braincel" / "web"


def main():
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT))
    httpd = socketserver.TCPServer(("127.0.0.1", 0), h)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    port = httpd.server_address[1]
    base = f"http://127.0.0.1:{port}/index.html"
    errs = []; ok = True
    def check(n, c):
        nonlocal ok; ok &= bool(c); print(f"  {'OK ' if c else 'BAD'} {n}")

    with sync_playwright() as p:
        b = p.chromium.launch(headless=True)
        pg = b.new_page(viewport={"width": 1400, "height": 900})
        pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        pg.on("pageerror", lambda e: errs.append("PAGEERR " + str(e)))

        # --- empty boot: no param -> no overlays auto-load (just the glass brain) ---
        pg.goto(base)
        pg.wait_for_function("window.__engine && window.__engine()", timeout=60000)
        pg.wait_for_timeout(600)
        check("no-param boot is EMPTY (0 overlays)", pg.evaluate("window.__engine().overlays.length") == 0)
        check("Demo button present", pg.evaluate("!!document.getElementById('c-demo')"))

        # --- colorbars OFF by default even with an overlay (?baked=1) ---
        pg.goto(base + "?baked=1")
        pg.wait_for_function("window.__engine && window.__engine() && window.__engine().overlays.length >= 1", timeout=60000)
        pg.wait_for_timeout(400)
        check("overlay present but NO colorbar element (off by default)", pg.evaluate("!document.querySelector('.colorbar')"))
        check("Colorbar button not active", pg.evaluate("!document.getElementById('c-colorbar').classList.contains('active')"))

        # toggle colorbars ON -> the bar appears + button activates
        pg.click("#c-colorbar"); pg.wait_for_timeout(300)
        check("Colorbar toggle ON creates the bar", pg.evaluate("!!document.querySelector('.colorbar')"))
        check("Colorbar button now active", pg.evaluate("document.getElementById('c-colorbar').classList.contains('active')"))

        # --- colormaps.json ships the full set (~150) incl RdPu/PuRd + reversed ---
        sel = ".overlay-row select"
        opts = pg.evaluate(f"[...document.querySelectorAll('{sel} option')].map(o=>o.value)")
        check("colormap picker has the full set (>=150)", len(opts) >= 150)
        check("RdPu + PuRd present (were missing before)", 'RdPu' in opts and 'PuRd' in opts)
        check("reversed (_r) variants present", any(v.endswith('_r') for v in opts))

        # --- ‹ › stepper cycles the colormap (› forward, ‹ back) ---
        v0 = pg.evaluate(f"document.querySelector('{sel}').value")
        pg.locator(".overlay-row .cmap-nav").nth(1).click(); pg.wait_for_timeout(120)   # ›
        v1 = pg.evaluate(f"document.querySelector('{sel}').value")
        check("› steps to a different colormap", v1 != v0)
        pg.locator(".overlay-row .cmap-nav").nth(0).click(); pg.wait_for_timeout(120)   # ‹ back
        check("‹ steps back to the original", pg.evaluate(f"document.querySelector('{sel}').value") == v0)

        # --- Randomise reassigns the colormap (try a few; repeating all 6 is ~(1/156)^6) ---
        check("Randomise button present", pg.evaluate("!!document.getElementById('c-random')"))
        before = pg.evaluate(f"document.querySelector('{sel}').value")
        changed = False; valid = True
        for _ in range(6):
            pg.click("#c-random"); pg.wait_for_timeout(80)
            now = pg.evaluate(f"document.querySelector('{sel}').value")
            changed = changed or (now != before)
            valid = valid and (now in opts)
        check("Randomise always picks a valid loaded colormap", valid)
        check("Randomise changes the colormap (≥1 of 6 clicks differs)", changed)

        # --- minimise: collapse the control rows, restore them ---
        row_shown = pg.evaluate("getComputedStyle(document.querySelector('#controls .row')).display !== 'none'")
        check("control rows visible before minimise", row_shown)
        pg.click("#c-min"); pg.wait_for_timeout(200)
        check("body.ctrl-min set after minimise", pg.evaluate("document.body.classList.contains('ctrl-min')"))
        check("control rows hidden when minimised", pg.evaluate("getComputedStyle(document.querySelector('#controls .row')).display === 'none'"))
        check("ctrl-bar still visible when minimised", pg.evaluate("getComputedStyle(document.querySelector('.ctrl-bar')).display !== 'none'"))
        pg.click("#c-min"); pg.wait_for_timeout(200)
        check("restore: rows shown again", pg.evaluate("getComputedStyle(document.querySelector('#controls .row')).display !== 'none'"))
        b.close()
    httpd.shutdown()

    bad = [e for e in errs if "favicon" not in e.lower()]
    if bad: print("ERRORS:", *bad[:6], sep="\n  - ")
    ok = ok and not bad
    print("\n" + ("PASS — empty boot, colorbars off by default (toggle works), Demo button, minimisable controls, "
                  "full colormap set (RdPu/PuRd/_r), ‹ › stepper + Randomise"
                  if ok else "FAIL"))
    raise SystemExit(0 if ok else 1)


if __name__ == "__main__":
    main()
