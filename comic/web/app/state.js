/**
 * state.js — the viewer's session flags + mode, in one place.
 *
 * A factory (not a module singleton) so a hypothetical second viewer instance in the
 * same page/process gets its own independent flags. main.js holds exactly one of these
 * (`const state = createSessionState()`), replacing the loose module-level flag `let`s.
 *
 * Scope note: this currently holds the boolean session flags + the current layout preset
 * — the mode/UI state that guards behaviour. The render-pipeline HANDLES (renderer,
 * colormaps, baseScene, config, engine, colorbar, overlays, …) deliberately stay
 * module-level in main.js for now: they're reassigned in hot paths (rebuild() recreates
 * engine/colorbar every add/remove) and their names collide with property accesses
 * (config.style.overlays, config.layout.canvas) and DOM ids, so folding them in safely
 * wants a browser round-trip. That migration is a separate, verifiable follow-up.
 */

/** Fresh session state with the app's boot defaults (matches the previous loose `let`s). */
export function createSessionState() {
    return {
        preset: undefined,       // current layout preset name (for the CLI-command export)
        isHeadless: false,       // ?headless=1: render-to-PNG mode (no controls, no ✕, sets __GB_DONE__)
        colorbarsVisible: false, // live colorbars OFF by default; the Colorbar button (or ✕) toggles them on
        demoLoaded: false,       // the Neurosynth Demo has loaded once (guards ?demo=1 + the Demo button vs stacking dupes)
        viewInitialized: false,  // the whole-canvas view has been fit-to-viewport once (then it's user-controlled)
        panelZoomUsed: false,    // the +/- buttons have no CLI equivalent; flag for the export note
    };
}
