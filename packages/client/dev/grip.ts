// Página de desarrollo (no entra al build): ajustar a ojo el agarre de cada arma en la mano del
// Kingslayer (y su `gripScale` en brute y minion) y revisar los clips y el brillo por tier.
// `npm run dev` → http://localhost:5173/dev/grip.html
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Engine } from "@babylonjs/core/Engines/engine";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { MOVESETS, WEAPONS, type WeaponId, type WeaponTier } from "@roguelike/shared";
import { AnimLibrary } from "../src/render/animLibrary";
import { loadAssets, type AssetId } from "../src/render/assets";
import { CharacterView } from "../src/render/characterView";
import { createScene } from "../src/render/createScene";
import { allClipIds, ENEMY_LOOKS, PLAYER_LOOK, WEAPON_LOOKS } from "../src/render/looks";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("view");
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true });
const scene = createScene(engine);
for (const l of scene.lights) l.intensity *= 1.5; // más luz que en el juego, para ver detalles
const ground = CreateGround("ground", { width: 6, height: 6 }, scene);
const gm = new StandardMaterial("ground", scene);
gm.diffuseColor = new Color3(0.25, 0.25, 0.3);
ground.material = gm;
// regla de 1,8 m a un costado, para comparar alturas y largos
const ruler = CreateBox("ruler", { width: 0.04, depth: 0.04, height: 1.8 }, scene);
ruler.position.set(-0.8, 0.9, 0);
for (let i = 1; i < 18; i++) {
  const tick = CreateBox(`tick${i}`, { width: i % 5 === 0 ? 0.2 : 0.1, depth: 0.02, height: 0.01 }, scene);
  tick.position.set(-0.8, i * 0.1, 0);
}

const camera = new ArcRotateCamera("cam", Math.PI / 2, 1.3, 3.2, new Vector3(0, 1, 0), scene);
camera.attachControl(canvas, true);
camera.wheelPrecision = 60;
camera.minZ = 0.01;

const characters: Record<string, { asset: AssetId; height: number; gripScale?: number }> = {
  kingslayer: PLAYER_LOOK,
  brute: ENEMY_LOOKS.brute,
  minion: ENEMY_LOOKS.minion,
  mage: ENEMY_LOOKS.mage,
};
const assets = await loadAssets(scene, [
  "kingslayer",
  "brute",
  "minion",
  "mage",
  "kingslayer-sword",
  "guard-sword",
  "great-sword",
]);
const anims = new AnimLibrary(scene);
await anims.load(allClipIds());

const characterSel = $<HTMLSelectElement>("character");
const weaponSel = $<HTMLSelectElement>("weapon");
const tierSel = $<HTMLSelectElement>("tier");
const gripScaleField = $<HTMLInputElement>("gs");
const clipSel = $<HTMLSelectElement>("clip");
const frac = $<HTMLInputElement>("frac");
const playing = $<HTMLInputElement>("playing");
const camSel = $<HTMLSelectElement>("cam");
const fields = ["px", "py", "pz", "rx", "ry", "rz", "sc"].map((id) => $<HTMLInputElement>(id));
const out = $<HTMLTextAreaElement>("out");

const option = (sel: HTMLSelectElement, value: string, text = value) => sel.add(new Option(text, value));
for (const c of Object.keys(characters)) option(characterSel, c);
option(weaponSel, "", "(ninguna)");
for (const w of Object.values(WEAPONS)) option(weaponSel, w.id, w.name);
weaponSel.value = "kingslayer-sword";

let view: CharacterView | undefined;
let clip = "";

function clipsFor(weapon: WeaponId | ""): string[] {
  if (characterSel.value !== "kingslayer") return allClipIds();
  if (!weapon) return allClipIds();
  const m = MOVESETS[WEAPONS[weapon].movesetId];
  return [...new Set([m.locomotion.idle, ...m.combo.map((s) => s.clip), ...Object.values(m.locomotion), ...allClipIds()])];
}

function fillClips(): void {
  const keep = clipSel.value;
  clipSel.innerHTML = "";
  for (const c of clipsFor(weaponSel.value as WeaponId | "")) option(clipSel, c);
  if ([...clipSel.options].some((o) => o.value === keep)) clipSel.value = keep;
}

function fillFields(): void {
  gripScaleField.value = String(characters[characterSel.value]!.gripScale ?? 1);
  const w = weaponSel.value as WeaponId | "";
  const disabled = !w;
  for (const f of fields) f.disabled = disabled;
  if (!w) return;
  const g = WEAPON_LOOKS[w].grip;
  const deg = (r: number) => Math.round((r * 180) / Math.PI * 10) / 10;
  [fields[0]!.value, fields[1]!.value, fields[2]!.value] = g.position.map(String) as [string, string, string];
  [fields[3]!.value, fields[4]!.value, fields[5]!.value] = g.rotation.map((r) => String(deg(r))) as [string, string, string];
  fields[6]!.value = String(g.scale);
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

function writeOut(): void {
  const w = weaponSel.value as WeaponId | "";
  if (!w) {
    out.value = "";
    return;
  }
  const g = WEAPON_LOOKS[w].grip;
  const r = g.rotation.map((v) => round(v, 4));
  // largo de la hoja en el mundo, para comparar con la regla
  let lo = Infinity;
  let hi = -Infinity;
  for (const m of scene.meshes) {
    if (!m.name.startsWith(w) && !m.parent?.name.startsWith("grip")) continue;
    if (!m.getTotalVertices()) continue;
    m.computeWorldMatrix(true);
    const b = m.getBoundingInfo().boundingBox;
    lo = Math.min(lo, b.minimumWorld.y);
    hi = Math.max(hi, b.maximumWorld.y);
  }
  out.value =
    `"${w}": { asset: "${WEAPON_LOOKS[w].asset}", grip: { position: [${g.position.map((v) => round(v, 3)).join(", ")}], ` +
    `rotation: [${r.join(", ")}], scale: ${round(g.scale, 4)} } },` +
    `\n// ${characterSel.value}: gripScale: ${round(characters[characterSel.value]!.gripScale ?? 1, 3)}` +
    (Number.isFinite(lo) ? `\n// alto vertical del arma en el mundo: ${round(hi - lo, 3)} m` : "");
}

function readFields(): void {
  const w = weaponSel.value as WeaponId | "";
  if (!w) return;
  const n = fields.map((f) => Number(f.value) || 0);
  const rad = (d: number) => (d * Math.PI) / 180;
  WEAPON_LOOKS[w].grip = {
    position: [n[0]!, n[1]!, n[2]!],
    rotation: [rad(n[3]!), rad(n[4]!), rad(n[5]!)],
    scale: n[6]! || 1,
  };
  applyWeapon();
}

function applyWeapon(): void {
  if (!view) return;
  view.setWeapon(null);
  const w = weaponSel.value as WeaponId | "";
  const gripScale = characters[characterSel.value]!.gripScale;
  if (w) view.setWeapon(w, { tier: Number(tierSel.value) as WeaponTier, gripScale });
  writeOut();
}

function currentGroup() {
  return scene.animationGroups.find((g) => g.isPlaying || g.name.startsWith(clip + "#"));
}

function applyClip(): void {
  clip = clipSel.value;
  applyPause();
}

function applyPause(): void {
  if (!view) return;
  view.play({ clip, loop: true, speed: 1 }, true);
  if (playing.checked) return;
  const g = scene.animationGroups.find((x) => x.name.startsWith(clip + "#") && x.isPlaying);
  if (!g) return;
  // Un cuadro sonando antes de pausar: un grupo pausado recién creado no aplica ninguna pose.
  scene.render();
  g.pause();
  g.goToFrame(g.from + Number(frac.value) * (g.to - g.from));
}

function buildView(): void {
  view?.dispose();
  view = new CharacterView(scene, assets, anims, characters[characterSel.value]!);
  view.setPose(0, 0, 0, 0);
  applyWeapon();
  applyClip();
}

function applyCamera(): void {
  const h = characters[characterSel.value]!.height;
  const presets: Record<string, [number, number, number, number]> = {
    front: [Math.PI / 2, 1.4, h * 2.2, h * 0.5],
    side: [0, 1.4, h * 2.2, h * 0.5],
    back: [-Math.PI / 2, 1.4, h * 2.2, h * 0.5],
    hand: [Math.PI / 3, 1.3, 0.7, 0],
  };
  const [alpha, beta, radius, y] = presets[camSel.value]!;
  camera.alpha = alpha;
  camera.beta = beta;
  camera.radius = radius;
  camera.target.set(0, y, 0);
  if (camSel.value === "hand") {
    // centrada en la mano derecha (su posición en la pose actual)
    const hand = scene.transformNodes.find((n) => /^mixamorig\d*:RightHand#/i.test(n.name));
    if (hand) camera.target.copyFrom(hand.getAbsolutePosition());
  }
}

characterSel.onchange = () => {
  fillClips();
  fillFields();
  buildView();
  applyCamera();
};
weaponSel.onchange = () => {
  fillClips();
  fillFields();
  applyWeapon();
  applyClip();
};
tierSel.onchange = applyWeapon;
// Toca el look del personaje solo en esta página: el valor a copiar sale en el cuadro de abajo.
gripScaleField.oninput = () => {
  characters[characterSel.value]!.gripScale = Number(gripScaleField.value) || 1;
  applyWeapon();
};
clipSel.onchange = applyClip;
frac.oninput = () => {
  playing.checked = false;
  applyPause();
};
playing.onchange = applyPause;
camSel.onchange = applyCamera;
for (const f of fields) f.oninput = readFields;

window.addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement).tagName === "INPUT" || !weaponSel.value) return;
  const map: Record<string, [number, number]> = { KeyQ: [0, 1], KeyA: [0, -1], KeyW: [1, 1], KeyS: [1, -1], KeyE: [2, 1], KeyD: [2, -1] };
  const hit = map[e.code];
  if (!hit) return;
  const [axis, sign] = hit;
  const f = fields[e.shiftKey ? 3 + axis : axis]!;
  f.value = String(round(Number(f.value) + sign * (e.shiftKey ? 5 : 0.005), 4));
  readFields();
});

fillClips();
fillFields();
buildView();
applyCamera();
engine.runRenderLoop(() => scene.render());
window.addEventListener("resize", () => engine.resize());

// para automatizar capturas desde Chrome headless
(window as unknown as { grip: unknown }).grip = {
  scene,
  ready: true,
  set(opts: { character?: string; weapon?: string; tier?: number; gripScale?: number; clip?: string; frac?: number; cam?: string; grip?: unknown; alpha?: number; beta?: number; radius?: number }) {
    if (opts.character && opts.character !== characterSel.value) {
      characterSel.value = opts.character;
      fillClips();
      fillFields();
      buildView();
    }
    if (opts.gripScale !== undefined) {
      gripScaleField.value = String(opts.gripScale);
      characters[characterSel.value]!.gripScale = opts.gripScale;
      applyWeapon();
    }
    if (opts.tier !== undefined) {
      tierSel.value = String(opts.tier);
      applyWeapon();
    }
    if (opts.weapon !== undefined && opts.weapon !== weaponSel.value) {
      weaponSel.value = opts.weapon;
      fillClips();
      fillFields();
      applyWeapon();
    }
    if (opts.grip && weaponSel.value) {
      WEAPON_LOOKS[weaponSel.value as WeaponId].grip = opts.grip as (typeof WEAPON_LOOKS)[WeaponId]["grip"];
      fillFields();
      applyWeapon();
    }
    if (opts.clip) {
      clipSel.value = opts.clip;
      applyClip();
    }
    if (opts.frac !== undefined) {
      playing.checked = false;
      frac.value = String(opts.frac);
      applyPause();
    } else if (opts.clip) {
      playing.checked = true;
      applyPause();
    }
    if (opts.cam) camSel.value = opts.cam;
    scene.render();
    applyCamera();
    if (opts.alpha !== undefined) camera.alpha = opts.alpha;
    if (opts.beta !== undefined) camera.beta = opts.beta;
    if (opts.radius !== undefined) camera.radius = opts.radius;
    return out.value;
  },
  currentGroup,
};
