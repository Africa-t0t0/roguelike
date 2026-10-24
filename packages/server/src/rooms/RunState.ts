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
    lastSeq: t.number(),
  },
  "PlayerState",
);
export type PlayerState = SchemaType<typeof PlayerState>;

/** `players` está indexado por la clave normalizada del jugador, no por `sessionId`. */
export const RunState = schema(
  {
    seed: t.number(),
    floor: t.number(),
    players: t.map(PlayerState),
  },
  "RunState",
);
export type RunState = SchemaType<typeof RunState>;
