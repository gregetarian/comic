"""Static brain size + whole-canvas pan/zoom (headless Chromium, offline ?baked=1).

The core guarantee: resizing the window (or minimising the controls) must NOT change the
brain's on-screen size — only the user's zoom/pan reframes it. Also checks wheel-zoom,
Fit, and drag-pan move the view. Lightweight (no heavy drag operations)."""
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
        pg.wait_for_timeout(500)

        def panel0_w():
            return pg.evaluate("window.__engine().getPanelRects()[0].w")
        w_before = panel0_w()
        s_before = pg.evaluate("window.__engine().getView().s")

        # --- RESIZE the viewport: the brain's on-screen size must NOT change ---
        pg.set_viewport_size({"width": 1000, "height": 700}); pg.wait_for_timeout(300)
        w_after = panel0_w()
        check("brain on-screen size is UNCHANGED after a window resize",
              abs(w_after - w_before) < 0.5)
        check("zoom (s) unchanged by resize", abs(pg.evaluate("window.__engine().getView().s") - s_before) < 1e-6)

        # --- wheel zoom changes s; panels scale with it ---
        pg.mouse.move(500, 350)
        pg.mouse.wheel(0, -300); pg.wait_for_timeout(150)
        s_zoom = pg.evaluate("window.__engine().getView().s")
        check("wheel up increases zoom (s)", s_zoom > s_before)
        check("panels scale with zoom", panel0_w() > w_after - 0.5)

        # --- Fit resets to fit-the-viewport; a known centred view ---
        pg.click("#c-zoom-fit"); pg.wait_for_timeout(150)
        v = pg.evaluate("window.__engine().getView()")
        check("Fit re-centres the view", abs(v["cx"] - v["W0"] / 2) < 1 and abs(v["cy"] - v["H0"] / 2) < 1)

        # --- middle-drag pans the canvas anywhere (even over Free-Canvas frames) ---
        cx0 = pg.evaluate("window.__engine().getView().cx")
        pg.mouse.move(500, 350); pg.mouse.down(button="middle"); pg.mouse.move(380, 350, steps=5); pg.mouse.up(button="middle")
        pg.wait_for_timeout(150)
        check("middle-drag pans the view centre (cx)", abs(pg.evaluate("window.__engine().getView().cx") - cx0) > 1)
        b.close()
    httpd.shutdown()

    bad = [e for e in errs if "favicon" not in e.lower()]
    if bad: print("ERRORS:", *bad[:6], sep="\n  - ")
    ok = ok and not bad
    print("\n" + ("PASS — brain size fixed on resize; wheel-zoom / Fit / drag-pan reframe the canvas"
                  if ok else "FAIL"))
    raise SystemExit(0 if ok else 1)


if __name__ == "__main__":
    main()
