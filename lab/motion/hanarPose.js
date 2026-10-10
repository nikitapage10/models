// Generated from C.E.O. apps/world/src/agents/bodies/hanarPose.ts by scripts/sync-lab.mjs. Don't edit here.
import { Euler, Matrix4, Quaternion, Vector3 } from "three";
/**
 * How a hanar moves, as plain functions over its bones so the same code drives the world and offline previews.
 * A hanar floats; its six tentacles drift as travelling waves, and the front pair work as hands: they reach out
 * and tap to type, handle things, cradle what it carries, rise to celebrate and lift in greeting.
 */
/**
 * Every number the hanar's motion is built from, grouped into layers that can be switched off one at a time. The
 * motion lab (github.com/nikitapage10/models, lab/) edits these live.
 */
export const HANAR_MOTION = {
    layers: {
        /** Tentacles undulate as travelling waves. */
        drift: true,
        /** The body floats up and down. */
        bob: true,
        /** The body leans into a glide, slumps forward when sad. */
        lean: true,
        /** The front pair work as hands: type, handle things, carry, cheer, wave. */
        hands: true,
    },
    /** Wave size (radians of bend) and speed (radians a second) for each kind of moment. */
    drift: {
        idle: { size: 0.18, speed: 1 },
        gliding: { size: 0.24, speed: 1.5 },
        celebrating: { size: 0.3, speed: 2.4 },
        slumped: { size: 0.1, speed: 1 },
        napping: { size: 0.09, speed: 0.5 },
    },
    wave: {
        /** How far behind each bone runs the one before it (radians): bigger, the wave looks longer and lazier. */
        boneLag: 0.65,
        /** Offset between neighbouring tentacles, so they don't move as one. */
        tentacleLag: 1.05,
        /** Share of the swing at the root (the rest builds to the tip). */
        rootShare: 0.35,
        /** Sideways swing and twist, relative to the main swing. */
        side: 0.6,
        twist: 0.3,
    },
    float: { height: 0.18, bob: 0.06, bobSpeed: 1.1, napSink: 0.42 },
    lean: { gliding: 0.1, slumped: 0.2, typing: 0.08 },
    hands: { tapSpeed: 9, tapDepth: 0.7, wave: 6, hello: 3 },
};
/** The tentacles: every chain of five or more bones branching off the body, root first, with its rest pose. */
export function chainsOf(model) {
    const chains = [];
    model.traverse((o) => {
        const b = o;
        if (!b.isBone)
            return;
        const siblings = b.parent?.children.filter((c) => c.isBone) ?? [];
        if (siblings.length < 2)
            return;
        const chain = [];
        let k = b;
        while (k && k.isBone) {
            chain.push(k);
            const next = k.children.filter((c) => c.isBone);
            k = next.length === 1 ? next[0] : undefined;
        }
        if (chain.length >= 5)
            chains.push(chain.map((bone) => ({ bone, rest: bone.quaternion.clone() })));
    });
    return chains;
}
const v = new Vector3();
/** The two tentacles nearest the front (+Z in `space`), left (+X) first. */
export function frontPair(space, chains) {
    space.updateMatrixWorld(true);
    const inv = new Matrix4().copy(space.matrixWorld).invert();
    const at = chains.map((c, i) => {
        const tip = c[Math.min(2, c.length - 1)].bone;
        tip.getWorldPosition(v).applyMatrix4(inv);
        return { i, x: v.x, z: v.z };
    });
    const [a, b] = [...at].sort((p, q) => q.z - p.z);
    return a.x >= b.x ? [a.i, b.i] : [b.i, a.i];
}
export const hanarState = () => ({ amp: 0.18, freq: 1, sink: 0, tilt: 0, reach: 0, wave: 0, last: null });
const smooth = (a, b, k) => a + (b - a) * k;
const e = new Euler();
const q = new Quaternion();
const a = new Vector3();
const b = new Vector3();
const want = new Vector3();
const spaceQ = new Quaternion();
const parentQ = new Quaternion();
const dq = new Quaternion();
/** Turn `bone` so the segment to its child points along `dir` (in `space`), keeping its parents as they are. */
function aim(space, bone, child, dir) {
    const inv = new Matrix4().copy(space.matrixWorld).invert();
    bone.getWorldPosition(a).applyMatrix4(inv);
    child.getWorldPosition(b).applyMatrix4(inv);
    const cur = b.sub(a).normalize();
    want.set(...dir).normalize();
    dq.setFromUnitVectors(cur, want);
    space.getWorldQuaternion(spaceQ);
    bone.parent.getWorldQuaternion(parentQ);
    const inSpace = spaceQ.clone().invert().multiply(parentQ);
    bone.quaternion.copy(inSpace.clone().invert().multiply(dq).multiply(inSpace).multiply(bone.quaternion));
    bone.updateWorldMatrix(false, true);
}
/** Directions for each segment of a front tentacle, root to tip, for side s (+1 left, -1 right). */
function handPose(mode, s, t, phase, n) {
    const seg = (i) => i / (n - 1);
    switch (mode) {
        case "typing": {
            // Out over the desk, then the tips tap, left and right in turn.
            const H = HANAR_MOTION.hands;
            const tap = Math.max(0, Math.sin(t * H.tapSpeed + (s > 0 ? 0 : Math.PI) + phase));
            return Array.from({ length: n }, (_, i) => {
                const f = seg(i);
                return f < 0.35 ? [0.3 * s, -0.72, 0.62] : f < 0.7 ? [0.1 * s, -0.3, 1] : [0.04 * s, -0.7 - tap * H.tapDepth, 0.55 - tap * 0.3];
            });
        }
        case "working": {
            const lift = Math.sin(t * 2.2 + (s > 0 ? 0 : 1.6) + phase) * 0.35;
            return Array.from({ length: n }, (_, i) => {
                const f = seg(i);
                return f < 0.4 ? [0.3 * s, -0.7, 0.65] : [0.12 * s, -0.2 + lift * f, 1];
            });
        }
        case "carrying":
            // Down in front of the body, then curled back up underneath: a cradle close to the chest.
            return Array.from({ length: n }, (_, i) => {
                const f = seg(i);
                return f < 0.35 ? [0.25 * s, -0.92, 0.32] : f < 0.6 ? [0.12 * s, -0.55, 0.8] : [-0.3 * s, 0.75, 0.2];
            });
        case "celebrating": {
            const wave = Math.sin(t * HANAR_MOTION.hands.wave + (s > 0 ? 0 : Math.PI)) * 0.5;
            return Array.from({ length: n }, (_, i) => {
                const f = seg(i);
                return [0.45 * s + wave * f * s, 1, 0.25 - f * 0.2];
            });
        }
        case "waiting":
            // The left one lifts in a slow hello; the right stays in the drift.
            if (s < 0)
                return null;
            return Array.from({ length: n }, (_, i) => {
                const f = seg(i);
                return f < 0.5 ? [0.35, 0.3, 0.9] : [0.2 + Math.sin(t * HANAR_MOTION.hands.hello + phase) * 0.45 * f, 1, 0.3];
            });
        default:
            return null;
    }
}
/**
 * Pose a hanar for one frame. `space` is the character's frame (+Z forward, +Y up), `float` the group that bobs.
 * Returns the float offset and lean to apply to that group.
 */
export function poseHanar(space, chains, front, st, mode, t, phase) {
    const M = HANAR_MOTION;
    const L = M.layers;
    const gliding = mode === "walking" || mode === "carrying";
    const hands = L.hands && (mode === "typing" || mode === "working" || mode === "carrying" || mode === "celebrating" || mode === "waiting");
    const drift = M.drift[gliding ? "gliding" : mode] ?? M.drift.idle;
    st.amp = smooth(st.amp, L.drift ? drift.size : 0, 0.05);
    st.freq = smooth(st.freq, drift.speed, 0.05);
    const dt = st.last === null ? 0 : Math.min(Math.max(t - st.last, 0), 0.1);
    st.last = t;
    st.wave += dt * st.freq;
    st.sink = smooth(st.sink, mode === "napping" ? 1 : mode === "slumped" ? 0.35 : 0, 0.03);
    st.tilt = smooth(st.tilt, !L.lean ? 0 : gliding ? M.lean.gliding : mode === "slumped" ? M.lean.slumped : mode === "typing" ? M.lean.typing : 0, 0.05);
    st.reach = smooth(st.reach, hands ? 1 : 0, 0.08);
    // The drift, on every tentacle.
    const W = M.wave;
    chains.forEach((chain, k) => {
        chain.forEach(({ bone, rest }, i) => {
            const along = (i + 1) / chain.length;
            const w = st.wave - i * W.boneLag + k * W.tentacleLag + phase;
            const amp = st.amp * (W.rootShare + along);
            e.set(Math.sin(w) * amp + st.sink * 0.22, Math.sin(w * 0.7 + k) * amp * W.twist, Math.cos(w) * amp * W.side);
            bone.quaternion.copy(rest).multiply(q.setFromEuler(e));
        });
    });
    // The hands: aim the front pair from the rest pose, then blend in from the drift.
    if (st.reach > 0.01) {
        space.updateMatrixWorld(true);
        front.forEach((k, side) => {
            const chain = chains[k];
            if (!chain)
                return;
            const dirs = handPose(mode, side === 0 ? 1 : -1, t, phase, chain.length);
            if (!dirs)
                return;
            const drift = chain.map(({ bone }) => bone.quaternion.clone());
            for (const { bone, rest } of chain)
                bone.quaternion.copy(rest);
            chain[0].bone.updateWorldMatrix(true, true);
            for (let i = 0; i < chain.length - 1; i++)
                aim(space, chain[i].bone, chain[i + 1].bone, dirs[i]);
            chain.forEach(({ bone }, i) => bone.quaternion.slerp(drift[i], 1 - st.reach));
        });
    }
    const F = M.float;
    return { y: F.height + (L.bob ? Math.sin(t * F.bobSpeed + phase) * F.bob : 0) - st.sink * F.napSink, tilt: st.tilt };
}
