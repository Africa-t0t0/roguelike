import { schema, t, type SchemaType } from "@colyseus/schema";

/** Una casilla de habilidad del jugador (activa o mantenida; la pasiva va en `passiveRank`). */
export const AbilitySlotState = schema(
  {
    /** AbilityId */
    id: t.string(),
    rank: t.number(),
    /** segundos de enfriamiento que le quedan */
    cooldown: t.number(),
  },
  "AbilitySlotState",
);
export type AbilitySlotState = SchemaType<typeof AbilitySlotState>;

export const PlayerState = schema(
  {
    name: t.string(),
    x: t.number(),
    z: t.number(),
    facing: t.number(),
    y: t.number(),
    vy: t.number(),
    lastSeq: t.number(),
    hp: t.number(),
    maxHp: t.number(),
    dead: t.boolean(),
    respawnIn: t.number(),
    comboStep: t.number(),
    swingTimer: t.number(),
    /** WeaponId del arma equipada */
    weaponId: t.string(),
    /** WeaponTier del arma equipada */
    weaponTier: t.number(),
    /** Nature del arma equipada */
    weaponNature: t.string(),
    /** tiene una elección de carta abierta sin elegir */
    choosing: t.boolean(),
    /** multiplicador de velocidad de movimiento de sus cartas (la predicción del cliente lo usa) */
    moveSpeedMult: t.number(),
    /** multiplicador de velocidad de ataque de sus cartas (la predicción del combo lo usa) */
    attackSpeedMult: t.number(),
    /** multiplicador de enfriamiento de habilidades (Celeridad; la predicción del cliente lo usa) */
    cooldownMult: t.number(),
    /** habilidades en orden de casilla (la tecla i+1 usa la i-ésima), sin la pasiva */
    abilities: t.array(AbilitySlotState),
    /** rango de la Onda de corte; 0 si no la tiene */
    passiveRank: t.number(),
    /** mantiene el Bloqueo */
    blocking: t.boolean(),
    /** el mayor Grito activo sobre él (0 si ninguno) */
    buffDamage: t.number(),
  },
  "PlayerState",
);
export type PlayerState = SchemaType<typeof PlayerState>;

export const EnemyState = schema(
  {
    kind: t.string(),
    x: t.number(),
    z: t.number(),
    facing: t.number(),
    hp: t.number(),
    maxHp: t.number(),
    ai: t.string(),
    aiTime: t.number(),
    /** WeaponId del arma que lleva; "" si va desarmado */
    weaponId: t.string(),
    /** WeaponTier de esa arma; 0 si va desarmado */
    weaponTier: t.number(),
    /** Nature de esa arma; "none" si va desarmado */
    weaponNature: t.string(),
    /** segundos que le quedan aturdido */
    stunned: t.number(),
    /** tier de sus hechizos (1..3); 0 si no es hechicero */
    spellTier: t.number(),
  },
  "EnemyState",
);
export type EnemyState = SchemaType<typeof EnemyState>;

export const ProjectileState = schema({ x: t.number(), z: t.number() }, "ProjectileState");
export type ProjectileState = SchemaType<typeof ProjectileState>;

/** Onda de corte de un jugador. */
export const PlayerShotState = schema(
  { x: t.number(), z: t.number(), dirX: t.number(), dirZ: t.number(), radius: t.number() },
  "PlayerShotState",
);
export type PlayerShotState = SchemaType<typeof PlayerShotState>;

/** Peligro de un hechicero: zona (círculo) o rayo, en aviso o ya activo. */
export const HazardState = schema(
  {
    /** "zone" | "beam" */
    kind: t.string(),
    x: t.number(),
    z: t.number(),
    dirX: t.number(),
    dirZ: t.number(),
    length: t.number(),
    size: t.number(),
    /** segundos que le quedan a la fase actual */
    left: t.number(),
    /** duración total de la fase actual */
    total: t.number(),
    /** "warn" | "fire" */
    phase: t.string(),
  },
  "HazardState",
);
export type HazardState = SchemaType<typeof HazardState>;

export const OrbState = schema({ x: t.number(), z: t.number(), value: t.number() }, "OrbState");
export type OrbState = SchemaType<typeof OrbState>;

/** `players` está indexado por la clave normalizada del jugador, no por `sessionId`. */
export const RunState = schema(
  {
    seed: t.number(),
    floor: t.number(),
    players: t.map(PlayerState),
    tick: t.number(),
    level: t.number(),
    xp: t.number(),
    xpToNext: t.number(),
    /** segundos del piso; avanza solo con al menos un jugador conectado */
    floorTime: t.number(),
    /** indexado por id de enemigo ("e1", …) */
    enemies: t.map(EnemyState),
    /** indexado por id de proyectil ("p1", …) */
    projectiles: t.map(ProjectileState),
    /** peligros de los hechiceros, indexados por id ("h1", …) */
    hazards: t.map(HazardState),
    /** orbes de XP compartidos, indexados por id ("o1", …) */
    orbs: t.map(OrbState),
    /** ondas de los jugadores, indexadas por id ("w1", …) */
    playerShots: t.map(PlayerShotState),
    /** el grupo está eligiendo cartas: la simulación no avanza */
    paused: t.boolean(),
    /** segundos que quedan de la elección en curso de la pausa */
    pauseLeft: t.number(),
  },
  "RunState",
);
export type RunState = SchemaType<typeof RunState>;
