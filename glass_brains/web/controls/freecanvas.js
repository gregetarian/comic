/**
 * freecanvas.js — the Free Canvas editor overlay.
 *
 * In layout.mode === 'free', each panel gets a draggable/resizable frame drawn over
 * the canvas: drag the HEADER to move, drag the BODY to orbit (yaw/pitch), drag the
 * CORNER to resize. The header also carries a view picker, stepped rotate buttons,
 * bring-to-front, and remove. A toolbar seeds a grid of panels or adds single panels.
 *
 * Move / resize / rotate / view-change mutate config.layout.panels IN PLACE — the
 * engine reads `def` every frame, so they're live with NO rebuild. Add / remove /
 * seed change the panel SET, so they call onStructureChange() (the app's rebuild).
 *
 * Positions are stored as FRACTIONS (place.{x,y,w,h} ∈ 0..1) of the canvas, matching
 * core/grid.js:freeRect — so a figure places identically at any render size.
 */
import { VIEWS, VIEW_ORDER, applyView, panelViewName } from '../core/views.js';
import { add, sub, dot, scale, normalize } from '../core/units.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };

const ROT_STEP = 15;     // degrees per button press
const ORBIT_SENS = 0.45; // degrees per pixel of body drag
const MIN_FRAC = 0.06;   // smallest panel (fraction of canvas)

// ✂ cycle: off → 3 orthogonal plane cuts → sphere bite → cube bite. Geometry is in
// world mm (MNI), centred on the brain. Arbitrary normals/centres are expressible in
// the spec / CLI; these presets cover the common cases one click at a time.
const SLICE_CYCLE = [
    null,
    { label: 'axial cut',    shape: 'plane',  mode: 'keep', normal: [0, 0, 1], offset: 18 },
    { label: 'coronal cut',  shape: 'plane',  mode: 'keep', normal: [0, 1, 0], offset: -18 },
    { label: 'sagittal cut', shape: 'plane',  mode: 'keep', normal: [1, 0, 0], offset: 0 },
    { label: 'sphere bite',  shape: 'sphere', mode: 'bite', center: [0, -18, 22], radius: 45 },
    { label: 'cube bite',    shape: 'cube',   mode: 'bite', min: [-5, -15, 0], max: [75, 80, 85] },
];
const materializeSlice = (p) => { if (!p) return null; const { label, ...s } = p; return s; };
const sliceCycleIndex = (slice) => {
    if (!slice) return 0;
    const i = SLICE_CYCLE.findIndex((p) => p && p.shape === slice.shape && p.mode === slice.mode);
    return i < 0 ? 0 : i;
};

// --- slice handle geometry: world mm (MNI) ↔ panel screen px (via getPanelView) ---
function sliceAnchor(sl) {
    if (sl.shape === 'plane') return scale(normalize(sl.normal), sl.offset);   // point on the plane
    if (sl.shape === 'sphere') return sl.center.slice();
    return [(sl.min[0] + sl.max[0]) / 2, (sl.min[1] + sl.max[1]) / 2, (sl.min[2] + sl.max[2]) / 2]; // cube centre
}
function sliceRadius(sl) {
    if (sl.shape === 'sphere') return sl.radius;
    if (sl.shape === 'cube') return Math.max((sl.max[0] - sl.min[0]) / 2, (sl.max[1] - sl.min[1]) / 2, (sl.max[2] - sl.min[2]) / 2);
    return 0;
}
function cloneSliceStart(sl) {
    if (!sl) return {};
    if (sl.shape === 'plane') return { offset: sl.offset };
    if (sl.shape === 'sphere') return { center: sl.center.slice(), radius: sl.radius };
    const c = [(sl.min[0] + sl.max[0]) / 2, (sl.min[1] + sl.max[1]) / 2, (sl.min[2] + sl.max[2]) / 2];
    const h = [(sl.max[0] - sl.min[0]) / 2, (sl.max[1] - sl.min[1]) / 2, (sl.max[2] - sl.min[2]) / 2];
    return { center: c, half: h };
}
// Orthographic projection: world point → panel pixel (square pixels, mm-per-px uniform).
function worldToScreen(view, P) {
    const d = sub(P, view.center);
    return {
        x: view.rect.cssLeft + view.rect.w / 2 + dot(d, view.r) / view.mmPerPx,
        y: view.rect.cssTop + view.rect.h / 2 - dot(d, view.u) / view.mmPerPx,   // screen y is down
    };
}
// In-image-plane world delta for a screen drag (mm).
const screenDeltaToWorld = (view, dx, dy) => add(scale(view.r, dx * view.mmPerPx), scale(view.u, -dy * view.mmPerPx));

let _uid = 0;
const newPanelId = () => `fc${++_uid}`;

export function createFreeCanvasEditor({ container, canvas, config, getEngine, onStructureChange, onBgAlpha }) {
    let frames = [];
    const toolbar = buildToolbar();

    function layout() { return config.layout; }
    function panels() { return config.layout.panels; }
    function maxZ() { return panels().reduce((m, p) => Math.max(m, (p.place && p.place.z) || 0), 0); }

    // --- toolbar: grid seeder + add panel ---
    function buildToolbar() {
        const bar = el('div', 'fc-toolbar');
        bar.append(el('span', 'fc-tag', 'Free Canvas'));
        const rows = el('input', 'fc-grid'); rows.type = 'number'; rows.min = 1; rows.max = 6; rows.value = 2; rows.title = 'rows';
        const cols = el('input', 'fc-grid'); cols.type = 'number'; cols.min = 1; cols.max = 6; cols.value = 2; cols.title = 'cols';
        const seed = el('button', 'btn', 'Seed grid'); seed.title = 'Replace the canvas with an R×C grid of panels';
        seed.addEventListener('click', () => seedGrid(clamp(+rows.value | 0, 1, 6), clamp(+cols.value | 0, 1, 6)));
        const add = el('button', 'btn', '+ panel'); add.title = 'Add a panel at the centre';
        add.addEventListener('click', addPanel);
        bar.append(rows, el('span', null, '×'), cols, seed, add);
        // Transparent background (whole canvas) — exports a transparent PNG.
        if (onBgAlpha) {
            const lab = el('label', 'fc-bg'); lab.title = 'Transparent figure background (exports a transparent PNG)';
            const cb = el('input'); cb.type = 'checkbox';
            cb.checked = ((config.layout.canvas && config.layout.canvas.bgAlpha) ?? 1) < 1;
            cb.addEventListener('change', () => onBgAlpha(cb.checked ? 0 : 1));
            lab.append(cb, el('span', null, ' transparent'));
            bar.append(lab);
        }
        return bar;
    }

    // --- structural ops (need an engine rebuild) ---
    function seedGrid(r, c) {
        const pad = 0.012, list = [];
        for (let i = 0; i < r * c; i++) {
            const ri = Math.floor(i / c), ci = i % c;
            const p = applyView({ id: newPanelId(), framing: { fit: 'auto' } }, VIEW_ORDER[i % VIEW_ORDER.length]);
            p.place = { x: ci / c + pad, y: ri / r + pad, w: 1 / c - 2 * pad, h: 1 / r - 2 * pad, z: i };
            list.push(p);
        }
        config.layout = { ...layout(), mode: 'free', panels: list };
        onStructureChange();
    }
    function addPanel() {
        const p = applyView({ id: newPanelId(), framing: { fit: 'auto' } }, 'dorsal');
        p.place = { x: 0.35, y: 0.35, w: 0.3, h: 0.3, z: maxZ() + 1 };
        panels().push(p);
        onStructureChange();
    }
    function removePanel(idx) {
        if (panels().length <= 1) return;     // keep at least one
        panels().splice(idx, 1);
        onStructureChange();
    }
    function bringToFront(panel) { (panel.place ||= { x: 0.3, y: 0.3, w: 0.4, h: 0.4 }).z = maxZ() + 1; }

    // --- per-panel frame ---
    function makeFrame(panel, idx) {
        const f = el('div', 'fc-frame');
        const body = el('div', 'fc-body');
        const head = el('div', 'fc-head');
        const resize = el('div', 'fc-resize');

        const view = el('select', 'fc-view');
        for (const name of VIEW_ORDER) { const o = el('option', null, VIEWS[name].title); o.value = name; view.append(o); }
        view.value = panelViewName(panel);
        view.title = 'View for this panel';
        view.addEventListener('pointerdown', (e) => e.stopPropagation());
        view.addEventListener('change', () => { applyView(panel, view.value); });

        const mkBtn = (txt, title, fn) => {
            const b = el('button', null, txt); b.title = title; b.type = 'button';
            b.addEventListener('pointerdown', (e) => e.stopPropagation());
            b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
            return b;
        };
        const rot = (k, d) => () => { (panel.rotate ||= { yaw: 0, pitch: 0, roll: 0 })[k] += d; };
        let sliceIdx = sliceCycleIndex(panel.slice);
        const sliceBtn = el('button', null, '✂'); sliceBtn.type = 'button';
        const setSliceTitle = () => { sliceBtn.title = 'Slice: ' + (SLICE_CYCLE[sliceIdx] ? SLICE_CYCLE[sliceIdx].label : 'off') + ' — click to cycle'; };
        sliceBtn.classList.toggle('on', !!panel.slice); setSliceTitle();
        sliceBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
        sliceBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            sliceIdx = (sliceIdx + 1) % SLICE_CYCLE.length;
            panel.slice = materializeSlice(SLICE_CYCLE[sliceIdx]);
            sliceBtn.classList.toggle('on', !!panel.slice); setSliceTitle();
        });
        head.append(view,
            mkBtn('◀', 'Turn left (yaw −)', rot('yaw', -ROT_STEP)),
            mkBtn('▶', 'Turn right (yaw +)', rot('yaw', ROT_STEP)),
            mkBtn('▲', 'Tilt up (pitch −)', rot('pitch', -ROT_STEP)),
            mkBtn('▼', 'Tilt down (pitch +)', rot('pitch', ROT_STEP)),
            mkBtn('⟲', 'Roll left', rot('roll', -ROT_STEP)),
            mkBtn('⟳', 'Roll right', rot('roll', ROT_STEP)),
            sliceBtn,
            mkBtn('⤒', 'Bring to front', () => bringToFront(panel)),
            mkBtn('✕', 'Remove panel', () => removePanel(idx)));

        // Slice handles (shown only when this panel has a slice): anchor = move the cut
        // (in-plane; SHIFT = depth along the view), size = radius/extent.
        const anchorH = el('div', 'fc-slice-handle');
        const sizeH = el('div', 'fc-slice-handle fc-slice-size');
        f.append(body, head, resize, anchorH, sizeH);
        container.appendChild(f);

        dragMove(head, panel);        // drag the header bar to move
        dragBody(body, panel);        // drag the brain to move; SHIFT+drag to orbit
        dragResize(resize, panel);
        dragSlice(anchorH, panel, 'anchor');
        dragSlice(sizeH, panel, 'size');
        return { el: f, panel, anchorH, sizeH };
    }

    // Drag a slice handle: 'anchor' moves the cut (plane→offset; sphere/cube→centre,
    // SHIFT = depth), 'size' grows the radius / box extent. Mutates panel.slice live.
    function dragSlice(handle, panel, kind) {
        startDrag(handle, (e) => ({ view: getEngine().getPanelView(panel), sl: panel.slice, shift: e.shiftKey, start: cloneSliceStart(panel.slice) }),
            (c, dx, dy) => {
                const sl = c.sl; if (!c.view || !sl) return;
                if (kind === 'anchor') {
                    if (sl.shape === 'plane') {
                        sl.offset = c.start.offset + dot(screenDeltaToWorld(c.view, dx, dy), normalize(sl.normal));
                    } else {
                        const wd = c.shift ? scale(c.view.f, -dy * c.view.mmPerPx) : screenDeltaToWorld(c.view, dx, dy);
                        if (sl.shape === 'sphere') sl.center = add(c.start.center, wd);
                        else { sl.min = add(c.start.min, wd); sl.max = add(c.start.max, wd); }
                    }
                } else {
                    const dr = dx * c.view.mmPerPx;
                    if (sl.shape === 'sphere') sl.radius = Math.max(5, c.start.radius + dr);
                    else if (sl.shape === 'cube') {
                        const ctr = c.start.center, h = c.start.half.map((v) => Math.max(5, v + dr));
                        sl.min = [ctr[0] - h[0], ctr[1] - h[1], ctr[2] - h[2]];
                        sl.max = [ctr[0] + h[0], ctr[1] + h[1], ctr[2] + h[2]];
                    }
                }
            });
    }
    // Position/show this panel's slice handles by projecting the slice into the panel.
    function updateSliceHandles(fr) {
        const { panel, anchorH, sizeH } = fr, sl = panel.slice;
        const view = sl ? getEngine().getPanelView(panel) : null;
        if (!sl || !view) { anchorH.style.display = 'none'; sizeH.style.display = 'none'; return; }
        const put = (h, p) => { h.style.left = (p.x - view.rect.cssLeft) + 'px'; h.style.top = (p.y - view.rect.cssTop) + 'px'; h.style.display = 'block'; };
        put(anchorH, worldToScreen(view, sliceAnchor(sl)));
        if (sl.shape === 'plane') sizeH.style.display = 'none';
        else put(sizeH, worldToScreen(view, add(sliceAnchor(sl), scale(view.r, sliceRadius(sl)))));
    }

    // --- drag helpers (pointer capture; mutate place/rotate fractions live) ---
    function startDrag(handle, onStart, onMove) {
        handle.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            e.preventDefault(); e.stopPropagation();
            handle.setPointerCapture(e.pointerId);
            const x0 = e.clientX, y0 = e.clientY, ctx = onStart(e);
            const move = (ev) => onMove(ctx, ev.clientX - x0, ev.clientY - y0);
            const up = () => {
                handle.style.cursor = '';
                handle.removeEventListener('pointermove', move);
                handle.removeEventListener('pointerup', up);
            };
            handle.addEventListener('pointermove', move);
            handle.addEventListener('pointerup', up);
        });
    }
    function moveBy(panel, start, dx, dy) {
        const W = canvas.clientWidth, H = canvas.clientHeight, pl = panel.place;
        pl.x = clamp(start.x + dx / W, -pl.w + 0.02, 1 - 0.02);
        pl.y = clamp(start.y + dy / H, -pl.h + 0.02, 1 - 0.02);
    }
    function dragMove(handle, panel) {
        startDrag(handle, () => ({ x: panel.place.x, y: panel.place.y }),
            (s, dx, dy) => moveBy(panel, s, dx, dy));
    }
    function dragResize(handle, panel) {
        startDrag(handle, () => ({ w: panel.place.w, h: panel.place.h }), (c, dx, dy) => {
            const W = canvas.clientWidth, H = canvas.clientHeight, pl = panel.place;
            pl.w = clamp(c.w + dx / W, MIN_FRAC, 1);
            pl.h = clamp(c.h + dy / H, MIN_FRAC, 1);
        });
    }
    function dragBody(handle, panel) {
        startDrag(handle, (e) => {
            if (e.shiftKey) {                          // SHIFT+drag = free orbit
                const r = (panel.rotate ||= { yaw: 0, pitch: 0, roll: 0 });
                handle.style.cursor = 'grabbing';
                return { orbit: true, yaw: r.yaw, pitch: r.pitch };
            }
            return { orbit: false, x: panel.place.x, y: panel.place.y }; // plain drag = move
        }, (c, dx, dy) => {
            if (c.orbit) {
                const r = panel.rotate;
                r.yaw = c.yaw + dx * ORBIT_SENS;
                r.pitch = clamp(c.pitch + dy * ORBIT_SENS, -85, 85);
            } else {
                moveBy(panel, c, dx, dy);
            }
        });
    }

    // --- public: refresh (rebuild frames) / reposition (track panel rects) / destroy ---
    function refresh() {
        frames.forEach((fr) => fr.el.remove());
        frames = (layout().mode === 'free')
            ? panels().map((p, i) => makeFrame(p, i))
            : [];
        toolbar.style.display = (layout().mode === 'free') ? '' : 'none';
        if (!toolbar.isConnected && layout().mode === 'free') container.appendChild(toolbar);
        reposition();
    }
    function reposition() {
        if (layout().mode !== 'free') return;
        const rects = getEngine().getPanelRects();
        frames.forEach((fr, i) => {
            const r = rects[i]; if (!r) return;
            fr.el.style.left = r.cssLeft + 'px';
            fr.el.style.top = r.cssTop + 'px';
            fr.el.style.width = r.w + 'px';
            fr.el.style.height = r.h + 'px';
            updateSliceHandles(fr);
        });
    }
    function destroy() {
        frames.forEach((fr) => fr.el.remove());
        frames = [];
        toolbar.remove();
    }

    return { refresh, reposition, destroy };
}
