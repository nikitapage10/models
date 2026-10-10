// Untangle auto-rigged skin weights: a vertex on one limb that is also bound to a neighbouring limb's bones
// stretches into spikes when the limbs move apart. Each vertex keeps the joints in line with its strongest one
// (that joint's own limb and the trunk above it) and drops the side branches.
//   node scripts/clean-weights.mjs in.glb [out.glb]
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });
const [src, out = src] = process.argv.slice(2);
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
  for (const mesh of root.listMeshes())
    for (const prim of mesh.listPrimitives()) {
      const J = prim.getAttribute("JOINTS_0");
      const W = prim.getAttribute("WEIGHTS_0");
      if (!J || !W || J.getCount() === 0 || J.getElement(0, []).length !== 4) continue;
      const j = [];
      const w = [];
      for (let i = 0; i < J.getCount(); i++) {
        J.getElement(i, j);
        W.getElement(i, w);
        total++;
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
