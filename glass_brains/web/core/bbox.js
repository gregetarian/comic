/**
 * bbox.js — the minimum screen-space box that tightly bounds every visible brain.
 *
 * For each panel, project its visible-mesh world AABB (8 corners) to screen px via the
 * panel's orthographic view (the same projection as freecanvas.worldToScreen), then union
 * across panels. Used to crop "Save PNG" and to reproduce that crop headlessly (--crop
 * content). Returns CSS px {x,y,w,h} (clamped to the viewport), or null if nothing visible.
 */

// World point → screen px, mirroring controls/freecanvas.js worldToScreen.
function projectToScreen(view, P) {
    const dx = P[0] - view.center[0], dy = P[1] - view.center[1], dz = P[2] - view.center[2];
    const right = dx * view.r[0] + dy * view.r[1] + dz * view.r[2];
    const up = dx * view.u[0] + dy * view.u[1] + dz * view.u[2];
    return {
        x: view.rect.cssLeft + view.rect.w / 2 + right / view.mmPerPx,
        y: view.rect.cssTop + view.rect.h / 2 - up / view.mmPerPx,   // screen y is down
    };
}

export function contentBBoxPx(engine, pad = 4) {
    const panels = (engine.config.layout && engine.config.layout.panels) || [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, any = false;
    for (const def of panels) {
        const view = engine.getPanelView(def);
        const aabb = engine.getPanelContentAABB(def);
        if (!view || !aabb || !isFinite(aabb.min[0]) || aabb.max[0] < aabb.min[0]) continue;
        const { min, max } = aabb;
        for (let i = 0; i < 8; i++) {
            const P = [(i & 1) ? max[0] : min[0], (i & 2) ? max[1] : min[1], (i & 4) ? max[2] : min[2]];
            const s = projectToScreen(view, P);
            if (s.x < minX) minX = s.x; if (s.x > maxX) maxX = s.x;
            if (s.y < minY) minY = s.y; if (s.y > maxY) maxY = s.y;
            any = true;
        }
    }
    if (!any) return null;
    const v = engine.getView();
    minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
    maxX = Math.min(v.VW, maxX + pad); maxY = Math.min(v.VH, maxY + pad);
    return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
}
