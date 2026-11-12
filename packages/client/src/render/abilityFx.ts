import { Constants } from "@babylonjs/core/Engines/constants";
import { Material } from "@babylonjs/core/Materials/material";
import type { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import "@babylonjs/core/Particles/particleSystemComponent";
import type { Scene } from "@babylonjs/core/scene";
import {
  ABILITIES,
  HOOK_IMPACT_AT,
  THRUST_DASH_S,
  WARCRY_RADIUS,
  abilityAnimS,
  slamImpactS,
  SPELL_RELEASE_S,
  SLAM_IMPACT_S,
  THROW_RELEASE_AT,
  THRUST_WIDTH,
  type AbilityId,
  type Nature,
} from "@roguelike/shared";
import {
  generated,
  moltenTexture,
  PARTICLE_SPEED,
  radial,
  rockTexture,
  scorchTexture,
  shockTexture,
  slashTexture,
  smokeTexture,
  sparkTexture,
  streakTexture,
  swirlTexture,
  telegraphTexture,
} from "./fxTextures";
import { natureTint } from "./natureLooks";
import { spellColor } from "./staffMesh";

/** Temblor de cámara del Golpe sísmico, si el jugador propio está a menos de `rangeM`. */
export const SLAM_SHAKE = { durationS: 0.25, intensity: 0.08, rangeM: 8 } as const;

const FIRE = new Color3(1, 0.45, 0.1);
const GOLD = new Color3(1, 0.78, 0.25);
const WARM_WHITE = new Color3(1, 0.92, 0.75);
const TRAIL = new Color3(1, 0.8, 0.5);
const STEEL = new Color3(0.7, 0.82, 1);
const BANNER_GREEN = new Color3(0.45, 1, 0.55);
const FRENZY_RED = new Color3(1, 0.22, 0.15);
/** Hechizos del mago: hielo, viento, sanación y el blanco violáceo del centro de lo arcano. */
const ICE = new Color3(0.55, 0.85, 1);
const WIND = new Color3(0.72, 1, 0.9);
const HEAL_GREEN = new Color3(0.4, 1, 0.6);
/** Tipos de estallido que anuncia el servidor (evento `blast`). */
export type BlastKind = "mine" | "meteor" | "meteorBig" | "mark" | "orb" | "blade";

const RING_START_M = 0.5;
const WHIRL_RING_Y = 1.0; // m: a la altura del giro del mandoble
const WARCRY_GROW_S = 0.5;
const WARCRY_RING_Y = 0.3;
/** Golpe sísmico: destello del impacto, dos ondas, la marca del suelo y lo que tarda en enfriarse. */
const BURST_S = 0.28;
const SHOCK_GROW_S = 0.38;
const SHOCK_ECHO_DELAY_S = 0.06;
const SHOCK_ECHO_S = 0.55;
const SCORCH_S = 2.6;
const MOLTEN_S = 1.5;
const SHARDS_S = 0.7;
const DEBRIS_S = 1.0;
const EMBERS_EMIT_S = 0.9;
const EMBERS_LIFE_MAX_S = 1.1;
/** Torbellino: vueltas por segundo de los tajos del remolino. */
const SWIRL_TURNS_PER_S = 2.6;
/** Tajo de un golpe normal: aparece un instante antes del impacto, a la altura de la espada. */
const SLASH_LEAD_S = 0.05;
const SLASH_S = 0.2;
const SLASH_Y = 1.05;
const SLASH_COLOR = new Color3(1, 0.9, 0.72);
/** Chispazo al conectar un golpe. */
const HIT_SPARK_S = 0.4;
const HIT_FLASH_S = 0.12;
const TRAIL_FADE_S = 0.3;
const TRAIL_Y = 0.9;
const FLOOR_Y = 0.04; // m: sobre el suelo, sin pelear con él por la profundidad
const SPARK_LIFE_MAX_S = 0.5;
const DUST_EMIT_S = 0.12;
const DUST_LIFE_MAX_S = 1.2;
type Pose = { x: number; z: number; facing: number };

/** Un paso del efecto: qué se dibuja, cuándo empieza (s desde el inicio de la habilidad) y cuánto dura. */
export type FxStep =
  | { kind: "ring"; startS: number; durS: number; to: number; color: Color3; y: number }
  | { kind: "sparks"; startS: number; durS: number; emitS: number; radius: number; nature: Nature }
  | { kind: "telegraph"; startS: number; durS: number; radius: number; color: Color3 }
  /** `forward`: metros por delante de la pose (por defecto, en ella) */
  | { kind: "burst"; startS: number; durS: number; radius: number; color: Color3; forward?: number; quiet?: boolean }
  | { kind: "zone"; startS: number; durS: number; radius: number; color: Color3 }
  /** aro que se cierra desde `radius` hasta el jugador (el tirón del Gancho) */
  | { kind: "implode"; startS: number; durS: number; radius: number; color: Color3 }
  | { kind: "swirl"; startS: number; durS: number; radius: number; color: Color3; y: number }
  | { kind: "wave"; startS: number; durS: number; radius: number; color: Color3; arcDeg: number; y: number }
  | { kind: "slash"; startS: number; durS: number; radius: number; color: Color3; arcDeg: number; flip: boolean }
  | { kind: "hitSparks"; startS: number; durS: number; y: number; weight: number; color: Color3 }
  | { kind: "hitFlash"; startS: number; durS: number; y: number; weight: number; color: Color3 }
  | { kind: "shock"; startS: number; durS: number; radius: number; color: Color3; alpha: number }
  | { kind: "scorch"; startS: number; durS: number; radius: number }
  | { kind: "molten"; startS: number; durS: number; radius: number; color: Color3 }
  | { kind: "shards"; startS: number; durS: number; radius: number; color: Color3 }
  | { kind: "debris"; startS: number; durS: number; radius: number }
  | { kind: "dust"; startS: number; durS: number; emitS: number; radius: number }
  | { kind: "embers"; startS: number; durS: number; emitS: number; radius: number; color: Color3 }
  | { kind: "trail"; startS: number; durS: number; range: number; color: Color3 };

/**
 * Los pasos del efecto de cada habilidad; los momentos de impacto salen de las constantes de `cards.ts`.
 * Los colores fijos pasan por `natureTint`: sin naturaleza quedan como siempre.
 */
export function abilityTimeline(id: AbilityId, rank: number, nature: Nature = "none"): FxStep[] {
  const def = ABILITIES[id];
  const r = def.ranks[Math.min(3, Math.max(1, rank)) - 1]!;
  // Hechizos del mago: lo arcano toma el color de la naturaleza del bastón (con su núcleo claro).
  const arcane = spellColor(nature);
  const core = Color3.Lerp(arcane, Color3.White(), 0.6);
  switch (id) {
    case "whirlwind": {
      const color = natureTint(FIRE, nature);
      const spin = abilityAnimS(id, rank);
      const steps: FxStep[] = [
        { kind: "zone", startS: 0, durS: spin, radius: r.radius!, color },
        { kind: "ring", startS: 0, durS: Math.min(spin, 0.9), to: r.radius!, color, y: WHIRL_RING_Y },
        { kind: "swirl", startS: 0, durS: spin, radius: r.radius!, color: Color3.Lerp(color, Color3.White(), 0.45), y: WHIRL_RING_Y },
        { kind: "sparks", startS: 0, durS: spin + SPARK_LIFE_MAX_S, emitS: spin, radius: r.radius!, nature },
      ];
      // Girando largo (rango 3): un segundo remolino a otra altura, polvo levantado y brasas todo el rato.
      if (rank >= 3) {
        steps.push(
          { kind: "swirl", startS: 0.1, durS: spin - 0.1, radius: r.radius! * 0.75, color, y: WHIRL_RING_Y * 0.45 },
          { kind: "dust", startS: 0, durS: spin + DUST_LIFE_MAX_S, emitS: spin, radius: r.radius! },
          { kind: "embers", startS: 0, durS: spin + EMBERS_LIFE_MAX_S, emitS: spin, radius: r.radius! * 0.8, color },
        );
      }
      return steps;
    }
    case "warcry": {
      // Rango 3: la onda dorada se tiñe del rojo de la furia (también da velocidad de ataque).
      const color = r.speed ? FRENZY_RED : GOLD;
      return [
        { kind: "burst", startS: 0, durS: 0.4, radius: WARCRY_RADIUS * 0.35, color },
        { kind: "ring", startS: 0, durS: WARCRY_GROW_S, to: WARCRY_RADIUS, color, y: WARCRY_RING_Y },
        { kind: "shock", startS: 0.05, durS: WARCRY_GROW_S, radius: WARCRY_RADIUS, color, alpha: 0.8 },
        { kind: "shock", startS: 0.15, durS: WARCRY_GROW_S + 0.2, radius: WARCRY_RADIUS * 0.7, color: GOLD, alpha: 0.5 },
        { kind: "embers", startS: 0, durS: 0.6 + EMBERS_LIFE_MAX_S, emitS: 0.6, radius: WARCRY_RADIUS * 0.3, color },
      ];
    }
    case "slam": {
      // Tres tiempos: el aviso de la zona mientras salta (y canaliza, en rango 3), el estallido al caer y lo que
      // queda enfriándose.
      const color = natureTint(FIRE, nature);
      const hot = Color3.Lerp(color, Color3.White(), 0.55);
      const radius = r.radius!;
      const hit = slamImpactS(rank);
      const steps: FxStep[] = [
        { kind: "telegraph", startS: 0, durS: hit, radius, color },
        { kind: "burst", startS: hit, durS: BURST_S, radius, color },
        { kind: "shock", startS: hit, durS: SHOCK_GROW_S, radius, color: hot, alpha: 1 },
        { kind: "shock", startS: hit + SHOCK_ECHO_DELAY_S, durS: SHOCK_ECHO_S, radius: radius * 1.3, color, alpha: 0.45 },
        { kind: "scorch", startS: hit, durS: SCORCH_S, radius },
        { kind: "molten", startS: hit, durS: MOLTEN_S, radius, color },
        { kind: "shards", startS: hit, durS: SHARDS_S, radius, color },
        { kind: "debris", startS: hit, durS: DEBRIS_S, radius },
        { kind: "dust", startS: hit, durS: DUST_EMIT_S + DUST_LIFE_MAX_S, emitS: DUST_EMIT_S, radius },
        { kind: "embers", startS: hit + 0.1, durS: EMBERS_EMIT_S + EMBERS_LIFE_MAX_S, emitS: EMBERS_EMIT_S, radius, color },
      ];
      if (hit > SLAM_IMPACT_S) {
        // Canaliza tras aterrizar: la energía se junta en el punto (aros que se cierran y brasas que suben).
        for (let t = SLAM_IMPACT_S; t < hit - 0.15; t += 0.22) steps.push({ kind: "implode", startS: t, durS: 0.3, radius: radius * 0.9, color: hot });
        steps.push(
          { kind: "embers", startS: SLAM_IMPACT_S, durS: hit - SLAM_IMPACT_S + EMBERS_LIFE_MAX_S, emitS: hit - SLAM_IMPACT_S, radius: radius * 0.4, color: hot },
          { kind: "shock", startS: hit + 0.12, durS: SHOCK_ECHO_S + 0.2, radius: radius * 1.6, color, alpha: 0.35 },
        );
      }
      return steps;
    }
    case "thrust": {
      // La embestida: la estela crece con el caballero y al final un tajo en abanico.
      const color = natureTint(TRAIL, nature);
      return [
        { kind: "trail", startS: 0, durS: THRUST_DASH_S + TRAIL_FADE_S, range: r.range!, color },
        { kind: "dust", startS: 0, durS: THRUST_DASH_S + DUST_LIFE_MAX_S, emitS: THRUST_DASH_S, radius: 1.2 },
        { kind: "burst", startS: THRUST_DASH_S, durS: 0.24, radius: 1.6, color, forward: r.range! },
        { kind: "wave", startS: THRUST_DASH_S, durS: 0.26, radius: 2.6, color, arcDeg: 140, y: TRAIL_Y },
      ];
    }
    case "throw": {
      const color = natureTint(WARM_WHITE, nature);
      const release = THROW_RELEASE_AT * def.animS;
      // Rango 3: salen en todas las direcciones, con un anillo de acero.
      return (r.count ?? 1) > 1
        ? [
            { kind: "burst", startS: release, durS: 0.25, radius: 1.6, color },
            { kind: "shock", startS: release, durS: 0.35, radius: 3, color: STEEL, alpha: 0.9 },
          ]
        : [{ kind: "burst", startS: release, durS: 0.18, radius: 0.9, color, forward: 0.8 }];
    }
    case "hook": {
      const color = natureTint(STEEL, nature);
      const hit = HOOK_IMPACT_AT * def.animS;
      const range = r.range!;
      const steps: FxStep[] = [
        { kind: "implode", startS: hit - 0.12, durS: 0.3, radius: range, color },
        { kind: "implode", startS: hit - 0.04, durS: 0.3, radius: range * 0.7, color },
        { kind: "burst", startS: hit + 0.14, durS: 0.25, radius: 2.4, color },
      ];
      // Rango 3: invulnerable 2 s, una cúpula de acero que se apaga.
      if (r.durationS) steps.push({ kind: "zone", startS: hit, durS: r.durationS, radius: 1.3, color: WARM_WHITE });
      return steps;
    }
    case "banner": {
      const steps: FxStep[] = [
        { kind: "burst", startS: 0, durS: 0.4, radius: r.radius! * 0.7, color: BANNER_GREEN },
        { kind: "shock", startS: 0.05, durS: 0.45, radius: r.radius!, color: BANNER_GREEN, alpha: 0.8 },
      ];
      // Rango 3: tres ondas, una por naturaleza.
      if (r.mark) {
        (["fire", "ice", "lightning"] as const).forEach((n, i) =>
          steps.push({ kind: "shock", startS: 0.15 + i * 0.12, durS: 0.5, radius: r.radius! * (0.8 + i * 0.15), color: natureTint(WARM_WHITE, n), alpha: 0.8 }),
        );
      }
      return steps;
    }
    // Hechizos del mago. Los que se colocan (Escarcha, Mina, Meteoros) se dibujan en el punto apuntado; lo que
    // dejan en el mundo (zonas, proyectiles, haz, estallidos) lo dibujan sus vistas y los eventos del servidor.
    case "frost":
      return [
        { kind: "telegraph", startS: 0, durS: SPELL_RELEASE_S, radius: r.radius!, color: ICE },
        { kind: "burst", startS: SPELL_RELEASE_S, durS: 0.4, radius: r.radius! * 0.9, color: ICE, quiet: true },
        { kind: "shock", startS: SPELL_RELEASE_S, durS: 0.5, radius: r.radius!, color: ICE, alpha: 0.9 },
        { kind: "embers", startS: SPELL_RELEASE_S, durS: 0.5 + EMBERS_LIFE_MAX_S, emitS: 0.5, radius: r.radius! * 0.8, color: ICE },
      ];
    case "nova": {
      const charge = r.chargeS!;
      const big = charge > 1;
      const steps: FxStep[] = [
        { kind: "telegraph", startS: 0, durS: charge, radius: r.radius!, color: arcane },
        { kind: "implode", startS: Math.max(0, charge - 0.3), durS: 0.3, radius: r.radius!, color: arcane },
        { kind: "burst", startS: charge, durS: BURST_S + 0.1, radius: r.radius!, color: core, quiet: !big },
        { kind: "shock", startS: charge, durS: SHOCK_GROW_S, radius: r.radius!, color: arcane, alpha: 1 },
        { kind: "shock", startS: charge + SHOCK_ECHO_DELAY_S, durS: SHOCK_ECHO_S, radius: r.radius! * 1.15, color: arcane, alpha: 0.5 },
        { kind: "embers", startS: charge, durS: EMBERS_EMIT_S + EMBERS_LIFE_MAX_S, emitS: EMBERS_EMIT_S, radius: r.radius! * 0.7, color: arcane },
      ];
      if (big) {
        // La carga larga se ve venir: aros que se cierran una y otra vez, y deja el suelo marcado.
        for (let t = 0.1; t < charge - 0.3; t += 0.3) steps.push({ kind: "implode", startS: t, durS: 0.35, radius: r.radius! * 0.8, color: arcane });
        steps.push(
          { kind: "scorch", startS: charge, durS: SCORCH_S, radius: r.radius! * 0.8 },
          { kind: "molten", startS: charge, durS: MOLTEN_S, radius: r.radius! * 0.8, color: arcane },
          { kind: "dust", startS: charge, durS: DUST_EMIT_S + DUST_LIFE_MAX_S, emitS: DUST_EMIT_S, radius: r.radius! },
        );
      }
      return steps;
    }
    case "beam":
      return [
        { kind: "implode", startS: 0, durS: SPELL_RELEASE_S, radius: 1.4, color: arcane },
        { kind: "burst", startS: SPELL_RELEASE_S, durS: 0.2, radius: 1.1, color: core, forward: 0.9, quiet: true },
      ];
    case "mine":
      return [
        { kind: "telegraph", startS: 0, durS: SPELL_RELEASE_S, radius: 0.9, color: arcane },
        { kind: "burst", startS: SPELL_RELEASE_S, durS: 0.25, radius: 0.9, color: arcane, quiet: true },
      ];
    case "gust":
      return [
        { kind: "burst", startS: SPELL_RELEASE_S, durS: 0.22, radius: r.radius! * 1.1, color: natureTint(WIND, nature), forward: 0.8, quiet: true },
        { kind: "dust", startS: SPELL_RELEASE_S, durS: DUST_EMIT_S + DUST_LIFE_MAX_S, emitS: DUST_EMIT_S, radius: r.radius! },
      ];
    case "orb":
      return [
        { kind: "implode", startS: 0, durS: SPELL_RELEASE_S, radius: 1.6, color: arcane },
        { kind: "burst", startS: SPELL_RELEASE_S, durS: 0.25, radius: 1.2, color: arcane, forward: 0.8, quiet: true },
      ];
    case "heal":
      return [
        { kind: "burst", startS: 0, durS: 0.45, radius: 2.2, color: HEAL_GREEN, quiet: true },
        { kind: "ring", startS: 0, durS: WARCRY_GROW_S, to: 3, color: HEAL_GREEN, y: WARCRY_RING_Y },
        { kind: "embers", startS: 0, durS: 0.7 + EMBERS_LIFE_MAX_S, emitS: 0.7, radius: 1.2, color: HEAL_GREEN },
      ];
    case "meteors":
      return [
        { kind: "telegraph", startS: 0, durS: SPELL_RELEASE_S + 0.3, radius: r.radius!, color: natureTint(FIRE, nature) },
        { kind: "shock", startS: SPELL_RELEASE_S, durS: 0.5, radius: r.radius!, color: natureTint(FIRE, nature), alpha: 0.7 },
      ];
    default:
      return [];
  }
}

/** Pasos del estallido de cada tipo, con su radio. */
export function blastTimeline(kind: BlastKind, radius: number, nature: Nature = "none"): FxStep[] {
  const arcane = spellColor(nature);
  const core = Color3.Lerp(arcane, Color3.White(), 0.6);
  const fire = natureTint(FIRE, nature);
  switch (kind) {
    case "mine":
      return [
        { kind: "burst", startS: 0, durS: BURST_S, radius, color: core },
        { kind: "shock", startS: 0, durS: SHOCK_GROW_S, radius, color: arcane, alpha: 1 },
        { kind: "scorch", startS: 0, durS: SCORCH_S, radius: radius * 0.7 },
        { kind: "debris", startS: 0, durS: DEBRIS_S, radius: radius * 0.6 },
        { kind: "embers", startS: 0, durS: 0.5 + EMBERS_LIFE_MAX_S, emitS: 0.5, radius: radius * 0.6, color: arcane },
      ];
    case "meteor":
    case "meteorBig": {
      const big = kind === "meteorBig";
      const steps: FxStep[] = [
        { kind: "burst", startS: 0, durS: big ? 0.45 : BURST_S, radius: radius * (big ? 1 : 1.2), color: WARM_WHITE, quiet: !big },
        { kind: "shock", startS: 0, durS: SHOCK_GROW_S, radius: radius * 1.1, color: fire, alpha: 1 },
        { kind: "scorch", startS: 0, durS: SCORCH_S, radius: radius * (big ? 0.8 : 1) },
        { kind: "molten", startS: 0, durS: MOLTEN_S, radius: radius * (big ? 0.8 : 1), color: fire },
        { kind: "debris", startS: 0, durS: DEBRIS_S, radius: radius * 0.6 },
        { kind: "embers", startS: 0, durS: EMBERS_EMIT_S + EMBERS_LIFE_MAX_S, emitS: EMBERS_EMIT_S, radius: radius * 0.7, color: fire },
      ];
      if (big) {
        steps.push(
          { kind: "shock", startS: SHOCK_ECHO_DELAY_S, durS: SHOCK_ECHO_S, radius: radius * 1.4, color: fire, alpha: 0.5 },
          { kind: "shards", startS: 0, durS: SHARDS_S, radius, color: fire },
          { kind: "dust", startS: 0, durS: DUST_EMIT_S + DUST_LIFE_MAX_S, emitS: DUST_EMIT_S, radius },
        );
      }
      return steps;
    }
    case "mark":
      return [
        { kind: "burst", startS: 0, durS: 0.22, radius: radius * 0.9, color: core, quiet: true },
        { kind: "shock", startS: 0, durS: 0.3, radius, color: arcane, alpha: 1 },
      ];
    case "orb":
      return [{ kind: "shock", startS: 0, durS: 0.35, radius, color: arcane, alpha: 0.55 }];
    case "blade": {
      // Estalla la marca de las espadas: un tajo de acero en estrella sobre el marcado y su onda.
      const steel = natureTint(STEEL, nature);
      return [
        { kind: "burst", startS: 0, durS: 0.3, radius: radius * 0.8, color: WARM_WHITE },
        { kind: "shock", startS: 0, durS: 0.35, radius, color: steel, alpha: 1 },
        { kind: "shards", startS: 0, durS: SHARDS_S, radius: radius * 0.8, color: steel },
        { kind: "slash", startS: 0, durS: 0.22, radius: radius * 0.9, color: WARM_WHITE, arcDeg: 300, flip: false },
      ];
    }
  }
}

/** Cuánto dura (ms) el efecto completo de esa habilidad y rango, desde su inicio. */
export function abilityFxDurationMs(id: AbilityId, rank: number): number {
  return Math.max(0, ...abilityTimeline(id, rank).map((s) => (s.startS + s.durS) * 1000));
}

/** Una pieza viva de un efecto (malla o sistema de partículas), con sus tiempos en el reloj de juego. */
interface Piece {
  startMs: number;
  endMs: number;
  started: boolean;
  mesh?: Mesh;
  mat?: StandardMaterial;
  ps?: ParticleSystem;
  emitEndMs?: number;
  /** radio actual, solo de los aros (para los tests) */
  ring?: number;
  onStart?(): void;
  /** `t`: fracción transcurrida de la pieza, en [0, 1] */
  apply?(t: number): void;
}

/** Grietas desde el centro: líneas oscuras con borde naranja (o del color de la naturaleza). Pseudoaleatorias con semilla (siempre iguales). */
export function drawCracks(ctx: CanvasRenderingContext2D, s: number, edge: Color3 | undefined): void {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const paths: [number, number][][] = [];
  const BRANCHES = 9;
  for (let i = 0; i < BRANCHES; i++) {
    let angle = (i / BRANCHES) * Math.PI * 2 + rnd() * 0.5;
    let x = s / 2;
    let y = s / 2;
    const path: [number, number][] = [[x, y]];
    const len = s * (0.3 + rnd() * 0.18);
    for (let d = 0; d < len; d += s * 0.05) {
      angle += (rnd() - 0.5) * 0.9;
      x += Math.cos(angle) * s * 0.05;
      y += Math.sin(angle) * s * 0.05;
      path.push([x, y]);
    }
    paths.push(path);
  }
  const stroke = (color: string, width: number) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const path of paths) {
      ctx.beginPath();
      path.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
      ctx.stroke();
    }
  };
  stroke(edge ? `rgba(${Math.round(edge.r * 255)}, ${Math.round(edge.g * 255)}, ${Math.round(edge.b * 255)}, 0.85)` : "rgba(255, 120, 30, 0.85)", s * 0.03);
  stroke("rgba(20, 12, 6, 0.95)", s * 0.012);
  radial(ctx, s, [
    [0, "rgba(20, 12, 6, 0.9)"],
    [0.12, "rgba(60, 25, 8, 0.6)"],
    [0.2, "rgba(0, 0, 0, 0)"],
  ]);
}

/**
 * Efectos visuales de las habilidades del guerrero: aros, onda, grietas, destellos, estelas y partículas.
 * Sin luces (solo materiales emisivos sin iluminación). Corre con el reloj de juego: en la pausa `update`
 * no avanza nada y las partículas se detienen (`setPaused`). Cada pieza se libera al terminar; las
 * texturas se generan una vez y se comparten.
 */
export class AbilityFx {
  /** Impacto del Golpe sísmico en (x, z), en el instante del impacto (p. ej. para el temblor de cámara). */
  onSlamImpact?: (x: number, z: number) => void;

  private readonly pieces: Piece[] = [];
  private readonly spark: DynamicTexture;
  private readonly ringTex: DynamicTexture;
  /** texturas del Golpe sísmico; blancas las que se tiñen con el material o la partícula */
  private readonly slamTex: Record<"scorch" | "molten" | "shock" | "telegraph" | "rock" | "smoke" | "swirl" | "slash" | "streak", DynamicTexture>;
  private paused = false;
  private seq = 0;

  constructor(private readonly scene: Scene) {
    this.spark = sparkTexture(scene);
    this.ringTex = generated(scene, "fx-ring", 128, (ctx, s) =>
      radial(ctx, s, [
        [0, "rgba(255, 255, 255, 0)"],
        [0.62, "rgba(255, 255, 255, 0)"],
        [0.88, "rgba(255, 255, 255, 1)"],
        [1, "rgba(255, 255, 255, 0)"],
      ]),
    );
    this.slamTex = {
      scorch: scorchTexture(scene),
      molten: moltenTexture(scene),
      shock: shockTexture(scene),
      telegraph: telegraphTexture(scene),
      rock: rockTexture(scene),
      smoke: smokeTexture(scene),
      swirl: swirlTexture(scene),
      slash: slashTexture(scene),
      streak: streakTexture(scene),
    };
  }

  /** Arranca el efecto de `id` en `at` (pose dibujada del jugador al empezar), con `startMs` en el reloj de juego. */
  play(id: AbilityId, at: Pose, rank: number, startMs: number, nature: Nature = "none"): void {
    this.spawn(abilityTimeline(id, rank, nature), at, startMs);
  }

  /**
   * Tajo de un golpe normal que arranca en `startMs` desde la pose `at`: un arco del alcance y la apertura
   * del golpe, justo antes de su impacto. `step`: golpe del combo (los pares van al revés).
   */
  slash(at: Pose, strike: { duration: number; impactAt: number; range: number; arcDeg: number }, step: number, startMs: number, nature: Nature = "none"): void {
    const startS = Math.max(0, strike.impactAt * strike.duration - SLASH_LEAD_S);
    this.spawn([{ kind: "slash", startS, durS: SLASH_S, radius: strike.range, arcDeg: strike.arcDeg, color: natureTint(SLASH_COLOR, nature), flip: step % 2 === 0 }], at, startMs);
  }

  /**
   * Chispazo de un golpe que conecta en (x, z) a `y` m del suelo, despedido hacia `dir` (rad de mundo, 0 = +Z).
   * `weight`: peso del golpe, de 0 a 1.
   */
  impact(x: number, z: number, y: number, dir: number, weight: number, startMs: number, nature: Nature = "none"): void {
    const color = natureTint(WARM_WHITE, nature);
    this.spawn(
      [
        { kind: "hitFlash", startS: 0, durS: HIT_FLASH_S, y, weight, color },
        { kind: "hitSparks", startS: 0, durS: HIT_SPARK_S, y, weight, color },
      ],
      { x, z, facing: dir },
      startMs,
    );
  }

  /** Estallido que anuncia el servidor (mina, meteorito, marca del Rayo o pulso de la Esfera) en (x, z). */
  blast(kind: BlastKind, x: number, z: number, radius: number, startMs: number, nature: Nature = "none"): void {
    this.spawn(blastTimeline(kind, radius, nature), { x, z, facing: 0 }, startMs);
  }

  /** Destello en la punta del bastón al soltar un proyectil: sale en el impacto del golpe, con el color de su naturaleza. */
  staffCast(at: Pose, strike: { duration: number; impactAt: number }, startMs: number, nature: Nature = "none"): void {
    const color = spellColor(nature);
    this.spawn([{ kind: "hitFlash", startS: strike.impactAt * strike.duration, durS: 0.14, y: 1.25, weight: 0.5, color }], { x: at.x + Math.sin(at.facing) * 0.7, z: at.z + Math.cos(at.facing) * 0.7, facing: at.facing }, startMs);
  }

  /** Gesto de refuerzo de un hechicero enemigo en (x, z): aviso del radio durante `castS` y onda al soltarlo. */
  enemyBuff(x: number, z: number, radius: number, castS: number, color: Color3, startMs: number): void {
    this.spawn(
      [
        { kind: "telegraph", startS: 0, durS: castS, radius, color },
        { kind: "implode", startS: Math.max(0, castS - 0.35), durS: 0.35, radius, color },
        { kind: "shock", startS: castS, durS: 0.45, radius, color, alpha: 0.85 },
        { kind: "embers", startS: castS, durS: 0.5 + EMBERS_LIFE_MAX_S, emitS: 0.5, radius: radius * 0.6, color },
      ],
      { x, z, facing: 0 },
      startMs,
    );
  }

  /** Sanación recibida por un jugador en (x, z). */
  healed(x: number, z: number, startMs: number): void {
    this.spawn(
      [
        { kind: "burst", startS: 0, durS: 0.4, radius: 1.3, color: HEAL_GREEN, quiet: true },
        { kind: "embers", startS: 0, durS: 0.6 + EMBERS_LIFE_MAX_S, emitS: 0.6, radius: 0.8, color: HEAL_GREEN },
      ],
      { x, z, facing: 0 },
      startMs,
    );
  }

  private spawn(steps: FxStep[], at: Pose, startMs: number): void {
    for (const step of steps) {
      const piece = this.build(step, at);
      piece.startMs = startMs + step.startS * 1000;
      piece.endMs = piece.startMs + step.durS * 1000;
      // Los sistemas de partículas dejan de emitir tras `emitS`; sus partículas viven hasta `endMs`.
      if ("emitS" in step) piece.emitEndMs = piece.startMs + step.emitS * 1000;
      // `quiet`: destello sin temblor ni estruendo (lo pequeño y lo que se repite mucho).
      if (step.kind === "burst" && !step.quiet) piece.onStart = () => this.onSlamImpact?.(at.x, at.z);
      piece.mesh?.setEnabled(false);
      this.pieces.push(piece);
    }
  }

  /** Avanza con el reloj de juego (quieto en la pausa). */
  update(nowMs: number): void {
    for (let i = this.pieces.length - 1; i >= 0; i--) {
      const p = this.pieces[i]!;
      if (nowMs >= p.endMs) {
        this.free(p);
        this.pieces.splice(i, 1);
        continue;
      }
      if (nowMs < p.startMs) continue;
      if (!p.started) {
        p.started = true;
        p.mesh?.setEnabled(true);
        if (p.ps) {
          p.ps.updateSpeed = this.paused ? 0 : PARTICLE_SPEED;
          p.ps.start();
        }
        p.onStart?.();
      }
      if (p.ps && p.emitEndMs !== undefined && nowMs >= p.emitEndMs && p.ps.isStarted()) p.ps.stop();
      p.apply?.(Math.min(1, (nowMs - p.startMs) / (p.endMs - p.startMs)));
    }
  }

  /** Detiene (o reanuda) las partículas: avanzan con los cuadros, no con el reloj de juego. */
  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    for (const p of this.pieces) if (p.ps && p.started) p.ps.updateSpeed = paused ? 0 : PARTICLE_SPEED;
  }

  /** Radio actual del último aro empezado (para los tests). */
  ringRadius(): number | undefined {
    return this.pieces.filter((p) => p.started && p.ring !== undefined).at(-1)?.ring;
  }

  /** `updateSpeed` de los sistemas de partículas empezados (para los tests). */
  particleSpeeds(): number[] {
    return this.pieces.filter((p) => p.ps && p.started).map((p) => p.ps!.updateSpeed);
  }

  dispose(): void {
    for (const p of this.pieces) this.free(p);
    this.pieces.length = 0;
    this.spark.dispose();
    this.ringTex.dispose();
    for (const t of Object.values(this.slamTex)) t.dispose();
  }

  /** Plano en el suelo de 2 × 2 m centrado en `at`: escalado por r en X y Z cubre un círculo de radio r. */
  private floorQuad(name: string, at: Pose, y: number, forward = 0): Mesh {
    const mesh = CreateGround(name, { width: 2, height: 2 }, this.scene);
    mesh.position.set(at.x + Math.sin(at.facing) * forward, y, at.z + Math.cos(at.facing) * forward);
    mesh.rotation.y = at.facing;
    mesh.isPickable = false;
    return mesh;
  }

  private free(p: Piece): void {
    p.mesh?.dispose(false, false);
    p.mat?.dispose(false, false);
    p.ps?.dispose(false); // la textura es compartida
  }

  /** Material emisivo sin iluminación, con mezcla aditiva y la opacidad de `opacity` si se da. */
  private glow(name: string, color: Color3, opacity?: DynamicTexture): StandardMaterial {
    const mat = new StandardMaterial(name, this.scene);
    mat.disableLighting = true;
    mat.diffuseColor = Color3.Black();
    mat.specularColor = Color3.Black();
    mat.emissiveColor = color.clone();
    mat.backFaceCulling = false;
    mat.alphaMode = Constants.ALPHA_ADD;
    mat.transparencyMode = Material.MATERIAL_ALPHABLEND; // siempre mezclado, también con alpha 1
    if (opacity) mat.opacityTexture = opacity;
    mat.alpha = 1;
    return mat;
  }

  private build(step: FxStep, at: Pose): Piece {
    const n = this.seq++;
    const piece: Piece = { startMs: 0, endMs: 0, started: false };
    const fwdX = Math.sin(at.facing);
    const fwdZ = Math.cos(at.facing);
    switch (step.kind) {
      case "ring": {
        // Toro construido al radio final (tubo de 0.05 m) y escalado por igual en los 3 ejes: el tubo solo
        // adelgaza al achicarse (nunca pasa de 0.05 m), así el anillo se mantiene fino.
        const mesh = CreateTorus(`fx-ring-${n}`, { diameter: 2 * step.to, thickness: 0.05, tessellation: 48 }, this.scene);
        const mat = this.glow(`fx-ringMat-${n}`, step.color);
        mesh.material = mat;
        mesh.position.set(at.x, step.y, at.z);
        mesh.isPickable = false;
        const apply = (t: number) => {
          const r = RING_START_M + (step.to - RING_START_M) * (1 - (1 - t) * (1 - t));
          piece.ring = r;
          const k = r / step.to;
          mesh.scaling.set(k, k, k);
          mat.alpha = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
        };
        Object.assign(piece, { mesh, mat, apply });
        break;
      }
      case "telegraph": {
        // Marca la zona que va a dañar: se cierra sobre su radio y se enciende hasta el impacto.
        const mesh = this.floorQuad(`fx-telegraph-${n}`, at, FLOOR_Y + 0.015);
        const mat = this.glow(`fx-telegraphMat-${n}`, step.color, this.slamTex.telegraph);
        mesh.material = mat;
        piece.apply = (t) => {
          const r = step.radius * (1.12 - 0.12 * t);
          mesh.scaling.set(r, 1, r);
          mat.alpha = 0.15 + 0.85 * t * t;
        };
        Object.assign(piece, { mesh, mat });
        break;
      }
      case "burst": {
        // Fogonazo del impacto: mancha de luz que se abre de golpe, de blanco al color, y se apaga.
        const mesh = this.floorQuad(`fx-burst-${n}`, at, FLOOR_Y + 0.03, step.forward);
        const mat = this.glow(`fx-burstMat-${n}`, Color3.White(), this.spark);
        mesh.material = mat;
        piece.apply = (t) => {
          const r = step.radius * (0.5 + 1.2 * (1 - (1 - t) ** 3));
          mesh.scaling.set(r, 1, r);
          mat.alpha = (1 - t) ** 2;
          Color3.LerpToRef(Color3.White(), step.color, Math.min(1, t * 2.5), mat.emissiveColor);
        };
        Object.assign(piece, { mesh, mat });
        break;
      }
      case "zone": {
        // Zona del ataque mientras dura: aparece, se mantiene y se apaga.
        const mesh = this.floorQuad(`fx-zone-${n}`, at, FLOOR_Y + 0.015);
        const mat = this.glow(`fx-zoneMat-${n}`, step.color, this.slamTex.telegraph);
        mesh.material = mat;
        mesh.scaling.set(step.radius, 1, step.radius);
        piece.apply = (t) => (mat.alpha = 0.85 * Math.min(1, t / 0.12, (1 - t) / 0.25));
        Object.assign(piece, { mesh, mat });
        break;
      }
      case "implode": {
        // Aro que se cierra sobre el jugador, cada vez más rápido y más brillante.
        const mesh = this.floorQuad(`fx-implode-${n}`, at, FLOOR_Y + 0.02);
        const mat = this.glow(`fx-implodeMat-${n}`, step.color, this.slamTex.telegraph);
        mesh.material = mat;
        piece.apply = (t) => {
          const r = Math.max(0.6, step.radius * (1 - t * t));
          mesh.scaling.set(r, 1, r);
          mat.alpha = 0.25 + 0.75 * t;
        };
        Object.assign(piece, { mesh, mat });
        break;
      }
      case "swirl": {
        // Tajos curvos que giran con el mandoble (la cabeza por delante).
        const mesh = this.floorQuad(`fx-swirl-${n}`, at, step.y);
        const mat = this.glow(`fx-swirlMat-${n}`, step.color, this.slamTex.swirl);
        mesh.material = mat;
        const turn = SWIRL_TURNS_PER_S * Math.PI * 2 * step.durS;
        piece.apply = (t) => {
          const r = step.radius * (0.75 + 0.3 * Math.min(1, t / 0.25));
          mesh.scaling.set(r, 1, r);
          mesh.rotation.y = at.facing - turn * t;
          mat.alpha = Math.min(1, t / 0.1, (1 - t) / 0.3);
        };
        Object.assign(piece, { mesh, mat });
        break;
      }
      case "wave":
      case "slash": {
        // Cuña del arco del golpe con una banda brillante: la onda de la Patada crece hacia fuera; el tajo
        // de la espada barre el arco de un lado al otro.
        const arc = step.arcDeg / 360;
        const mesh = CreateDisc(`fx-${step.kind === "wave" ? "kickwave" : "slash"}-${n}`, { radius: 1, tessellation: 32, arc }, this.scene);
        const mat = this.glow(`fx-${step.kind}Mat-${n}`, step.color, step.kind === "wave" ? this.slamTex.shock : this.slamTex.slash);
        mesh.material = mat;
        mesh.rotation.x = Math.PI / 2;
        const centered = at.facing - (Math.PI / 2 - (arc * Math.PI * 2) / 2);
        mesh.rotation.y = centered;
        mesh.position.set(at.x, step.kind === "wave" ? step.y : SLASH_Y, at.z);
        mesh.isPickable = false;
        if (step.kind === "wave") {
          piece.apply = (t) => {
            const r = step.radius * (0.3 + 0.7 * (1 - (1 - t) ** 3));
            mesh.scaling.set(r, r, 1);
            mat.alpha = (1 - t) ** 1.5;
          };
        } else {
          const sweep = (arc * Math.PI * 2) * 0.35 * (step.flip ? -1 : 1);
          piece.apply = (t) => {
            const r = step.radius * (0.9 + 0.12 * t);
            mesh.scaling.set(r, r, 1);
            mesh.rotation.y = centered + sweep * (2 * (1 - (1 - t) ** 2) - 1) * 0.5;
            mat.alpha = t < 0.25 ? t / 0.25 : (1 - (t - 0.25) / 0.75) ** 1.5;
          };
        }
        Object.assign(piece, { mesh, mat });
        break;
      }
      case "hitFlash": {
        // Destello en el punto del golpe, de cara a la cámara.
        const mesh = CreatePlane(`fx-hit-${n}`, { size: 1 }, this.scene);
        const mat = this.glow(`fx-hitMat-${n}`, step.color, this.spark);
        mat.disableDepthWrite = true;
        mesh.material = mat;
        mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
        mesh.position.set(at.x, step.y, at.z);
        mesh.isPickable = false;
        const size = 0.9 + 1.1 * step.weight;
        piece.apply = (t) => {
          mesh.scaling.setAll(size * (0.5 + 0.5 * (1 - (1 - t) ** 3)));
          mat.alpha = (1 - t) ** 1.5;
        };
        Object.assign(piece, { mesh, mat });
        break;
      }
      case "hitSparks": {
        // Chispas en abanico, despedidas en la dirección del golpe.
        const ps = new ParticleSystem(`fx-hitSparks-${n}`, 24, this.scene);
        ps.particleTexture = this.spark;
        ps.emitter = new Vector3(at.x, step.y, at.z);
        const rightX = fwdZ;
        const rightZ = -fwdX;
        ps.createPointEmitter(new Vector3(fwdX - rightX * 0.8, 0.1, fwdZ - rightZ * 0.8), new Vector3(fwdX + rightX * 0.8, 1, fwdZ + rightZ * 0.8));
        ps.color1 = new Color4(1, 1, 1, 1);
        ps.color2 = new Color4(step.color.r, step.color.g, step.color.b, 1);
        ps.colorDead = new Color4(step.color.r * 0.6, step.color.g * 0.35, step.color.b * 0.2, 0);
        ps.billboardMode = ParticleSystem.BILLBOARDMODE_STRETCHED;
        ps.minSize = 0.05;
        ps.maxSize = 0.1;
        ps.minScaleY = 2;
        ps.maxScaleY = 4;
        ps.minLifeTime = 0.14;
        ps.maxLifeTime = 0.34;
        ps.minEmitPower = 3;
        ps.maxEmitPower = 7 + 3 * step.weight;
        ps.gravity = new Vector3(0, -9, 0);
        ps.blendMode = ParticleSystem.BLENDMODE_ADD;
        ps.emitRate = 0;
        ps.manualEmitCount = Math.round(6 + 14 * step.weight);
        ps.updateSpeed = 0;
        piece.ps = ps;
        break;
      }
      case "shock": {
        // Onda de frente irregular que sale disparada hasta el radio y se desvanece.
        const mesh = this.floorQuad(`fx-shock-${n}`, at, FLOOR_Y + 0.02);
        const mat = this.glow(`fx-shockMat-${n}`, step.color, this.slamTex.shock);
        mesh.material = mat;
        piece.apply = (t) => {
          const r = Math.max(0.05, step.radius * (1 - (1 - t) ** 3));
          mesh.scaling.set(r, 1, r);
          mat.alpha = step.alpha * (1 - t) ** 1.5;
        };
        Object.assign(piece, { mesh, mat });
        break;
      }
      case "scorch": {
        const mesh = this.floorQuad(`fx-scorch-${n}`, at, FLOOR_Y);
        const k = step.radius * 1.1;
        mesh.scaling.set(k, 1, k);
        const mat = new StandardMaterial(`fx-scorchMat-${n}`, this.scene);
        mat.disableLighting = true;
        mat.diffuseTexture = this.slamTex.scorch;
        mat.useAlphaFromDiffuseTexture = true;
        mat.diffuseColor = Color3.White();
        mat.specularColor = Color3.Black();
        mat.emissiveColor = Color3.Black();
        mat.zOffset = -1;
        mesh.material = mat;
        piece.apply = (t) => (mat.alpha = t < 0.55 ? 1 : 1 - (t - 0.55) / 0.45);
        Object.assign(piece, { mesh, mat });
        break;
      }
      case "molten": {
        // Las mismas grietas al rojo: arrancan casi blancas, pasan al color y se enfrían titilando.
        const mesh = this.floorQuad(`fx-molten-${n}`, at, FLOOR_Y + 0.01);
        const k = step.radius * 1.1;
        mesh.scaling.set(k, 1, k);
        const mat = this.glow(`fx-moltenMat-${n}`, step.color, this.slamTex.molten);
        mesh.material = mat;
        const hot = Color3.Lerp(step.color, Color3.White(), 0.7);
        const cold = step.color.scale(0.45);
        piece.apply = (t) => {
          if (t < 0.2) Color3.LerpToRef(hot, step.color, t / 0.2, mat.emissiveColor);
          else Color3.LerpToRef(step.color, cold, (t - 0.2) / 0.8, mat.emissiveColor);
          mat.alpha = (1 - t) ** 1.4 * (0.86 + 0.14 * Math.sin(t * 46));
        };
        Object.assign(piece, { mesh, mat });
        break;
      }
      case "trail": {
        // Plano alargado del ancho de la línea y del largo del alcance, desde donde se lanzó.
        const mesh = CreateGround(`fx-thrust-${n}`, { width: THRUST_WIDTH, height: step.range }, this.scene);
        const mat = this.glow(`fx-thrustMat-${n}`, step.color, this.slamTex.streak);
        mesh.material = mat;
        mesh.position.set(at.x + (fwdX * step.range) / 2, TRAIL_Y, at.z + (fwdZ * step.range) / 2);
        mesh.rotation.y = at.facing;
        mesh.isPickable = false;
        // La franja sale disparada desde el jugador (crece hacia delante) y luego se afina y se apaga.
        const half = step.range / 2;
        piece.apply = (t) => {
          const grow = Math.min(1, t / 0.2);
          mesh.scaling.set(1.3 - 0.6 * t, 1, grow);
          mesh.position.set(at.x + fwdX * half * grow, TRAIL_Y, at.z + fwdZ * half * grow);
          mat.alpha = 1 - t * t;
        };
        Object.assign(piece, { mesh, mat });
        break;
      }
      case "sparks": {
        const ps = new ParticleSystem(`fx-sparks-${n}`, 300, this.scene);
        ps.particleTexture = this.spark;
        ps.emitter = new Vector3(at.x, WHIRL_RING_Y, at.z);
        ps.createCylinderEmitter(step.radius, 0.3, 1, 0.2);
        if (step.nature === "none") {
          ps.color1 = new Color4(1, 0.75, 0.3, 1);
          ps.color2 = new Color4(1, 0.4, 0.08, 1);
          ps.colorDead = new Color4(0.6, 0.1, 0, 0);
        } else {
          // Chispas del tono de la naturaleza (sin aclararlas hacia el blanco: sumadas en aditivo, cientos de chispas
          // claras viran el aro y la nube a amarillo) y apagándose a su tono oscuro.
          const c = natureTint(FIRE, step.nature);
          ps.color1 = new Color4(c.r, c.g, c.b, 1);
          ps.color2 = new Color4(c.r * 0.8, c.g * 0.8, c.b * 0.8, 1);
          ps.colorDead = new Color4(c.r * 0.5, c.g * 0.5, c.b * 0.5, 0);
        }
        ps.minSize = 0.06;
        ps.maxSize = 0.16;
        ps.minLifeTime = 0.2;
        ps.maxLifeTime = SPARK_LIFE_MAX_S;
        ps.emitRate = 260;
        ps.minEmitPower = 1;
        ps.maxEmitPower = 3;
        ps.gravity = new Vector3(0, -6, 0);
        ps.blendMode = ParticleSystem.BLENDMODE_ADD;
        ps.updateSpeed = 0;
        piece.ps = ps;
        break;
      }
      case "shards": {
        // Chispas rasantes que salen disparadas del centro, estiradas por su velocidad.
        const ps = new ParticleSystem(`fx-shards-${n}`, 90, this.scene);
        ps.particleTexture = this.spark;
        ps.emitter = new Vector3(at.x, 0.2, at.z);
        ps.createCylinderEmitter(0.5, 0.1, 1, 0.35);
        const hot = Color3.Lerp(step.color, Color3.White(), 0.6);
        ps.color1 = new Color4(hot.r, hot.g, hot.b, 1);
        ps.color2 = new Color4(step.color.r, step.color.g, step.color.b, 1);
        ps.colorDead = new Color4(step.color.r * 0.4, step.color.g * 0.4, step.color.b * 0.4, 0);
        ps.billboardMode = ParticleSystem.BILLBOARDMODE_STRETCHED;
        ps.minSize = 0.05;
        ps.maxSize = 0.11;
        ps.minScaleY = 2.5;
        ps.maxScaleY = 5;
        ps.minLifeTime = 0.18;
        ps.maxLifeTime = 0.45;
        ps.minEmitPower = step.radius * 1.6;
        ps.maxEmitPower = step.radius * 3.2;
        ps.gravity = new Vector3(0, -5, 0);
        ps.blendMode = ParticleSystem.BLENDMODE_ADD;
        ps.emitRate = 0;
        ps.manualEmitCount = 80; // de una vez, en el impacto
        ps.updateSpeed = 0;
        piece.ps = ps;
        break;
      }
      case "debris": {
        // Esquirlas del suelo que saltan y caen girando.
        const ps = new ParticleSystem(`fx-debris-${n}`, 40, this.scene);
        ps.particleTexture = this.slamTex.rock;
        ps.emitter = new Vector3(at.x, 0.1, at.z);
        ps.createHemisphericEmitter(step.radius * 0.35, 1);
        ps.color1 = new Color4(0.42, 0.37, 0.33, 1);
        ps.color2 = new Color4(0.26, 0.23, 0.21, 1);
        ps.colorDead = new Color4(0.2, 0.18, 0.16, 0);
        ps.minSize = 0.08;
        ps.maxSize = 0.22;
        ps.minLifeTime = 0.5;
        ps.maxLifeTime = 0.9;
        ps.minEmitPower = 3;
        ps.maxEmitPower = 7;
        ps.minInitialRotation = 0;
        ps.maxInitialRotation = Math.PI * 2;
        ps.minAngularSpeed = -7;
        ps.maxAngularSpeed = 7;
        ps.gravity = new Vector3(0, -16, 0);
        ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
        ps.emitRate = 0;
        ps.manualEmitCount = 30;
        ps.updateSpeed = 0;
        piece.ps = ps;
        break;
      }
      case "dust": {
        // Anillo de polvo a ras del suelo: sale del centro, frena al llegar al borde y se hincha al disiparse.
        const ps = new ParticleSystem(`fx-dust-${n}`, 140, this.scene);
        ps.particleTexture = this.slamTex.smoke;
        ps.emitter = new Vector3(at.x, 0.3, at.z);
        ps.createCylinderEmitter(0.8, 0.1, 0, 0.1);
        ps.addColorGradient(0, new Color4(0.62, 0.55, 0.47, 0));
        ps.addColorGradient(0.15, new Color4(0.58, 0.51, 0.43, 0.38));
        ps.addColorGradient(1, new Color4(0.45, 0.4, 0.34, 0));
        ps.addSizeGradient(0, 0.5);
        ps.addSizeGradient(1, 1.8);
        ps.addVelocityGradient(0, 1);
        ps.addVelocityGradient(1, 0.05);
        ps.minLifeTime = 0.7;
        ps.maxLifeTime = DUST_LIFE_MAX_S;
        ps.emitRate = 700;
        ps.minEmitPower = step.radius * 1.3;
        ps.maxEmitPower = step.radius * 2.1;
        ps.minInitialRotation = 0;
        ps.maxInitialRotation = Math.PI * 2;
        ps.gravity = new Vector3(0, 0.3, 0);
        ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
        ps.updateSpeed = 0;
        piece.ps = ps;
        break;
      }
      case "embers": {
        // Brasas que suben despacio de las grietas mientras se enfrían.
        const ps = new ParticleSystem(`fx-embers-${n}`, 70, this.scene);
        ps.particleTexture = this.spark;
        ps.emitter = new Vector3(at.x, 0.1, at.z);
        const half = step.radius * 0.5;
        ps.createBoxEmitter(new Vector3(-0.2, 1, -0.2), new Vector3(0.2, 1, 0.2), new Vector3(-half, 0, -half), new Vector3(half, 0, half));
        const hot = Color3.Lerp(step.color, Color3.White(), 0.4);
        ps.color1 = new Color4(hot.r, hot.g, hot.b, 1);
        ps.color2 = new Color4(step.color.r, step.color.g, step.color.b, 1);
        ps.colorDead = new Color4(step.color.r * 0.5, step.color.g * 0.3, step.color.b * 0.3, 0);
        ps.minSize = 0.04;
        ps.maxSize = 0.1;
        ps.minLifeTime = 0.6;
        ps.maxLifeTime = EMBERS_LIFE_MAX_S;
        ps.emitRate = 45;
        ps.minEmitPower = 0.5;
        ps.maxEmitPower = 1.4;
        ps.gravity = new Vector3(0, 0.4, 0);
        ps.blendMode = ParticleSystem.BLENDMODE_ADD;
        ps.updateSpeed = 0;
        piece.ps = ps;
        break;
      }
    }
    return piece;
  }
}
