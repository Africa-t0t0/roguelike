import { schema, t, type SchemaType } from "@colyseus/schema";

export const PlayerState = schema(
  {
    name: t.string(),
    x: t.number(),
    z: t.number(),
    facing: t.number(),
    dodgeTime: t.number(),
    dodgeCooldown: t.number(),
    dodgeDirX: t.number(),
    dodgeDirZ: t.number(),
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
  },
  "EnemyState",
);
export type EnemyState = SchemaType<typeof EnemyState>;

export const ProjectileState = schema({ x: t.number(), z: t.number() }, "ProjectileState");
export type ProjectileState = SchemaType<typeof ProjectileState>;

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
    /** indexado por id de enemigo ("e1", …) */
    enemies: t.map(EnemyState),
    /** indexado por id de proyectil ("p1", …) */
    projectiles: t.map(ProjectileState),
  },
  "RunState",
);
export type RunState = SchemaType<typeof RunState>;
