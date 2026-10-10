import { NodeIO } from "@gltf-transform/core"; import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, resample, textureCompress, meshopt, weld } from "@gltf-transform/functions";
import { MeshoptEncoder } from "meshoptimizer"; import sharp from "sharp"; import fs from "node:fs"; import path from "node:path";
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({"meshopt.encoder": MeshoptEncoder});
const [root, catalog, out] = process.argv.slice(2);
const { models } = JSON.parse(fs.readFileSync(catalog, "utf8"));
let total = 0, n = 0;
for (const m of models) {
  const o = path.join(out, m.pack, m.id + ".glb"); fs.mkdirSync(path.dirname(o), { recursive: true });
  try { const doc = await io.read(path.join(root, m.source));
    await doc.transform(dedup(), weld(), resample(), prune(), textureCompress({ encoder: sharp, targetFormat: "webp", resize: [1024, 1024], quality: 85 }), meshopt({ encoder: MeshoptEncoder, level: "medium" }));
    await io.write(o, doc); total += fs.statSync(o).size;
  } catch (e) { console.log("fail", m.pack, m.id, e.message.slice(0, 100)); }
  if (++n % 100 === 0) console.log(n, (total / 1e6).toFixed(0) + " MB");
}
console.log("done", n, (total / 1e6).toFixed(0) + " MB");
