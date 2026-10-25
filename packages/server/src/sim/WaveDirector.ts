import {
  FlowField,
  hasLineOfSight,
  isWalkableTile,
  maxLiveEnemies,
  tileCenter,
  TILE_SIZE,
  waveGroupSize,
  waveInterval,
  waveKinds,
  WAVE_FIRST_AT_S,
  WAVE_SPAWN_BAND,
  WAVE_SPAWN_FALLBACK_MIN,
  type Dungeon,
  type Rng,
} from "@roguelike/shared";
import type { Enemy, EnemySystem, SimPlayer } from "./EnemySystem";

const tileOf = (v: number): number => Math.floor(v / TILE_SIZE);

interface Candidate {
  tx: number;
  tz: number;
  d: number;
}

/** Director de oleadas: cada cierto tiempo crea un grupo de enemigos en chase, lejos de los jugadores vivos. */
export class WaveDirector {
  /** segundo del piso en que toca el siguiente grupo */
  private nextAt = WAVE_FIRST_AT_S;

  constructor(
    private readonly dungeon: Dungeon,
    private readonly rng: Rng,
  ) {}

  /** Devuelve los enemigos creados en este tick. Sin jugadores vivos no hace nada. */
  step(floorTime: number, alive: readonly SimPlayer[], playerCount: number, enemies: EnemySystem): Enemy[] {
    if (alive.length === 0 || floorTime < this.nextAt) return [];
    const room = maxLiveEnemies(playerCount) - enemies.liveCount();
    // En el tope se espera: el grupo pendiente sale en cuanto baje, sin acumular grupos atrasados.
    if (room <= 0) return [];

    // El flujo se refresca aquí (barato si las casillas no cambiaron): el director corre antes de `enemies.step`.
    enemies.refreshFlow(alive);
    const n = Math.min(waveGroupSize(floorTime, playerCount), room);
    const spots = this.pickSpots(n, alive, enemies.flow);
    const base = this.nextAt;
    this.nextAt = Math.max(floorTime, base + waveInterval(base));
    return enemies.spawnWave(spots, waveKinds(floorTime));
  }

  /**
   * Casillas a 8-30 pasos del jugador vivo más cercano, fuera de toda sala con un jugador vivo y fuera de
   * la vista de todos ellos. Si no hay, las más lejanas con distancia ≥ 6 (también ocultas); si tampoco,
   * `[]` con un aviso.
   */
  pickSpots(n: number, alive: readonly SimPlayer[], flow: FlowField): { x: number; z: number }[] {
    const occupied = this.dungeon.rooms.filter((r) =>
      alive.some((p) => tileOf(p.x) >= r.x && tileOf(p.x) < r.x + r.w && tileOf(p.z) >= r.z && tileOf(p.z) < r.z + r.h),
    );
    const inOccupied = (tx: number, tz: number) =>
      occupied.some((r) => tx >= r.x && tx < r.x + r.w && tz >= r.z && tz < r.z + r.h);

    const band: Candidate[] = [];
    const far: Candidate[] = [];
    for (let tz = 0; tz < this.dungeon.height; tz++) {
      for (let tx = 0; tx < this.dungeon.width; tx++) {
        if (!isWalkableTile(this.dungeon, tx, tz) || inOccupied(tx, tz)) continue;
        const d = flow.distance(tx, tz);
        if (d >= WAVE_SPAWN_BAND.min && d <= WAVE_SPAWN_BAND.max) band.push({ tx, tz, d });
        else if (d >= WAVE_SPAWN_FALLBACK_MIN && d !== Infinity) far.push({ tx, tz, d });
      }
    }

    this.shuffle(band);
    let picked = this.hidden(band, n, alive);
    if (picked.length === 0) {
      // Respaldo: las más lejanas (desempate por posición, para ser determinista).
      far.sort((a, b) => b.d - a.d || a.tz - b.tz || a.tx - b.tx);
      picked = this.hidden(far, n, alive);
    }
    if (picked.length === 0) {
      console.warn("WaveDirector: no hay casillas donde aparecer; se salta el grupo");
      return [];
    }
    return picked;
  }

  /** Centros de las primeras `n` casillas (en orden) que ningún jugador vivo ve; para al llegar a `n`. */
  private hidden(cands: readonly Candidate[], n: number, alive: readonly SimPlayer[]): { x: number; z: number }[] {
    const out: { x: number; z: number }[] = [];
    for (const c of cands) {
      if (out.length >= n) break;
      const p = tileCenter(c.tx, c.tz);
      if (alive.some((pl) => hasLineOfSight(this.dungeon, pl.x, pl.z, p.x, p.z, 0))) continue;
      out.push(p);
    }
    return out;
  }

  private shuffle<T>(arr: T[]): void {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.rng.int(0, i);
      [arr[i], arr[j]] = [arr[j]!, arr[i]!];
    }
  }
}
