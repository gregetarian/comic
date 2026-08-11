from pathlib import Path

p = Path('comic/web/scene/renderer.js')
text = p.read_text()
old = """        const sampleWorld = (tm, target) => {
            const pos = tm.mesh.geometry.attributes.position;
            const n = pos ? pos.count : 0;
            if (!n) return new Float32Array();
            const step = Math.max(1, Math.ceil(n / target));
            const pts = [];
            const extrema = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity];
            const extremeIdx = new Int32Array(6).fill(-1);
            for (let i = 0; i < n; i++) {
                v.fromBufferAttribute(pos, i).applyMatrix4(tm.mesh.matrixWorld);
                if (i % step === 0) pts.push(v.x, v.y, v.z);
                if (v.x < extrema[0]) { extrema[0] = v.x; extremeIdx[0] = i; }
                if (v.x > extrema[1]) { extrema[1] = v.x; extremeIdx[1] = i; }
                if (v.y < extrema[2]) { extrema[2] = v.y; extremeIdx[2] = i; }
                if (v.y > extrema[3]) { extrema[3] = v.y; extremeIdx[3] = i; }
                if (v.z < extrema[4]) { extrema[4] = v.z; extremeIdx[4] = i; }
                if (v.z > extrema[5]) { extrema[5] = v.z; extremeIdx[5] = i; }
            }
            for (const i of new Set(extremeIdx)) {
                if (i < 0) continue;
                v.fromBufferAttribute(pos, i).applyMatrix4(tm.mesh.matrixWorld);
                pts.push(v.x, v.y, v.z);
            }
            return new Float32Array(pts);
        };
        for (const tm of sceneModel.meshes) {
            if (tm.meta.role === 'voxel') tm.depthSamples = sampleWorld(tm, 300);
            else if (tm.meta.role === 'cortex') tm.anatomyDepthSamples = sampleWorld(tm, 4096);
            else if (tm.meta.role === 'anatomy') tm.anatomyDepthSamples = sampleWorld(tm, 512);
        }
"""
new = """        const sampleWorld = (tm, target, preserveAxisExtrema = false) => {
            const pos = tm.mesh.geometry.attributes.position;
            const n = pos ? pos.count : 0;
            if (!n) return new Float32Array();
            const step = Math.max(1, Math.ceil(n / target));
            const pts = [];
            if (!preserveAxisExtrema) {
                // Statistical meshes can be very large and already only need an approximate veil
                // range. Keep their old strided cost rather than scanning every hidden variant.
                for (let i = 0; i < n; i += step) {
                    v.fromBufferAttribute(pos, i).applyMatrix4(tm.mesh.matrixWorld);
                    pts.push(v.x, v.y, v.z);
                }
                return new Float32Array(pts);
            }
            const extrema = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity];
            const extremeIdx = new Int32Array(6).fill(-1);
            for (let i = 0; i < n; i++) {
                v.fromBufferAttribute(pos, i).applyMatrix4(tm.mesh.matrixWorld);
                if (i % step === 0) pts.push(v.x, v.y, v.z);
                if (v.x < extrema[0]) { extrema[0] = v.x; extremeIdx[0] = i; }
                if (v.x > extrema[1]) { extrema[1] = v.x; extremeIdx[1] = i; }
                if (v.y < extrema[2]) { extrema[2] = v.y; extremeIdx[2] = i; }
                if (v.y > extrema[3]) { extrema[3] = v.y; extremeIdx[3] = i; }
                if (v.z < extrema[4]) { extrema[4] = v.z; extremeIdx[4] = i; }
                if (v.z > extrema[5]) { extrema[5] = v.z; extremeIdx[5] = i; }
            }
            for (const i of new Set(extremeIdx)) {
                if (i < 0) continue;
                v.fromBufferAttribute(pos, i).applyMatrix4(tm.mesh.matrixWorld);
                pts.push(v.x, v.y, v.z);
            }
            return new Float32Array(pts);
        };
        for (const tm of sceneModel.meshes) {
            if (tm.meta.role === 'voxel') tm.depthSamples = sampleWorld(tm, 300);
            else if (tm.meta.role === 'cortex') tm.anatomyDepthSamples = sampleWorld(tm, 4096, true);
            else if (tm.meta.role === 'anatomy') tm.anatomyDepthSamples = sampleWorld(tm, 512, true);
        }
"""
if text.count(old) != 1:
    raise SystemExit(f'expected one renderer sampling block, found {text.count(old)}')
p.write_text(text.replace(old, new, 1))
