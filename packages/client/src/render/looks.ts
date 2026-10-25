import { MOVESETS, type EnemyKind, type WeaponId } from "@roguelike/shared";
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

export const WEAPON_LOOKS: Record<WeaponId, { asset: AssetId; grip: WeaponGrip }> = {
  // El mango quedó dentro del puño del modelo original: entre guarda y pomo hay un hueco (~0,36 m).
  "kingslayer-sword": { asset: "kingslayer-sword", grip: { position: [0.045, 0.05, 0.02], rotation: [...BLADE_OUT_OF_FIST], scale: 2.8 } },
  "guard-sword": { asset: "guard-sword", grip: { position: [0.135, 0.05, 0.02], rotation: [...BLADE_OUT_OF_FIST], scale: 0.24 } },
  "great-sword": { asset: "great-sword", grip: { position: [0.14, 0.05, 0.02], rotation: [...BLADE_OUT_OF_FIST], scale: 0.32 } },
};

export interface EnemyLook {
  asset: AssetId;
  /** m */
  height: number;
  clips: { idle: string; run: string; attack: string; hit: string; death: string };
  /** velocidad de reproducción del clip de correr */
  runSpeed?: number;
}

export const ENEMY_LOOKS: Record<EnemyKind, EnemyLook> = {
  brute: {
    asset: "brute",
    height: 2.4,
    clips: { idle: "cr_idle", run: "cr_run", attack: "cr_swiping", hit: "gs_impact", death: "cr_dying" },
  },
  minion: {
    asset: "minion",
    height: 1.7,
    clips: { idle: "cr_idle_2", run: "cr_run", attack: "cr_punch", hit: "gs_impact_4", death: "cr_dying" },
    runSpeed: 1.3,
  },
  mage: {
    asset: "mage",
    height: 2.2,
    clips: { idle: "mg_idle", run: "cr_walking", attack: "mg_attack", hit: "gs_impact_2", death: "gs_death" },
  },
};

/**
 * Velocidad a la que avanza cada clip de correr del héroe con velocidad de reproducción 1, en m/s
 * para el Kingslayer de 1,8 m: lo que se desplaza la cadera en el clip original (en alturas de cadera
 * por segundo, cadera ≈ 1 m). Sirve para que los pies no patinen.
 */
export const HERO_STRIDE_MPS: Record<string, number> = {
  ss_run: 4.9,
  ss_run_2: 5.2,
  ss_strafe_3: 3.8,
  ss_strafe_4: 3.8,
  gs_run_2: 4.8,
  gs_run: 2.8,
  gs_strafe_3: 2.8,
  gs_strafe_4: 3.6,
};

export const PLAYER_LOOK: { asset: AssetId; height: number } = { asset: "kingslayer", height: 1.8 };

/** Todos los clips que usa el juego (estilos de combate y enemigos), sin repetir. */
export function allClipIds(): string[] {
  const ids = new Set<string>();
  for (const m of Object.values(MOVESETS)) {
    for (const c of Object.values(m.locomotion)) ids.add(c);
    for (const s of m.combo) ids.add(s.clip);
  }
  for (const look of Object.values(ENEMY_LOOKS)) for (const c of Object.values(look.clips)) ids.add(c);
  return [...ids];
}
