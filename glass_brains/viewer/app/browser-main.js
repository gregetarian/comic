/**
 * browser-main.js — interactive browser entry.
 * Loads config + colormaps + scene, builds the engine, runs a RAF loop, places
 * panel labels, and handles resize. Controls are wired separately (controls/).
 */
import * as THREE from 'three';
import { resolveConfig } from '../core/presets.js';
import { loadColormaps } from '../core/colormap.js';
import { loadScene } from '../scene/asset-loader.js';
import { createEngine } from '../scene/renderer.js';
import { bindControls } from '../controls/bind.js';
import { createColorbar } from '../controls/colorbar.js';
import { initKapow } from '../controls/kapow.js';

async function fetchJSON(url, fallback) {
    try { const r = await fetch(url); if (!r.ok) throw 0; return await r.json(); }
    catch { return fallback; }
}

async function main() {
    const params = new URLSearchParams(location.search);
    const rc = await fetchJSON(params.get('config') || 'render-config.json', { preset: 'fourPanel', style: {} });
    const presetOverride = params.get('preset');
    const config = (rc.layout && !presetOverride)
        ? resolveConfig(rc)                                              // full custom layout
        : resolveConfig(presetOverride || rc.preset || 'fourPanel', { style: rc.style || {} });

    const cmJson = await fetchJSON(config.data.colormaps, { n: 2, maps: {} });
    const colormaps = loadColormaps(cmJson);

    const sceneModel = await loadScene(config.data.manifest);

    const showColorbar = config.render.colorbar !== false;
    document.body.classList.toggle('nobar', !showColorbar);

    const container = document.getElementById('viewer');
    const canvas = document.getElementById('canvas');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);

    // Provisional size; the ResizeObserver below makes the renderer track the real
    // canvas box once the control rows + colorbar settle (so nothing depends on the
    // exact timing of a refresh). updateStyle=false: CSS owns the display size.
    renderer.setSize(canvas.clientWidth || 1, canvas.clientHeight || 1, false);
    const engine = createEngine({ renderer, width: canvas.clientWidth || 1, height: canvas.clientHeight || 1, sceneModel, colormaps, config });

    bindControls({ engine, config, colormaps });          // builds the per-overlay rows
    let colorbarsVisible = showColorbar;
    let colorbar = showColorbar ? createColorbar(container, { engine, config, colormaps, onHide: () => setColorbarVisible(false) }) : null;
    initKapow(document.getElementById('c-kapow'));         // comic SFX on click

    const sbBrain = document.getElementById('c-save-brain'); if (sbBrain) sbBrain.addEventListener('click', saveBrain);
    const sbBars = document.getElementById('c-save-bars'); if (sbBars) sbBars.addEventListener('click', saveBars);
    const cbTgl = document.getElementById('c-colorbar'); if (cbTgl) cbTgl.addEventListener('click', () => setColorbarVisible(!colorbarsVisible));

    // --- per-panel zoom: + / - buttons at each panel's top-left, shown on hover ---
    const zoomEls = engine.getPanelRects().map((p, i) => {
        const el = document.createElement('div');
        el.className = 'panel-zoom';
        const plus = document.createElement('button'); plus.textContent = '+'; plus.title = 'Zoom in';
        const minus = document.createElement('button'); minus.textContent = '–'; minus.title = 'Zoom out';
        plus.addEventListener('click', (e) => { e.stopPropagation(); engine.zoomPanel(i, 1.15); });
        minus.addEventListener('click', (e) => { e.stopPropagation(); engine.zoomPanel(i, 1 / 1.15); });
        el.append(plus, minus);
        container.appendChild(el);
        return el;
    });
    const placeZoom = () => engine.getPanelRects().forEach((p, i) => {
        zoomEls[i].style.left = (p.cssLeft + 6) + 'px';
        zoomEls[i].style.top = (p.cssTop + 6) + 'px';
    });
    placeZoom();
    container.addEventListener('mousemove', (e) => {
        const r = container.getBoundingClientRect();
        const x = e.clientX - r.left, y = e.clientY - r.top;
        engine.getPanelRects().forEach((p, i) =>
            zoomEls[i].classList.toggle('show', x >= p.cssLeft && x < p.cssLeft + p.w && y >= p.cssTop && y < p.cssTop + p.h));
    });
    container.addEventListener('mouseleave', () => zoomEls.forEach((el) => el.classList.remove('show')));

    // Robust sizing: reserve the bottom strip from the MEASURED colorbar height,
    // then keep the renderer synced to the actual canvas via a ResizeObserver. This
    // survives control-row reflow, overlay add/remove, window resize, and the async
    // web-font load — the canvas size is the single source of truth.
    const syncStrip = () => {
        const strip = (!colorbar) ? 0 : Math.ceil(colorbar.el.getBoundingClientRect().height) + 22;
        document.documentElement.style.setProperty('--cbstrip', strip + 'px');
    };
    const fit = () => { const w = canvas.clientWidth, h = canvas.clientHeight; if (w > 0 && h > 0) { engine.resize(w, h); placeZoom(); } };
    syncStrip(); fit();
    new ResizeObserver(fit).observe(canvas);     // control-row reflow / overlay add-remove
    window.addEventListener('resize', fit);      // window/viewport resize
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { syncStrip(); fit(); });

    // Show/hide the live colorbars. Hiding drops the strip so the brains reclaim the
    // full canvas height (no squash); showing recreates the bars.
    function setColorbarVisible(v) {
        colorbarsVisible = v;
        const t = document.getElementById('c-colorbar'); if (t) t.classList.toggle('active', v);
        if (v && !colorbar) {
            colorbar = createColorbar(container, { engine, config, colormaps, onHide: () => setColorbarVisible(false) });
        } else if (!v && colorbar) {
            colorbar.el.remove(); colorbar = null;
        }
        document.body.classList.toggle('nobar', !colorbar);
        syncStrip(); fit();
    }

    // Save the brains ONLY at full resolution — no colorbars, never squashed.
    function saveBrain() {
        const btn = document.getElementById('c-save-brain'); const label = btn && btn.textContent; if (btn) btn.textContent = 'Saving…';
        const basePr = window.devicePixelRatio || 1;
        const saved = { margin: config.style.margin };
        const barEl = colorbar && colorbar.el;
        try {
            if (barEl) barEl.style.display = 'none';
            document.documentElement.style.setProperty('--cbstrip', '0px');     // canvas → full height
            const cssW = canvas.clientWidth, cssH = canvas.clientHeight;        // forces reflow; cssH is now full
            const savePr = Math.min(4, Math.max(basePr, Math.ceil(3800 / cssW)));
            config.style.margin = (saved.margin ?? 0.95) + 0.13;
            engine.setPixelRatio(savePr);
            engine.applyStyle();
            engine.scaleOutlines(savePr / basePr);                             // keep on-screen line thickness
            engine.resize(cssW, cssH);
            engine.renderFrame();
            const out = document.createElement('canvas');
            out.width = Math.round(cssW * savePr); out.height = Math.round(cssH * savePr);
            const g = out.getContext('2d');
            g.fillStyle = (config.render && config.render.background) || '#ffffff';
            g.fillRect(0, 0, out.width, out.height);
            g.drawImage(canvas, 0, 0, out.width, out.height);
            out.toBlob((blob) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'glassbrain.png'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }, 'image/png');
        } finally {
            config.style.margin = saved.margin;
            if (barEl) barEl.style.display = '';
            engine.setPixelRatio(basePr);
            engine.applyStyle();
            syncStrip(); fit(); engine.renderFrame();
            if (btn) btn.textContent = label;
        }
    }

    // Save the colorbars on their own as a separate image (a legend you place yourself).
    function saveBars() {
        const btn = document.getElementById('c-save-bars'); const label = btn && btn.textContent;
        const ovs = engine.overlays || [];
        if (!ovs.length) { if (btn) { btn.textContent = 'No bars'; setTimeout(() => { btn.textContent = label; }, 1200); } return; }
        if (btn) btn.textContent = 'Saving…';
        const temp = !colorbar;
        const cb = colorbar || createColorbar(container, { engine, config, colormaps });
        cb.update();
        try {
            const pad = 8, basePr = window.devicePixelRatio || 1, savePr = Math.min(4, Math.max(basePr, 3));
            const wrap = cb.el.getBoundingClientRect();
            const out = document.createElement('canvas');
            out.width = Math.round((wrap.width + pad * 2) * savePr); out.height = Math.round((wrap.height + pad * 2) * savePr);
            const g = out.getContext('2d');
            g.fillStyle = (config.render && config.render.background) || '#ffffff';
            g.fillRect(0, 0, out.width, out.height);
            const ox = wrap.left - pad, oy = wrap.top - pad; g.textBaseline = 'top';
            cb.el.querySelectorAll('.cbar-row').forEach((row) => {
                const bar = row.querySelector('canvas'); const br = bar.getBoundingClientRect();
                g.drawImage(bar, (br.left - ox) * savePr, (br.top - oy) * savePr, br.width * savePr, br.height * savePr);
                const nm = row.querySelector('.cbar-name');
                if (nm) { const nr = nm.getBoundingClientRect(); g.fillStyle = '#555'; g.font = `${10 * savePr}px sans-serif`; g.fillText(nm.textContent, (nr.left - ox) * savePr, (nr.top - oy) * savePr); }
                g.fillStyle = '#777'; g.font = `${(config.render.colorbarFontSize ?? 11) * savePr}px ${config.render.colorbarFont || 'serif'}`;
                row.querySelectorAll('.colorbar-labels span').forEach((s) => { const sr = s.getBoundingClientRect(); g.fillText(s.textContent, (sr.left - ox) * savePr, (sr.top - oy) * savePr); });
            });
            out.toBlob((blob) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'glassbrain_colorbars.png'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }, 'image/png');
        } finally { if (temp) cb.el.remove(); if (btn) btn.textContent = label; }
    }

    document.getElementById('loading').style.display = 'none';
    (function loop() { requestAnimationFrame(loop); engine.renderFrame(); colorbar?.update(); })();

    window.__engine = engine; // debug handle
}

main().catch((err) => {
    console.error(err);
    const el = document.getElementById('loading');
    if (el) el.textContent = 'Error: ' + err.message;
});
