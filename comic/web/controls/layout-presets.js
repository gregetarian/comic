/**
 * layout-presets.js — save/load CUSTOM layouts to the browser (localStorage).
 *
 * A saved layout is just the `config.layout` object (grid or free-canvas: panels,
 * cameras, content, place/rotate/slice, canvas). It is SEPARATE from the built-in
 * presets in core/presets.js (which ship with the app) and from a style preset
 * (colours/params, style-presets.js). Applying one swaps only config.layout.
 */

const KEY = 'comic.layoutPresets.v1';

const clone = (x) => JSON.parse(JSON.stringify(x));

/** All saved layouts as { name: layout }. Never throws (bad JSON → empty). */
export function loadSavedLayouts() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; }
    catch { return {}; }
}

/** Save (or overwrite) a named layout. Returns the updated map. */
export function saveLayout(name, layout) {
    const all = loadSavedLayouts();
    all[name] = clone(layout);
    localStorage.setItem(KEY, JSON.stringify(all));
    return all;
}

/** Delete a saved layout by name. Returns the updated map. */
export function deleteLayout(name) {
    const all = loadSavedLayouts();
    delete all[name];
    localStorage.setItem(KEY, JSON.stringify(all));
    return all;
}
