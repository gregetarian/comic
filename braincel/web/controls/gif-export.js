/**
 * gif-export.js — render a spinning turntable GIF entirely client-side.
 *
 * Spins the camera (yaw added to every panel, like the headless `--orbit`), captures the canvas per
 * frame (the same renderFrame-then-drawImage trick Save brain uses — works without
 * preserveDrawingBuffer because the capture is synchronous), and encodes with the vendored gifenc.
 * No server, no headless render. Returns the GIF bytes (Uint8Array).
 */
export async function exportSpinGif({ engine, config, canvas, frames = 48, degrees = 360, fps = 20,
                                      maxW = 480, background = '#ffffff', onProgress = () => {} }) {
    const { GIFEncoder, quantize, applyPalette } = await import('../vendor/gifenc/gifenc.esm.js');
    const panels = (config.layout && config.layout.panels) || [];
    if (!panels.length) throw new Error('no panels to spin');
    const base = panels.map((p) => (p.rotate && p.rotate.yaw) || 0);
    const setYaw = (deg) => {
        for (let k = 0; k < panels.length; k++) panels[k].rotate = { ...(panels[k].rotate || {}), yaw: base[k] + deg };
    };

    const aspect = (canvas.height / canvas.width) || 0.8;
    const W = Math.max(2, Math.min(maxW, canvas.width | 0));
    const H = Math.max(2, Math.round(W * aspect));
    const c2 = document.createElement('canvas'); c2.width = W; c2.height = H;
    const ctx = c2.getContext('2d', { willReadFrequently: true });

    // Capture pass (synchronous: the RAF loop can't interleave, so each renderFrame's backbuffer is
    // intact for drawImage). Downscaled to maxW — GIFs are small and 256-colour anyway.
    if (engine.setSpinFit) engine.setSpinFit(true);   // constant-size sphere fit across the spin (no bounce)
    const grabs = [];
    for (let i = 0; i < frames; i++) {
        setYaw(degrees * i / frames);
        engine.renderFrame(); engine.renderFrame();           // settle the rotation-invariant re-framing
        ctx.fillStyle = background; ctx.fillRect(0, 0, W, H);  // GIF has no real alpha → flat background
        ctx.drawImage(canvas, 0, 0, W, H);
        grabs.push(ctx.getImageData(0, 0, W, H).data);
        onProgress(0.5 * (i + 1) / frames);
    }
    setYaw(0);
    if (engine.setSpinFit) engine.setSpinFit(false);          // back to tight per-view fit
    engine.renderFrame();                                      // restore the live view

    // Encode pass (yields to the UI so the button can show progress).
    const gif = GIFEncoder();
    const delay = Math.round(1000 / Math.max(fps, 1));
    for (let i = 0; i < frames; i++) {
        const palette = quantize(grabs[i], 256);
        const index = applyPalette(grabs[i], palette);
        gif.writeFrame(index, W, H, { palette, delay });
        onProgress(0.5 + 0.5 * (i + 1) / frames);
        if ((i & 3) === 0) await new Promise((r) => setTimeout(r, 0));
    }
    gif.finish();
    return gif.bytes();
}
