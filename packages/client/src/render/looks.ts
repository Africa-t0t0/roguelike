import { ABILITIES, MOVESETS, type ClassId, type EnemyKind, type WeaponId } from "@roguelike/shared";
import type { AssetId } from "./assets";

/**
 * Cómo se agarra un arma, en el espacio del hueso `RightHand` pero en metros (CharacterView compensa
 * la escala del esqueleto): `position` en m, `rotation` en radianes (XYZ de Euler) y `scale` pasa de
 * las unidades nativas del modelo a metros. El origen del arma es el centro de la guarda y la hoja
 * va por +Y.
 */
export interface WeaponGrip {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
}

/**
 * Ajustados a ojo con `dev/grip.html` sobre el Kingslayer de 1,8 m. En la mano de Mixamo +Y va hacia
 * los dedos, +Z hacia la palma y +X hacia el pulgar: la hoja sale por +X (giro [0, π, π/2]) con la
 * guarda a lo largo de los dedos, y la guarda queda justo encima del puño. Hojas: ~0,8 m (Kingslayer),
 * ~0,9 m (guardia) y ~1,5 m (mandoble).
 */
const BLADE_OUT_OF_FIST: [number, number, number] = [0, Math.PI, Math.PI / 2];

/** `asset: null`: el arma no tiene modelo y se construye por código (el bastón, `buildStaff`). */
export const WEAPON_LOOKS: Record<WeaponId, { asset: AssetId | null; grip: WeaponGrip }> = {
  // El mango quedó dentro del puño del modelo original: entre guarda y pomo hay un hueco (~0,36 m).
  "kingslayer-sword": { asset: "kingslayer-sword", grip: { position: [0.045, 0.05, 0.02], rotation: [...BLADE_OUT_OF_FIST], scale: 2.8 } },
  "guard-sword": { asset: "guard-sword", grip: { position: [0.135, 0.05, 0.02], rotation: [...BLADE_OUT_OF_FIST], scale: 0.24 } },
  "great-sword": { asset: "great-sword", grip: { position: [0.14, 0.05, 0.02], rotation: [...BLADE_OUT_OF_FIST], scale: 0.32 } },
  // Ya en metros: se agarra por el tercio de arriba, con el orbe hacia donde saldría la hoja.
  staff: { asset: null, grip: { position: [0.05, 0.05, 0.02], rotation: [...BLADE_OUT_OF_FIST], scale: 1 } },
};

export interface EnemyLook {
  asset: AssetId;
  /** m */
  height: number;
  clips: { idle: string; run: string; attack: string; hit: string; death: string };
  /** velocidad de reproducción del clip de correr */
  runSpeed?: number;
  /**
   * Multiplica `grip.scale` y `grip.position` de `WEAPON_LOOKS` cuando lleva arma (por defecto 1): el
   * agarre está ajustado a la mano del Kingslayer de 1,8 m. Ajustado a ojo con `dev/grip.html`: el
   * mandoble del bruto queda de ~1,8 m de hoja y la espada del esbirro, de ~0,85 m.
   */
  gripScale?: number;
}

const MAGE_LOOK: EnemyLook = {
  asset: "mage",
  height: 2.2,
  clips: { idle: "mg_idle", run: "cr_walking", attack: "mg_attack", hit: "gs_impact_2", death: "gs_death" },
};

/** El dragón tiene su propia vista (`DragonViews`), con su modelo y sus animaciones. */
export type LookKind = Exclude<EnemyKind, "dragon">;

export const ENEMY_LOOKS: Record<LookKind, EnemyLook> = {
  brute: {
    asset: "brute",
    height: 2.4,
    clips: { idle: "cr_idle", run: "cr_run", attack: "cr_swiping", hit: "gs_impact", death: "cr_dying" },
    gripScale: 1.2,
  },
  minion: {
    asset: "minion",
    height: 1.7,
    clips: { idle: "cr_idle_2", run: "cr_run", attack: "cr_punch", hit: "gs_impact_4", death: "cr_dying" },
    runSpeed: 1.3,
    gripScale: 0.94,
  },
  mage: MAGE_LOOK,
  // Sin modelos propios: los tres hechiceros comparten el del mago (se distinguen por tinte y aura).
  pyromancer: MAGE_LOOK,
  stormcaller: MAGE_LOOK,
  healer: MAGE_LOOK,
};

/**
 * Velocidad a la que avanza cada clip de correr del héroe con velocidad de reproducción 1, en m/s
 * para el Kingslayer de 1,8 m: lo que se desplaza la cadera en el clip original (en alturas de cadera
 * por segundo, cadera ≈ 1 m). Sirve para que los pies no patinen.
 */
export const HERO_STRIDE_MPS: Record<string, number> = {
  ss_run_2: 5.2,
  ss_strafe_3: 3.8,
  ss_strafe_4: 3.8,
  gs_run_2: 4.8,
  gs_run: 2.8,
  gs_strafe_3: 2.8,
  gs_strafe_4: 3.6,
};

/** Clip propio del modelo que suena en lugar de un clip del juego; `rate` multiplica su velocidad. */
export interface OwnClip {
  clip: string;
  rate?: number;
}

/**
 * Cuerpo de un personaje. Los modelos de Mixamo usan los clips de `AnimLibrary`; los que traen sus propias
 * animaciones (KayKit) dicen en `ownClips` cuál de las suyas suena por cada clip del juego, y en `ownWeapons` qué
 * mallas suyas muestran por cada arma (la primera es el arma, que brilla con su tier; el resto, accesorios
 * como el escudo). Sin arma propia se cuelga el modelo de `WEAPON_LOOKS`.
 */
export interface CharacterLook {
  asset: AssetId;
  /** m */
  height: number;
  ownClips?: Readonly<Record<string, OwnClip>>;
  /** mallas del modelo que no se ven nunca (o solo con su arma de `ownWeapons`) */
  hideMeshes?: readonly string[];
  ownWeapons?: Partial<Record<WeaponId, readonly [string, ...string[]]>>;
}

/**
 * Velocidad con la que un héroe KayKit de 1,8 m avanza con `Running_A` a velocidad 1 (m/s), ajustada a ojo:
 * reescala el paso de los clips de Mixamo a los suyos para que los pies no patinen.
 */
const KAYKIT_RUN_MPS = 4.4;
const kaykitRun = (mixamo: string): OwnClip => ({ clip: "Running_A", rate: HERO_STRIDE_MPS[mixamo]! / KAYKIT_RUN_MPS });
const kaykitStrafe = (side: "Left" | "Right", mixamo: string): OwnClip => ({ clip: `Running_Strafe_${side}`, rate: HERO_STRIDE_MPS[mixamo]! / KAYKIT_RUN_MPS });

/**
 * El caballero KayKit con sus propias animaciones, en lugar de los clips de Mixamo del estilo de cada arma y de
 * las habilidades. Espada y escudo redondo con la del Kingslayer, escudo de insignia con la de guardia y el
 * mandoble a dos manos.
 */
export const KNIGHT_LOOK: CharacterLook = {
  asset: "knight",
  height: 1.8,
  ownClips: {
    ss_idle: { clip: "Idle" },
    ss_run_2: kaykitRun("ss_run_2"),
    ss_strafe_3: kaykitStrafe("Left", "ss_strafe_3"),
    ss_strafe_4: kaykitStrafe("Right", "ss_strafe_4"),
    ss_jump: { clip: "Jump_Idle" },
    ss_impact: { clip: "Hit_A" },
    ss_death: { clip: "Death_A" },
    ss_slash: { clip: "1H_Melee_Attack_Slice_Diagonal" },
    ss_slash_3: { clip: "1H_Melee_Attack_Slice_Horizontal" },
    ss_attack_4: { clip: "1H_Melee_Attack_Chop" },
    ss_power_up: { clip: "Cheer" },
    gs_idle: { clip: "2H_Melee_Idle" },
    gs_run_2: kaykitRun("gs_run_2"),
    gs_run: kaykitRun("gs_run"),
    gs_strafe_3: kaykitStrafe("Left", "gs_strafe_3"),
    gs_strafe_4: kaykitStrafe("Right", "gs_strafe_4"),
    gs_jump: { clip: "Jump_Idle" },
    gs_impact: { clip: "Hit_B" },
    gs_death: { clip: "Death_B" },
    gs_slash: { clip: "2H_Melee_Attack_Slice" },
    gs_high_spin_attack: { clip: "2H_Melee_Attack_Spin" },
    gs_jump_attack: { clip: "2H_Melee_Attack_Chop" },
    gs_slide_attack: { clip: "2H_Melee_Attack_Stab" },
  },
  hideMeshes: ["1H_Sword", "1H_Sword_Offhand", "2H_Sword", "Badge_Shield", "Rectangle_Shield", "Round_Shield", "Spike_Shield"],
  ownWeapons: {
    "kingslayer-sword": ["1H_Sword", "Round_Shield"],
    "guard-sword": ["1H_Sword", "Badge_Shield"],
    "great-sword": ["2H_Sword"],
  },
};

export const PLAYER_LOOK: CharacterLook = KNIGHT_LOOK;

/** Cuerpo de cada rol: el mago usa el modelo del hechicero, a la altura del caballero. */
export const PLAYER_LOOKS: Record<ClassId, CharacterLook> = {
  warrior: PLAYER_LOOK,
  mage: { asset: "mage", height: 1.8 },
};

/** Todos los clips que usa el juego (estilos de combate, habilidades y enemigos), sin repetir. */
export function allClipIds(): string[] {
  const ids = new Set<string>();
  for (const m of Object.values(MOVESETS)) {
    for (const c of Object.values(m.locomotion)) ids.add(c);
    for (const s of m.combo) ids.add(s.clip);
  }
  for (const def of Object.values(ABILITIES)) if (def.clip) ids.add(def.clip);
  for (const look of Object.values(ENEMY_LOOKS)) for (const c of Object.values(look.clips)) ids.add(c);
  return [...ids];
}
