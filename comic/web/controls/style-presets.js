/**
 * style-presets.js — save/load a STYLE preset: the per-overlay colour + params AND the
 * global cortex/lighting/outline style, to the browser (localStorage) OR a small JSON
 * file. This is SEPARATE from figure.json (which is layout + style + render).
 *
 * Loading applies the preset to the currently on-screen overlays BY SEQUENCE: the i-th
 * file entry styles the i-th overlay; if the file has FEWER entries than on-screen
 * overlays, the extras get a random colormap; if it has MORE, the surplus is ignored.
 */
import { overlayStyle, setOverlayStyle, deepMerge } from '../core/config-schema.js';

const KEY = 'comic.stylePresets.v1';
// Global style fields a preset carries (everything in config.style EXCEPT the per-overlay
// `overlays` array, which is captured separately, and nothing layout-related).
const GLOBAL_KEYS = ['colormap', 'colormapMode', 'threshold', 'positiveOnly', 'gamma', 'margin',
    'cortexSurface', 'voxel', 'glass', 'anatomy', 'outline', 'lighting', 'tilt', 'shadows'];

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const clone = (x) => JSON.parse(JSON.stringify(x));

/** Flatten one overlay's resolved style into a preset entry (the setOverlayStyle patch shape). */
function captureOverlay(config, i) {
    const os = overlayStyle(config, i);
    return {
        colormap: os.colormap, colormapMode: os.colormapMode, threshold: os.threshold,
        positiveOnly: os.positiveOnly, gamma: os.gamma,
        voxel: {
            representation: os.representation, subcortexRepresentation: os.subcortexRepresentation,
            clusterMin: os.clusterMin, smoothing: os.smoothing,
            shininess: os.shininess, specular: os.specular, emissive: os.emissive,
            veil: clone(os.veil), edges: clone(os.edges),
        },
    };
}

/** Capture the current style as a preset object. */
export function captureStyle(config, nOverlays) {
    const s = config.style || {};
    const global = {};
    for (const k of GLOBAL_KEYS) if (s[k] !== undefined) global[k] = clone(s[k]);
    const overlays = [];
    for (let i = 0; i < nOverlays; i++) overlays.push(captureOverlay(config, i));
    return { version: 1, global, overlays };
}

/** A random colormap name not already in `used` (falls back to any once exhausted). */
export function randomColormapName(colormaps, used = new Set()) {
    const names = [...colormaps.keys()];
    if (!names.length) return null;
    const free = names.filter((n) => !used.has(n));
    const pool = free.length ? free : names;
    return pool[Math.floor(Math.random() * pool.length)];
}

/** Apply a preset to `config` (mutates it): global style + per-overlay by sequence. */
export function applyStyleToConfig(config, prefs, colormaps, nOverlays) {
    if (!prefs) return;
    const s = config.style;
    if (isObj(prefs.global)) {
        for (const k of GLOBAL_KEYS) {
            if (prefs.global[k] === undefined) continue;
            s[k] = (isObj(prefs.global[k]) && isObj(s[k])) ? deepMerge(s[k], prefs.global[k]) : clone(prefs.global[k]);
        }
    }
    const entries = Array.isArray(prefs.overlays) ? prefs.overlays : [];
    const used = new Set();
    for (let i = 0; i < nOverlays; i++) {
        if (i < entries.length) {
            setOverlayStyle(config, i, entries[i]);
            if (entries[i] && entries[i].colormap) used.add(entries[i].colormap);
        } else {
            const name = randomColormapName(colormaps, used);
            if (name) { setOverlayStyle(config, i, { colormap: name }); used.add(name); }
        }
    }
}

// --- localStorage CRUD ----------------------------------------------------
function readStore() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } }
function writeStore(obj) { try { localStorage.setItem(KEY, JSON.stringify(obj)); return true; } catch { return false; } }
export function listPresets() { return Object.keys(readStore()).sort(); }
export function savePreset(name, prefs) { const s = readStore(); s[name] = prefs; return writeStore(s); }
export function loadPreset(name) { return readStore()[name] || null; }
export function deletePreset(name) { const s = readStore(); delete s[name]; writeStore(s); }

/**
 * Wire a "Presets" button to a popup: name + Save, the saved list (apply / delete),
 * Export current to JSON, Import a JSON file. `onApplied` runs after any apply/import so
 * the caller can refresh the engine + controls; `download(text, name)` saves a file.
 */
export function createPresetsUI({ button, getConfig, getColormaps, getNOverlays, onApplied, download }) {
    if (!button) return;
    let pop = null;
    const label = button.textContent;
    const flash = (m) => { button.textContent = m; setTimeout(() => { button.textContent = label; }, 1400); };
    const apply = (prefs) => { applyStyleToConfig(getConfig(), prefs, getColormaps(), getNOverlays()); onApplied && onApplied(); };

    function onDoc(e) { if (!e.target.closest('.preset-pop, #c-presets')) close(); }
    function close() { if (pop) { pop.remove(); pop = null; } document.removeEventListener('click', onDoc, true); }
    function rebuildList(listEl) {
        listEl.innerHTML = '';
        const names = listPresets();
        if (!names.length) { const e = document.createElement('div'); e.className = 'preset-empty'; e.textContent = 'No saved presets'; listEl.appendChild(e); return; }
        for (const name of names) {
            const row = document.createElement('div'); row.className = 'preset-row';
            const apBtn = document.createElement('button'); apBtn.type = 'button'; apBtn.className = 'preset-apply'; apBtn.textContent = name; apBtn.title = 'Apply this preset';
            apBtn.addEventListener('click', () => { apply(loadPreset(name)); close(); });
            const del = document.createElement('button'); del.type = 'button'; del.className = 'preset-del'; del.textContent = '✕'; del.title = 'Delete';
            del.addEventListener('click', (e) => { e.stopPropagation(); deletePreset(name); rebuildList(listEl); });
            row.append(apBtn, del); listEl.appendChild(row);
        }
    }
    function open() {
        if (pop) { close(); return; }
        pop = document.createElement('div'); pop.className = 'preset-pop';
        // Save current as named preset
        const saveRow = document.createElement('div'); saveRow.className = 'preset-saverow';
        const nameIn = document.createElement('input'); nameIn.type = 'text'; nameIn.placeholder = 'preset name'; nameIn.className = 'preset-name';
        const saveBtn = document.createElement('button'); saveBtn.type = 'button'; saveBtn.className = 'btn'; saveBtn.textContent = 'Save';
        const doSave = () => {
            const nm = (nameIn.value || '').trim(); if (!nm) { nameIn.focus(); return; }
            const ok = savePreset(nm, captureStyle(getConfig(), getNOverlays()));
            flash && flash(ok ? 'Saved preset' : 'Save failed (storage off)');
            nameIn.value = ''; rebuildList(listEl);
        };
        saveBtn.addEventListener('click', doSave);
        nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSave(); });
        saveRow.append(nameIn, saveBtn);

        const listEl = document.createElement('div'); listEl.className = 'preset-list';
        rebuildList(listEl);

        // Export / Import a JSON file
        const fileRow = document.createElement('div'); fileRow.className = 'preset-filerow';
        const exp = document.createElement('button'); exp.type = 'button'; exp.className = 'btn'; exp.textContent = 'Export';
        exp.addEventListener('click', () => download(JSON.stringify(captureStyle(getConfig(), getNOverlays()), null, 2), 'comic-style.json'));
        const impLbl = document.createElement('label'); impLbl.className = 'btn'; impLbl.textContent = 'Import';
        const imp = document.createElement('input'); imp.type = 'file'; imp.accept = '.json,application/json'; imp.style.display = 'none';
        imp.addEventListener('change', async (e) => {
            const f = e.target.files[0]; e.target.value = '';
            if (!f) return;
            try { apply(JSON.parse(await f.text())); flash && flash('Preset loaded'); close(); }
            catch { flash && flash('Bad preset file'); }
        });
        impLbl.appendChild(imp); fileRow.append(exp, impLbl);

        pop.append(saveRow, listEl, fileRow);
        document.body.appendChild(pop);
        const r = button.getBoundingClientRect();
        pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth - 8)) + 'px';
        const above = r.top - pop.offsetHeight - 6;
        pop.style.top = (above >= 0 ? above : r.bottom + 6) + 'px';
        setTimeout(() => document.addEventListener('click', onDoc, true), 0);
    }
    button.addEventListener('click', (e) => { e.stopPropagation(); open(); });
}
