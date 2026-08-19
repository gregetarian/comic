/**
 * bind.js — UI controls, static/in-browser variant.
 *
 * Forked from the server app's bind.js. Two differences:
 *  - Split into bindGlobalControls() (the static surface/light row, bound ONCE) and
 *    buildOverlayRows() (rebuilt on every overlay add/remove). The engine is recreated
 *    on each rebuild, so global handlers reach it through getEngine().
 *  - No server: upload / remove / layout-change call back into app.js (which runs the
 *    Pyodide pipeline and rebuilds the engine in-place) instead of POSTing + reloading.
 */
import { resolveColormap } from '../core/colormap.js?v=edge-v1';
import { overlayStyle, setOverlayStyle } from '../core/config-schema.js?v=depth-lines-v1';
import { createCmapPicker } from './cmap-picker.js?v=edge-v1';
import { PRESET_LABELS } from '../core/presets.js?v=edge-v1';
import { loadSavedLayouts, saveLayout, deleteLayout } from './layout-presets.js?v=edge-v1';

const $ = (id) => document.getElementById(id);
const trimNum = (v) => { const n = parseFloat(v); return Number.isInteger(n) ? String(n) : String(Math.round(n * 1e4) / 1e4); };

// --- clickable info popovers: one shared box; click an anchor to toggle, click away to close.
// Each parameter's label (above its slider) is clickable; toggles/selects get a small ⓘ. ---
let _pop = null, _popFor = null;
function _popover() {
    if (_pop) return _pop;
    _pop = document.createElement('div');
    _pop.className = 'info-pop';
    document.body.appendChild(_pop);
    document.addEventListener('click', (e) => { if (!e.target.closest('.has-info, .info')) hideInfo(); }, true);
    window.addEventListener('resize', hideInfo);
    return _pop;
}
function hideInfo() { if (_pop) _pop.classList.remove('show'); _popFor = null; }
function showInfo(anchor, text) {
    const pop = _popover();
    if (_popFor === anchor) { hideInfo(); return; }            // click again to dismiss
    pop.textContent = text; pop.classList.add('show'); _popFor = anchor;
    const r = anchor.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth - 8)) + 'px';
    // prefer above (controls live in the bottom bar); fall back to below if no room
    pop.style.top = (r.top - pop.offsetHeight - 6 >= 0 ? r.top - pop.offsetHeight - 6 : r.bottom + 6) + 'px';
}
/** Make a slider's label (the span above it, in .sw) a clickable info trigger. */
function infoLabel(rangeEl, tip) {
    if (!rangeEl || !tip) return;
    const label = rangeEl.closest('.sw')?.querySelector('span');
    if (!label) return;
    label.classList.add('has-info'); label.title = tip;
    label.addEventListener('click', (e) => { e.stopPropagation(); showInfo(label, tip); });
}
/** A small ⓘ button after a toggle/select that pops its info. */
function infoIcon(afterEl, tip) {
    if (!afterEl || !tip) return;
    const b = document.createElement('button');
    b.className = 'info'; b.type = 'button'; b.textContent = 'i'; b.title = tip; b.setAttribute('aria-label', 'info');
    b.addEventListener('click', (e) => { e.stopPropagation(); showInfo(b, tip); });
    afterEl.insertAdjacentElement('afterend', b);
}

const TIPS = {
    'c-inflate': 'Inflated cortical surface vs the folded pial surface.',
    'c-outline': 'Toggle the black cortical-surface outline.',
    'c-cortex': 'Cortex glass opacity. 0 = invisible (only the outline shows).',
    'c-outline-thresh': 'Surface-line density — higher hides shallower folds (fewer lines).',
    'c-outline-width': 'Surface (cortex outline) line thickness.',
    'c-outline-overvox': 'Cortex line strength where it crosses a voxel: 0 = hidden under the blob, 1 = full black on top, in between = a greyed line blended with the blob.',
    'c-directional': 'Directional (headlight) intensity — global.',
    'c-ambient': 'Ambient light intensity — global.',
    'c-line-color': 'Colour of the cortical fold (sulcal/gyral) lines.',
    'c-line-anat-color': 'Colour of the subcortical structure lines. Defaults to the cortex line colour.',
    'c-sil-color': "Colour of the cortex and subcortex outer contours. Setting it splits both anatomical contours from their fold lines; statistical blobs never become the silhouette.",
    'c-sil-width': 'Thickness of the separate cortex and subcortex outer contours, independent of the fold lines.',
    'c-parc': 'Draw atlas parcel boundaries on the cortical surface.',
    'c-parc-mask': "Hide surface vertices the atlas calls non-cortex (the medial wall), so a map carrying values there doesn't paint it. Needs an atlas loaded.",
    'c-parc-color': 'Colour of the parcel boundary lines.',
    'c-parc-width': 'Parcel boundary thickness, in screen pixels — constant at any zoom.',
};

function bindRange(el, value, oninput, { min, max, step } = {}, tip, propagate) {
    if (!el) return;
    if (min != null) el.min = min;
    if (max != null) el.max = max;
    if (step != null) el.step = step;
    el.value = value;
    if (tip) el.title = tip;
    const box = document.createElement('input');
    box.type = 'number'; box.className = 'numbox';
    if (min != null) box.min = min;
    if (max != null) box.max = max;
    if (step != null) box.step = step;
    if (tip) box.title = tip;
    box.value = trimNum(value);
    el.insertAdjacentElement('afterend', box);
    el.addEventListener('input', () => { box.value = trimNum(el.value); oninput(parseFloat(el.value)); });
    box.addEventListener('input', () => { const v = parseFloat(box.value); if (!isFinite(v)) return; el.value = v; oninput(parseFloat(el.value)); });
    infoLabel(el, tip);                              // clickable ⓘ on the label above the slider
    if (propagate) {                                 // "⇶": copy THIS value to every loaded volume
        const all = document.createElement('button');
        all.type = 'button'; all.className = 'btn propagate'; all.textContent = '⇶';
        all.title = 'Apply this value to every loaded volume';
        all.addEventListener('click', () => propagate(parseFloat(el.value)));
        box.insertAdjacentElement('afterend', all);
    }
}
function bindToggle(el, active, onchange, tip) {
    if (!el) return;
    // defer the ⓘ so it's inserted after the button is appended to the DOM (per-overlay
    // toggles are bound before append; globals are already in the DOM — both work).
    if (tip) { el.title = tip; queueMicrotask(() => infoIcon(el, tip)); }
    el.classList.toggle('active', !!active);
    el.addEventListener('click', () => { el.classList.toggle('active'); onchange(el.classList.contains('active')); });
}
/** A colour swatch inside a .sw wrapper — same clickable-label help as a slider. */
function bindColor(el, value, oninput, tip) {
    if (!el) return;
    el.value = value || '#000000';
    if (tip) el.title = tip;
    el.addEventListener('input', () => oninput(el.value));
    infoLabel(el, tip);        // infoLabel only needs el.closest('.sw') and its first <span>
}
const slider = (id, value, oninput, opts) => bindRange($(id), value, oninput, opts, TIPS[id]);
const toggle = (id, active, onchange) => bindToggle($(id), active, onchange, TIPS[id]);
const color = (id, value, oninput) => bindColor($(id), value, oninput, TIPS[id]);

function sw(labelText) {
    const wrap = document.createElement('div'); wrap.className = 'sw';
    const span = document.createElement('span'); span.textContent = labelText;
    const range = document.createElement('input'); range.type = 'range';
    wrap.append(span, range);
    return { wrap, range };
}
const btn = (text) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn'; b.textContent = text; return b; };

/** Build one control row per overlay. Re-callable: clears + rebuilds on each engine rebuild. */
export function buildOverlayRows({ engine, config, colormaps, onRemove, onSurface, onReorder }) {
    const host = $('overlay-rows'); if (!host) return;
    host.innerHTML = '';
    const overlays = engine.overlays || [];
    const multi = overlays.length > 1;
    // Copy ONE parameter's value onto every loaded volume, then refresh all rows (no confirm).
    const propagateAll = (patch) => {
        for (let k = 0; k < overlays.length; k++) setOverlayStyle(config, k, patch);
        engine.applyStyle(); engine.recolor(); engine.applySmoothing();
        buildOverlayRows({ engine, config, colormaps, onRemove, onSurface, onReorder });
    };
    // A per-overlay slider that (with >1 volume) shows a "⇶" to propagate its value to all.
    const ovRange = (el, val, oninput, opts, tip, patch) =>
        bindRange(el, val, oninput, opts, tip, multi && patch ? (v) => propagateAll(patch(v)) : null);
    overlays.forEach((ov, i) => {
        const os = overlayStyle(config, i);
        const maxAbs = ov.maxAbsValue ?? 1.0;
        let maxClu = ov.maxClusterSize ?? 0;
        if (!maxClu) {
            for (const t of (engine.sceneModel.meshes || [])) {
                if (t.meta.role === 'voxel' && (t.meta.overlay ?? 0) === i) {
                    const a = t.mesh.geometry.getAttribute('aClusterSize');
                    if (a) for (let k = 0; k < a.array.length; k++) { const v = a.array[k]; if (v < 1e8 && v > maxClu) maxClu = v; }
                }
            }
        }
        maxClu = Math.max(maxClu, 1);
        const set = (patch) => setOverlayStyle(config, i, patch);

        const row = document.createElement('div'); row.className = 'row overlay-row';
        const gName = document.createElement('div'); gName.className = 'grp';
        const nm = document.createElement('span'); nm.className = 'lab ov-name';
        nm.textContent = ov.name || ('NIfTI ' + (i + 1));
        nm.title = ov.name || '';
        // Show/hide this volume (toggles config.style.overlays[i].hidden; the renderer's
        // visibility gate skips a hidden overlay's voxels live — no rebuild needed).
        const eye = btn('👁'); eye.classList.add('eye');
        const hidden0 = !!(config.style.overlays && config.style.overlays[i] && config.style.overlays[i].hidden);
        eye.classList.toggle('off', hidden0); eye.title = hidden0 ? 'Show this volume' : 'Hide this volume';
        eye.addEventListener('click', () => {
            const h = !eye.classList.contains('off');
            set({ hidden: h }); eye.classList.toggle('off', h); eye.title = h ? 'Show this volume' : 'Hide this volume';
        });
        const rm = document.createElement('button'); rm.className = 'btn rm'; rm.textContent = '✕';
        rm.title = 'Remove this overlay';
        rm.addEventListener('click', () => onRemove(i));
        gName.append(nm, eye, rm); row.append(gName);

        // Drag the name to reorder overlays (later overlays composite over earlier). Only the name
        // is a drag handle, so the row's sliders/selects stay usable. rebuild() re-indexes by position.
        if (onReorder && overlays.length > 1) {
            nm.draggable = true; nm.style.cursor = 'grab'; nm.title = (ov.name || '') + ' — drag to reorder';
            nm.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', String(i)); e.dataTransfer.effectAllowed = 'move';
                row.classList.add('dragging');
            });
            nm.addEventListener('dragend', () => row.classList.remove('dragging'));
            row.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; row.classList.add('drop-target'); });
            row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
            row.addEventListener('drop', (e) => {
                e.preventDefault(); row.classList.remove('drop-target');
                const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
                if (!Number.isNaN(from)) onReorder(from, i);
            });
        }

        const g = document.createElement('div'); g.className = 'grp';

        // Colormap picker with swatch previews: trigger (name + gradient), a popup of all
        // ~150 maps each with a swatch, and ‹ › steppers (live preview). Same apply path.
        const picker = createCmapPicker({
            colormaps,
            value: resolveColormap(os, !!ov.diverging, colormaps).name,
            onChange: (name) => { set({ colormap: name }); engine.recolor(); },
        });
        g.append(picker.el);
        infoIcon(picker.el, 'Colormap for this overlay — click for swatches, or step with ‹ ›. Each overlay can use a different one; sequential vs diverging is auto-picked from the data.');

        // Colour-scale mode (M11 parity: was CLI/notebook-only). Recolour only, no re-mesh.
        const modeSel = document.createElement('select'); modeSel.className = 'btn';
        for (const m of ['auto', 'sequential', 'diverging']) {
            const o = document.createElement('option'); o.value = m; o.textContent = m; modeSel.append(o);
        }
        modeSel.value = os.colormapMode || 'auto';
        modeSel.addEventListener('change', () => { set({ colormapMode: modeSel.value }); engine.recolor(); });
        g.append(modeSel);
        infoIcon(modeSel, 'Colour scale: auto (sequential/diverging picked from the data), or force one.');

        // Voxel representation: blocky / smooth / surface (M8 — surface projects onto the cortex,
        // keeping the cel-shaded glass look; chosen lazily re-meshes via onSurface). A NATIVE surface
        // overlay (per-vertex data) has no volumetric geometry, so it shows a fixed 'surface' tag and
        // the blocky/smooth options are withheld entirely.
        if (ov.surfaceOnly) {
            const tag = document.createElement('span'); tag.className = 'lab'; tag.textContent = 'surface';
            g.append(tag);
            infoIcon(tag, 'Surface (per-vertex) overlay — always drawn on the cortical surface; blocky/smooth volumetric modes do not apply.');
        } else {
            const repSel = document.createElement('select'); repSel.className = 'btn';
            for (const r of ['blocky', 'smooth', 'surface']) {
                const o = document.createElement('option'); o.value = r; o.textContent = r; repSel.append(o);
            }
            repSel.value = os.representation || 'smooth';
            const subcortWrap = document.createElement('span'); subcortWrap.className = 'surface-subcort-control';
            const subcortSel = document.createElement('select'); subcortSel.className = 'btn';
            for (const r of ['smooth', 'blocky']) {
                const o = document.createElement('option'); o.value = r; o.textContent = `subcort: ${r}`; subcortSel.append(o);
            }
            subcortSel.value = os.subcortexRepresentation || 'blocky';
            subcortWrap.hidden = repSel.value !== 'surface';
            subcortSel.addEventListener('change', () => {
                set({ voxel: { subcortexRepresentation: subcortSel.value } });
                engine.applyStyle(); engine.recolor();
            });
            subcortWrap.append(subcortSel);
            repSel.addEventListener('change', async () => {
                subcortWrap.hidden = repSel.value !== 'surface';
                if (repSel.value === 'surface') {
                    if (onSurface) await onSurface(i, repSel);
                    else repSel.value = 'smooth';
                    subcortWrap.hidden = repSel.value !== 'surface';
                } else { set({ voxel: { representation: repSel.value } }); engine.applyStyle(); engine.recolor(); }
            });
            g.append(repSel, subcortWrap);
            infoIcon(repSel, 'Voxel representation: blocky, smooth (marching cubes), or surface (project onto the cortex — keeps the glass-brain look).');
            infoIcon(subcortSel, 'Subcortical voxels cannot project onto the cortical surface. Show their original blocky voxel shape (default), or use a smooth volume.');
        }

        const thr = sw('thr');
        ovRange(thr.range, os.threshold ?? ov.threshold ?? 0, (v) => { set({ threshold: v }); engine.applyStyle(); }, { min: 0, max: maxAbs, step: maxAbs / 200 }, 'Statistical threshold — hide |value| below this.', (v) => ({ threshold: v }));
        g.append(thr.wrap);

        const clu = sw('cluster k');
        ovRange(clu.range, os.clusterMin ?? 0, (v) => { set({ voxel: { clusterMin: v } }); engine.applyStyle(); }, { min: 0, max: maxClu, step: 1 }, 'Cluster-extent threshold — hide clusters < N voxels.', (v) => ({ voxel: { clusterMin: v } }));
        g.append(clu.wrap);

        const gam = sw('gamma');
        ovRange(gam.range, os.gamma ?? 0.5, (v) => { set({ gamma: v }); engine.recolor(); },
                { min: 0.2, max: 1.5, step: 0.05 },
                'Colormap gamma (power-law) — <1 lifts low values (0.5 = sqrt).', (v) => ({ gamma: v }));
        g.append(gam.wrap);

        // Colour limits: explicit V min / V max (the scale's lower & upper bounds — vmin maps to the
        // bottom of the colormap, vmax to the top). Recolour only. Defaults to the data-derived range.
        const liveClim = () => { const c = overlayStyle(config, i).clim; return Array.isArray(c) ? c : null; };
        const dLo = ov.diverging ? -maxAbs : 0, dHi = maxAbs;
        const setClim = (lo, hi) => { set({ clim: [lo, hi] }); engine.recolor(); engine.applyStyle(); };
        const rng = { min: -maxAbs * 2, max: maxAbs * 2, step: Math.max(maxAbs / 100, 0.01) };
        const vmn = sw('vmin');
        ovRange(vmn.range, (liveClim() || [dLo, dHi])[0], (v) => setClim(v, (liveClim() || [dLo, dHi])[1]),
                rng, 'Colour-scale minimum — maps to the bottom of the colormap.');
        g.append(vmn.wrap);
        const vmx = sw('vmax');
        ovRange(vmx.range, (liveClim() || [dLo, dHi])[1], (v) => setClim((liveClim() || [dLo, dHi])[0], v),
                rng, 'Colour-scale maximum — maps to the top of the colormap.');
        g.append(vmx.wrap);

        const pos = btn('+only');
        bindToggle(pos, !!os.positiveOnly, (on) => { set({ positiveOnly: on }); engine.applyStyle(); }, 'Show only positive values.');
        g.append(pos);

        const edges = btn('Edges');
        bindToggle(edges, os.edges.enabled !== false, (on) => set({ voxel: { edges: { enabled: on } } }), 'Blob edge outlines.');
        g.append(edges);
        const edgeMode = document.createElement('select'); edgeMode.className = 'btn edge-mode';
        for (const [value, label] of [['outer', 'edge: outer'], ['full', 'edge: full']]) {
            const o = document.createElement('option'); o.value = value; o.textContent = label; edgeMode.append(o);
        }
        edgeMode.value = os.edges.mode || (os.representation === 'smooth' ? 'outer' : 'full');
        edgeMode.addEventListener('change', () => {
            set({ voxel: { edges: { mode: edgeMode.value } } });
            engine.applyStyle();
        });
        g.append(edgeMode);
        infoIcon(edgeMode, 'Edge geometry: outer draws only the visible blob silhouette; full also draws internal depth discontinuities. Smooth defaults to outer, blocky defaults to full.');

        const balpha = sw('blob \u03b1');
        ovRange(balpha.range, os.opacity ?? 1, (v) => { set({ voxel: { opacity: v } }); engine.applyStyle(); }, { min: 0.05, max: 1, step: 0.05 }, 'Blob translucency. Below 1 you can see through the blobs, at the cost of exact front/back sorting where they overlap.', (v) => ({ voxel: { opacity: v } }));
        g.append(balpha.wrap);

        const ea = sw('edge \u03b1');
        ovRange(ea.range, os.edges.opacity ?? 1, (v) => { set({ voxel: { edges: { opacity: v } } }); engine.applyStyle(); }, { min: 0, max: 1, step: 0.05 }, 'Blob outline (edge line) opacity.', (v) => ({ voxel: { edges: { opacity: v } } }));
        g.append(ea.wrap);

        const ew = sw('edge w');
        ovRange(ew.range, os.edges.width, (v) => { set({ voxel: { edges: { width: v } } }); engine.applyStyle(); }, { min: 0.3, max: 3, step: 0.1 }, 'Voxel edge thickness.', (v) => ({ voxel: { edges: { width: v } } }));
        g.append(ew.wrap);

        const depthCut = sw('depth cut');
        ovRange(depthCut.range, os.depthCut ?? 0, (v) => { set({ voxel: { depthCut: v } }); engine.applyStyle(); },
                { min: 0, max: 0.98, step: 0.02 },
                'Viewer-relative depth gate. 0 shows the full anatomical depth; higher values keep only overlay fragments nearest the viewer (for example, dorsal cortex while suppressing thalamus).',
                (v) => ({ voxel: { depthCut: v } }));
        g.append(depthCut.wrap);

        const veil = sw('veil');
        ovRange(veil.range, os.veil.strength, (v) => { set({ voxel: { veil: { strength: v } } }); engine.applyStyle(); }, { min: 0, max: 1, step: 0.02 }, 'Depth colour veil — fades deeper voxels toward white without hiding them.', (v) => ({ voxel: { veil: { strength: v } } }));
        g.append(veil.wrap);

        const veilk = sw('veil log');
        ovRange(veilk.range, os.veil.k, (v) => { set({ voxel: { veil: { k: v } } }); engine.applyStyle(); }, { min: 0.1, max: 20, step: 0.1 }, 'Colour-veil depth curve (log steepness).', (v) => ({ voxel: { veil: { k: v } } }));
        g.append(veilk.wrap);

        const em = sw('emissive');
        ovRange(em.range, os.emissive, (v) => { set({ voxel: { emissive: v } }); engine.applyStyle(); }, { min: 0, max: 1, step: 0.02 }, 'Flat colormap-colour brightness.', (v) => ({ voxel: { emissive: v } }));
        g.append(em.wrap);

        const sp = sw('specular');
        ovRange(sp.range, os.specular, (v) => { set({ voxel: { specular: v } }); engine.applyStyle(); }, { min: 0, max: 0.6, step: 0.01 }, 'Glossiness — specular glint amount.', (v) => ({ voxel: { specular: v } }));
        g.append(sp.wrap);

        const sh = sw('shine');
        ovRange(sh.range, os.shininess, (v) => { set({ voxel: { shininess: v } }); engine.applyStyle(); }, { min: 1, max: 200, step: 1 }, 'Highlight tightness.', (v) => ({ voxel: { shininess: v } }));
        g.append(sh.wrap);

        row.append(g); host.append(row);
    });
}

/** Bind the static global surface/light row + upload + layout. Called ONCE; reaches
 *  the live engine through getEngine() since the engine is recreated on rebuild. */
/** The Layout picker: built-in presets + this browser's saved layouts + save/delete actions.
 *  Selecting a built-in calls onPreset(name); a saved one calls onPreset(layoutObject);
 *  Save/Delete edit localStorage and repopulate. `current` is restored after an action so the
 *  dropdown never sticks on "Save…". */
function setupLayoutPicker(lay, config, preset, onPreset) {
    let current = preset || 'freeDefault';
    const opt = (value, label) => { const o = document.createElement('option'); o.value = value; o.textContent = label; return o; };
    const group = (label) => { const g = document.createElement('optgroup'); g.label = label; return g; };

    function populate() {
        lay.innerHTML = '';
        const builtin = group('Built-in');
        for (const [name, label] of PRESET_LABELS) builtin.append(opt(name, label));
        lay.append(builtin);
        const saved = loadSavedLayouts();
        const names = Object.keys(saved);
        if (names.length) {
            const g = group('Saved (this browser)');
            for (const n of names) g.append(opt('saved:' + n, n));
            lay.append(g);
        }
        const actions = group('—');
        actions.append(opt('__save__', '💾 Save current layout…'));
        if (names.length) actions.append(opt('__delete__', '🗑 Delete a saved layout…'));
        lay.append(actions);
        lay.value = current;
    }

    lay.addEventListener('change', () => {
        const v = lay.value;
        if (v === '__save__') {
            const name = (prompt('Save the current layout as:') || '').trim();
            if (name) { saveLayout(name, config.layout); current = 'saved:' + name; }
            populate();
        } else if (v === '__delete__') {
            const saved = loadSavedLayouts();
            const name = (prompt('Delete which saved layout?\n\n' + Object.keys(saved).join('\n')) || '').trim();
            if (name && saved[name]) { deleteLayout(name); if (current === 'saved:' + name) current = 'freeDefault'; }
            populate();
        } else if (v.startsWith('saved:')) {
            const saved = loadSavedLayouts();
            const layout = saved[v.slice(6)];
            if (layout) { current = v; onPreset(layout); } else populate();
        } else {
            current = v; onPreset(v);
        }
    });
    populate();
}

export function bindGlobalControls({ config, colormaps, getEngine, preset, onUpload, onPreset, onParcellation }) {
    const s = config.style;
    const apply = () => getEngine().applyStyle();

    const lay = $('c-layout');
    if (lay) setupLayoutPicker(lay, config, preset, onPreset);

    toggle('c-inflate', s.cortexSurface === 'inflated', (on) => { s.cortexSurface = on ? 'inflated' : 'pial'; });
    toggle('c-outline', s.outline.enabled, (on) => { s.outline.enabled = on; });
    slider('c-cortex', s.glass.maxOpacity, (v) => { s.glass.maxOpacity = v; apply(); }, { min: 0, max: 2.0, step: 0.01 });
    color('c-brain-color', s.glass.color ?? '#ffffff', (hex) => {
        s.glass.color = hex;
        s.anatomy.color = hex;
        s.anatomy.opaqueColor = hex;
        apply();
    });
    slider('c-outline-thresh', s.outline.threshold, (v) => { s.outline.threshold = v; apply(); }, { min: 0.001, max: 0.02, step: 0.0005 });
    slider('c-outline-width', s.outline.width, (v) => { s.outline.width = v; apply(); }, { min: 0.3, max: 8, step: 0.1 });
    slider('c-outline-overvox', s.outline.overVoxelOpacity ?? 1, (v) => { s.outline.overVoxels = true; s.outline.overVoxelOpacity = v; apply(); }, { min: 0, max: 1, step: 0.05 });
    const lineMode = $('c-voxel-line-mode');
    if (lineMode) {
        lineMode.value = s.outline.voxelLineMode || 'alpha';
        lineMode.addEventListener('change', () => {
            s.outline.voxelLineMode = lineMode.value;
            apply();
        });
    }
    slider('c-directional', s.lighting.directional, (v) => { s.lighting.directional = v; apply(); }, { min: 0, max: 4, step: 0.05 });
    slider('c-ambient', s.lighting.ambient, (v) => { s.lighting.ambient = v; apply(); }, { min: 0, max: 4, step: 0.05 });

    // --- line colours -----------------------------------------------------------------
    // Touching the silhouette colour or width splits each anatomical group's outer contour
    // from its fold lines (see style.outline.silhouette in config-schema). Until then both
    // values inherit and each group draws folds + contour in a single pass.
    const sil = (s.outline.silhouette ||= { enabled: true, color: null, width: null });
    color('c-line-color', s.outline.color, (hex) => { s.outline.color = hex; apply(); });
    color('c-line-anat-color', s.outline.anatomyColor ?? s.outline.color, (hex) => { s.outline.anatomyColor = hex; apply(); });
    color('c-sil-color', sil.color ?? s.outline.color, (hex) => { sil.color = hex; apply(); });
    slider('c-sil-width', sil.width ?? s.outline.width, (v) => { sil.width = v; apply(); }, { min: 0.3, max: 12, step: 0.1 });
    const silReset = $('c-sil-reset');
    if (silReset) silReset.addEventListener('click', () => {
        sil.color = null; sil.width = null; s.outline.anatomyColor = null;
        const c = $('c-sil-color'); if (c) c.value = s.outline.color;
        const a = $('c-line-anat-color'); if (a) a.value = s.outline.color;
        const w = $('c-sil-width');
        if (w) { w.value = s.outline.width; if (w.nextElementSibling) w.nextElementSibling.value = trimNum(s.outline.width); }
        apply();
    });

    // --- parcellation borders ---------------------------------------------------------
    // Colour/width are pure style (applyStyle pushes a uniform). Enabling, changing atlas, or
    // changing `smooth` needs the label field fetched and/or the distance field re-derived, so
    // those go back to main.js through onParcellation.
    const p = (s.parcellation ||= { enabled: false, atlas: null, color: '#1a1a1a', width: 2.0 });
    color('c-parc-color', p.color, (hex) => { p.color = hex; apply(); });
    slider('c-parc-width', p.width, (v) => { p.width = v; apply(); }, { min: 0.4, max: 8, step: 0.1 });
    toggle('c-parc', p.enabled, (on) => { onParcellation?.({ enabled: on }); });
    toggle('c-parc-mask', p.maskMedialWall, (on) => { p.maskMedialWall = on; onParcellation?.({ mask: true }); });
    const atlasSel = $('c-parc-atlas');
    if (atlasSel) atlasSel.addEventListener('change', () => onParcellation?.({ atlas: atlasSel.value }));

    const up = $('c-upload');
    if (up) up.addEventListener('change', (e) => {
        const files = [...e.target.files];
        e.target.value = '';
        if (files.length) onUpload(files);
    });
}
