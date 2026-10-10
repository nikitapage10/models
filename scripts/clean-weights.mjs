// Untangle auto-rigged skin weights: a vertex on one limb that is also bound to a neighbouring limb's bones
// stretches into spikes when the limbs move apart. Each vertex keeps the joints in line with its strongest one
// (that joint's own limb and the trunk above it) and drops the side branches.
// --core: also hand the body's middle to the trunk. Auto-rigs often bind a carapace or torso to the limbs that
// sprout from it, so lifting a limb drags the body with it. Vertices nearer the centre than the limbs' roots go to
// the joint the limbs branch from, blending back to the limbs just outside that ring.
//   node scripts/clean-weights.mjs [--core] in.glb [out.glb]
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import { Matrix4, Vector3 } from "three";
await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });
const args = process.argv.slice(2);
const core = args.includes("--core");
const [src, out = src] = args.filter((a) => !a.startsWith("--"));
const doc = await io.read(src);
const root = doc.getRoot();
let changed = 0;
let total = 0;
for (const skin of root.listSkins()) {
  const joints = skin.listJoints();
  const isJoint = new Set(joints);
  const parentOf = new Map();
  for (const n of root.listNodes()) for (const c of n.listChildren()) parentOf.set(c, n);
  // Two joints are on the same line when one is the other's ancestor; joints on side branches are not.
  const ancestors = joints.map((j) => {
    const up = new Set([j]);
    for (let p = parentOf.get(j); p; p = parentOf.get(p)) up.add(p);
    return up;
  });
  const related = (a, b) => ancestors[a].has(joints[b]) || ancestors[b].has(joints[a]);
  // For --core: the joint the most limbs branch from, where it sits and how far out the limb roots are (bind pose, mesh space).
  const ibm = skin.getInverseBindMatrices();
  const at = joints.map((_, i) => new Vector3().applyMatrix4(new Matrix4().fromArray(ibm.getElement(i, [])).invert()));
  const kids = joints.map((j) => joints.map((c, i) => (parentOf.get(c) === j ? i : -1)).filter((i) => i >= 0));
  const hub = kids.reduce((best, k, i) => (k.length > kids[best].length ? i : best), 0);
  const ring = kids[hub].reduce((a, i) => a + Math.hypot(at[i].x - at[hub].x, at[i].z - at[hub].z), 0) / Math.max(1, kids[hub].length);
  const inLimb = joints.map((j) => j !== joints[hub] && ancestors[joints.indexOf(j)].has(joints[hub]));
  const smoothstep = (a, b, x) => {
    const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return u * u * (3 - 2 * u);
  };
  for (const mesh of root.listMeshes())
    for (const prim of mesh.listPrimitives()) {
      const J = prim.getAttribute("JOINTS_0");
      const W = prim.getAttribute("WEIGHTS_0");
      if (!J || !W || J.getCount() === 0 || J.getElement(0, []).length !== 4) continue;
      const P = prim.getAttribute("POSITION");
      const j = [];
      const w = [];
      const pos = [];
      for (let i = 0; i < J.getCount(); i++) {
        J.getElement(i, j);
        W.getElement(i, w);
        total++;
        if (core && kids[hub].length >= 3) {
          P.getElement(i, pos);
          const keep = smoothstep(0.8 * ring, 1.15 * ring, Math.hypot(pos[0] - at[hub].x, pos[2] - at[hub].z));
          if (keep < 1) {
            const by = new Map();
            for (let k = 0; k < 4; k++) if (w[k] > 0) by.set(j[k], (by.get(j[k]) ?? 0) + w[k] * (inLimb[j[k]] ? keep : 1));
            let moved = 0;
            for (let k = 0; k < 4; k++) if (inLimb[j[k]]) moved += w[k] * (1 - keep);
            if (moved > 0) {
              by.set(hub, (by.get(hub) ?? 0) + moved);
              const top4 = [...by].sort((a, b) => b[1] - a[1]).slice(0, 4);
              const sum = top4.reduce((a, [, x]) => a + x, 0);
              for (let k = 0; k < 4; k++) [j[k], w[k]] = top4[k] ? [top4[k][0], top4[k][1] / sum] : [0, 0];
              J.setElement(i, j);
              W.setElement(i, w);
              changed++;
              continue;
            }
          }
        }
        // The strongest joint decides which limb this vertex belongs to.
        let top = 0;
        for (let k = 1; k < 4; k++) if (w[k] > w[top]) top = k;
        let sum = 0;
        let cut = false;
        for (let k = 0; k < 4; k++) {
          if (w[k] > 0 && !related(j[top], j[k])) (w[k] = 0), (cut = true);
          sum += w[k];
        }
        if (!cut) continue;
        for (let k = 0; k < 4; k++) w[k] /= sum;
        W.setElement(i, w);
        changed++;
      }
    }
}
await io.write(out, doc);
console.log(`${changed} of ${total} vertices untangled -> ${out}`);
