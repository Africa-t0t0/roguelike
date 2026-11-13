import { Constants } from "@babylonjs/core/Engines/constants";
import type { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { THRUST_TRAIL_TICK_S, type Nature } from "@roguelike/shared";
import type { WorldSnapshot, ZoneKind, ZoneSnapshot } from "../net/connection";
import { generated, radial, rockTexture, swirlTexture, telegraphTexture } from "./fxTextures";
import { NATURE_COLORS } from "./natureLooks";
import { ARCANE_COLOR } from "./staffMesh";

const ICE = new Color3(0.55, 0.85, 1);
const FIRE = new Color3(1, 0.45, 0.1);
const FLOOR_Y = 0.05; // m: sobre las marcas del suelo
const FADE_S = 0.35;
/** El meteorito cae en diagonal desde esta altura y este desvío (m) hacia el punto de impacto. */
const METEOR_FROM_Y = 16;
const METEOR_FROM_X = 5;
/** Diámetro del meteorito respecto del radio de su impacto. */
const METEOR_SIZE = 0.75;
const MINE_SIZE_M = 0.55;

/** Zonas del mago que dibuja esta vista (las grietas y el Estandarte tienen las suyas). */
const KINDS: readonly ZoneKind[] = ["frost", "mine", "meteors", "meteor", "meteorBig", "trail", "fire", "ice", "scar"];

interface ZoneView {
  kind: ZoneKind;
  root: TransformNode;
  /** marca del suelo: su opacidad sigue la vida de la zona */
  floor: Mesh;
  /** segundo plano del suelo (el relleno del aviso del meteorito, el brillo de la mina) */
  inner?: Mesh;
  /** lo que cae o flota (el meteorito, el orbe de la mina) */
  body?: TransformNode;
  /** la roca del meteorito, que gira sobre sí misma */
  spin?: Mesh;
  radius: number;
  /** instante (reloj de juego) en que nació, deducido de `total - left` al verla por primera vez */
  bornMs: number;
  totalS: number;
}

/**
 * Lo que los hechizos del mago dejan en el suelo: la Escarcha (disco de hielo que gira despacio), la Mina
 * (runa que late), la lluvia de Meteoros (aro de fuego) con cada meteorito (aviso que se llena mientras la
 * roca cae en diagonal) y el rastro de la Esfera. Los estallidos los dibuja `AbilityFx.blast` con el evento.
 */
export class SpellZoneViews {
  private readonly views = new Map<string, ZoneView>();
  private readonly tex: Record<"ring" | "frost" | "disc" | "rock" | "rune", DynamicTexture>;
  private readonly mats: Record<"frost" | "frostRing" | "mine" | "mineGlow" | "mineOrb" | "meteors" | "warn" | "warnFill" | "frostFill" | "scar" | "scarCore" | "trail" | "rock" | "tail", StandardMaterial>;

  private readonly tinted = new Map<string, StandardMaterial>();

  constructor(private readonly scene: Scene) {
    this.tex = {
      ring: telegraphTexture(scene, "spell-ring"),
      frost: swirlTexture(scene, "spell-frost"),
      disc: generated(scene, "spell-disc", 128, (ctx, s) =>
        radial(ctx, s, [
          [0, "rgba(255, 255, 255, 0.9)"],
          [0.7, "rgba(255, 255, 255, 0.55)"],
          [1, "rgba(255, 255, 255, 0)"],
        ]),
      ),
      rock: rockTexture(scene, "spell-rock"),
      rune: generated(scene, "spell-rune", 128, (ctx, s) => {
        // Runa de la mina: dos aros y una estrella de seis puntas.
        ctx.strokeStyle = "rgba(255, 255, 255, 1)";
        ctx.lineWidth = s * 0.035;
        for (const r of [0.44, 0.3]) {
          ctx.beginPath();
          ctx.arc(s / 2, s / 2, s * r, 0, Math.PI * 2);
          ctx.stroke();
        }
        for (const turn of [0, Math.PI]) {
          ctx.beginPath();
          for (let i = 0; i < 3; i++) {
            const a = turn + (i * 2 * Math.PI) / 3 - Math.PI / 2;
            const x = s / 2 + Math.cos(a) * s * 0.3;
            const y = s / 2 + Math.sin(a) * s * 0.3;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.closePath();
          ctx.stroke();
        }
      }),
    };
    const glow = (name: string, color: Color3, opacity: DynamicTexture, alpha = 1) => {
      const m = new StandardMaterial(name, scene);
      m.diffuseColor = Color3.Black();
      m.specularColor = Color3.Black();
      m.emissiveColor = color.clone();
      m.disableLighting = true;
      m.fogEnabled = false;
      m.backFaceCulling = false;
      m.opacityTexture = opacity;
      m.alphaMode = Constants.ALPHA_ADD;
      m.alpha = alpha;
      return m;
    };
    // Roca al rojo: sin luces, para que la antorcha no la queme a blanco.
    const rock = new StandardMaterial("spellRock", scene);
    rock.diffuseColor = Color3.Black();
    rock.specularColor = Color3.Black();
    rock.emissiveTexture = this.tex.rock;
    rock.emissiveColor = new Color3(1, 0.42, 0.12);
    rock.disableLighting = true;
    rock.fogEnabled = false;
    this.mats = {
      frost: glow("spellFrost", ICE, this.tex.frost, 0.75),
      frostRing: glow("spellFrostRing", ICE, this.tex.ring),
      mine: glow("spellMine", ARCANE_COLOR, this.tex.rune),
      mineGlow: glow("spellMineGlow", ARCANE_COLOR, this.tex.disc, 0.6),
      mineOrb: glow("spellMineOrb", ARCANE_COLOR, this.tex.disc, 0.9),
      meteors: glow("spellMeteors", FIRE, this.tex.ring, 0.7),
      warn: glow("spellWarn", FIRE, this.tex.ring),
      warnFill: glow("spellWarnFill", FIRE, this.tex.disc, 0.55),
      trail: glow("spellTrail", ARCANE_COLOR, this.tex.disc, 0.6),
      rock,
      tail: glow("spellTail", new Color3(1, 0.38, 0.08), this.tex.disc, 0.55),
      frostFill: glow("spellFrostFill", ICE, this.tex.disc, 0.3),
      // Rastro del Tajo: brasa roja intensa con un núcleo casi blanco, para que se lea como suelo que quema.
      scar: glow("spellScar", new Color3(1, 0.28, 0.04), this.tex.disc, 0.95),
      scarCore: glow("spellScarCore", new Color3(1, 0.8, 0.45), this.tex.disc, 0.8),
    };
  }

  /**
   * Material de ese nombre con el color de la naturaleza del bastón de quien lanzó el hechizo (un clon por
   * naturaleza, hecho al primer uso); sin naturaleza, el de siempre. La Escarcha no pasa por aquí: siempre es hielo.
   */
  private tint(name: keyof SpellZoneViews["mats"], nature: Nature): StandardMaterial {
    const base = this.mats[name];
    if (nature === "none") return base;
    const key = `${name}-${nature}`;
    let mat = this.tinted.get(key);
    if (!mat) {
      mat = base.clone(`${base.name}-${nature}`);
      mat.emissiveColor = NATURE_COLORS[nature].clone();
      this.tinted.set(key, mat);
    }
    return mat;
  }

  /** `receivedAtMs`: instante de recepción en el reloj de juego. */
  push(world: WorldSnapshot, receivedAtMs: number): void {
    for (const [id, z] of world.zones) {
      if (!KINDS.includes(z.kind) || this.views.has(id)) continue;
      this.views.set(id, this.create(id, z, receivedAtMs));
    }
    for (const [id, view] of this.views) {
      if (world.zones.has(id)) continue;
      view.root.dispose(false, false); // los materiales son compartidos
      this.views.delete(id);
    }
  }

  /** `nowMs`: reloj de juego (quieto en la pausa). */
  render(nowMs: number): void {
    const t = nowMs / 1000;
    for (const view of this.views.values()) {
      const age = Math.max(0, (nowMs - view.bornMs) / 1000);
      const left = view.totalS - age;
      const fade = Math.max(0, Math.min(1, age / FADE_S + 0.15, left / FADE_S));
      switch (view.kind) {
        case "frost":
          view.floor.rotation.y = t * 0.35;
          view.floor.visibility = fade;
          if (view.inner) view.inner.visibility = fade * (0.7 + 0.3 * Math.sin(t * 3));
          break;
        case "mine": {
          const pulse = 0.6 + 0.4 * Math.sin(t * 4);
          view.floor.rotation.y = t * 0.8;
          view.floor.visibility = Math.min(1, age / FADE_S + 0.15) * (0.7 + 0.3 * pulse);
          if (view.inner) view.inner.visibility = 0.35 + 0.4 * pulse;
          if (view.body) view.body.position.y = 0.32 + 0.06 * Math.sin(t * 2.5);
          break;
        }
        case "meteors":
          view.floor.visibility = fade * (0.6 + 0.2 * Math.sin(t * 5));
          break;
        case "meteor":
        case "meteorBig": {
          // El aviso se llena mientras la roca baja: llega al suelo justo cuando el servidor lo hace estallar.
          const k = Math.min(1, age / view.totalS);
          view.floor.visibility = 0.5 + 0.5 * k;
          if (view.inner) {
            view.inner.scaling.set(view.radius * k, 1, view.radius * k);
            view.inner.visibility = 0.35 + 0.5 * k;
          }
          if (view.body) {
            const fall = (1 - k) ** 1.6;
            view.body.position.set(METEOR_FROM_X * fall, METEOR_FROM_Y * fall + view.radius * METEOR_SIZE * 0.3, 0);
          }
          if (view.spin) view.spin.rotation.x = t * 4;
          break;
        }
        case "trail":
        case "ice":
          view.floor.visibility = Math.max(0, Math.min(1, left / view.totalS + 0.1));
          break;
        case "scar": {
          // Brasa que se aviva en cada pulso de daño y se apaga al final.
          const flash = Math.exp(-((age % THRUST_TRAIL_TICK_S) / THRUST_TRAIL_TICK_S) * 5);
          view.floor.visibility = fade * (0.7 + 0.3 * flash);
          if (view.inner) view.inner.visibility = fade * (0.45 + 0.55 * flash);
          break;
        }
        case "fire":
          view.floor.visibility = Math.max(0, Math.min(1, left / FADE_S)) * (0.7 + 0.3 * Math.sin(t * 9 + view.bornMs));
          break;
        default:
          break;
      }
    }
  }

  dispose(): void {
    for (const view of this.views.values()) view.root.dispose(false, false);
    this.views.clear();
    for (const m of Object.values(this.mats)) m.dispose();
    for (const m of this.tinted.values()) m.dispose();
    this.tinted.clear();
    for (const tx of Object.values(this.tex)) tx.dispose();
  }

  private quad(name: string, parent: TransformNode, mat: StandardMaterial, radius: number, y = FLOOR_Y): Mesh {
    const mesh = CreateGround(name, { width: 2, height: 2 }, this.scene);
    mesh.material = mat;
    mesh.parent = parent;
    mesh.scaling.set(radius, 1, radius);
    mesh.position.y = y;
    mesh.isPickable = false;
    return mesh;
  }

  private create(id: string, z: ZoneSnapshot, receivedAtMs: number): ZoneView {
    const root = new TransformNode(`spellZone-${id}`, this.scene);
    root.position.set(z.x, 0, z.z);
    const base = { kind: z.kind, root, radius: z.radius, bornMs: receivedAtMs - (z.total - z.left) * 1000, totalS: z.total };
    switch (z.kind) {
      case "frost":
        this.quad(`frostFill-${id}`, root, this.mats.frostFill, z.radius, FLOOR_Y - 0.01);
        return { ...base, floor: this.quad(`frost-${id}`, root, this.mats.frost, z.radius), inner: this.quad(`frostRing-${id}`, root, this.mats.frostRing, z.radius, FLOOR_Y + 0.01) };
      case "mine": {
        const body = CreateSphere(`mineOrb-${id}`, { diameter: 0.22, segments: 8 }, this.scene);
        body.material = this.tint("mineOrb", z.nature);
        body.parent = root;
        body.isPickable = false;
        return {
          ...base, body,
          floor: this.quad(`mine-${id}`, root, this.tint("mine", z.nature), MINE_SIZE_M),
          inner: this.quad(`mineGlow-${id}`, root, this.tint("mineGlow", z.nature), MINE_SIZE_M * 1.5, FLOOR_Y - 0.01),
        };
      }
      case "meteors":
        return { ...base, floor: this.quad(`meteors-${id}`, root, this.tint("meteors", z.nature), z.radius) };
      case "meteor":
      case "meteorBig": {
        const size = z.radius * METEOR_SIZE * (z.kind === "meteorBig" ? 0.7 : 1);
        const body = new TransformNode(`meteor-${id}`, this.scene);
        body.parent = root;
        const rock = CreateSphere(`meteorRock-${id}`, { diameter: size, segments: 6 }, this.scene);
        rock.material = this.tint("rock", z.nature);
        rock.parent = body;
        rock.isPickable = false;
        // Cola de fuego: un cono que apunta hacia de dónde viene.
        const tail = CreateCylinder(`meteorTail-${id}`, { height: size * 3.2, diameterTop: 0, diameterBottom: size * 0.9, tessellation: 10 }, this.scene);
        tail.material = this.tint("tail", z.nature);
        tail.parent = root;
        tail.isPickable = false;
        const view: ZoneView = {
          ...base, body,
          floor: this.quad(`meteorWarn-${id}`, root, this.tint("warn", z.nature), z.radius),
          inner: this.quad(`meteorFill-${id}`, root, this.tint("warnFill", z.nature), 0.01, FLOOR_Y + 0.01),
        };
        // La cola sigue a la roca: cuelga de un nodo propio orientado a lo largo de la caída.
        const tailPivot = new TransformNode(`meteorTailPivot-${id}`, this.scene);
        tailPivot.parent = body;
        tailPivot.rotation.z = -Math.atan2(METEOR_FROM_X, METEOR_FROM_Y);
        tail.parent = tailPivot;
        tail.position.y = size * 1.6;
        // El giro de la roca no arrastra la cola: gira solo su malla.
        view.spin = rock;
        return view;
      }
      case "fire":
        return { ...base, floor: this.quad(`fire-${id}`, root, this.tint("warnFill", z.nature), z.radius) };
      case "scar":
        return {
          ...base,
          floor: this.quad(`scar-${id}`, root, this.tint("scar", z.nature), z.radius),
          inner: this.quad(`scarCore-${id}`, root, this.mats.scarCore, z.radius * 0.5, FLOOR_Y + 0.01),
        };
      case "ice":
        return { ...base, floor: this.quad(`ice-${id}`, root, this.mats.frostFill, z.radius) };
      default:
        return { ...base, floor: this.quad(`trail-${id}`, root, this.tint("trail", z.nature), z.radius) };
    }
  }
}
