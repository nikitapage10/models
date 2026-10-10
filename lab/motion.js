import * as THREE from "three";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { Graph } from "./graph.js";
import { HANAR_MOTION, chainsOf, frontPair, hanarState, poseHanar } from "./motion/hanarPose.js";
import { ROCKY_GAIT, legsOf, poseRocky, rigRocky } from "./motion/rockyPose.js";
import { assignDeep, clone, copyText, download, h, paramsUI, store, toast } from "./ui.js";

/**
 * Motion: the app's own procedural motion (copied from C.E.O. by scripts/sync-lab.mjs), live, with every number on
 * a slider and every layer on a switch. What you tune here is what ships once it's pasted back.
 */

const MODES = [
  ["idle", "Idle"],
  ["walking", "Walk"],
  ["carrying", "Carry"],
  ["typing", "Type"],
  ["working", "Work"],
  ["celebrating", "Cheer"],
  ["waiting", "Wait"],
  ["staring", "Stare"],
  ["slumped", "Slump"],
  ["napping", "Nap"],
];

const LAYER_DOCS = {
  step: "Feet lift and step. Off: feet stay planted and the body slides over them.",
  bob: "The body rises and falls with the steps (Rocky) or floats up and down (Blasto).",
  lean: "The body leans into travel and sways.",
  arms: "The front pair rise as arms when not scuttling.",
  breathe: "A slow breath, so it's never quite still.",
  drift: "Tentacles undulate as travelling waves.",
  hands: "The front pair type, handle things, carry, cheer and wave.",
};

const CHARACTERS = {
  rocky: {
    name: "Rocky",
    about: "Eridian engineer. Five legs on planted feet: scuttles on all five, stands on a tripod with two arms.",
    url: "../custom/Rocky.glb",
    height: 1,
    params: ROCKY_GAIT,
    turn: 0,
    build(model, ground, body) {
      const rig = rigRocky(ground, legsOf(model));
      return {
        pose: (mode, t, dt) => poseRocky(ground, body, rig, mode, t, dt, 0),
        state: rig,
        channels: () => rig.legs.map((l) => (l.swing ? l.foot.y - ground.getWorldPosition(new THREE.Vector3()).y : 0)),
        labels: () => rig.legs.map((l, i) => `Leg ${i + 1}${l.front ? " (arm)" : ""}`),
        range: [0, 0.25],
      };
    },
  },
  blasto: {
    name: "Blasto",
    about: "Hanar. Floats; six tentacles drift as travelling waves, the front pair work as hands.",
    url: "../custom/Blasto.glb",
    height: 2.1,
    params: HANAR_MOTION,
    turn: Math.PI,
    build(model, ground, body) {
      const chains = chainsOf(model);
      let front = null;
      const st = hanarState();
      const a = new THREE.Vector3();
      const b = new THREE.Vector3();
      return {
        pose(mode, t) {
          front ??= frontPair(body, chains);
          const { y, tilt } = poseHanar(body, chains, front, st, mode, t, 0);
          body.position.y = y;
          body.rotation.x = tilt;
          if (mode !== "carrying") return null;
          body.updateWorldMatrix(true, true);
          chains[front[0]][chains[front[0]].length - 3].bone.getWorldPosition(a);
          chains[front[1]][chains[front[1]].length - 3].bone.getWorldPosition(b);
          const mid = ground.worldToLocal(a.add(b).multiplyScalar(0.5));
          mid.y += 0.08;
          return mid;
        },
        channels: () =>
          chains.map((c) => {
            const tip = c[c.length - 1].bone.getWorldPosition(a);
            return body.worldToLocal(tip).x;
          }),
        labels: () => chains.map((_, i) => `Tentacle ${i + 1}${front && front.includes(i) ? " (hand)" : ""}`),
        range: [-0.35, 0.35],
      };
    },
  },
};

export class MotionWorkspace {
  constructor(lab) {
    this.lab = lab;
    this.objects = [];
    this.who = "rocky";
    this.mode = "idle";
    this.path = { on: false, shape: "circle", speed: 2.4, radius: 2.2 };
    this.graph = new Graph(6);
    this.defaults = { rocky: clone(ROCKY_GAIT), blasto: clone(HANAR_MOTION) };
    for (const [k, c] of Object.entries(CHARACTERS)) {
      const saved = store(`lab.motion.${k}`);
      if (saved?.params) assignDeep(c.params, saved.params);
    }
  }

  async mount(panel) {
    this.panel = panel;
    const { THREE: T, scene } = this.lab;
    this.ground = new T.Group();
    this.body = new T.Group();
    this.ground.add(this.body);
    this.desk = new T.Mesh(new T.BoxGeometry(1.4, 0.05, 0.6), new T.MeshStandardMaterial({ color: "#8a6a4a" }));
    this.desk.castShadow = this.desk.receiveShadow = true;
    this.crate = new T.Mesh(new T.BoxGeometry(0.28, 0.2, 0.28), new T.MeshStandardMaterial({ color: "#c98a4a" }));
    this.crate.castShadow = true;
    this.pathLine = new T.Line(new T.BufferGeometry(), new T.LineDashedMaterial({ color: "#c9a25c", dashSize: 0.1, gapSize: 0.08 }));
    this.objects = [this.ground, this.desk, this.crate, this.pathLine];
    scene.add(...this.objects);
    await this.load(this.who);
    this.render();
  }

  unmount() {
    this.lab.follow = null;
  }

  async load(who) {
    this.who = who;
    const c = CHARACTERS[who];
    this.body.clear();
    this.body.position.set(0, 0, 0);
    this.body.rotation.set(0, 0, 0);
    this.ground.position.set(0, 0, 0);
    this.ground.rotation.set(0, 0, 0);
    this.lab.hud(`Loading ${c.name}…`);
    const gltf = await this.lab.load(c.url);
    const model = cloneSkinned(gltf.scene);
    model.traverse((o) => {
      if (o.isMesh) o.castShadow = o.receiveShadow = true;
    });
    const box = new THREE.Box3().setFromObject(model, true);
    model.scale.setScalar(c.height / (box.max.y - box.min.y));
    model.rotation.y = c.turn;
    this.body.add(model);
    this.ground.updateWorldMatrix(true, true);
    this.rig = c.build(model, this.ground, this.body);
    this.graph.clear();
    this.lab.orbit.target.set(0, c.height * 0.5, 0);
    this.lab.camera.position.set(c.height * 2.3, c.height * 1.5, c.height * 3);
    this.lab.hud("");
    this.yaw = 0;
    this.travel = 0;
  }

  setMode(mode) {
    this.mode = mode;
    this.graph.mark(this.lab.time, MODES.find(([m]) => m === mode)?.[1] ?? mode);
    if ((mode === "walking" || mode === "carrying") && !this.path.on) this.path.on = true;
    this.render();
  }

  save() {
    store(`lab.motion.${this.who}`, { params: CHARACTERS[this.who].params, notes: this.notes });
  }

  get notes() {
    return store(`lab.notes.${this.who}`) ?? "";
  }
  set notes(v) {
    store(`lab.notes.${this.who}`, v);
  }

  exportText() {
    const c = CHARACTERS[this.who];
    return JSON.stringify({ lab: "motion", character: this.who, params: c.params, notes: this.notes }, null, 2);
  }

  render() {
    const c = CHARACTERS[this.who];
    const P = c.params;
    const notes = h("textarea", { id: "motion-notes", placeholder: "What should change? e.g. \"steps feel too quick when carrying\" or \"tentacles should trail more when gliding\".", oninput: (e) => (this.notes = e.target.value) });
    notes.value = this.notes;
    this.panel.replaceChildren(
      h(
        "section",
        {},
        h("h2", { text: "Character" }),
        h(
          "div",
          { class: "row" },
          Object.entries(CHARACTERS).map(([k, ch]) => h("button", { class: "btn", type: "button", "aria-pressed": String(k === this.who), text: ch.name, onclick: async () => (await this.load(k), this.render()) })),
        ),
        h("p", { class: "note", text: c.about }),
      ),
      h(
        "section",
        {},
        h("h3", { text: "Doing" }),
        h("div", { class: "row" }, MODES.map(([m, label]) => h("button", { class: "btn small", type: "button", "aria-pressed": String(m === this.mode), text: label, onclick: () => this.setMode(m) }))),
        h(
          "label",
          { class: "toggle" },
          h("input", { type: "checkbox", id: "path-on", checked: this.path.on, onchange: (e) => ((this.path.on = e.target.checked), this.render()) }),
          h("span", {}, "Move along a path", h("small", { text: "Walk and Carry need it to step; turn it off to see a mode standing still." })),
        ),
        this.path.on
          ? h(
              "div",
              { class: "group" },
              h("div", { class: "row" }, ["circle", "line"].map((s) => h("button", { class: "btn small", type: "button", "aria-pressed": String(this.path.shape === s), text: s, onclick: () => ((this.path.shape = s), this.render()) }))),
              ...paramsUI(this.path, "path", { skip: ["on", "shape"] }),
            )
          : null,
      ),
      h(
        "section",
        {},
        h("h3", { text: "Layers" }),
        Object.keys(P.layers).map((k) =>
          h(
            "label",
            { class: "toggle" },
            h("input", { type: "checkbox", id: `layer-${k}`, checked: P.layers[k], onchange: (e) => ((P.layers[k] = e.target.checked), this.save()) }),
            h("span", {}, k[0].toUpperCase() + k.slice(1), h("small", { text: LAYER_DOCS[k] ?? "" })),
          ),
        ),
      ),
      h("section", {}, h("h3", { text: "Numbers" }), ...paramsUI(P, `p-${this.who}`, { skip: ["layers"], onChange: () => this.save() })),
      h(
        "section",
        {},
        h("h3", { text: "Notes for Claude" }),
        notes,
        h(
          "div",
          { class: "row" },
          h("button", { class: "btn small", type: "button", text: "Note this moment", onclick: () => ((notes.value += `${notes.value ? "\n" : ""}[${this.mode} @ ${this.lab.time.toFixed(1)}s] `), (this.notes = notes.value), notes.focus()) }),
        ),
      ),
      h(
        "section",
        {},
        h("h3", { text: "Share" }),
        h(
          "div",
          { class: "row" },
          h("button", { class: "btn primary", type: "button", text: "Copy settings + notes", onclick: () => copyText(this.exportText(), this.panel) }),
          h("button", { class: "btn", type: "button", text: "Download", onclick: () => download(`${this.who}-motion.json`, new Blob([this.exportText()], { type: "application/json" })) }),
          h("button", { class: "btn", type: "button", text: "Reset to app", onclick: () => (assignDeep(P, clone(this.defaults[this.who])), this.save(), this.render(), toast("Back to the app's numbers.")) }),
        ),
        h("p", { class: "note", text: "Paste what you copy into your chat with Claude, and your numbers become the app's." }),
      ),
    );
    this.lab.legend(this.rig.labels().map((l, i) => [["#8fd3ff", "#ffb36b", "#9fe3c9", "#ff7aa8", "#c9b6ff", "#f2e27a"][i % 6], l]));
  }

  /** Where the path is at distance `s`, and which way it heads. */
  pathAt(s) {
    const { shape, radius } = this.path;
    if (shape === "circle") {
      const a = s / radius;
      return { x: Math.sin(a) * radius, z: Math.cos(a) * radius - radius, heading: Math.atan2(Math.cos(a), -Math.sin(a)) };
    }
    // Back and forth along a line.
    const L = radius * 2;
    const u = s % (2 * L);
    const fwd = u < L;
    return { x: 0, z: fwd ? u - radius : L - (u - L) - radius, heading: fwd ? 0 : Math.PI };
  }

  update(dt, t) {
    if (!this.rig) return;
    const moving = this.path.on && dt > 0;
    if (moving) this.travel += this.path.speed * dt;
    if (this.path.on) {
      const p = this.pathAt(this.travel);
      this.ground.position.set(p.x, 0, p.z);
      let d = p.heading - this.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.yaw += d * Math.min(1, dt * 6);
      this.ground.rotation.y = this.yaw;
      this.lab.follow = new THREE.Vector3(p.x, CHARACTERS[this.who].height * 0.5, p.z);
      // Dashed path line, once per change.
      const key = `${this.path.shape}${this.path.radius}`;
      if (this.pathKey !== key) {
        this.pathKey = key;
        const pts = Array.from({ length: 200 }, (_, i) => {
          const q = this.pathAt((i / 199) * this.path.radius * Math.PI * 2);
          return new THREE.Vector3(q.x, 0.01, q.z);
        });
        this.pathLine.geometry.setFromPoints(pts);
        this.pathLine.computeLineDistances();
      }
    } else this.lab.follow = null;
    this.pathLine.visible = this.path.on;
    // Paused: hold the last pose (and what it holds) rather than re-solving with no time passing.
    const held = dt > 0 ? (this.held = this.rig.pose(this.mode, t, dt)) : this.held;
    // Props: a desk in front for typing and working; the crate wherever it's held.
    const h0 = CHARACTERS[this.who].height;
    this.desk.visible = this.mode === "typing" || this.mode === "working";
    if (this.desk.visible) {
      this.desk.position.copy(this.ground.localToWorld(new THREE.Vector3(0, this.who === "rocky" ? 0.6 : 0.78, this.who === "rocky" ? 0.72 : 0.8)));
      this.desk.rotation.y = this.ground.rotation.y;
    }
    this.crate.visible = !!held;
    if (held) this.crate.position.copy(this.ground.localToWorld(held.clone()));
    if (dt > 0) this.graph.push(t, this.rig.channels());
    this.lab.hud(`${CHARACTERS[this.who].name} · ${this.mode} · ${t.toFixed(1)}s${this.path.on ? ` · ${this.path.speed.toFixed(1)} m/s` : ""} · ${h0} m tall`);
  }

  drawTimeline(ctx, w, hgt, dpr) {
    const [lo, hi] = this.rig?.range ?? [0, 1];
    this.graph.draw(ctx, w, hgt, dpr, { lo, hi, bands: true, labels: this.rig?.labels() ?? [] });
  }
}
