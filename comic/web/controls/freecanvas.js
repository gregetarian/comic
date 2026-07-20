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
import { WORLD_AXES, rotateAroundWorldAxis, snapPlaneForAxis } from '../core/rotation.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };

const ROT_STEP = 15;     // degrees per button press
const ORBIT_SENS = 0.45; // degrees per pixel of body drag
const GIZMO_SENS = 0.55; // degrees per pixel along a coloured MNI axis
const GIZMO_KEY_STEP = 5;
const MIN_FRAC = 0.06;     // smallest panel (fraction of canvas)
const SNAP_DEFAULT_PX = 8; // default snap step (CSS px) — fine; user-adjustable

// Delayed, styled hover tooltip for editor controls — native `title` is slow and
// inconsistent. `text` may be a string or a function (for controls whose label changes).
let _tip = null, _tipTimer = 0;
const hideTip = () => { clearTimeout(_tipTimer); if (_tip) _tip.style.display = 'none'; };
function attachTip(node, text) {
    if (!text) return;
    node.setAttribute('aria-label', typeof text === 'function' ? 'control' : text);
    node.addEventListener('mouseenter', () => {
        _tipTimer = setTimeout(() => {
            if (!_tip) { _tip = el('div', 'fc-tip'); document.body.appendChild(_tip); }
            _tip.textContent = typeof text === 'function' ? text() : text;
            _tip.style.display = 'block';
            const r = node.getBoundingClientRect();
            _tip.style.left = Math.max(6, Math.min(r.left, window.innerWidth - _tip.offsetWidth - 6)) + 'px';
            const below = r.bottom + 6;
            _tip.style.top = (below + _tip.offsetHeight <= window.innerHeight ? below : r.top - _tip.offsetHeight - 6) + 'px';
        }, 450);
    });
    node.addEventListener('mouseleave', hideTip);
    node.addEventListener('mousedown', hideTip);
}

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
function materializeSlice(p, panel = null) {
    if (!p) return null;
    const { label, ...raw } = p;
    const s = JSON.parse(JSON.stringify(raw));
    // A sagittal cut at x=0 lands in the inter-hemispheric fissure and exposes almost no tissue.
    // Start 15 mm inside the panel's displayed hemisphere, with the face pointing toward that
    // named camera. The handle can then move it anywhere. Whole-brain/unknown views keep x=0.
    if (label === 'sagittal cut' && panel) {
        const hemi = panel.content?.hemisphere;
        const planeX = hemi === 'lh' ? -15 : (hemi === 'rh' ? 15 : 0);
        const plane = panel.camera?.plane || '';
        const cameraX = ['right_lateral', 'left_medial'].includes(plane) ? 1
            : (['left_lateral', 'right_medial'].includes(plane) ? -1 : 0);
        if (cameraX) s.normal = [-cameraX, 0, 0];
        s.offset = s.normal[0] * planeX;
    }
    return s;
}
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
    // The "active" panel is the one you last pressed; it STAYS lifted + interactive until you
    // press another, so reaching for its resize corner (which overhangs into a neighbour) can't
    // be stolen by whatever the cursor grazes en route. Hover only lifts to 200; active wins at 250.
    let activeId = null;
    function setActive(id) {
        if (activeId === id) return;
        activeId = id;
        for (const fr of frames) fr.el.classList.toggle('fc-active', fr.panel.id === id);
        reposition();
    }
    // DESELECT the active panel by pressing anywhere that isn't a panel frame or the toolbar —
    // empty canvas, the snap grid, panel margins, whatever overlays the canvas (capture phase, so
    // stacking/pointer-events can't hide it) — or by pressing Escape (works even when panels tile
    // the whole canvas and there's no empty space to click). Without this the last-pressed panel
    // stays active forever; you could never click "off" a box.
    const onDeselectDown = (e) => {
        if (activeId === null) return;
        if (e.target && e.target.closest && e.target.closest('.fc-frame, .fc-toolbar')) return;
        setActive(null);
    };
    container.addEventListener('pointerdown', onDeselectDown, true);

    let snap = true;                                 // snap move/resize to a fine px grid
    let snapPx = SNAP_DEFAULT_PX;                     // snap step (CSS px); user-adjustable
    const gridOverlay = el('div', 'fc-gridlines');   // faint grid shown while snapping
    const clone = (o) => JSON.parse(JSON.stringify(o));
    let home = clone(config.layout);                 // baseline arrangement, for "Reset"

    // Undo / redo of the whole layout (Cmd/Ctrl+Z; add Shift, or Ctrl+Y, to redo). pushHistory()
    // is called just before each edit; undo swaps the current layout for the last snapshot.
    let undoStack = [], redoStack = [];
    function pushHistory() { undoStack.push(clone(config.layout)); if (undoStack.length > 60) undoStack.shift(); redoStack = []; }
    function undo() { if (!undoStack.length) return; redoStack.push(clone(config.layout)); config.layout = undoStack.pop(); onStructureChange(); }
    function redo() { if (!redoStack.length) return; undoStack.push(clone(config.layout)); config.layout = redoStack.pop(); onStructureChange(); }
    const onKey = (e) => {
        if (layout().mode !== 'free') return;
        const t = e.target;
        if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
        const k = (e.key || '').toLowerCase();
        if (k === 'escape') { if (activeId !== null) { e.preventDefault(); setActive(null); } }
        else if ((e.metaKey || e.ctrlKey) && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
        else if ((e.metaKey || e.ctrlKey) && k === 'y') { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', onKey);

    const toolbar = buildToolbar();

    function layout() { return config.layout; }
    function panels() { return config.layout.panels; }
    function maxZ() { return panels().reduce((m, p) => Math.max(m, (p.place && p.place.z) || 0), 0); }
    const snapshotHome = () => { home = clone(config.layout); };
    // Snap a fraction to the nearest grid step of the live canvas (no-op when off).
    const snapF = (frac, dim) => (snap ? Math.round(frac * dim / snapPx) * snapPx / dim : frac);
    const updateGrid = () => { gridOverlay.style.display = (layout().mode === 'free' && snap) ? 'block' : 'none'; };

    // --- toolbar: grid seeder + add panel ---
    function buildToolbar() {
        const bar = el('div', 'fc-toolbar');
        bar.append(el('span', 'fc-tag', 'Free Canvas'));
        const rows = el('input', 'fc-grid'); rows.type = 'number'; rows.min = 1; rows.max = 6; rows.value = 2; attachTip(rows, 'Rows');
        const cols = el('input', 'fc-grid'); cols.type = 'number'; cols.min = 1; cols.max = 6; cols.value = 2; attachTip(cols, 'Columns');
        const seed = el('button', 'btn', 'Seed grid'); attachTip(seed, 'Replace the canvas with an R×C grid of panels');
        seed.addEventListener('click', () => seedGrid(clamp(+rows.value | 0, 1, 6), clamp(+cols.value | 0, 1, 6)));
        const add = el('button', 'btn', '+ panel'); attachTip(add, 'Add a panel at the centre of the canvas');
        add.addEventListener('click', addPanel);
        const reset = el('button', 'btn', 'Reset'); attachTip(reset, 'Reset panels to their original positions (undo moves, resizes, rotations & slices)');
        reset.addEventListener('click', resetLayout);
        bar.append(rows, el('span', null, '×'), cols, seed, add, reset);
        // Snap to grid — snaps move/resize to a fine grid (with a faint grid overlay).
        const snapLab = el('label', 'fc-chk'); const snapCb = el('input'); snapCb.type = 'checkbox'; snapCb.checked = snap;
        snapCb.addEventListener('change', () => { snap = snapCb.checked; updateGrid(); });
        snapLab.append(snapCb, el('span', null, ' snap')); attachTip(snapLab, 'Snap moving & resizing to a fine grid');
        const gpx = el('input', 'fc-grid'); gpx.type = 'number'; gpx.min = 2; gpx.max = 40; gpx.value = snapPx;
        gpx.addEventListener('change', () => { snapPx = clamp(+gpx.value | 0, 2, 40) || SNAP_DEFAULT_PX; gpx.value = snapPx; reposition(); });
        attachTip(gpx, 'Grid size in px (smaller = finer snapping)');
        bar.append(snapLab, gpx);
        // Transparent background (whole canvas) — exports a transparent PNG.
        if (onBgAlpha) {
            const lab = el('label', 'fc-chk');
            const cb = el('input'); cb.type = 'checkbox';
            cb.checked = ((config.layout.canvas && config.layout.canvas.bgAlpha) ?? 1) < 1;
            cb.addEventListener('change', () => onBgAlpha(cb.checked ? 0 : 1));
            lab.append(cb, el('span', null, ' transparent')); attachTip(lab, 'Transparent figure background (exports a transparent PNG)');
            bar.append(lab);
        }
        return bar;
    }

    // --- structural ops (need an engine rebuild) ---
    function seedGrid(r, c) {
        pushHistory();
        const pad = 0.012, list = [];
        for (let i = 0; i < r * c; i++) {
            const ri = Math.floor(i / c), ci = i % c;
            const p = applyView({ id: newPanelId(), framing: { fit: 'auto', margin: 1.1 } }, VIEW_ORDER[i % VIEW_ORDER.length]);
            p.place = { x: ci / c + pad, y: ri / r + pad, w: 1 / c - 2 * pad, h: 1 / r - 2 * pad, z: i };
            list.push(p);
        }
        config.layout = { ...layout(), mode: 'free', panels: list };
        snapshotHome();              // a freshly seeded grid is the new "original" to reset to
        onStructureChange();
    }
    function addPanel() {
        pushHistory();
        const p = applyView({ id: newPanelId(), framing: { fit: 'auto', margin: 1.1 } }, 'dorsal');
        p.place = { x: 0.35, y: 0.35, w: 0.3, h: 0.3, z: maxZ() + 1 };
        panels().push(p);
        onStructureChange();
    }
    function removePanel(idx) {
        if (panels().length <= 1) return;     // keep at least one
        pushHistory();
        panels().splice(idx, 1);
        onStructureChange();
    }
    function bringToFront(panel) { (panel.place ||= { x: 0.3, y: 0.3, w: 0.4, h: 0.4 }).z = maxZ() + 1; }
    // Restore each panel that existed in the baseline to its original place/rotate/slice/
    // view (matched by id); panels added since are left as-is. Undoes manual edits.
    function resetLayout() {
        pushHistory();
        const byId = new Map((home.panels || []).map((p) => [p.id, p]));
        for (const p of panels()) {
            const h = byId.get(p.id); if (!h) continue;
            p.place = h.place ? { ...h.place } : p.place;
            p.rotate = h.rotate ? { ...h.rotate } : undefined;
            p.slice = h.slice ? clone(h.slice) : null;
            p.camera = clone(h.camera); p.content = clone(h.content);
            p.framing = h.framing ? { ...h.framing } : p.framing;
            p.view = h.view; p.title = h.title;
            p.anatomyOpacity = h.anatomyOpacity != null ? h.anatomyOpacity : null;
        }
        onStructureChange();   // rebuild so the frame controls (view picker, slice state) refresh
    }

    // --- per-panel frame ---
    function makeFrame(panel, idx) {
        const f = el('div', 'fc-frame');
        const body = el('div', 'fc-body');
        const head = el('div', 'fc-head');
        const resize = el('div', 'fc-resize');

        const view = el('select', 'fc-view');
        for (const name of VIEW_ORDER) { const o = el('option', null, VIEWS[name].title); o.value = name; view.append(o); }
        view.value = panelViewName(panel);
        attachTip(view, 'View shown in this panel');
        view.addEventListener('pointerdown', (e) => e.stopPropagation());
        view.addEventListener('change', () => { applyView(panel, view.value); });

        const mkBtn = (txt, tip, fn) => {
            const b = el('button', null, txt); b.type = 'button'; attachTip(b, tip);
            b.addEventListener('pointerdown', (e) => e.stopPropagation());
            b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
            return b;
        };
        const rot = (k, d) => () => { (panel.rotate ||= { yaw: 0, pitch: 0, roll: 0 })[k] += d; };
        // Per-panel cortex-outline tuning (multiplies the global width/threshold). Lets one view
        // (e.g. a dorsal panel, whose face-on folds merge into thick strokes) thin its line or shed
        // shallow folds without affecting the others. Engine reads def.outline live each frame.
        const outlineAdj = (key, factor) => () => {
            const o = (panel.outline ||= {});
            o[key] = clamp((o[key] ?? 1) * factor, 0.2, 5);
        };
        let sliceIdx = sliceCycleIndex(panel.slice);
        const sliceBtn = el('button', null, '✂'); sliceBtn.type = 'button';
        sliceBtn.classList.toggle('on', !!panel.slice);
        attachTip(sliceBtn, () => 'Slice: ' + (SLICE_CYCLE[sliceIdx] ? SLICE_CYCLE[sliceIdx].label : 'off') + ' — click to cycle');
        sliceBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
        sliceBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            sliceIdx = (sliceIdx + 1) % SLICE_CYCLE.length;
            panel.slice = materializeSlice(SLICE_CYCLE[sliceIdx], panel);
            sliceBtn.classList.toggle('on', !!panel.slice);
        });
        // The header stays compact — view picker, the quick ✂ slice toggle, and a ☰ menu button —
        // so it never overflows a small panel. Everything else lives in a collapsible dropdown that
        // wraps to as many rows as it needs (no more zooming in just to reach a button).
        const menuBtn = el('button', 'fc-menu-btn', '☰'); menuBtn.type = 'button';
        attachTip(menuBtn, 'Panel controls (rotate, cortex lines, reorder, remove)');
        const menu = el('div', 'fc-menu');
        menuBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
        menuBtn.addEventListener('click', (e) => { e.stopPropagation(); menu.classList.toggle('open'); });
        menu.addEventListener('pointerdown', (e) => e.stopPropagation());
        const surface = el('select', 'fc-surface');
        const surfaceChoices = [['', 'surface: global'],
            ...(getEngine().getSurfaceVariants?.() || ['pial', 'inflated']).map((s) => [s, `surface: ${s}`]),
            ['hidden', 'surface: hidden']];
        for (const [value, label] of surfaceChoices) {
            const o = el('option', null, label); o.value = value; surface.append(o);
        }
        surface.value = panel.content?.surface || '';
        surface.addEventListener('change', () => { (panel.content ||= {}).surface = surface.value || null; });
        attachTip(surface, 'Cortical shell for this panel only; statistical overlays keep their own representation');
        menu.append(
            surface,
            mkBtn('◀', 'Turn left (yaw −)', rot('yaw', -ROT_STEP)),
            mkBtn('▶', 'Turn right (yaw +)', rot('yaw', ROT_STEP)),
            mkBtn('▲', 'Tilt up (pitch −)', rot('pitch', -ROT_STEP)),
            mkBtn('▼', 'Tilt down (pitch +)', rot('pitch', ROT_STEP)),
            mkBtn('⟲', 'Roll left', rot('roll', -ROT_STEP)),
            mkBtn('⟳', 'Roll right', rot('roll', ROT_STEP)),
            mkBtn('╌', 'Thinner cortex outline', outlineAdj('widthMul', 1 / 1.18)),
            mkBtn('━', 'Thicker cortex outline', outlineAdj('widthMul', 1.18)),
            mkBtn('░', 'Fewer cortex lines (sparser folds)', outlineAdj('thresholdMul', 1.25)),
            mkBtn('▓', 'More cortex lines (denser folds)', outlineAdj('thresholdMul', 1 / 1.25)),
            mkBtn('⤒', 'Bring to front', () => bringToFront(panel)),
            mkBtn('✕', 'Remove panel', () => removePanel(idx)));
        head.append(view, sliceBtn, menuBtn);

        // Slice handles (shown only when this panel has a slice): anchor = move the cut
        // (in-plane; SHIFT = depth along the view), size = radius/extent.
        const anchorH = el('div', 'fc-slice-handle');
        const sizeH = el('div', 'fc-slice-handle fc-slice-size');
        const gizmo = makeRotationGizmo(panel, view);
        // Chrome (header, menu, resize, rotate, slice handles) lives INSIDE the body so moving among
        // them never fires the body's mouseleave (no hover flicker). Chrome is hidden until the panel
        // is hovered/edited — see the .hover/.fc-editing CSS.
        body.append(head, menu, resize, gizmo.el, anchorH, sizeH);
        f.append(body);
        container.appendChild(f);
        body.addEventListener('mouseenter', () => f.classList.add('hover'));
        body.addEventListener('mouseleave', () => { f.classList.remove('hover'); menu.classList.remove('open'); });

        attachTip(body, 'Drag to move · Shift-drag for free orbit · coloured MNI gizmo for precise rotation');
        attachTip(resize, 'Drag to resize this panel');
        attachTip(anchorH, 'Drag to move the cut · Shift-drag for depth');
        attachTip(sizeH, 'Drag to resize the cut');
        dragMove(head, panel);        // drag the header bar to move
        dragBody(body, panel);        // drag the brain to move; SHIFT+drag to orbit
        dragResize(resize, panel);
        dragSlice(anchorH, panel, 'anchor');
        dragSlice(sizeH, panel, 'size');
        if (panel.id === activeId) f.classList.add('fc-active');   // survive rebuilds (refresh recreates frames)
        return { el: f, panel, anchorH, sizeH, gizmo };
    }

    // Bottom-right world/MNI rotation widget. The coloured axes are projected through the live
    // camera basis, so the little triad turns with the brain. Drag any endpoint to rotate only about
    // that fixed world axis; click it to snap the camera to that ±orthogonal direction.
    function makeRotationGizmo(panel, viewSelect) {
        const root = el('div', 'fc-gizmo');
        root.setAttribute('role', 'group');
        root.setAttribute('aria-label', 'MNI axis rotation: X red, Y green, Z blue');
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 76 76'); svg.setAttribute('aria-hidden', 'true');
        const records = {};

        const snapAxis = (axis, sign) => {
            const hemi = panel.content?.hemisphere || 'both';
            panel.camera = { plane: snapPlaneForAxis(axis, sign, hemi) };
            panel.rotate = null; panel.view = null;
            panel.title = `MNI ${sign > 0 ? '+' : '−'}${axis.toUpperCase()}`;
            viewSelect.value = panelViewName(panel);
        };
        const adjustAxis = (axis, delta) => {
            panel.rotate = rotateAroundWorldAxis(panel.rotate, axis, delta);
        };

        for (const [axis, info] of Object.entries(WORLD_AXES)) {
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', '38'); line.setAttribute('y1', '38');
            line.setAttribute('stroke', info.color); line.setAttribute('stroke-width', '2.6');
            line.setAttribute('stroke-linecap', 'round'); svg.append(line);
            const ends = {};
            for (const sign of [-1, 1]) {
                const b = el('button', `fc-gizmo-axis fc-axis-${axis}`,
                    sign > 0 ? axis.toUpperCase() : '');
                b.type = 'button'; b.dataset.axis = axis; b.dataset.sign = String(sign);
                b.setAttribute('aria-label', `${sign > 0 ? 'Positive' : 'Negative'} MNI ${axis.toUpperCase()} axis: drag to rotate, press to snap view`);
                b.setAttribute('aria-keyshortcuts', 'ArrowLeft ArrowRight ArrowUp ArrowDown Enter Space');
                b.style.setProperty('--axis-color', info.color);
                attachTip(b, `${axis.toUpperCase()} axis (${axis === 'x' ? 'left–right' : axis === 'y' ? 'posterior–anterior' : 'inferior–superior'}): drag to rotate · click to snap ${sign > 0 ? '+' : '−'}${axis.toUpperCase()}`);
                b.addEventListener('pointerdown', (e) => {
                    if (e.button !== 0) return;
                    e.preventDefault(); e.stopPropagation(); hideTip();
                    b.setPointerCapture(e.pointerId);
                    const fr = b.closest('.fc-frame');
                    const rec = frames.find((r) => r.el === fr);
                    if (rec) setActive(rec.panel.id);
                    if (fr) fr.classList.add('fc-editing');
                    const x0 = e.clientX, y0 = e.clientY;
                    const start = { ...(panel.rotate || {}) };
                    let moved = false;
                    const move = (ev) => {
                        const dx = ev.clientX - x0, dy = ev.clientY - y0;
                        if (!moved && Math.hypot(dx, dy) < 3) return;
                        if (!moved) { moved = true; pushHistory(); }
                        getEngine().setSpinFit?.(true);
                        panel.rotate = rotateAroundWorldAxis(start, axis,
                            (dx - dy) * GIZMO_SENS * sign);
                    };
                    const up = () => {
                        if (!moved) { pushHistory(); snapAxis(axis, sign); }
                        if (fr) fr.classList.remove('fc-editing');
                        getEngine().setSpinFit?.(false);
                        b.removeEventListener('pointermove', move);
                        b.removeEventListener('pointerup', up);
                        b.removeEventListener('pointercancel', up);
                    };
                    b.addEventListener('pointermove', move);
                    b.addEventListener('pointerup', up);
                    b.addEventListener('pointercancel', up);
                });
                b.addEventListener('keydown', (e) => {
                    if (['Enter', ' '].includes(e.key)) {
                        e.preventDefault(); pushHistory(); snapAxis(axis, sign); return;
                    }
                    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
                    e.preventDefault(); pushHistory();
                    const direction = ['ArrowRight', 'ArrowUp'].includes(e.key) ? 1 : -1;
                    adjustAxis(axis, direction * (e.shiftKey ? ROT_STEP : GIZMO_KEY_STEP));
                });
                root.append(b); ends[sign] = b;
            }
            records[axis] = { line, ends };
        }
        root.prepend(svg);
        const orb = el('div', 'fc-gizmo-orb'); orb.setAttribute('aria-hidden', 'true'); root.append(orb);
        const readout = el('div', 'fc-gizmo-readout'); root.append(readout);
        return { el: root, records, readout };
    }

    function updateRotationGizmo(fr) {
        const g = fr.gizmo, view = getEngine().getPanelView(fr.panel);
        if (!g || !view) return;
        const radius = 28, center = 38;
        for (const [axis, info] of Object.entries(WORLD_AXES)) {
            const rec = g.records[axis];
            for (const sign of [-1, 1]) {
                const v = info.vector.map((x) => x * sign);
                const x = center + radius * dot(v, view.r);
                const y = center - radius * dot(v, view.u);
                const depth = dot(v, view.f); // + points into scene; − points toward the viewer
                const b = rec.ends[sign];
                b.style.left = `${x - 8}px`; b.style.top = `${y - 8}px`;
                b.style.zIndex = depth < 0 ? '5' : '3';
                b.style.opacity = String(depth < 0 ? 1 : 0.58);
                b.style.transform = `scale(${depth < 0 ? 1.08 : 0.86})`;
                if (sign > 0) { rec.line.setAttribute('x2', String(x)); rec.line.setAttribute('y2', String(y)); }
            }
        }
        const r = fr.panel.rotate || {};
        g.readout.textContent = `MNI  X ${Math.round(r.worldX || 0)}°  Y ${Math.round(r.worldY || 0)}°  Z ${Math.round(r.worldZ || 0)}°`;
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
            const fr = handle.closest('.fc-frame');
            const rec = frames.find((r) => r.el === fr);
            if (rec) setActive(rec.panel.id);          // sticky-activate the panel being pressed
            if (fr) fr.classList.add('fc-editing');   // keep chrome shown during the drag
            const x0 = e.clientX, y0 = e.clientY, ctx = onStart(e);
            let moved = false;   // snapshot once, on the first actual move (a bare click adds no undo step)
            const move = (ev) => { if (!moved) { moved = true; pushHistory(); } onMove(ctx, ev.clientX - x0, ev.clientY - y0); };
            const up = () => {
                handle.style.cursor = '';
                if (fr) fr.classList.remove('fc-editing');
                getEngine().setSpinFit?.(false);   // back to tight per-view fit after any drag
                handle.removeEventListener('pointermove', move);
                handle.removeEventListener('pointerup', up);
            };
            handle.addEventListener('pointermove', move);
            handle.addEventListener('pointerup', up);
        });
    }
    function moveBy(panel, start, dx, dy) {
        // place fractions are of the DESIGN size; a screen drag dx = design dx × zoom, so
        // divide by the view zoom to keep the frame 1:1 under the cursor at any zoom.
        const v = getEngine().getView(), W = v.W0, H = v.H0, s = v.s || 1, pl = panel.place;
        pl.x = snapF(clamp(start.x + (dx / s) / W, -pl.w + 0.02, 1 - 0.02), W);
        pl.y = snapF(clamp(start.y + (dy / s) / H, -pl.h + 0.02, 1 - 0.02), H);
    }
    function dragMove(handle, panel) {
        startDrag(handle, () => ({ x: panel.place.x, y: panel.place.y }),
            (s, dx, dy) => moveBy(panel, s, dx, dy));
    }
    function dragResize(handle, panel) {
        startDrag(handle, () => ({ w: panel.place.w, h: panel.place.h }), (c, dx, dy) => {
            const v = getEngine().getView(), W = v.W0, H = v.H0, s = v.s || 1, pl = panel.place;
            pl.w = snapF(clamp(c.w + (dx / s) / W, MIN_FRAC, 1), W);
            pl.h = snapF(clamp(c.h + (dy / s) / H, MIN_FRAC, 1), H);
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
                getEngine().setSpinFit?.(true);   // constant-size sphere fit while orbiting (no bounce)
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
        const free = layout().mode === 'free';
        frames = free ? panels().map((p, i) => makeFrame(p, i)) : [];
        toolbar.style.display = free ? '' : 'none';
        if (free && !toolbar.isConnected) container.appendChild(toolbar);
        if (free && !gridOverlay.isConnected) container.appendChild(gridOverlay);
        updateGrid();
        reposition();
    }
    function reposition() {
        if (layout().mode !== 'free') return;
        // grid overlay tracks the canvas area (behind the frames)
        gridOverlay.style.left = '0px'; gridOverlay.style.top = '0px';
        gridOverlay.style.width = canvas.clientWidth + 'px'; gridOverlay.style.height = canvas.clientHeight + 'px';
        gridOverlay.style.backgroundSize = snapPx + 'px ' + snapPx + 'px';
        // Hug the rendered brain (content bbox), not the looser panel cell, so the frame fits tight.
        const rects = getEngine().getPanelContentRects();
        frames.forEach((fr, i) => {
            const r = rects[i]; if (!r) return;
            fr.el.style.left = r.cssLeft + 'px';
            fr.el.style.top = r.cssTop + 'px';
            fr.el.style.width = r.w + 'px';
            fr.el.style.height = r.h + 'px';
            // Stack frames by paint order (place.z); LIFT the hovered/editing one well above
            // the rest so its header/handles stay clickable even where panels overlap.
            const z = (fr.panel.place && fr.panel.place.z != null) ? fr.panel.place.z : i;
            const active = fr.el.classList.contains('fc-active');
            const lifted = fr.el.classList.contains('hover') || fr.el.classList.contains('fc-editing');
            // active (250) > hover/editing (200) > base (14+z); 250 stays below the toolbar (300).
            fr.el.style.zIndex = active ? 250 : (lifted ? 200 : (14 + z));
            updateSliceHandles(fr);
            updateRotationGizmo(fr);
        });
    }
    function destroy() {
        container.removeEventListener('pointerdown', onDeselectDown, true);
        window.removeEventListener('keydown', onKey);
        frames.forEach((fr) => fr.el.remove());
        frames = [];
        toolbar.remove();
        gridOverlay.remove();
        hideTip();
    }

    return { refresh, reposition, destroy };
}
