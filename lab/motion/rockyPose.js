// Generated from C.E.O. apps/world/src/agents/bodies/rockyPose.ts by scripts/sync-lab.mjs. Don't edit here.
import { Quaternion, Vector3 } from "three";
import { chainLengths, solveChain } from "./ik.js";
/**
 * How an Eridian moves (shared by the world, offline previews and the motion lab). Five identical limbs in radial
 * symmetry, so nothing moves in left-right pairs, and the feet are planted: each foot holds its place on the floor
 * while the carapace travels over it, then lifts and swings through an arc to land ahead, and the leg bends to
 * reach it, knee up and out like a spider's.
 * - Scuttling (getting somewhere): all five step, one after another round the body, off the beat.
 * - Standing, working, carrying: a tripod. Three limbs stay feet (stepping one at a time if it moves); the front
 *   two rise as arms to engineer, gesture and hold.
 * Step shape and timing follow the four-legged crawler's walk: half the cycle planted, half in the air, the foot
 * rising about 14% of body height at mid-swing, the body bobbing twice a cycle.
 */
/** Every number the gait is built from, in body heights and seconds. The motion lab edits these live. */
export const ROCKY_GAIT = {
    /** Parts of the motion that can be switched off one at a time (the motion lab's layers). */
    layers: {
        /** Feet step; off, they stay planted and slide. */
        step: true,
        /** The body bobs twice a cycle. */
        bob: true,
        /** The body leans into travel and sways. */
        lean: true,
        /** The front pair rise as arms when not scuttling. */
        arms: true,
        /** A slow breath, so it's never quite still. */
        breathe: true,
    },
    /** How far a foot travels per step. */
    stride: 0.63,
    /** Share of a cycle a foot spends on the floor: more than half, so the body glides on most of its feet. */
    duty: 0.67,
    /** Peak height of a step. */
    lift: 0.29,
    /** Shortest and longest a step may take: quick and light. */
    minStep: 0.1,
    maxStep: 0.22,
    /** Spider stance: feet planted this much further out than they hang at rest, and the body slung this low
     * between them, so the knees arch up above the carapace. `crouch` while scuttling, `stance` otherwise. */
    reach: 0.12,
    crouch: 0.11,
    stance: 0.13,
    /** When each leg steps in the scuttle, as a fraction of the cycle: a wave round the body, off the beat. */
    scuttleOrder: [0, 0.38, 0.81, 0.17, 0.59],
    /** Body bob while walking (twice a cycle; small, so it glides), lean into travel per unit speed, and the most it leans. */
    bob: 0.1,
    lean: 0.15,
    maxLean: 0.1,
    /** Feet planted out from the body by this much more when settling to sleep, and how low it settles. */
    splay: 0.34,
    settle: 0.36,
    /** A planted foot this far from where it belongs takes a corrective step when standing still. */
    restep: 0.14,
    /** Share of a leg's reach (across the floor, from its hip) a planted foot may drift to before it must step, and
     * the share it lands within. Keeps the trailing legs from being dragged straight. */
    maxReach: 0.92,
    landReach: 0.8,
    /** While walking, a foot lands no further out to the side of its hip than this share of the leg's reach. */
    sideReach: 0.55,
    /** Where the front pair hold their hands for each job, in the body's frame [x (each side), y, z]. */
    arms: {
        idle: [0.3, 0.5, 0.42],
        typing: [0.17, 0.62, 0.62],
        working: [0.2, 0.7, 0.55],
        carrying: [0.15, 0.52, 0.42],
        celebrating: [0.36, 0.95, 0.3],
        bump: [0.1, 0.78, 0.82],
    },
};
/** The legs: every chain of three or more bones branching off the body, hip first. */
export function legsOf(model) {
    const legs = [];
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
        if (chain.length >= 3)
            legs.push(chain);
    });
    return legs;
}
/**
 * Measure the rig once, standing at rest: `ground` is the frame that sits on the floor and turns with the agent,
 * `body` the carapace inside it.
 */
export function rigRocky(ground, legs) {
    ground.updateWorldMatrix(true, true);
    const tips = legs.map((l) => ground.worldToLocal(l[l.length - 1].getWorldPosition(new Vector3())));
    const byZ = tips.map((p, i) => ({ i, z: p.z })).sort((a, b) => b.z - a.z);
    const front = new Set([byZ[0]?.i, byZ[1]?.i]);
    return {
        legs: legs.map((bones, i) => {
            const home = tips[i].clone();
            const out = new Vector3(home.x, 0, home.z).normalize();
            const footRest = ground.getWorldQuaternion(new Quaternion()).invert().multiply(bones[bones.length - 1].getWorldQuaternion(new Quaternion()));
            return { bones, lengths: chainLengths(bones), home, out, front: front.has(i), side: home.x >= 0 ? 1 : -1, footRest, foot: ground.localToWorld(home.clone()), swing: null, stepped: -1 };
        }),
        clock: 0,
        last: null,
        velocity: new Vector3(),
        arms: 0.6,
        sink: 0,
        crouch: 0,
        bounce: 0,
        bump: 0,
        lean: 0,
    };
}
const smooth = (a, b, k) => a + (b - a) * k;
const ease = (u) => 0.5 - 0.5 * Math.cos(Math.PI * u);
const UP = new Vector3(0, 1, 0);
const v = new Vector3();
const homeW = new Vector3();
const target = new Vector3();
const pole = new Vector3();
const hip = new Vector3();
const arm = new Vector3();
const qa = new Quaternion();
const qb = new Quaternion();
/**
 * One frame. `ground` turns with the agent and sits on the floor; `body` is the carapace inside it, which this
 * bobs and leans. Returns where the front pair are holding things (ground frame), for carrying.
 */
export function poseRocky(ground, body, rig, mode, t, dt, phase) {
    const G = ROCKY_GAIT;
    dt = Math.min(Math.max(dt, 0), 0.1);
    ground.updateWorldMatrix(true, false);
    const here = ground.getWorldPosition(new Vector3());
    if (rig.last && dt > 0)
        rig.velocity.lerp(v.copy(here).sub(rig.last).setY(0).multiplyScalar(1 / dt), 0.35);
    rig.last = here;
    const speed = rig.velocity.length();
    const moving = speed > 0.08;
    // What the front pair are doing: feet while scuttling, arms otherwise.
    const scuttle = mode === "walking";
    rig.arms = smooth(rig.arms, scuttle || mode === "napping" || !G.layers.arms ? 0 : 1, 0.1);
    rig.sink = smooth(rig.sink, mode === "napping" ? 1 : mode === "slumped" ? 0.45 : 0, 0.05);
    rig.crouch = smooth(rig.crouch, scuttle ? G.crouch : G.stance, 0.06);
    rig.bounce = smooth(rig.bounce, mode === "celebrating" ? 1 : 0, 0.1);
    rig.bump = smooth(rig.bump, mode === "waiting" ? 1 : 0, 0.07);
    const armsUp = rig.arms > 0.5;
    // The clock runs on distance: a cycle is the ground covered while one foot goes through a full step.
    const cycle = G.stride / G.duty;
    if (moving)
        rig.clock += (speed * dt) / cycle;
    const stepTime = Math.min(G.maxStep, Math.max(G.minStep, ((1 - G.duty) * cycle) / Math.max(speed, 0.01)));
    // Body: bob twice a cycle while walking, lean into travel, bounce to celebrate, settle to sleep.
    const walkBob = moving && G.layers.bob ? Math.abs(Math.sin(rig.clock * Math.PI * 2)) * G.bob : 0;
    body.position.y = walkBob + rig.bounce * Math.abs(Math.sin(t * 9)) * 0.12 - rig.sink * G.settle - rig.crouch;
    rig.lean = smooth(rig.lean, G.layers.lean ? Math.min(G.maxLean, speed * G.lean) : 0, 0.1);
    body.rotation.x = rig.lean + (G.layers.breathe ? Math.sin(t * 1.3 + phase) * 0.012 : 0);
    body.rotation.z = moving && G.layers.lean ? Math.sin(rig.clock * Math.PI * 2 + 0.7) * 0.025 : 0;
    body.updateWorldMatrix(true, true);
    const feet = rig.legs.filter((l) => !(armsUp && l.front));
    const swinging = rig.legs.some((l) => l.swing);
    feet.forEach((leg, k) => {
        // Where this foot belongs now: out wide of its hip, wider still if settling.
        homeW.copy(leg.home).addScaledVector(leg.out, G.reach + G.splay * rig.sink);
        ground.localToWorld(homeW);
        // How far across the floor this leg can reach from its hip at foot height.
        leg.bones[0].getWorldPosition(hip);
        const length = leg.lengths.reduce((a, b) => a + b, 0);
        const span = Math.sqrt(Math.max(0, length * length - (hip.y - homeW.y) ** 2));
        const across = (p) => Math.hypot(p.x - hip.x, p.z - hip.z);
        if (leg.swing) {
            const s = leg.swing;
            s.u = Math.min(1, s.u + dt / s.time);
            leg.foot.lerpVectors(s.from, s.to, ease(s.u)).addScaledVector(UP, Math.sin(Math.PI * s.u) * G.lift);
            if (s.u >= 1) {
                leg.foot.copy(s.to);
                leg.swing = null;
            }
        }
        else {
            const order = scuttle ? (G.scuttleOrder[rig.legs.indexOf(leg) % G.scuttleOrder.length] ?? 0) : k / Math.max(1, feet.length);
            const c = rig.clock + order;
            const due = G.layers.step && moving && c - Math.floor(c) < 1 - G.duty && Math.floor(c) !== leg.stepped;
            const strayed = leg.foot.distanceTo(homeW) > (moving ? G.stride * 1.1 : G.restep);
            const overreached = across(leg.foot) > span * G.maxReach;
            if (due || (G.layers.step && (overreached || (strayed && (moving || !swinging))))) {
                leg.stepped = Math.floor(c);
                // Land ahead of home by half the ground covered while planted, so the foot passes under the hip mid-stance.
                const ahead = v.copy(rig.velocity).multiplyScalar(stepTime + (G.duty * cycle) / Math.max(speed, 0.01) / 2);
                if (!moving)
                    ahead.set(0, 0, 0);
                else if (ahead.length() > G.stride * 0.6)
                    ahead.setLength(G.stride * 0.6);
                const to = homeW.clone().add(ahead);
                // A foot that rests behind its hip (the back legs) lands level with the hip instead, so its stride spans
                // the reach in front of and behind it rather than starting at the back edge.
                if (moving) {
                    const dir = v.copy(rig.velocity).setY(0).normalize();
                    const behind = -((to.x - ahead.x - hip.x) * dir.x + (to.z - ahead.z - hip.z) * dir.z);
                    if (behind > 0)
                        to.addScaledVector(dir, behind);
                    // And a foot planted far out to the side comes in a little, leaving it room to stride.
                    const sideX = -dir.z;
                    const sideZ = dir.x;
                    const lateral = (to.x - hip.x) * sideX + (to.z - hip.z) * sideZ;
                    const most = span * G.sideReach;
                    if (Math.abs(lateral) > most) {
                        const d = lateral - Math.sign(lateral) * most;
                        to.x -= sideX * d;
                        to.z -= sideZ * d;
                    }
                }
                // Land where the leg can still reach once the body has carried on through the step.
                const later = hip.clone().addScaledVector(rig.velocity, moving ? stepTime : 0);
                const off = v.set(to.x - later.x, 0, to.z - later.z);
                const most = span * G.landReach;
                if (off.length() > most)
                    to.set(later.x, to.y, later.z).add(off.setLength(most));
                leg.swing = { from: leg.foot.clone(), to, u: 0, time: moving ? stepTime : 0.22 };
            }
        }
    });
    // Solve every leg; the front pair reach for their hand positions when they're arms.
    const armPose = (name, side, out) => {
        const p = G.arms[name] ?? G.arms.idle;
        return out.set(p[0] * side, p[1], p[2]);
    };
    let held = null;
    for (const leg of rig.legs) {
        leg.bones[0].getWorldPosition(hip);
        target.copy(leg.foot);
        if (leg.front && rig.arms > 0.01) {
            const side = leg.side;
            if (mode === "waiting" && side > 0)
                armPose("bump", side, arm);
            else if (mode === "typing")
                armPose("typing", side, arm).add(v.set(0, -Math.max(0, Math.sin(t * 10 + (side > 0 ? 0 : Math.PI))) * 0.05, 0));
            else if (mode === "working")
                armPose("working", side, arm).add(v.set(0, Math.sin(t * 3 + side) * 0.06, Math.cos(t * 2.3 + side) * 0.05));
            else if (mode === "carrying")
                armPose("carrying", side, arm);
            else if (mode === "celebrating")
                armPose("celebrating", side, arm).add(v.set(Math.sin(t * 7 + side) * 0.12, 0, 0));
            else
                armPose("idle", side, arm).add(v.set(0, Math.sin(t * 0.9 + side * 2 + phase) * 0.05, Math.sin(t * 0.7 + side) * 0.04));
            // Hands keep their height while the body crouches between the feet.
            arm.y += rig.crouch;
            body.localToWorld(arm);
            target.lerp(arm, rig.arms);
            // Elbow up and a little out.
            pole.copy(hip).addScaledVector(UP, 0.5).add(v.copy(leg.out).transformDirection(ground.matrixWorld).multiplyScalar(0.15));
        }
        else {
            // Knee up and out, like a spider's.
            pole.copy(hip).addScaledVector(UP, 0.45);
            v.copy(leg.out).transformDirection(ground.matrixWorld).multiplyScalar(0.35);
            pole.add(v);
        }
        solveChain(leg.bones, leg.lengths, target, pole);
        // The foot points at the floor as it did at rest (arms keep the curl the bend gives them).
        const footBlend = leg.front ? 1 - rig.arms : 1;
        if (footBlend > 0.01) {
            const foot = leg.bones[leg.bones.length - 1];
            ground.getWorldQuaternion(qa).multiply(leg.footRest);
            foot.parent.getWorldQuaternion(qb).invert();
            foot.quaternion.slerp(qb.multiply(qa), footBlend);
            foot.updateWorldMatrix(false, true);
        }
        if (leg.front && mode === "carrying" && rig.arms > 0.5) {
            const tip = leg.bones[leg.bones.length - 1].getWorldPosition(new Vector3());
            held = held ? held.add(tip).multiplyScalar(0.5) : tip;
        }
    }
    if (held) {
        ground.worldToLocal(held);
        held.y += 0.06;
    }
    return held;
}
