#!/usr/bin/env node
// Arma packages/client/public/assets/mixamo/ desde la carpeta de trabajo (no versionada) con los GLB de Mixamo
// y las piezas de la espada del Kingslayer, más dos armas de Quaternius (CC0) que se descargan si no están en caché.
//
// Uso: node scripts/assets/build-mixamo.mjs [--work .superpowers/kingslayer-work]   (Node >= 24)
//
// - characters/*.glb: copias tal cual de los personajes con rig de Mixamo.
// - anims/<clipId>.glb: un clip por archivo (sin malla), con fotogramas redundantes eliminados (resample).
// - weapons/*.glb: una malla por arma, transformaciones horneadas, origen en el centro de la guarda
//   (donde la hoja se une al mango) y la hoja apuntando a +Y local; el ancho de la guarda queda en X.
// - manifest.json: ids → archivos, y largo/ancho de cada arma en unidades del modelo.
//
// Es idempotente: valida todas las fuentes, borra la carpeta de salida y la vuelve a escribir.
// Los GLB descargados son solo datos: se validan y se parsean, nada se ejecuta.
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  clearNodeTransform, compactPrimitive, dedup, flatten, join, mergeDocuments, prune, resample, transformPrimitive,
} from '@gltf-transform/functions';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'packages/client/public/assets/mixamo');
const { values: args } = parseArgs({ options: { work: { type: 'string', default: '.superpowers/kingslayer-work' } } });
const WORK = path.resolve(ROOT, args.work);
const GLB = path.join(WORK, 'glb');

const QUATERNIUS_BASE = 'https://raw.githubusercontent.com/trebeljahr/quaternius-showcase/HEAD/public/glb/medieval_weapons_pack/';
const QUATERNIUS_CACHE = path.join(WORK, 'quaternius');

const CHARACTERS = {
  kingslayer: 'kingslayer-rig.glb',
  brute: 'bruto-1k.glb',
  minion: 'esbirro-1k.glb',
  mage: 'mago-1k.glb',
};

/** clipId → ruta relativa a glb/ */
const CLIPS = {};
for (const x of ['idle', 'run', 'run_2', 'jump', 'impact', 'death', 'slash', 'slash_3', 'attack_4']) {
  CLIPS[`ss_${x}`] = `pack/sword_and_shield_${x}.glb`;
}
for (const x of ['idle', 'run', 'run_2', 'jump', 'impact', 'impact_2', 'impact_4', 'slash', 'high_spin_attack']) {
  CLIPS[`gs_${x}`] = `great-sword-pack/great_sword_${x}.glb`;
}
CLIPS.gs_death = 'great-sword-pack/two_handed_sword_death.glb';
for (const x of ['idle', 'idle_2', 'run', 'walking', 'swiping', 'punch', 'dying']) {
  CLIPS[`cr_${x}`] = `creature-pack/mutant_${x}.glb`;
}
CLIPS.mg_idle = 'magic-spell-pack/standing_idle.glb';
CLIPS.mg_attack = 'magic-spell-pack/standing_1h_magic_attack_01.glb';

const KINGSLAYER_PARTS = { hoja: 'kingslayer-hoja.glb', guarda: 'kingslayer-guarda.glb', pomo: 'kingslayer-pomo.glb' };
const QUATERNIUS = { 'guard-sword': 'Sword.glb', 'great-sword': 'Claymore.glb' };
const MAX_CLIP_BYTES = 300 * 1024;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const fail = (msg) => { console.error(`build-mixamo: ${msg}`); process.exit(1); };

// ---------- 1. Fuentes ----------
const required = [
  ...Object.values(CHARACTERS).map((f) => path.join(GLB, f)),
  ...Object.values(CLIPS).map((f) => path.join(GLB, f)),
  ...Object.values(KINGSLAYER_PARTS).map((f) => path.join(WORK, f)),
];
const missing = required.filter((f) => !existsSync(f));
if (missing.length) fail(`faltan archivos de origen:\n  ${missing.map((f) => path.relative(ROOT, f)).join('\n  ')}`);

await mkdir(QUATERNIUS_CACHE, { recursive: true });
for (const file of Object.values(QUATERNIUS)) {
  const dst = path.join(QUATERNIUS_CACHE, file);
  if (!existsSync(dst)) {
    console.log(`descargando ${file}…`);
    const res = await fetch(QUATERNIUS_BASE + file).catch((e) => fail(`no se pudo descargar ${file}: ${e.message}`));
    if (!res.ok) fail(`no se pudo descargar ${file}: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.toString('latin1', 0, 4) !== 'glTF') fail(`${file} descargado no es un GLB`);
    await writeFile(dst, buf);
  }
  const sha = createHash('sha256').update(await readFile(dst)).digest('hex');
  console.log(`${file} sha256 ${sha}`);
}

await rm(OUT, { recursive: true, force: true });
for (const d of ['characters', 'anims', 'weapons']) await mkdir(path.join(OUT, d), { recursive: true });

// ---------- 2. Personajes ----------
for (const [id, file] of Object.entries(CHARACTERS)) {
  await copyFile(path.join(GLB, file), path.join(OUT, 'characters', `${id}.glb`));
}

// ---------- 3. Clips ----------
for (const [id, file] of Object.entries(CLIPS)) {
  const doc = await io.read(path.join(GLB, file));
  const root = doc.getRoot();
  if (root.listAnimations().length !== 1) fail(`${file}: se esperaba 1 animación, hay ${root.listAnimations().length}`);
  // Solo el esqueleto y la animación: fuera mallas, pieles, materiales y texturas, si las hubiera.
  for (const node of root.listNodes()) { node.setMesh(null); node.setSkin(null); }
  for (const p of [...root.listMeshes(), ...root.listSkins(), ...root.listMaterials(), ...root.listTextures()]) p.dispose();
  root.listAnimations()[0].setName(id);
  await doc.transform(resample(), dedup(), prune({ keepLeaves: true }));
  const dst = path.join(OUT, 'anims', `${id}.glb`);
  await io.write(dst, doc);
  const { size } = await stat(dst);
  if (size >= MAX_CLIP_BYTES) fail(`${id}.glb pesa ${size} B (máximo ${MAX_CLIP_BYTES})`);
}

// ---------- 4. Armas ----------
const vec = {
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  norm: (a) => vec.scale(a, 1 / Math.hypot(...a)),
};

/** Vértices (ya horneados) de las primitivas dadas. */
function points(prims) {
  const out = [];
  for (const p of prims) {
    const pos = p.getAttribute('POSITION');
    for (let i = 0; i < pos.getCount(); i++) out.push(pos.getElement(i, []));
  }
  return out;
}

function bboxCenter(pts) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p[k]); max[k] = Math.max(max[k], p[k]); }
  return vec.scale([min[0] + max[0], min[1] + max[1], min[2] + max[2]], 0.5);
}

/** Eje principal (autovector dominante de la covarianza, por iteración de potencias, determinista). */
function principalAxis(pts, orthogonalTo = null) {
  const c = pts.reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0]).map((v) => v / pts.length);
  const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of pts) {
    let d = vec.sub(p, c);
    if (orthogonalTo) d = vec.sub(d, vec.scale(orthogonalTo, vec.dot(d, orthogonalTo)));
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m[i][j] += d[i] * d[j];
  }
  let v = orthogonalTo ? vec.norm(vec.cross(orthogonalTo, Math.abs(orthogonalTo[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0])) : [0.577, 0.577, 0.577];
  for (let it = 0; it < 200; it++) {
    let w = [vec.dot(m[0], v), vec.dot(m[1], v), vec.dot(m[2], v)];
    if (orthogonalTo) w = vec.sub(w, vec.scale(orthogonalTo, vec.dot(w, orthogonalTo)));
    v = vec.norm(w);
  }
  return v;
}

/**
 * Hornea las transformaciones de los nodos en la geometría y deja una escena con nodos-malla en la raíz,
 * todos con transformación identidad.
 */
function bakeScene(doc) {
  const root = doc.getRoot();
  const scene = root.listScenes()[0];
  for (const s of root.listScenes().slice(1)) { for (const n of s.listChildren()) scene.addChild(n); s.dispose(); }
  root.setDefaultScene(scene);
  return doc.transform(flatten()).then(() => {
    for (const node of root.listNodes()) if (node.getMesh()) clearNodeTransform(node);
    // Nodos vacíos (raíces de Sketchfab/Blender) ya no aportan nada.
    for (const node of root.listNodes()) if (!node.getMesh()) { for (const c of node.listChildren()) scene.addChild(c); node.dispose(); }
    for (const node of root.listNodes()) if (!node.getParentNode()) scene.addChild(node);
  });
}

/**
 * Lleva el arma a su marco: origen en `grip`, hoja en +Y (`bladeDir`), ancho de la guarda en +X (`widthDir`).
 * Luego une todo en una malla. Devuelve medidas para el manifiesto.
 */
async function orientAndJoin(doc, grip, bladeDir, widthDir) {
  const y = vec.norm(bladeDir);
  const x = vec.norm(vec.sub(widthDir, vec.scale(y, vec.dot(widthDir, y))));
  const z = vec.cross(x, y);
  // Matriz columna-mayor de v' = R (v − grip), con R de filas x, y, z.
  const t = [-vec.dot(x, grip), -vec.dot(y, grip), -vec.dot(z, grip)];
  const mat = [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, t[0], t[1], t[2], 1];
  const root = doc.getRoot();
  for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) transformPrimitive(prim, mat);
  await doc.transform(dedup(), join({ keepNamed: false }), prune());
  const nodes = root.listNodes().filter((n) => n.getMesh());
  if (nodes.length !== 1) throw new Error(`se esperaba 1 malla tras join, hay ${nodes.length}`);
  const pts = points(nodes[0].getMesh().listPrimitives());
  const minY = Math.min(...pts.map((p) => p[1])), maxY = Math.max(...pts.map((p) => p[1]));
  const minX = Math.min(...pts.map((p) => p[0])), maxX = Math.max(...pts.map((p) => p[0]));
  return { bladeLength: +maxY.toFixed(4), handleLength: +(-minY).toFixed(4), guardWidth: +(maxX - minX).toFixed(4) };
}

async function buildKingslayerSword() {
  const doc = await io.read(path.join(WORK, KINGSLAYER_PARTS.hoja));
  doc.getRoot().listMeshes()[0].setName('hoja');
  for (const part of ['guarda', 'pomo']) {
    const other = await io.read(path.join(WORK, KINGSLAYER_PARTS[part]));
    other.getRoot().listMeshes()[0].setName(part);
    mergeDocuments(doc, other);
  }
  await bakeScene(doc);
  const root = doc.getRoot();
  // Las piezas se recortaron solo por índices: conservan todos los vértices del cuerpo. Se compactan.
  for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) compactPrimitive(prim);
  const byName = (n) => root.listMeshes().find((m) => m.getName() === n).listPrimitives();
  const guardPts = points(byName('guarda'));
  const bladePts = points(byName('hoja'));
  const grip = bboxCenter(guardPts);
  let blade = principalAxis(bladePts);
  if (vec.dot(vec.sub(bboxCenter(bladePts), grip), blade) < 0) blade = vec.scale(blade, -1);
  const width = principalAxis(guardPts, blade);
  return { doc, info: await orientAndJoin(doc, grip, blade, width) };
}

/**
 * Heurística de agarre para Quaternius: se corta el arma en rebanadas a lo largo de su eje principal y se toma
 * la rebanada más ancha (perpendicular al eje) como la guarda. La región de la guarda son las rebanadas
 * contiguas con al menos 60 % de ese ancho; el origen es el centro de su caja. La hoja es el lado más largo.
 */
async function buildQuaternius(file) {
  const doc = await io.read(path.join(QUATERNIUS_CACHE, file));
  await bakeScene(doc);
  const pts = points(doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives()));
  const axis = principalAxis(pts);
  const width = principalAxis(pts, axis);
  const along = pts.map((p) => vec.dot(p, axis));
  const lo = Math.min(...along), hi = Math.max(...along);
  const BINS = 64;
  const bin = (s) => Math.min(BINS - 1, Math.floor(((s - lo) / (hi - lo)) * BINS));
  const wMin = new Array(BINS).fill(Infinity), wMax = new Array(BINS).fill(-Infinity);
  pts.forEach((p, i) => { const b = bin(along[i]), w = vec.dot(p, width); wMin[b] = Math.min(wMin[b], w); wMax[b] = Math.max(wMax[b], w); });
  const ext = wMin.map((m, b) => (wMax[b] >= m ? wMax[b] - m : 0));
  const top = ext.indexOf(Math.max(...ext));
  let a = top, b = top;
  while (a > 0 && ext[a - 1] >= 0.6 * ext[top]) a--;
  while (b < BINS - 1 && ext[b + 1] >= 0.6 * ext[top]) b++;
  const guardPts = pts.filter((_, i) => bin(along[i]) >= a && bin(along[i]) <= b);
  const grip = bboxCenter(guardPts);
  const g = vec.dot(grip, axis);
  const blade = hi - g >= g - lo ? axis : vec.scale(axis, -1);
  return { doc, info: await orientAndJoin(doc, grip, blade, width) };
}

const weapons = {};
const builds = {
  'kingslayer-sword': buildKingslayerSword,
  'guard-sword': () => buildQuaternius(QUATERNIUS['guard-sword']),
  'great-sword': () => buildQuaternius(QUATERNIUS['great-sword']),
};
for (const [id, build] of Object.entries(builds)) {
  const { doc, info } = await build();
  await io.write(path.join(OUT, 'weapons', `${id}.glb`), doc);
  weapons[id] = { file: `weapons/${id}.glb`, ...info };
}

// ---------- 5. Manifiesto ----------
const manifest = {
  characters: Object.fromEntries(Object.keys(CHARACTERS).map((id) => [id, `characters/${id}.glb`])),
  anims: Object.fromEntries(Object.keys(CLIPS).map((id) => [id, `anims/${id}.glb`])),
  // Medidas en unidades del modelo (sin escalar): +Y = largo de hoja, −Y = mango, X = ancho de la guarda.
  weapons,
};
await writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`listo: ${Object.keys(CHARACTERS).length} personajes, ${Object.keys(CLIPS).length} clips, ${Object.keys(weapons).length} armas → ${path.relative(ROOT, OUT)}`);
