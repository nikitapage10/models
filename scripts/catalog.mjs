import fs from "node:fs"; import path from "node:path";
const [idx, thumbsDir, out] = process.argv.slice(2);
const rows = JSON.parse(fs.readFileSync(idx, "utf8"));
const meta = JSON.parse(fs.readFileSync(path.join(thumbsDir, "_meta.json"), "utf8"));
const PACKS = {
  "drive-download-20261010T063841Z-1-001": ["men", "Ultimate Modular Men"],
  "drive-download-20261010T063851Z-1-001": ["women", "Ultimate Modular Women"],
  "drive-download-20261010T063739Z-1-001": ["animals", "Ultimate Animated Animals"],
  "drive-download-20261010T063522Z-1-001": ["robots", "Animated Robots (George, Leela, Mike, Stan)"],
  "drive-download-20261010T063222Z-1-001": ["monsters", "Ultimate Monsters (Big, Blob, Flying)"],
  "Bestiary - Dungeon Monsters Kit[Standard]": ["bestiary", "Bestiary - Dungeon Monsters Kit"],
  "Downtown City MegaKit[Standard]": ["downtown", "Downtown City MegaKit"],
  "Fantasy Props MegaKit[Standard]": ["fantasy-props", "Fantasy Props MegaKit"],
  "Medieval Village MegaKit[Standard]": ["medieval", "Medieval Village MegaKit"],
  "Modular Character Outfits - Fantasy[Standard]": ["outfits", "Modular Character Outfits - Fantasy"],
  "Modular SciFi MegaKit[Standard]": ["scifi-modular", "Modular SciFi MegaKit"],
  "Sci-Fi Essentials Kit[Standard]": ["scifi-essentials", "Sci-Fi Essentials Kit"],
  "Stylized Nature MegaKit[Standard]": ["nature", "Stylized Nature MegaKit"],
  "Universal Animation Library 2[Standard]": ["ual2", "Universal Animation Library 2"],
};
const RIGS = { "65:root,pelvis": "quaternius-universal (UAL)", "55:root,pelvis": "quaternius-universal (UAL)", "62:Root,Body": "modular-humans", "43:Root,Foot.L": "monster-big", "4:Body,Head": "monster-blob", "13:Root,Torso": "monster-flying" };
const NOISE = new Set(["glTF","Exports","Individual Characters","Textured","Unreal-Godot","GLB (Godot-Unreal)"]);
const models = [];
for (const r of rows) {
  if (r.error || !meta[r.file]) continue;
  const parts = r.file.split("/"); const [slug, name] = PACKS[parts[0]];
  const rest = parts.slice(1).filter((p, i) => !(i === 0 && p === parts[0]) && !NOISE.has(p) && !/^glTF/.test(p) && p !== "Outfits" && !PACKS[p] && !p.endsWith("[Standard]"));
  const id = rest.join("/").replace(/\.(gltf|glb)$/i, "");
  const thumb = `thumbs/${slug}/${id.replace(/[^\w.-]+/g, "_")}.webp`;
  fs.mkdirSync(path.dirname(path.join(out, thumb)), { recursive: true });
  fs.copyFileSync(path.join(thumbsDir, meta[r.file].thumb), path.join(out, thumb));
  const sk = r.skins[0]; const rigKey = sk && `${sk.joints}:${sk.names.slice(0, 2).join(",")}`;
  models.push({ pack: slug, id, source: r.file, tris: r.tris, materials: r.materials.length,
    textures: [...new Set(r.tex.map(t => `${t.w}x${t.h}`))], size: meta[r.file].size,
    rig: sk ? (RIGS[rigKey] || `own (${sk.joints} bones)`) : null, anims: r.anims, thumb });
}
const packs = Object.fromEntries(Object.values(PACKS).map(([s, n]) => [s, { name: n, count: models.filter(m => m.pack === s).length }]));
fs.writeFileSync(path.join(out, "catalog.json"), JSON.stringify({ packs, models }, null, 0).replace(/\},\{"pack"/g, '},\n{"pack"'));
console.log(models.length, "models", Object.entries(packs).map(([k, v]) => `${k}:${v.count}`).join(" "));
