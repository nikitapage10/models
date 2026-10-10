import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import fs from "node:fs"; import path from "node:path"; import sharp from "sharp";
const root = process.argv[2], out = process.argv[3];
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const files = [];
(function walk(d){ for (const e of fs.readdirSync(d,{withFileTypes:true})) { const p=path.join(d,e.name); if(e.isDirectory()) walk(p); else if(/\.(gltf|glb)$/i.test(e.name)) files.push(p);} })(root);
const rows = [];
for (const f of files) {
  try {
    const doc = await io.read(f); const r = doc.getRoot();
    let tris=0, verts=0, prims=0;
    for (const m of r.listMeshes()) for (const p of m.listPrimitives()) { prims++; const pos=p.getAttribute("POSITION"); verts+=pos?pos.getCount():0; const idx=p.getIndices(); tris += Math.floor((idx?idx.getCount():(pos?pos.getCount():0))/3); }
    const tex = [];
    for (const t of r.listTextures()) { let w=0,h=0; try{const md=await sharp(Buffer.from(t.getImage())).metadata(); w=md.width;h=md.height;}catch{} tex.push({uri:t.getURI(), w, h, bytes:t.getImage()?.byteLength||0}); }
    const skins = r.listSkins().map(s=>({joints:s.listJoints().length, names:s.listJoints().map(j=>j.getName())}));
    const anims = r.listAnimations().map(a=>a.getName());
    // on-disk size incl. sidecar files
    let bytes = fs.statSync(f).size;
    if (f.endsWith(".gltf")) { const j=JSON.parse(fs.readFileSync(f,"utf8")); for (const b of [...(j.buffers||[]),...(j.images||[])]) if (b.uri && !b.uri.startsWith("data:")) { try { bytes += fs.statSync(path.join(path.dirname(f), decodeURIComponent(b.uri))).size; } catch {} } }
    const bb = (()=>{ let mn=[1e9,1e9,1e9], mx=[-1e9,-1e9,-1e9]; for (const m of r.listMeshes()) for (const p of m.listPrimitives()) { const a=p.getAttribute("POSITION"); if(!a) continue; const lo=a.getMin([]), hi=a.getMax([]); for(let i=0;i<3;i++){mn[i]=Math.min(mn[i],lo[i]);mx[i]=Math.max(mx[i],hi[i]);} } return mx.map((v,i)=>+(v-mn[i]).toFixed(2)); })();
    rows.push({ file: path.relative(root,f), bytes, meshes:r.listMeshes().length, prims, tris, verts, materials:r.listMaterials().map(m=>m.getName()), tex, skins, anims, size: bb });
  } catch (e) { rows.push({ file: path.relative(root,f), error: String(e.message||e) }); }
}
fs.writeFileSync(out, JSON.stringify(rows));
console.log(rows.length, "indexed;", rows.filter(r=>r.error).length, "errors");
