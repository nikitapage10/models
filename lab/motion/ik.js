// Generated from C.E.O. apps/world/src/agents/bodies/ik.ts by scripts/sync-lab.mjs. Don't edit here.
import { Quaternion, Vector3 } from "three";
/**
 * Inverse kinematics for chains of bones: say where the end should be and the joints bend to get it there. Works on
 * any rig, because bones are turned in world space ("point at that"), never through their local axes.
 */
const cur = new Vector3();
const want = new Vector3();
const at = new Vector3();
const dq = new Quaternion();
const parentQ = new Quaternion();
/** Turn `bone` (keeping its parents) so the segment towards `child` points at the world point `target`. */
export function pointAt(bone, child, target) {
    bone.getWorldPosition(at);
    child.getWorldPosition(cur).sub(at);
    want.copy(target).sub(at);
    if (cur.lengthSq() < 1e-10 || want.lengthSq() < 1e-10)
        return;
    dq.setFromUnitVectors(cur.normalize(), want.normalize());
    bone.parent.getWorldQuaternion(parentQ);
    // world-space turn, carried into the parent's frame: local' = P⁻¹ · dq · P · local
    bone.quaternion.premultiply(parentQ.clone().invert().multiply(dq).multiply(parentQ));
    bone.updateWorldMatrix(false, true);
}
/** Segment lengths of a chain, joint to joint, measured as it stands. */
export function chainLengths(bones) {
    const p = bones.map((b) => b.getWorldPosition(new Vector3()));
    return p.slice(1).map((q, i) => q.distanceTo(p[i]));
}
/**
 * FABRIK: move the chain's joints so the last one reaches `target` (as near as it can), bending the middle joints
 * towards `pole`, then turn the bones to match. `bones` run root to end; the root stays where it is.
 */
export function solveChain(bones, lengths, target, pole, iterations = 8) {
    const n = bones.length;
    if (n < 2)
        return;
    const joints = bones.map((b) => b.getWorldPosition(new Vector3()));
    const root = joints[0].clone();
    const reach = lengths.reduce((s, l) => s + l, 0);
    if (root.distanceTo(target) >= reach) {
        // Out of reach: lay the chain straight towards it.
        const dir = target.clone().sub(root).normalize();
        for (let i = 1; i < n; i++)
            joints[i].copy(joints[i - 1]).addScaledVector(dir, lengths[i - 1]);
    }
    else {
        // Start bent towards the pole, so the knees go the right way.
        for (let i = 1; i < n - 1; i++)
            joints[i].lerp(pole, 0.35);
        for (let it = 0; it < iterations; it++) {
            joints[n - 1].copy(target);
            for (let i = n - 2; i >= 0; i--) {
                const d = joints[i].clone().sub(joints[i + 1]).normalize();
                joints[i].copy(joints[i + 1]).addScaledVector(d, lengths[i]);
            }
            joints[0].copy(root);
            for (let i = 1; i < n; i++) {
                const d = joints[i].clone().sub(joints[i - 1]).normalize();
                joints[i].copy(joints[i - 1]).addScaledVector(d, lengths[i - 1]);
            }
            if (joints[n - 1].distanceToSquared(target) < 1e-6)
                break;
        }
    }
    for (let i = 0; i < n - 1; i++)
        pointAt(bones[i], bones[i + 1], joints[i + 1]);
}
