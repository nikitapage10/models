import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { $, h } from "./ui.js";
import { MotionWorkspace } from "./motion.js";
import { AnimatorWorkspace } from "./animator.js";

/**
 * The lab's shared stage: one renderer, camera, floor and transport (play, pause, slow motion, step), and a
 * timeline canvas the active workspace draws into. Workspaces own the panel and what's on stage.
 */

const stageEl = $("#stage");
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
stageEl.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color("#15181f");
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
const sun = new THREE.DirectionalLight("#ffffff", 2.2);
sun.position.set(3, 6, 4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6 });
scene.add(sun, new THREE.HemisphereLight("#cfd8ff", "#2a2420", 0.4));
const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: "#20232a", roughness: 0.95 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
const grid = new THREE.GridHelper(40, 80, "#3a404c", "#2a2f38");
grid.position.y = 0.001;
scene.add(grid);

const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 200);
camera.position.set(2.6, 1.8, 3.4);
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.target.set(0, 0.7, 0);
orbit.enableDamping = true;
const gizmo = new TransformControls(camera, renderer.domElement);
gizmo.addEventListener("dragging-changed", (e) => (orbit.enabled = !e.value));
scene.add(gizmo.getHelper());

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

/** Everything a workspace gets from the stage. */
export const lab = {
  THREE,
  scene,
  camera,
  orbit,
  gizmo,
  renderer,
  load: (url) => loader.loadAsync(url),
  /** Seconds of lab time; runs at `speed`, stops when paused. */
  time: 0,
  speed: 1,
  paused: false,
  /** Set by the transport's step button: advance one frame while paused. */
  stepOnce: false,
  hud: (text) => ($("#hud").textContent = text),
  legend: (items) => $("#legend").replaceChildren(...items.map(([c, label]) => h("span", {}, h("i", { style: `background:${c}` }), label))),
  /** Follow a point with the camera target (the walk path). */
  follow: null,
};

// Transport: play/pause, speeds, single-frame step.
const transport = $("#transport");
const pause = h("button", { class: "btn small", type: "button", text: "Pause", onclick: () => setPaused(!lab.paused) });
function setPaused(p) {
  lab.paused = p;
  pause.textContent = p ? "Play" : "Pause";
}
transport.append(
  pause,
  h("button", { class: "btn small", type: "button", text: "Step", title: "Advance one frame", onclick: () => (setPaused(true), (lab.stepOnce = true)) }),
  ...[0.1, 0.25, 0.5, 1].map((s) =>
    h("button", {
      class: "btn small speed",
      type: "button",
      text: s === 1 ? "1×" : `${s}×`,
      "aria-pressed": String(s === 1),
      onclick: (e) => {
        lab.speed = s;
        transport.querySelectorAll(".speed").forEach((b) => b.setAttribute("aria-pressed", String(b === e.currentTarget)));
      },
    }),
  ),
);
lab.setPaused = setPaused;

// Timeline canvas, sized to its box; the workspace draws it every frame.
const tlCanvas = $("#timeline-canvas");
const tl = tlCanvas.getContext("2d");
lab.timelineCanvas = tlCanvas;

function resize() {
  const r = stageEl.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / Math.max(1, r.height);
  camera.updateProjectionMatrix();
  const t = tlCanvas.getBoundingClientRect();
  tlCanvas.width = Math.round(t.width * devicePixelRatio);
  tlCanvas.height = Math.round(t.height * devicePixelRatio);
}
new ResizeObserver(resize).observe(stageEl);
new ResizeObserver(resize).observe(tlCanvas);

// Workspaces.
const workspaces = { motion: new MotionWorkspace(lab), animator: new AnimatorWorkspace(lab) };
let active = null;
async function open(name) {
  active?.unmount();
  scene.remove(...(active?.objects ?? []));
  gizmo.detach();
  document.querySelectorAll(".tab").forEach((b) => b.setAttribute("aria-selected", String(b.id === `tab-${name}`)));
  active = workspaces[name];
  $("#panel").replaceChildren();
  $("#legend").replaceChildren();
  await active.mount($("#panel"));
  try {
    location.hash = name;
  } catch {
    /* ignore */
  }
}
$("#tab-motion").addEventListener("click", () => open("motion"));
$("#tab-animator").addEventListener("click", () => open("animator"));

const clock = new THREE.Clock();
function frame() {
  const real = Math.min(clock.getDelta(), 0.1);
  let dt = lab.paused ? 0 : real * lab.speed;
  if (lab.stepOnce) {
    dt = 1 / 60;
    lab.stepOnce = false;
  }
  lab.time += dt;
  active?.update(dt, lab.time);
  if (lab.follow) {
    orbit.target.lerp(lab.follow, 0.15);
  }
  orbit.update();
  renderer.render(scene, camera);
  tl.setTransform(1, 0, 0, 1, 0, 0);
  tl.clearRect(0, 0, tlCanvas.width, tlCanvas.height);
  active?.drawTimeline(tl, tlCanvas.width, tlCanvas.height, devicePixelRatio);
  requestAnimationFrame(frame);
}
resize();
await open(location.hash === "#animator" ? "animator" : "motion");
frame();
window.lab = lab;
lab.active = () => active;
