#!/usr/bin/env node
// Descarga las piezas de mazmorra KayKit (CC0) desde un commit fijo a packages/client/public/assets/kaykit/.
// Uso: node scripts/fetch-kaykit.mjs   (Node >= 24, sin dependencias)
// Los archivos descargados son solo datos: se escriben a disco y se parsea su JSON, nada se ejecuta.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ORG = 'KayKit-Game-Assets';
const DUN = { repo: 'KayKit-Dungeon-Remastered-1.0', sha: 'b0ca9bd96a8072ab36a3a5464f00ed1e06a16d07', base: 'addons/kaykit_dungeon_remastered' };

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../packages/client/public/assets/kaykit');

/** @type {{src: typeof DUN, from: string, to: string}[]} */
const files = [];
const add = (src, from, to) => files.push({ src, from: `${src.base}/${from}`, to });

for (const n of ['wall', 'floor_tile_large', 'pillar']) add(DUN, `Assets/gltf/${n}.gltf.glb`, `dungeon/${n}.glb`);

const rawUrl = (f) => `https://raw.githubusercontent.com/${ORG}/${f.src.repo}/${f.src.sha}/${f.from}`;

async function download(f) {
  const res = await fetch(rawUrl(f));
  if (res.status !== 200) throw new Error(`${rawUrl(f)} respondió ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error(`${rawUrl(f)} vino vacío`);
  return buf;
}

async function save(f, buf) {
  const dest = path.join(OUT, f.to);
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, buf);
  console.log(`ok ${f.to} (${buf.length} bytes)`);
}

/** URIs externas (no data:) de buffers e imágenes de un JSON glTF. */
function externalUris(json) {
  return [...(json.buffers ?? []), ...(json.images ?? [])]
    .map((x) => x.uri)
    .filter((u) => typeof u === 'string' && !u.startsWith('data:'))
    .map((u) => decodeURIComponent(u));
}

/** JSON del chunk 0 de un .glb. */
function glbJson(buf, name) {
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${name}: no es un .glb`);
  const len = buf.readUInt32LE(12);
  if (buf.readUInt32LE(16) !== 0x4e4f534a) throw new Error(`${name}: el primer chunk no es JSON`);
  return JSON.parse(buf.subarray(20, 20 + len).toString('utf8'));
}

const fetched = new Map(); // destino -> Buffer
for (const f of files) {
  const buf = await download(f);
  fetched.set(f.to, buf);
  await save(f, buf);
}

// Verificación de referencias externas.
const known = new Set(files.map((f) => f.to));
for (const f of [...files]) {
  const dir = path.posix.dirname(f.to);
  let json;
  if (f.to.endsWith('.gltf')) json = JSON.parse(fetched.get(f.to).toString('utf8'));
  else if (f.to.endsWith('.glb')) json = glbJson(fetched.get(f.to), f.to);
  else continue;
  for (const uri of externalUris(json)) {
    const target = path.posix.join(dir, uri);
    if (known.has(target)) continue;
    if (f.to.endsWith('.gltf')) throw new Error(`${f.to} referencia "${uri}", que no está en la lista de descarga`);
    // .glb con recurso externo: se baja junto al .glb, desde la misma carpeta de origen.
    const extra = { src: f.src, from: path.posix.join(path.posix.dirname(f.from), uri), to: target };
    console.log(`aviso: ${f.to} referencia "${uri}" externo; se descarga`);
    const buf = await download(extra);
    await save(extra, buf);
    known.add(target);
  }
}
console.log(`listo: ${known.size} archivos en ${OUT}`);
