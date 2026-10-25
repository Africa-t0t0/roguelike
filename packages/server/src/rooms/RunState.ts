import { schema, t, type SchemaType } from "@colyseus/schema";

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
    /** tiene una elección de carta abierta sin elegir */
    choosing: t.boolean(),
    /** multiplicador de velocidad de movimiento de sus cartas (la predicción del cliente lo usa) */
    moveSpeedMult: t.number(),
    /** multiplicador de velocidad de ataque de sus cartas (la predicción del combo lo usa) */
    attackSpeedMult: t.number(),
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
  },
  "EnemyState",
);
export type EnemyState = SchemaType<typeof EnemyState>;

export const ProjectileState = schema({ x: t.number(), z: t.number() }, "ProjectileState");
export type ProjectileState = SchemaType<typeof ProjectileState>;

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
    /** orbes de XP compartidos, indexados por id ("o1", …) */
    orbs: t.map(OrbState),
    /** el grupo está eligiendo cartas: la simulación no avanza */
    paused: t.boolean(),
    /** segundos que quedan de la elección en curso de la pausa */
    pauseLeft: t.number(),
  },
  "RunState",
);
export type RunState = SchemaType<typeof RunState>;
