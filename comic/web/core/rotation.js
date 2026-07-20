/** Pure helpers shared by the Free Canvas MNI-axis rotation gizmo and its tests. */

export const WORLD_AXES = {
    x: { vector: [1, 0, 0], field: 'worldX', color: '#d64545' },
    y: { vector: [0, 1, 0], field: 'worldY', color: '#35a854' },
    z: { vector: [0, 0, 1], field: 'worldZ', color: '#3578d4' },
};

export function wrapDegrees(value) {
    const x = ((Number(value) || 0) + 180) % 360;
    return (x < 0 ? x + 360 : x) - 180;
}

export function rotateAroundWorldAxis(rotate, axis, delta) {
    const field = WORLD_AXES[axis]?.field;
    if (!field) throw new Error(`unknown MNI rotation axis '${axis}'`);
    return { ...(rotate || {}), [field]: wrapDegrees(((rotate || {})[field] || 0) + delta) };
}

/** Named camera plane for an orthogonal ±MNI-axis snap while preserving panel content. */
export function snapPlaneForAxis(axis, sign, hemisphere = 'both') {
    const positive = sign >= 0;
    if (axis === 'y') return positive ? 'anterior' : 'posterior';
    if (axis === 'z') return positive ? 'dorsal' : 'ventral';
    if (axis !== 'x') throw new Error(`unknown MNI snap axis '${axis}'`);
    if (hemisphere === 'lh') return positive ? 'left_medial' : 'left_lateral';
    if (hemisphere === 'rh') return positive ? 'right_lateral' : 'right_medial';
    return positive ? 'right_lateral' : 'left_lateral';
}

