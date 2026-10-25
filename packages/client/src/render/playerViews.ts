import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { MOVESETS, WEAPONS, strikeOf, type WeaponId } from "@roguelike/shared";
import type { AnimLibrary } from "./animLibrary";
import { chooseHeroAnim, SpeedMeter, type ClipLengths } from "./animState";
import type { Assets } from "./assets";
import { CharacterView } from "./characterView";
import { PLAYER_LOOK } from "./looks";

const LABEL_W = 2;
const LABEL_H = 0.5;
const AIRBORNE_Y = 0.05; // m
const LABEL_ABOVE_HEAD = 0.4; // m sobre PLAYER_LOOK.height

/** Lo que el servidor dice del jugador y que decide su animación (además de la pose dibujada). */
export interface HeroState {
  dodgeTime: number;
  comboStep: number;
  swingTimer: number;
  dead: boolean;
  weaponId: WeaponId;
}

interface PlayerView {
  character: CharacterView;
  speed: SpeedMeter;
  /** Swing anunciado por evento (`startMs` en el reloj con el que se dibuja a este jugador). */
  swing?: { step: number; startMs: number; restart: boolean };
  dispose(): void;
}

function createLabel(scene: Scene, key: string, text: string, parent: TransformNode): Mesh {
  const tex = new DynamicTexture(`label-${key}`, { width: 512, height: 128 }, scene, false);
  tex.hasAlpha = true;
  tex.drawText(text, null, 88, "bold 72px system-ui, sans-serif", "white", "transparent", true);
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

  constructor(
    private readonly scene: Scene,
    private readonly assets: Assets,
    private readonly anims: AnimLibrary,
  ) {
    this.clipLengths = { get: (clip) => anims.length(clip) };
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
    view.character.setWeapon(state.weaponId);
    let { comboStep, swingTimer } = state;
    let attackClip: string | undefined;
    const s = view.swing;
    if (s) {
      const inCombo = s.step >= 1 && s.step <= MOVESETS[WEAPONS[state.weaponId].movesetId].combo.length;
      const strike = inCombo ? strikeOf(state.weaponId, s.step) : undefined;
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
    const choice = chooseHeroAnim(
      {
        weaponId: state.weaponId,
        speed: view.speed.sample(pose.x, pose.z, dtS),
        airborne: pose.y > AIRBORNE_Y,
        dodging: state.dodgeTime > 0,
        comboStep,
        swingTimer,
        dead: state.dead,
        hurtRecently,
      },
      this.clipLengths,
    );
    view.character.play(choice, attackClip !== undefined && choice.clip === attackClip);
  }

  dispose(): void {
    for (const view of this.views.values()) view.dispose();
    this.views.clear();
  }

  private create(key: string, name: string): PlayerView {
    const character = new CharacterView(this.scene, this.assets, this.anims, PLAYER_LOOK);
    const label = createLabel(this.scene, key, name, character.root);
    return {
      character,
      speed: new SpeedMeter(),
      dispose() {
        label.material?.getActiveTextures().forEach((t) => t.dispose());
        label.material?.dispose();
        character.dispose();
      },
    };
  }
}
