/**
 * cameras.js — named anatomical view planes → camera poses. Pure.
 *
 * Coordinate frame is RAS/MNI mm: +x = right, +y = anterior, +z = superior.
 * `dir` is the direction from the brain centre TO the camera, so the camera
 * sits at  centre + dir*distance  and looks back at the centre.
 *
 * IMPORTANT (medial-lighting lesson): medial views are the genuinely OPPOSITE
 * side camera, never a horizontally-mirrored projection. A mirror flips the
 * view-basis determinant → gl_FrontFacing inverts → lit DoubleSide normals flip
 * → medial panels render dark. `poseFromPlane` keeps a right-handed basis.
 */
import { add, scale, normalize, sub, cross, dot, rotateAxis, deg2rad } from './units.js';

export const PLANES = {
    left_lateral:  { dir: [-1, 0, 0], up: [0, 0, 1], hemisphere: 'lh' },
    left_medial:   { dir: [ 1, 0, 0], up: [0, 0, 1], hemisphere: 'lh' },
    right_lateral: { dir: [ 1, 0, 0], up: [0, 0, 1], hemisphere: 'rh' },
    right_medial:  { dir: [-1, 0, 0], up: [0, 0, 1], hemisphere: 'rh' },
    anterior:      { dir: [0,  1, 0], up: [0, 0, 1], hemisphere: 'both' },
    posterior:     { dir: [0, -1, 0], up: [0, 0, 1], hemisphere: 'both' },
    dorsal:        { dir: [0, 0,  1], up: [0, 1, 0], hemisphere: 'both' },
    ventral:       { dir: [0, 0, -1], up: [0, 1, 0], hemisphere: 'both' },
};

/**
 * Per-panel orbit: rotate the centre→camera offset `rel` (and screen-up) by a
 * Free-Canvas rotation delta, about the panel's OWN camera basis — yaw about up,
 * pitch about right, roll about forward. Applied AFTER the global tilt so the
 * lighting rig stays consistent; rotations preserve handedness so the medial
 * dark-flip guard still holds. Pure.
 */
function orbitRel(rel, up, rotate) {
    const yaw = deg2rad(rotate.yaw || 0), pitch = deg2rad(rotate.pitch || 0), roll = deg2rad(rotate.roll || 0);
    if (!yaw && !pitch && !roll) return { rel, up };
    const f = normalize(scale(rel, -1));        // forward = camera → centre
    let r = normalize(cross(up, f));
    if (!isFinite(r[0]) || (r[0] === 0 && r[1] === 0 && r[2] === 0)) r = normalize(cross([0, 1, 0], f));
    const u = cross(f, r);                       // right-handed view-up
    let nrel = rel, nup = up;
    if (yaw)   { nrel = rotateAxis(nrel, u, yaw); }
    if (pitch) { nrel = rotateAxis(nrel, r, pitch); nup = rotateAxis(nup, r, pitch); }
    if (roll)  { nup = rotateAxis(nup, f, roll); }
    return { rel: nrel, up: normalize(nup) };
}

/** Extrinsic rotations about the fixed RAS/MNI axes. These are deliberately applied after the
 * legacy view-local yaw/pitch/roll so the coloured gizmo remains world-locked and predictable. */
function orbitWorld(rel, up, rotate) {
    const turns = [
        [[1, 0, 0], deg2rad(rotate.worldX || 0)],
        [[0, 1, 0], deg2rad(rotate.worldY || 0)],
        [[0, 0, 1], deg2rad(rotate.worldZ || 0)],
    ];
    let nrel = rel, nup = up;
    for (const [axis, angle] of turns) {
        if (!angle) continue;
        nrel = rotateAxis(nrel, axis, angle);
        nup = rotateAxis(nup, axis, angle);
    }
    return { rel: nrel, up: normalize(nup) };
}

/**
 * Resolve a camera spec to a concrete pose.
 * @param {object} cameraSpec - { plane: 'left_lateral' } OR { pose: {position,up,lookAt} }
 * @param {number[]} center - point to look at (usually the content AABB centre)
 * @param {number} distance - mm from centre (orthographic, so size-independent)
 * @param {object} [tilt] - global oblique tilt {azimuth,elevation} (degrees)
 * @param {object} [rotate] - per-panel orbit delta {yaw,pitch,roll} (degrees), applied after tilt
 * @returns {{ position, up, lookAt, hemisphere }}
 */
export function resolveCamera(cameraSpec, center = [0, 0, 0], distance = 400, tilt = null, rotate = null) {
    if (cameraSpec.pose) {
        const p = cameraSpec.pose;
        const lookAt = p.lookAt ?? center;
        let position = p.position, up = p.up;
        if (rotate && (rotate.yaw || rotate.pitch || rotate.roll)) {
            const o = orbitRel(sub(position, lookAt), up, rotate);
            position = add(lookAt, o.rel); up = o.up;
        }
        if (rotate && (rotate.worldX || rotate.worldY || rotate.worldZ)) {
            const o = orbitWorld(sub(position, lookAt), up, rotate);
            position = add(lookAt, o.rel); up = o.up;
        }
        return { position, up, lookAt, hemisphere: cameraSpec.hemisphere ?? 'both' };
    }
    const plane = PLANES[cameraSpec.plane];
    if (!plane) throw new Error(`Unknown camera plane: ${cameraSpec.plane}`);
    let up = plane.up.slice();

    // centre→camera offset, optionally tilted a few degrees off-axis for a
    // slight oblique (depth cue). The tilt is a FIXED WORLD-space rotation
    // (azimuth around world +z, elevation around world +x) applied identically
    // to every view — so the rig is consistent in space and opposite views
    // (L/R lateral, L/R medial) come out mirror-consistent, as if looking at one
    // consistently-tilted brain. Screen-up stays vertical (up is not rotated).
    let rel = scale(plane.dir, distance);
    if (tilt && (tilt.azimuth || tilt.elevation)) {
        rel = rotateAxis(rel, [0, 0, 1], deg2rad(tilt.azimuth || 0));
        rel = rotateAxis(rel, [1, 0, 0], deg2rad(tilt.elevation || 0));
    }
    // per-panel orbit (Free Canvas l/r/u/d/roll), after the global tilt
    if (rotate && (rotate.yaw || rotate.pitch || rotate.roll)) {
        const o = orbitRel(rel, up, rotate);
        rel = o.rel; up = o.up;
    }
    if (rotate && (rotate.worldX || rotate.worldY || rotate.worldZ)) {
        const o = orbitWorld(rel, up, rotate);
        rel = o.rel; up = o.up;
    }
    return {
        position: add(center, rel),
        up,
        lookAt: center.slice(),
        hemisphere: plane.hemisphere,
    };
}

/**
 * Orthonormal camera basis from a pose.
 * forward (f) points INTO the scene (lookAt - position); right (r) and up (u)
 * span the image plane. Returns a right-handed {r, u, f} (det>0).
 */
export function cameraBasis(pose) {
    const f = normalize(sub(pose.lookAt, pose.position));
    // right = up × forward  gives a right-handed basis with the image-up matching `up`.
    let r = normalize(cross(pose.up, f));
    // Guard against degenerate up ∥ forward.
    if (!isFinite(r[0]) || (r[0] === 0 && r[1] === 0 && r[2] === 0)) {
        r = normalize(cross([0, 1, 0], f));
    }
    const u = cross(f, r); // already unit, right-handed
    return { r, u, f };
}
