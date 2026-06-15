"""Style presets (headless Chromium, offline — ?baked=1, no Pyodide):
save the current style to the browser, perturb it (Randomise + a global change), then
load the preset back and assert it restores the per-overlay colormap AND the global style
(and syncs the surface-row slider). Guards the save/localStorage/apply-by-sequence path."""
import functools, http.server, socketserver, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent / "braincel" / "web"


def main():
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT))
    httpd = socketserver.TCPServer(("127.0.0.1", 0), h)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    port = httpd.server_address[1]
    errs = []; ok = True
    def check(n, c):
        nonlocal ok; ok &= bool(c); print(f"  {'OK ' if c else 'BAD'} {n}")

    with sync_playwright() as p:
        b = p.chromium.launch(headless=True)
        pg = b.new_page(viewport={"width": 1400, "height": 900})
        pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        pg.on("pageerror", lambda e: errs.append("PAGEERR " + str(e)))
        pg.goto(f"http://127.0.0.1:{port}/index.html?baked=1")
        pg.wait_for_function("window.__engine && window.__engine() && window.__engine().overlays.length>=1", timeout=60000)
        pg.wait_for_timeout(400)
        sel = ".overlay-row select"
        v0 = pg.evaluate(f"document.querySelector('{sel}').value")
        g0 = pg.evaluate("window.__engine().config.style.outline.width")

        # save the current style as preset 'p1'
        pg.click("#c-presets"); pg.wait_for_timeout(150)
        pg.fill(".preset-name", "p1")
        pg.click(".preset-saverow .btn"); pg.wait_for_timeout(150)
        check("preset 'p1' saved + listed", pg.evaluate("[...document.querySelectorAll('.preset-apply')].some(e=>e.textContent==='p1')"))

        # perturb: randomise colormaps + change a global field
        pg.evaluate("document.body.click()"); pg.wait_for_timeout(50)
        for _ in range(3):
            pg.click("#c-random"); pg.wait_for_timeout(60)
        pg.evaluate("window.__engine().config.style.outline.width = 7.0; window.__engine().applyStyle();")

        # load preset 'p1' back
        pg.click("#c-presets"); pg.wait_for_timeout(150)
        pg.evaluate("[...document.querySelectorAll('.preset-apply')].find(e=>e.textContent==='p1').click()")
        pg.wait_for_timeout(250)
        v2 = pg.evaluate(f"document.querySelector('{sel}').value")
        g2 = pg.evaluate("window.__engine().config.style.outline.width")
        slider = pg.evaluate("parseFloat(document.getElementById('c-outline-width').value)")
        check("per-overlay colormap restored", v2 == v0)
        check("global style restored", abs(g2 - g0) < 1e-6)
        check("surface-row slider synced to restored value", abs(slider - g0) < 1e-6)
        b.close()
    httpd.shutdown()

    bad = [e for e in errs if "favicon" not in e.lower()]
    if bad: print("ERRORS:", *bad[:6], sep="\n  - ")
    ok = ok and not bad
    print("\n" + ("PASS — style preset save/load round-trips per-overlay colormap + global style (slider synced)"
                  if ok else "FAIL"))
    raise SystemExit(0 if ok else 1)


if __name__ == "__main__":
    main()
