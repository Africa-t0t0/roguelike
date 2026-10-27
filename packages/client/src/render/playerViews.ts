import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { ABILITIES, MOVESETS, WEAPONS, strikeOf, type AbilityId, type GearSlot, type Nature, type RelicId, type WeaponId, type WeaponTier } from "@roguelike/shared";
import type { EquippedGear } from "../net/connection";
import type { AnimLibrary } from "./animLibrary";
import { chooseHeroAnim, heroBodyYaw, SpeedMeter, type ClipLengths, type HeroAnimInput } from "./animState";
import type { Assets } from "./assets";
import { CharacterView } from "./characterView";
import { GearFxShared, GearLooks } from "./gearLooks";
import { GearTint } from "./gearTint";
import { PLAYER_LOOK } from "./looks";

const LABEL_W = 2;
const LABEL_H = 0.5;
const AIRBORNE_Y = 0.05; // m
const LABEL_ABOVE_HEAD = 0.4; // m sobre PLAYER_LOOK.height

/** Lo que el servidor dice del jugador y que decide su animación (además de la pose dibujada). */
export interface HeroState {
  comboStep: number;
  swingTimer: number;
  dead: boolean;
  weaponId: WeaponId;
  weaponTier: WeaponTier;
  weaponNature: Nature;
  blocking: boolean;
  /** velocidad de ataque (Furia): ajusta la duración de los golpes */
  attackSpeedMult: number;
  /**
   * Habilidad en curso y cuánto lleva (s), para el propio jugador (predicha). Sin ella, la que anuncie
   * el evento `ability` (los remotos).
   */
  ability?: { id: AbilityId; elapsed: number } | null;
  /** equipo y reliquia puestos (brillo por parte del cuerpo y gema que orbita); sin ellos, nada */
  gear?: Partial<Record<GearSlot, EquippedGear>>;
  relic?: RelicId | null;
}

interface PlayerView {
  character: CharacterView;
  gearLooks: GearLooks;
  /** tinte y contorno del color de cada pieza sobre su parte del cuerpo */
  gearTint: GearTint;
  speed: SpeedMeter;
  /** Swing anunciado por evento (`startMs` en el reloj con el que se dibuja a este jugador). */
  swing?: { step: number; startMs: number; restart: boolean };
  /** Habilidad anunciada por evento (`startMs` en el reloj con el que se dibuja a este jugador). */
  ability?: { id: AbilityId; startMs: number };
  /** cuánto llevaba la habilidad dibujada en el cuadro anterior (para reiniciar el clip si empieza otra) */
  abilityElapsed?: number;
  dispose(): void;
}

function createLabel(scene: Scene, key: string, text: string, parent: TransformNode): Mesh {
  const tex = new DynamicTexture(`label-${key}`, { width: 512, height: 128 }, scene, false);
  tex.hasAlpha = true;
  tex.drawText(text, null, 86, "700 52px Cinzel, Georgia, serif", "#f3e6c8", "transparent", true);
  const mat = new StandardMaterial(`labelMat-${key}`, scene);
  mat.diffuseTexture = tex;
  mat.emissiveColor = Color3.White();
  mat.disableLighting = true;
  mat.fogEnabled = false;
  mat.backFaceCulling = false;
  mat.useAlphaFromDiffuseTexture = true;

  const plane = CreatePlane(`labelPlane-${key}`, { width: LABEL_W, height: LABEL_H }, scene);
  plane.material = mat;
  plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
  plane.parent = parent;
  plane.position.y = PLAYER_LOOK.height + LABEL_ABOVE_HEAD;
  return plane;
}

/** Un Kingslayer animado según el estilo de su arma, con el arma en la mano y su nombre encima. */
export class PlayerViews {
  private readonly views = new Map<string, PlayerView>();
  private readonly clipLengths: ClipLengths;
  private readonly gearFx: GearFxShared;
  private paused = false;
  /**
   * Empezó a dibujarse una habilidad (una vez por lanzamiento, propia o ajena): con la pose dibujada en ese
   * cuadro y cuánto lleva ya (s) en el reloj con el que se dibuja a ese jugador.
   */
  onAbilityStart?: (key: string, id: AbilityId, pose: { x: number; z: number; facing: number }, elapsedS: number) => void;

  constructor(
    private readonly scene: Scene,
    private readonly assets: Assets,
    private readonly anims: AnimLibrary,
  ) {
    this.clipLengths = { get: (clip) => anims.length(clip) };
    this.gearFx = new GearFxShared(scene);
  }

  /** Crea las vistas de los que entraron y destruye las de los que salieron. */
  sync(players: Map<string, { name: string }>): void {
    for (const [key, p] of players) {
      if (!this.views.has(key)) this.views.set(key, this.create(key, p.name));
    }
    for (const [key, view] of this.views) {
      if (!players.has(key)) {
        view.dispose();
        this.views.delete(key);
      }
    }
  }

  /** Otro jugador empezó un golpe del combo en `startMs` (mismo reloj que se pasa a `render`). */
  swing(key: string, step: number, startMs: number): void {
    const view = this.views.get(key);
    if (view) view.swing = { step, startMs, restart: true };
  }

  /** Otro jugador empezó una habilidad en `startMs` (mismo reloj que se pasa a `render`). */
  ability(key: string, id: AbilityId, startMs: number): void {
    const view = this.views.get(key);
    if (view) view.ability = { id, startMs };
  }

  /**
   * Dibuja al jugador en la pose dada y elige su animación. `nowMs` es el instante que representa la
   * pose (ahora para el propio, ahora − retardo de interpolación para los remotos).
   */
  render(
    key: string,
    pose: { x: number; y: number; z: number; facing: number },
    state: HeroState,
    hurtRecently: boolean,
    nowMs: number,
    dtS: number,
  ): void {
    const view = this.views.get(key);
    if (!view) return;
    view.character.setPose(pose.x, pose.y, pose.z, pose.facing);
    view.character.setWeapon(state.weaponId, { tier: state.weaponTier, nature: state.weaponNature });
    view.gearLooks.set(state.relic ?? null);
    view.gearTint.set(state.gear ?? {});
    view.gearLooks.render(nowMs);
    let { comboStep, swingTimer } = state;
    let attackClip: string | undefined;
    const s = view.swing;
    if (s) {
      const inCombo = s.step >= 1 && s.step <= MOVESETS[WEAPONS[state.weaponId].movesetId].combo.length;
      const strike = inCombo ? strikeOf(state.weaponId, s.step, state.attackSpeedMult) : undefined;
      const left = (strike?.duration ?? 0) - (nowMs - s.startMs) / 1000;
      if (left <= 0) view.swing = undefined;
      else if (nowMs >= s.startMs) {
        comboStep = s.step;
        swingTimer = left;
        // Un golpe nuevo reinicia su clip aunque sea el mismo que ya suena.
        if (s.restart) attackClip = strike?.clip;
        s.restart = false;
      }
    }
    let ability = state.ability ?? undefined;
    const ev = view.ability;
    if (state.ability === undefined && ev) {
      const elapsed = (nowMs - ev.startMs) / 1000;
      if (elapsed >= ABILITIES[ev.id].animS) view.ability = undefined;
      else if (elapsed >= 0) ability = { id: ev.id, elapsed };
    }
    // Una habilidad nueva (o la misma otra vez) reinicia su clip aunque ya sonara (p. ej. el Torbellino
    // usa el clip del golpe 2 del mandoble).
    if (ability && (view.abilityElapsed === undefined || ability.elapsed < view.abilityElapsed)) {
      attackClip = ABILITIES[ability.id].clip;
      this.onAbilityStart?.(key, ability.id, pose, ability.elapsed);
    }
    view.abilityElapsed = ability?.elapsed;
    const input: HeroAnimInput = {
      weaponId: state.weaponId,
      speed: view.speed.sample(pose.x, pose.z, dtS),
      moveAngle: view.speed.angleFrom(pose.facing),
      airborne: pose.y > AIRBORNE_Y,
      comboStep,
      swingTimer,
      dead: state.dead,
      hurtRecently,
      ability,
      blocking: state.blocking,
      attackSpeedMult: state.attackSpeedMult,
    };
    const choice = chooseHeroAnim(input, this.clipLengths);
    view.character.setBodyYaw(heroBodyYaw(input));
    view.character.play(choice, attackClip !== undefined && choice.clip === attackClip);
  }

  /** Congela (o reanuda) las partículas de las armas en la pausa del grupo. */
  setPaused(paused: boolean): void {
    this.paused = paused;
    for (const view of this.views.values()) {
      view.character.setPaused(paused);
    }
  }

  dispose(): void {
    for (const view of this.views.values()) view.dispose();
    this.views.clear();
    this.gearFx.dispose();
  }

  private create(key: string, name: string): PlayerView {
    const character = new CharacterView(this.scene, this.assets, this.anims, PLAYER_LOOK);
    const label = createLabel(this.scene, key, name, character.root);
    const gearLooks = new GearLooks(this.scene, this.gearFx, character);
    // Mallas con esqueleto: el cuerpo (el arma cuelga de la mano sin esqueleto).
    const gearTint = new GearTint(character.root.getChildMeshes(false).filter((m) => m.skeleton));
    return {
      character,
      gearLooks,
      gearTint,
      speed: new SpeedMeter(),
      dispose() {
        label.material?.getActiveTextures().forEach((t) => t.dispose());
        label.material?.dispose();
        gearLooks.dispose();
        gearTint.dispose();
        character.dispose();
      },
    };
  }
}
