import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { HANAR_MOTION, chainsOf, frontPair, hanarState, poseHanar } from "./motion/hanarPose.js";
import { chainLengths, solveChain } from "./motion/ik.js";
import { ROCKY_GAIT, legsOf, poseRocky, rigRocky } from "./motion/rockyPose.js";
import { $, clone, copyText, download, h, paramsUI, store, toast } from "./ui.js";

/**
 * Animator: make new clips for any rigged model.
 * - Pose bones with a rotate gizmo and key them on a timeline (auto-key on by default).
 * - Add motion layers to a bone or chain: a travelling wave (tentacle wiggle), a swing, a bob, a shake. They stack
 *   on top of the keys and of an existing clip playing underneath.
 * - Drag an IK handle and a whole limb follows; key the result.
 * - Export a GLB with the new clip added (the app can use it directly), or the recipe as JSON.
 */

const LAYER_TYPES = {
  wave: {
    label: "Wave (tentacle wiggle)",
    doc: "A wave travels down a chain of bones from the one you pick: each bone swings a little later than its parent.",
    params: () => ({ size: 12, speed: 0.8, lag: 0.7, grow: 1, phase: 0, length: 12 }),
  },
  swing: { label: "Swing", doc: "One bone swings back and forth.", params: () => ({ size: 20, speed: 0.6, phase: 0 }) },
  bob: { label: "Bob", doc: "One bone (usually the root or hips) rises and falls.", params: () => ({ height: 0.05, speed: 1, phase: 0 }) },
  shake: { label: "Shake", doc: "A nervous jitter on one bone.", params: () => ({ size: 4, speed: 9 }) },
  ik: { label: "IK handle", doc: "Drag a target and the limb follows: pick the end bone (hand, foot, tentacle tip).", params: () => ({ bones: 3, poleUp: 0.5 }) },
};
const AXES = ["x", "y", "z"];

const ROCKY_APP = [
  ["walking", "Scuttle (all five)"],
  ["carrying", "Tripod walk, carrying"],
  ["idle", "Standing (tripod, arms easy)"],
  ["typing", "Typing"],
  ["working", "Working"],
  ["celebrating", "Cheer"],
  ["waiting", "Fist my bump"],
  ["napping", "Nap"],
];
const BLASTO_APP = [
  ["idle", "Drifting"],
  ["walking", "Gliding"],
  ["carrying", "Carrying"],
  ["typing", "Typing"],
  ["working", "Working"],
  ["celebrating", "Cheer"],
  ["waiting", "Hello"],
  ["napping", "Nap"],
];
const id6 = () => Math.random().toString(36).slice(2, 8);

/** Starters that fit any rig, built from its limbs. */
const GENERIC = [
  {
    id: "breathe",
    label: "Breathe (gentle idle)",
    build(w) {
      const root = w.bones[0]?.name;
      if (!root) return;
      w.duration = 4;
      w.layers.push({ id: id6(), type: "bob", bone: root, axis: "y", on: true, p: { height: 0.012, speed: 0.25, phase: 0 } });
      w.limbs().forEach((chain, k) => w.layers.push({ id: id6(), type: "swing", bone: chain[0].name, axis: "x", on: true, p: { size: 2.5, speed: 0.25, phase: k * 0.6 } }));
    },
  },
  {
    id: "ripple",
    label: "Ripple walk (every limb steps in turn)",
    build(w) {
      const limbs = w.limbs();
      w.duration = 1;
      limbs.forEach((chain, k) => {
        const phase = (k / Math.max(1, limbs.length)) * Math.PI * 2;
        w.layers.push({ id: id6(), type: "swing", bone: chain[0].name, axis: "x", on: true, p: { size: 18, speed: 1, phase } });
        if (chain[1]) w.layers.push({ id: id6(), type: "swing", bone: chain[1].name, axis: "x", on: true, p: { size: 14, speed: 1, phase: phase + Math.PI / 2 } });
      });
    },
  },
  {
    id: "wiggle",
    label: "Wiggle (every limb undulates)",
    build(w) {
      const limbs = w.limbs();
      w.duration = 3;
      limbs.forEach((chain, k) => w.layers.push({ id: id6(), type: "wave", bone: chain[0].name, axis: "x", on: true, p: { size: 10, speed: 0.4, lag: 0.7, grow: 1, phase: (k / Math.max(1, limbs.length)) * Math.PI * 2, length: chain.length } }));
    },
  },
  {
    id: "hello",
    label: "Hello (the highest limb waves)",
    build(w) {
      const limbs = w.limbs();
      if (!limbs.length) return;
      const top = [...limbs].sort((a, b) => b.at(-1).getWorldPosition(new THREE.Vector3()).y - a.at(-1).getWorldPosition(new THREE.Vector3()).y)[0];
      w.duration = 2;
      w.layers.push({ id: id6(), type: "swing", bone: top[0].name, axis: "z", on: true, p: { size: 25, speed: 1, phase: 0 } });
      if (top[1]) w.layers.push({ id: id6(), type: "wave", bone: top[1].name, axis: "z", on: true, p: { size: 15, speed: 1, lag: 0.6, grow: 1, phase: 0.5, length: top.length - 1 } });
    },
  },
];
const AXIS = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };

const q1 = new THREE.Quaternion();
const q2 = new THREE.Quaternion();

/** Smoothstep easing between keys, so motion eases in and out instead of snapping at each key. */
const ease = (u, kind) => (kind === "linear" ? u : u * u * (3 - 2 * u));

export class AnimatorWorkspace {
  constructor(lab) {
    this.lab = lab;
    this.objects = [];
    this.duration = 2;
    this.easing = "smooth";
    this.autoKey = true;
    this.loop = true;
    this.keys = {}; // bone name → [{ t, q: [x, y, z, w] }]
    this.layers = []; // { id, type, bone, axis, on, p }
    this.selected = null; // bone name
    this.selectedKey = null; // { bone, i }
    this.base = { clip: "", weight: 1 };
    this.clipName = "MyClip";
    this.source = "custom/Rocky";
  }

  async mount(panel) {
    this.panel = panel;
    const cat = await fetch("../catalog.json").then((r) => r.json());
    this.rigged = cat.models.filter((m) => m.rig).map((m) => `${m.pack}/${m.id}`);
    this.wrap = new THREE.Group();
    this.markers = new THREE.Group();
    this.objects = [this.wrap, this.markers];
    this.lab.scene.add(...this.objects);
    this.lab.renderer.domElement.addEventListener("pointerdown", (this.onPick = (e) => this.pick(e)));
    this.lab.gizmo.addEventListener("mouseUp", (this.onGizmoUp = () => this.gizmoUp()));
    this.lab.gizmo.addEventListener("mouseDown", (this.onGizmoDown = () => this.lab.setPaused(true)));
    this.lab.timelineCanvas.addEventListener("pointerdown", (this.onTimeline = (e) => this.timelineDown(e)));
    await this.loadModel(this.source);
  }

  unmount() {
    this.lab.renderer.domElement.removeEventListener("pointerdown", this.onPick);
    this.lab.gizmo.removeEventListener("mouseUp", this.onGizmoUp);
    this.lab.gizmo.removeEventListener("mouseDown", this.onGizmoDown);
    this.lab.timelineCanvas.removeEventListener("pointerdown", this.onTimeline);
    this.save();
  }

  // ── Loading ──────────────────────────────────────────────────────────────────────────────────

  async loadModel(source, file) {
    this.save();
    for (const L of this.layers) if (L.target) this.lab.scene.remove(L.target);
    this.lab.gizmo.detach();
    this.source = source;
    this.lab.hud("Loading…");
    const url = file ? URL.createObjectURL(file) : `../${source}.glb`;
    const gltf = await this.lab.load(url);
    this.gltf = gltf;
    this.model = cloneSkinned(gltf.scene);
    this.model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = o.receiveShadow = true;
        o.frustumCulled = false;
      }
    });
    this.wrap.clear();
    this.wrap.add(this.model);
    const box = new THREE.Box3().setFromObject(this.model, true);
    this.height = box.max.y - box.min.y;
    this.wrap.scale.setScalar(1.8 / this.height);
    this.wrap.position.y = -box.min.y * (1.8 / this.height);
    this.bones = [];
    this.model.traverse((o) => o.isBone && this.bones.push(o));
    this.rest = new Map(this.bones.map((b) => [b.name, { q: b.quaternion.clone(), p: b.position.clone() }]));
    this.byName = new Map(this.bones.map((b) => [b.name, b]));
    this.mixer = new THREE.AnimationMixer(this.model);
    this.action = null;
    this.buildMarkers();
    // Restore this model's work.
    const saved = store(`lab.anim.${source}`);
    Object.assign(this, { keys: {}, layers: [], duration: 2, clipName: "MyClip", base: { clip: "", weight: 1 } }, saved ?? {});
    this.setBase(this.base.clip);
    this.selected = null;
    this.lab.gizmo.detach();
    this.lab.orbit.target.set(0, 0.9, 0);
    this.lab.camera.position.set(2.4, 1.7, 3.2);
    this.lab.hud("");
    this.render();
  }

  save() {
    if (!this.source || this.source.startsWith("file:")) return;
    store(`lab.anim.${this.source}`, { keys: this.keys, layers: this.layers.map((l) => ({ ...l, target: undefined })), duration: this.duration, clipName: this.clipName, base: this.base, easing: this.easing });
  }

  setBase(name) {
    this.base.clip = name;
    this.mixer.stopAllAction();
    const clip = this.gltf.animations.find((c) => c.name === name);
    this.action = clip ? this.mixer.clipAction(clip).play() : null;
  }

  buildMarkers() {
    this.markers.clear();
    const geo = new THREE.SphereGeometry(0.018, 10, 8);
    for (const b of this.bones) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: "#8fd3ff", depthTest: false, transparent: true, opacity: 0.85 }));
      m.renderOrder = 10;
      m.userData.bone = b.name;
      this.markers.add(m);
    }
  }

  // ── Posing ───────────────────────────────────────────────────────────────────────────────────

  /** The chain from `name` down through first children, `n` bones long. */
  chainFrom(name, n) {
    const out = [];
    let b = this.byName.get(name);
    while (b && b.isBone && out.length < n) {
      out.push(b);
      b = b.children.find((c) => c.isBone);
    }
    return out;
  }

  /** The chain ending at `name`, `n` bones long, root first. */
  chainTo(name, n) {
    const out = [];
    let b = this.byName.get(name);
    while (b && b.isBone && out.length < n) {
      out.unshift(b);
      b = b.parent;
    }
    return out;
  }

  /** Set every bone for time `t`: rest, then the base clip, then keys, then layers, then IK. */
  evaluate(t) {
    for (const b of this.bones) {
      const r = this.rest.get(b.name);
      b.quaternion.copy(r.q);
      b.position.copy(r.p);
    }
    if (this.action) {
      this.action.weight = this.base.weight;
      this.mixer.setTime(t % Math.max(0.001, this.action.getClip().duration));
    }
    for (const [name, ks] of Object.entries(this.keys)) {
      const b = this.byName.get(name);
      if (!b || !ks.length) continue;
      let i = ks.findIndex((k) => k.t > t);
      if (i === -1) b.quaternion.fromArray(ks.at(-1).q);
      else if (i === 0) b.quaternion.fromArray(ks[0].q);
      else {
        const a = ks[i - 1];
        const c = ks[i];
        b.quaternion.slerpQuaternions(q1.fromArray(a.q), q2.fromArray(c.q), ease((t - a.t) / (c.t - a.t), this.easing));
      }
    }
    const tau = Math.PI * 2;
    for (const L of this.layers) {
      if (!L.on) continue;
      const p = L.p;
      if (L.type === "wave") {
        const chain = this.chainFrom(L.bone, Math.round(p.length));
        chain.forEach((b, i) => {
          const along = chain.length > 1 ? i / (chain.length - 1) : 1;
          const amp = THREE.MathUtils.degToRad(p.size) * (1 - p.grow + p.grow * (0.3 + along));
          b.quaternion.multiply(q1.setFromAxisAngle(AXIS[L.axis], Math.sin(t * p.speed * tau - i * p.lag + p.phase) * amp));
        });
      } else if (L.type === "swing") {
        const b = this.byName.get(L.bone);
        b?.quaternion.multiply(q1.setFromAxisAngle(AXIS[L.axis], Math.sin(t * p.speed * tau + p.phase) * THREE.MathUtils.degToRad(p.size)));
      } else if (L.type === "bob") {
        // Up in the world by `height` (on the 1.8 m stage), whatever scale the bone lives at.
        const b = this.byName.get(L.bone);
        if (b?.parent) {
          b.parent.updateWorldMatrix(true, false);
          const wp = b.parent.localToWorld(b.position.clone());
          wp.y += Math.sin(t * p.speed * tau + p.phase) * p.height;
          b.position.copy(b.parent.worldToLocal(wp));
        }
      } else if (L.type === "shake") {
        const b = this.byName.get(L.bone);
        const n = Math.sin(t * p.speed * 7.1) * 0.6 + Math.sin(t * p.speed * 13.3 + 1) * 0.4;
        b?.quaternion.multiply(q1.setFromAxisAngle(AXIS[L.axis], n * THREE.MathUtils.degToRad(p.size)));
      }
    }
    this.model.updateMatrixWorld(true);
    for (const L of this.layers) {
      if (!L.on || L.type !== "ik" || !L.target) continue;
      const chain = this.chainTo(L.bone, Math.round(L.p.bones) + 1);
      if (chain.length < 2) continue;
      const lengths = chainLengths(chain);
      const pole = chain[0].getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, L.p.poleUp, 0.2));
      solveChain(chain, lengths, L.target.getWorldPosition(new THREE.Vector3()), pole);
    }
  }

  setKey(name, t = this.lab.time % this.duration) {
    const b = this.byName.get(name);
    if (!b) return;
    const ks = (this.keys[name] ??= []);
    const existing = ks.find((k) => Math.abs(k.t - t) < 0.02);
    if (existing) existing.q = b.quaternion.toArray();
    else ks.push({ t: +t.toFixed(3), q: b.quaternion.toArray() });
    ks.sort((a, c) => a.t - c.t);
    this.save();
  }

  gizmoUp() {
    const obj = this.lab.gizmo.object;
    if (!obj) return;
    if (obj.isBone && this.autoKey) this.setKey(obj.name);
    if (obj.userData.ikLayer) {
      const L = this.layers.find((l) => l.id === obj.userData.ikLayer);
      if (L) L.at = obj.position.toArray();
      if (this.autoKey) for (const b of this.chainTo(L.bone, Math.round(L.p.bones) + 1).slice(0, -1)) this.setKey(b.name);
    }
    this.render();
  }

  select(name) {
    this.selected = name;
    const b = this.byName.get(name);
    if (b) {
      this.lab.gizmo.setMode("rotate");
      this.lab.gizmo.setSpace("local");
      this.lab.gizmo.attach(b);
    }
    this.render();
  }

  pick(e) {
    if (this.lab.gizmo.dragging || e.button !== 0) return;
    const r = this.lab.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.lab.camera);
    const hit = ray.intersectObjects(this.markers.children, false)[0];
    if (hit) this.select(hit.object.userData.bone);
  }

  addLayer(type) {
    const bone = this.selected ?? this.bones[0]?.name;
    const L = { id: Math.random().toString(36).slice(2, 8), type, bone, axis: "x", on: true, p: LAYER_TYPES[type].params() };
    this.layers.push(L);
    if (type === "ik") this.makeTarget(L);
    this.save();
    this.render();
  }

  makeTarget(L) {
    const end = this.byName.get(L.bone);
    if (!end) return;
    const target = new THREE.Mesh(new THREE.OctahedronGeometry(0.05), new THREE.MeshBasicMaterial({ color: "#ffb36b", depthTest: false }));
    target.renderOrder = 11;
    target.userData.ikLayer = L.id;
    if (L.at) target.position.fromArray(L.at);
    else target.position.copy(end.getWorldPosition(new THREE.Vector3()));
    this.lab.scene.add(target);
    this.objects.push(target);
    L.target = target;
  }

  // ── Templates and limb tools ────────────────────────────────────────────────────────────────

  /**
   * The model's limbs: chains of bones that branch off a common bone (legs, arms, tentacles, a neck), fingers left
   * out, sorted round the body (by the angle of their tips) so neighbours are next to each other.
   */
  limbs() {
    const out = [];
    for (const b of this.bones) {
      const kids = b.children.filter((c) => c.isBone);
      if (kids.length < 2) continue;
      for (const k of kids) {
        if (/thumb|index|middle|ring|pinky|finger/i.test(k.name)) continue;
        const chain = [];
        let c = k;
        while (c && c.isBone) {
          chain.push(c);
          const next = c.children.filter((x) => x.isBone && !/thumb|index|middle|ring|pinky|finger/i.test(x.name));
          c = next.length === 1 ? next[0] : undefined;
        }
        if (chain.length >= 2) out.push(chain);
      }
    }
    this.model.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(this.model.matrixWorld).invert();
    const angle = (chain) => {
      const p = chain.at(-1).getWorldPosition(new THREE.Vector3()).applyMatrix4(inv);
      return Math.atan2(p.x, p.z);
    };
    return out.sort((a, c) => angle(a) - angle(c));
  }

  /** The limb a bone belongs to, and its place in it. */
  limbOf(name) {
    const limbs = this.limbs();
    for (const [li, chain] of limbs.entries()) {
      const i = chain.findIndex((b) => b.name === name);
      if (i >= 0) return { limbs, li, chain, i };
    }
    return null;
  }

  /**
   * Copy the keys of the selected bone's limb onto every other limb, bone for bone, shifted in time: a wave round
   * the body, alternating, or all at once. Rotations carry over relative to each bone's rest pose, so limbs that
   * point different ways still move the same way.
   */
  spread(mode) {
    const found = this.selected && this.limbOf(this.selected);
    if (!found) return toast("Pick a bone in a limb that has keys first.");
    const { limbs, li, chain } = found;
    const src = chain.map((b) => this.keys[b.name] ?? []);
    if (!src.some((k) => k.length)) return toast("That limb has no keys yet: key a step on it first.");
    const n = limbs.length;
    const qa = new THREE.Quaternion();
    limbs.forEach((target, k) => {
      if (k === li) return;
      const rel = (k - li + n) % n;
      const shift = mode === "same" ? 0 : mode === "alternate" ? (rel % 2) * 0.5 : rel / n;
      target.forEach((b, i) => {
        const from = chain[Math.min(i, chain.length - 1)];
        const ks = src[Math.min(i, src.length - 1)];
        if (!ks?.length) return;
        const rs = this.rest.get(from.name).q;
        const rt = this.rest.get(b.name).q;
        this.keys[b.name] = ks
          .map((key) => {
            const delta = rs.clone().invert().multiply(qa.fromArray(key.q));
            return { t: +(((key.t + shift * this.duration) % this.duration) + 0).toFixed(3), q: rt.clone().multiply(delta).toArray() };
          })
          .sort((a, c) => a.t - c.t);
      });
    });
    this.save();
    this.render();
    toast(`Copied to ${n - 1} limbs.`);
  }

  /** Templates for this model: the app's own motions where it has them, and starters that fit any rig. */
  templates() {
    const app = this.source === "custom/Rocky" ? ROCKY_APP : this.source === "custom/Blasto" ? BLASTO_APP : [];
    return [...app.map(([mode, label]) => ({ id: `app:${mode}`, label: `From the app: ${label}` })), ...GENERIC.map((g) => ({ id: g.id, label: g.label }))];
  }

  applyTemplate(id) {
    this.keys = {};
    this.layers.forEach((L) => L.target && this.lab.scene.remove(L.target));
    this.layers = [];
    this.selected = null;
    this.lab.gizmo.detach();
    if (id.startsWith("app:")) this.bakeFromApp(id.slice(4));
    else GENERIC.find((g) => g.id === id)?.build(this);
    this.save();
    this.render();
    this.lab.time = 0;
    this.lab.setPaused(false);
  }

  /**
   * Run the app's motion for Rocky or Blasto on a private copy of the model and key what the bones do, a dozen
   * times a second, so it can be edited. Travel happens on the spot, like a treadmill.
   */
  bakeFromApp(mode) {
    const rocky = this.source === "custom/Rocky";
    const copy = cloneSkinned(this.gltf.scene);
    const ground = new THREE.Group();
    const body = new THREE.Group();
    ground.add(body);
    body.add(copy);
    const box = new THREE.Box3().setFromObject(copy, true);
    copy.scale.setScalar((rocky ? 1 : 2.1) / (box.max.y - box.min.y));
    if (!rocky) copy.rotation.y = Math.PI;
    ground.updateWorldMatrix(true, true);
    const moving = mode === "walking" || mode === "carrying";
    const speed = mode === "walking" ? 1.4 : 0.9;
    const step = 1 / 60;
    let t = 0;
    let advance;
    if (rocky) {
      const rig = rigRocky(ground, legsOf(copy));
      advance = () => poseRocky(ground, body, rig, mode, t, step, 0);
      this.duration = moving ? +((ROCKY_GAIT.stride / ROCKY_GAIT.duty / speed) * 2).toFixed(2) : 2;
    } else {
      const chains = chainsOf(copy);
      const front = frontPair(body, chains);
      const st = hanarState();
      advance = () => poseHanar(body, chains, front, st, mode, t, 0);
      this.duration = 3;
    }
    const bones = [];
    copy.traverse((o) => o.isBone && this.byName.has(o.name) && bones.push(o));
    const warm = 2;
    const keyEvery = 1 / 12;
    let nextKey = warm;
    while (t < warm + this.duration + 1e-6) {
      if (moving) ground.position.z += speed * step;
      ground.updateWorldMatrix(true, true);
      advance();
      if (t >= nextKey - 1e-6) {
        const kt = +(t - warm).toFixed(3);
        for (const b of bones) (this.keys[b.name] ??= []).push({ t: kt, q: b.quaternion.toArray() });
        nextKey += keyEvery;
      }
      t += step;
    }
    // What lived on the body rather than the bones (the bob and float) comes back as a layer.
    const root = this.bones[0]?.name;
    if (root) this.layers.push({ id: "bob", type: "bob", bone: root, axis: "y", on: true, p: { height: rocky ? (moving ? 0.03 : 0.006) : HANAR_MOTION.float.bob, speed: rocky ? (moving ? speed / (ROCKY_GAIT.stride / ROCKY_GAIT.duty) * 2 : 0.2) : HANAR_MOTION.float.bobSpeed / (Math.PI * 2), phase: 0 } });
    this.clipName = `${rocky ? "Rocky" : "Blasto"}_${mode}`;
    toast(`Loaded the app's ${mode} as keys. Edit any bone; the rest keeps moving.`);
  }

  // ── Export ───────────────────────────────────────────────────────────────────────────────────

  /** Sample the whole timeline into a clip: every bone that anything moves. */
  bake(fps = 30) {
    const moved = new Set(Object.keys(this.keys));
    for (const L of this.layers) {
      if (!L.on) continue;
      if (L.type === "wave") this.chainFrom(L.bone, Math.round(L.p.length)).forEach((b) => moved.add(b.name));
      else if (L.type === "ik") this.chainTo(L.bone, Math.round(L.p.bones) + 1).forEach((b) => moved.add(b.name));
      else moved.add(L.bone);
    }
    if (this.action) for (const tr of this.action.getClip().tracks) moved.add(tr.name.split(".")[0]);
    const frames = Math.max(2, Math.round(this.duration * fps) + 1);
    const times = Array.from({ length: frames }, (_, i) => (i / (frames - 1)) * this.duration);
    const q = new Map([...moved].map((n) => [n, []]));
    const p = new Map([...moved].map((n) => [n, []]));
    for (const t of times) {
      this.evaluate(t);
      for (const n of moved) {
        const b = this.byName.get(n);
        if (!b) continue;
        q.get(n).push(...b.quaternion.toArray());
        p.get(n).push(...b.position.toArray());
      }
    }
    const tracks = [];
    for (const n of moved) {
      if (!this.byName.get(n)) continue;
      tracks.push(new THREE.QuaternionKeyframeTrack(`${n}.quaternion`, times, q.get(n)));
      const pos = p.get(n);
      const r = this.rest.get(n).p;
      if (pos.some((v, i) => Math.abs(v - r.getComponent(i % 3)) > 1e-5)) tracks.push(new THREE.VectorKeyframeTrack(`${n}.position`, times, pos));
    }
    return new THREE.AnimationClip(this.clipName || "MyClip", this.duration, tracks);
  }

  async exportGlb() {
    const clip = this.bake();
    const exporter = new GLTFExporter();
    const out = await exporter.parseAsync(this.model, { binary: true, animations: [...this.gltf.animations, clip] });
    const name = `${this.source.split("/").pop()}-${clip.name}.glb`;
    download(name, new Blob([out], { type: "model/gltf-binary" }));
    toast(`Exported ${name}: the model with "${clip.name}" added.`);
  }

  recipe() {
    return JSON.stringify(
      { lab: "animator", model: this.source, clip: this.clipName, duration: this.duration, easing: this.easing, base: this.base, keys: this.keys, layers: this.layers.map(({ target, ...l }) => l), notes: store(`lab.anim.notes.${this.source}`) ?? "" },
      null,
      1,
    );
  }

  // ── Panel ────────────────────────────────────────────────────────────────────────────────────

  render() {
    const opts = (list, cur) => list.map((v) => h("option", { value: v, selected: v === cur, text: v || "(none)" }));
    const notes = h("textarea", { id: "anim-notes", placeholder: "What is this clip for, and what should it feel like?", oninput: (e) => store(`lab.anim.notes.${this.source}`, e.target.value) });
    notes.value = store(`lab.anim.notes.${this.source}`) ?? "";
    const sel = this.selected;
    this.panel.replaceChildren(
      h(
        "section",
        {},
        h("h2", { text: "Model" }),
        h("select", { id: "anim-model", onchange: (e) => this.loadModel(e.target.value) }, opts(this.rigged, this.source)),
        h("label", { class: "note" }, "Or open a GLB from your computer (it stays on your computer): ", h("input", { type: "file", accept: ".glb,.gltf", onchange: (e) => e.target.files[0] && this.loadModel(`file:${e.target.files[0].name}`, e.target.files[0]) })),
        h("p", { class: "note", text: `${this.bones.length} bones · ${this.gltf.animations.length} clips · click a blue dot to pick a bone` }),
      ),
      h(
        "section",
        {},
        h("h3", { text: "Start from a template" }),
        h("select", { id: "template", "aria-label": "Template" }, this.templates().map((tp) => h("option", { value: tp.id, text: tp.label }))),
        h(
          "div",
          { class: "row" },
          h("button", {
            class: "btn primary",
            type: "button",
            text: "Load template",
            onclick: (e) => {
              const has = Object.keys(this.keys).length || this.layers.length;
              if (has && e.currentTarget.dataset.armed !== "1") {
                e.currentTarget.dataset.armed = "1";
                e.currentTarget.textContent = "Replace current work?";
                return;
              }
              this.applyTemplate($("#template").value);
            },
          }),
        ),
        h("p", { class: "note", text: `${this.limbs().length} limbs found. Templates give you something already moving: change the bones you want, keep the rest.` }),
      ),
      h(
        "section",
        {},
        h("h3", { text: "Clip" }),
        h("input", { type: "text", id: "clip-name", value: this.clipName, "aria-label": "Clip name", onchange: (e) => ((this.clipName = e.target.value), this.save()) }),
        h(
          "div",
          { class: "row" },
          h("label", { for: "dur", text: "Length (s)" }),
          h("input", { type: "number", id: "dur", min: 0.2, max: 30, step: 0.1, value: this.duration, style: "width:80px", onchange: (e) => ((this.duration = Math.max(0.2, +e.target.value)), this.save()) }),
          h("select", { id: "easing", "aria-label": "Easing between keys", style: "width:auto", onchange: (e) => ((this.easing = e.target.value), this.save()) }, opts(["smooth", "linear"], this.easing)),
        ),
        h(
          "label",
          { class: "toggle" },
          h("input", { type: "checkbox", id: "autokey", checked: this.autoKey, onchange: (e) => (this.autoKey = e.target.checked) }),
          h("span", {}, "Auto-key", h("small", { text: "Rotating a bone (or dragging an IK handle) keys it at the playhead." })),
        ),
        h("h3", { text: "Play underneath" }),
        h("select", { id: "base-clip", onchange: (e) => (this.setBase(e.target.value), this.save()) }, opts(["", ...this.gltf.animations.map((c) => c.name)], this.base.clip)),
      ),
      h(
        "section",
        {},
        h("h3", { text: "Bone" }),
        h("select", { id: "bone", onchange: (e) => this.select(e.target.value) }, [h("option", { value: "", text: "(pick a bone)" }), ...this.bones.map((b) => h("option", { value: b.name, selected: b.name === sel, text: b.name }))]),
        sel
          ? h(
              "div",
              { class: "row" },
              h("button", { class: "btn small", type: "button", text: "Key now", onclick: () => (this.setKey(sel), this.render()) }),
              h("button", { class: "btn small", type: "button", text: "Reset bone", onclick: () => (this.byName.get(sel).quaternion.copy(this.rest.get(sel).q), this.setKey(sel), this.render()) }),
              h("button", { class: "btn small", type: "button", text: "Clear its keys", onclick: () => (delete this.keys[sel], this.save(), this.render()) }),
            )
          : h("p", { class: "note", text: "Pick a bone to rotate it, key it, or put a motion layer on it." }),
        sel && this.limbOf(sel)
          ? h(
              "div",
              { class: "group" },
              h("span", { class: "note", text: `Limb ${this.limbOf(sel).li + 1} of ${this.limbOf(sel).limbs.length}, bone ${this.limbOf(sel).i + 1}. Key a step on this limb, then copy it to the others:` }),
              h(
                "div",
                { class: "row" },
                h("button", { class: "btn small", type: "button", text: "Wave round the body", title: "Each limb a little later than its neighbour (Rocky's scuttle)", onclick: () => this.spread("wave") }),
                h("button", { class: "btn small", type: "button", text: "Alternate", title: "Every other limb half a cycle apart", onclick: () => this.spread("alternate") }),
                h("button", { class: "btn small", type: "button", text: "All together", onclick: () => this.spread("same") }),
              ),
            )
          : null,
        this.selectedKey
          ? h(
              "div",
              { class: "row" },
              h("span", { class: "note", text: `Key at ${this.keys[this.selectedKey.bone]?.[this.selectedKey.i]?.t ?? "?"}s on ${this.selectedKey.bone}` }),
              h("button", { class: "btn small", type: "button", text: "Delete key", onclick: () => (this.keys[this.selectedKey.bone]?.splice(this.selectedKey.i, 1), (this.selectedKey = null), this.save(), this.render()) }),
            )
          : null,
      ),
      h(
        "section",
        {},
        h("h3", { text: "Motion layers" }),
        h("div", { class: "row" }, Object.entries(LAYER_TYPES).map(([k, v]) => h("button", { class: "btn small", type: "button", text: `+ ${v.label}`, title: v.doc, onclick: () => this.addLayer(k) }))),
        h("p", { class: "note", text: "Layers start on the selected bone. Stack as many as you like; switch them on and off to compare." }),
        h(
          "div",
          { class: "list" },
          this.layers.map((L) =>
            h(
              "div",
              { class: "layer" },
              h(
                "div",
                { class: "head" },
                h("input", { type: "checkbox", id: `on-${L.id}`, checked: L.on, "aria-label": "Layer on", onchange: (e) => ((L.on = e.target.checked), this.save()) }),
                h("strong", { text: LAYER_TYPES[L.type].label }),
                h("button", { class: "btn small", type: "button", text: "Remove", style: "margin-left:auto", onclick: () => ((this.layers = this.layers.filter((x) => x !== L)), L.target && (this.lab.scene.remove(L.target), this.lab.gizmo.detach()), this.save(), this.render()) }),
              ),
              h("select", { id: `bone-${L.id}`, "aria-label": "Bone", onchange: (e) => ((L.bone = e.target.value), this.save()) }, this.bones.map((b) => h("option", { value: b.name, selected: b.name === L.bone, text: b.name }))),
              L.type !== "bob" && L.type !== "ik" ? h("div", { class: "row" }, "Axis", AXES.map((a) => h("button", { class: "btn small", type: "button", "aria-pressed": String(L.axis === a), text: a, onclick: () => ((L.axis = a), this.save(), this.render()) }))) : null,
              ...paramsUI(L.p, `p-${L.id}`, { onChange: () => this.save() }),
              L.type === "ik" ? h("button", { class: "btn small", type: "button", text: "Move the handle", onclick: () => (L.target || this.makeTarget(L), this.lab.gizmo.setMode("translate"), this.lab.gizmo.setSpace("world"), this.lab.gizmo.attach(L.target)) }) : null,
            ),
          ),
        ),
      ),
      h("section", {}, h("h3", { text: "Notes for Claude" }), notes),
      h(
        "section",
        {},
        h("h3", { text: "Export" }),
        h(
          "div",
          { class: "row" },
          h("button", { class: "btn primary", type: "button", text: "Download GLB with clip", onclick: () => this.exportGlb() }),
          h("button", { class: "btn", type: "button", text: "Copy recipe", onclick: () => copyText(this.recipe(), this.panel) }),
          h("button", { class: "btn", type: "button", text: "Clear all", onclick: () => ((this.keys = {}), (this.layers = []), this.save(), this.render()) }),
        ),
        h("p", { class: "note", text: "The GLB is the model with your clip added: upload it to Claude to use in the app. The recipe is the keys and layers as text." }),
      ),
    );
    for (const L of this.layers) if (L.type === "ik" && !L.target) this.makeTarget(L);
  }

  // ── Every frame ──────────────────────────────────────────────────────────────────────────────

  update(dt, t) {
    if (!this.model) return;
    const local = this.loop ? t % this.duration : Math.min(t, this.duration);
    if (!this.lab.gizmo.dragging) this.evaluate(local);
    // Markers follow the bones; the selected one shows brass.
    this.markers.children.forEach((m, i) => {
      this.bones[i].getWorldPosition(m.position);
      m.material.color.set(this.bones[i].name === this.selected ? "#c9a25c" : this.keys[this.bones[i].name]?.length ? "#9fe3c9" : "#8fd3ff");
    });
    this.lab.hud(`${this.source.split("/").pop()} · ${local.toFixed(2)} / ${this.duration}s${this.selected ? ` · ${this.selected}` : ""}`);
  }

  /** Dope sheet: a row per keyed bone (and per layer), the playhead, and diamonds for keys. */
  drawTimeline(ctx, w, hgt, dpr) {
    const left = 150 * dpr;
    const top = 20 * dpr;
    const rowH = 16 * dpr;
    const x = (t) => left + (t / this.duration) * (w - left - 10 * dpr);
    ctx.font = `${10 * dpr}px "IBM Plex Mono", monospace`;
    ctx.fillStyle = "#5d6470";
    for (let s = 0; s <= this.duration + 1e-6; s += this.duration > 6 ? 1 : 0.25) {
      ctx.fillRect(x(s), top - 6 * dpr, 1, 4 * dpr);
      if (Math.abs(s - Math.round(s)) < 1e-6) ctx.fillText(`${s}s`, x(s) + 2 * dpr, top - 8 * dpr);
    }
    const rows = [...Object.keys(this.keys).filter((k) => this.keys[k].length).map((k) => ({ kind: "keys", name: k })), ...this.layers.map((L) => ({ kind: "layer", L }))];
    this.rows = rows;
    rows.forEach((r, i) => {
      const y = top + i * rowH;
      ctx.fillStyle = i % 2 ? "#151922" : "#12161e";
      ctx.fillRect(0, y, w, rowH);
      ctx.fillStyle = r.kind === "keys" && r.name === this.selected ? "#c9a25c" : "#9097a3";
      ctx.fillText(r.kind === "keys" ? r.name.slice(0, 22) : `${LAYER_TYPES[r.L.type].label.split(" ")[0]} · ${r.L.bone.slice(0, 12)}`, 6 * dpr, y + 11 * dpr);
      if (r.kind === "keys") {
        this.keys[r.name].forEach((k, j) => {
          const kx = x(k.t);
          const on = this.selectedKey && this.selectedKey.bone === r.name && this.selectedKey.i === j;
          ctx.fillStyle = on ? "#c9a25c" : "#9fe3c9";
          ctx.beginPath();
          ctx.moveTo(kx, y + 3 * dpr);
          ctx.lineTo(kx + 5 * dpr, y + rowH / 2);
          ctx.lineTo(kx, y + rowH - 3 * dpr);
          ctx.lineTo(kx - 5 * dpr, y + rowH / 2);
          ctx.fill();
        });
      } else {
        // A layer: draw its wave across the row.
        ctx.strokeStyle = r.L.on ? "#8fd3ff" : "#3a404c";
        ctx.beginPath();
        for (let px = 0; px <= 120; px++) {
          const t = (px / 120) * this.duration;
          const sp = r.L.p.speed ?? 0;
          const v = r.L.type === "ik" ? 0 : Math.sin(t * sp * Math.PI * 2 + (r.L.p.phase ?? 0));
          const yy = y + rowH / 2 - v * (rowH / 2 - 3 * dpr);
          px ? ctx.lineTo(x(t), yy) : ctx.moveTo(x(t), yy);
        }
        ctx.stroke();
      }
    });
    if (!rows.length) {
      ctx.fillStyle = "#5d6470";
      ctx.fillText("Rotate a bone to key it, or add a motion layer. Click here to scrub.", left, top + 14 * dpr);
    }
    // Playhead.
    const local = this.lab.time % this.duration;
    ctx.fillStyle = "#c9a25c";
    ctx.fillRect(x(local), top - 10 * dpr, 2 * dpr, hgt);
    this.tl = { left, top, rowH, x, w, dpr };
  }

  timelineDown(e) {
    if (!this.tl) return;
    const r = this.lab.timelineCanvas.getBoundingClientRect();
    const px = (e.clientX - r.left) * this.tl.dpr;
    const py = (e.clientY - r.top) * this.tl.dpr;
    const { left, top, rowH, w } = this.tl;
    const toT = (p) => Math.min(this.duration, Math.max(0, ((p - left) / (w - left - 10 * this.tl.dpr)) * this.duration));
    // A key under the pointer? Select it and let it be dragged in time.
    const row = this.rows?.[Math.floor((py - top) / rowH)];
    if (row?.kind === "keys") {
      const ks = this.keys[row.name];
      const j = ks.findIndex((k) => Math.abs(this.tl.x(k.t) - px) < 7 * this.tl.dpr);
      if (j >= 0) {
        this.selectedKey = { bone: row.name, i: j };
        const move = (ev) => {
          ks[j].t = +toT((ev.clientX - r.left) * this.tl.dpr).toFixed(3);
        };
        const up = () => {
          ks.sort((a, c) => a.t - c.t);
          this.selectedKey = null;
          this.save();
          this.render();
          removeEventListener("pointermove", move);
          removeEventListener("pointerup", up);
        };
        addEventListener("pointermove", move);
        addEventListener("pointerup", up);
        this.render();
        return;
      }
    }
    // Otherwise scrub: pause and move the playhead with the pointer.
    this.lab.setPaused(true);
    const set = (cx) => (this.lab.time = toT((cx - r.left) * this.tl.dpr));
    set(e.clientX);
    const move = (ev) => set(ev.clientX);
    const up = () => (removeEventListener("pointermove", move), removeEventListener("pointerup", up));
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  }
}
