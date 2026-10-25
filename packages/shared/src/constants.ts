export const SIM_HZ = 30;
export const SIM_DT = 1 / SIM_HZ;
export const PATCH_RATE_MS = 50;
export const INTERP_DELAY_MS = 100;
export const MAX_INPUTS_PER_TICK = 3;
export const MAX_QUEUED_INPUTS = 30;
export const MAX_PENDING_INPUTS = 90;
export const TILE_SIZE = 2; // metros
// Anchos posibles de pasillo en casillas; cada pasillo sortea uno con la semilla.
// Valores válidos: 1, 3 o 5 (impar para quedar centrado; un par se redondea al impar
// siguiente, y 7+ choca con el borde del mapa).
export const CORRIDOR_WIDTHS: readonly number[] = [3, 5];
export const PLAYER_RADIUS = 0.4;
export const PLAYER_SPEED = 5; // m/s
export const SPRINT_SPEED = 8; // m/s, con Shift; sin estamina por ahora
export const JUMP_VELOCITY = 7; // m/s hacia arriba al saltar (~1,1 m de altura)
export const GRAVITY = 20; // m/s² (~0,7 s en el aire)
export const MAX_PLAYERS = 4;
export const PICKUP_RANGE = 1.5; // m, para tomar un arma del suelo
export const EMPTY_ROOM_TTL_MS = 600_000;
export const NAME_MAX_LEN = 16;
export const ROOM_CODE_LENGTH = 5;
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const REWIND_MAX_TICKS = 10; // ~333 ms a 30 Hz
export const HISTORY_TICKS = 14;
export const RESPAWN_S = 5;
export const RESPAWN_INVULN_S = 1;
export const ENEMY_SPAWN_MIN_PLAYER_DIST_TILES = 3;
