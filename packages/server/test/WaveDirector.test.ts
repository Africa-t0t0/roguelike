import { describe, expect, it, vi } from "vitest";
import {
  createRng,
  FlowField,
  generateDungeon,
  hasLineOfSight,
  maxLiveEnemies,
  roomSpawnPoints,
  SIM_DT,
  TILE_SIZE,
  waveGroupSize,
  waveInterval,
  waveKinds,
  WAVE_SPAWN_BAND,
  WAVE_SPAWN_FALLBACK_MIN,
  type Dungeon,
} from "@roguelike/shared";
import { EnemySystem, type SimPlayer } from "../src/sim/EnemySystem";
import { WaveDirector } from "../src/sim/WaveDirector";

const tileOf = (v: number) => Math.floor(v / TILE_SIZE);

function setup(seed = 5) {
  const dungeon = generateDungeon(seed, 1);
  const start = roomSpawnPoints(dungeon, dungeon.startRoomId, 1)[0]!;
  const player: SimPlayer = { key: "a", x: start.x, z: start.z, alive: true };
  const enemies = new EnemySystem(dungeon, createRng(1));
  const director = new WaveDirector(dungeon, createRng(2));
  return { dungeon, player, enemies, director };
}

const flowFor = (dungeon: Dungeon, players: SimPlayer[]) => {
  const f = new FlowField(dungeon);
  f.rebuild(players.map((p) => ({ tx: tileOf(p.x), tz: tileOf(p.z) })));
  return f;
};

describe("WaveDirector.step", () => {
  it("no crea nada antes del segundo 10", () => {
    const { player, enemies, director } = setup();
    for (let t = 0; t < 9.9; t += SIM_DT) expect(director.step(t, [player], 1, enemies)).toEqual([]);
    expect(enemies.liveCount()).toBe(0);
  });

  it("de 10 a 70 s los grupos salen en los instantes esperados, con tamaño y tipos de la fórmula", () => {
    const { player, enemies, director } = setup();
    const times: number[] = [];
    for (let i = 0; i * SIM_DT < 70; i++) {
      const t = i * SIM_DT;
      const made = director.step(t, [player], 1, enemies);
      if (made.length === 0) continue;
      times.push(t);
      expect(made).toHaveLength(waveGroupSize(t, 1));
      for (const e of made) {
        expect(waveKinds(t)).toContain(e.kind);
        expect(e.ai).toBe("chase");
        expect(e.roomId).toBe(-1);
      }
      // Libera el tope para que el test mida solo el reloj.
      for (const e of made) enemies.damage(e.id, 9999);
    }
    const expected: number[] = [];
    for (let at = 10; at < 70; at += waveInterval(at)) expected.push(at);
    expect(times).toHaveLength(expected.length);
    times.forEach((t, i) => expect(Math.abs(t - expected[i]!)).toBeLessThanOrEqual(SIM_DT + 1e-9));
  });

  it("con el tope de vivos no crea nada hasta que baja", () => {
    const { player, enemies, director } = setup();
    const cap = maxLiveEnemies(1, 15);
    enemies.spawnWave(Array.from({ length: cap }, () => ({ x: player.x, z: player.z })), ["minion"]);
    expect(enemies.liveCount()).toBe(cap);
    expect(director.step(15, [player], 1, enemies)).toEqual([]);
    enemies.damage(enemies.enemies[0]!.id, 9999);
    expect(director.step(15 + SIM_DT, [player], 1, enemies)).toHaveLength(1);
  });

  it("sin jugadores vivos no crea nada", () => {
    const { enemies, director } = setup();
    expect(director.step(30, [], 1, enemies)).toEqual([]);
    expect(director.step(30, [{ key: "a", x: 1, z: 1, alive: false }], 1, enemies)).toEqual([]);
    expect(enemies.liveCount()).toBe(0);
  });
});

describe("WaveDirector.pickSpots", () => {
  it("cae en la banda 8-30 y fuera de la sala de todo jugador vivo", () => {
    const { dungeon, player, director } = setup();
    const flow = flowFor(dungeon, [player]);
    const spots = director.pickSpots(6, [player], flow);
    expect(spots).toHaveLength(6);
    const room = dungeon.rooms.find((r) => r.id === dungeon.startRoomId)!;
    for (const s of spots) {
      const [tx, tz] = [tileOf(s.x), tileOf(s.z)];
      const d = flow.distance(tx, tz);
      expect(d).toBeGreaterThanOrEqual(WAVE_SPAWN_BAND.min);
      expect(d).toBeLessThanOrEqual(WAVE_SPAWN_BAND.max);
      expect(tx >= room.x && tx < room.x + room.w && tz >= room.z && tz < room.z + room.h).toBe(false);
    }
  });

  it("con dos jugadores separados evita la sala de ambos", () => {
    const { dungeon, director } = setup();
    const a = roomSpawnPoints(dungeon, dungeon.startRoomId, 1)[0]!;
    const b = roomSpawnPoints(dungeon, dungeon.bossRoomId, 1)[0]!;
    const players: SimPlayer[] = [
      { key: "a", x: a.x, z: a.z, alive: true },
      { key: "b", x: b.x, z: b.z, alive: true },
    ];
    const spots = director.pickSpots(10, players, flowFor(dungeon, players));
    const rooms = [dungeon.startRoomId, dungeon.bossRoomId].map((id) => dungeon.rooms.find((r) => r.id === id)!);
    for (const s of spots) {
      for (const r of rooms) {
        const [tx, tz] = [tileOf(s.x), tileOf(s.z)];
        expect(tx >= r.x && tx < r.x + r.w && tz >= r.z && tz < r.z + r.h).toBe(false);
      }
    }
  });

  /** Dos salas de 3x3 unidas por un pasillo de `gap` casillas; el jugador en la primera. */
  function corridor(gap: number) {
    const width = 3 + gap + 3;
    const tiles = new Uint8Array(width * 3);
    const rooms = [
      { id: 0, x: 0, z: 0, w: 3, h: 3, kind: "start" as const, neighbors: [1] },
      { id: 1, x: 3 + gap, z: 0, w: 3, h: 3, kind: "boss" as const, neighbors: [0] },
    ];
    for (let z = 0; z < 3; z++) for (let x = 0; x < width; x++) tiles[z * width + x] = z === 1 || x < 3 || x >= 3 + gap ? 1 : 0;
    const dungeon: Dungeon = { seed: 1, floor: 1, width, height: 3, tiles, rooms, startRoomId: 0, bossRoomId: 1 };
    const player: SimPlayer = { key: "a", x: 1.5 * TILE_SIZE, z: 1.5 * TILE_SIZE, alive: true };
    return { dungeon, player };
  }

  it("usa el respaldo cuando toda casilla elegible queda bajo la banda", () => {
    const { dungeon, player } = corridor(2); // distancias máximas 1+2+3 = 6 desde el centro
    const flow = flowFor(dungeon, [player]);
    const director = new WaveDirector(dungeon, createRng(3));
    const spots = director.pickSpots(2, [player], flow);
    expect(spots.length).toBeGreaterThan(0);
    for (const s of spots) {
      const d = flow.distance(tileOf(s.x), tileOf(s.z));
      expect(d).toBeGreaterThanOrEqual(WAVE_SPAWN_FALLBACK_MIN);
      expect(d).toBeLessThan(WAVE_SPAWN_BAND.min);
    }
  });

  it("nunca elige una casilla a la vista de un jugador vivo, aunque esté en un pasillo largo y recto", () => {
    // Pasillo recto de 3 casillas de ancho (z 1..3, x 0..39) con dos cuartos laterales fuera de la vista,
    // unidos por una puerta de una casilla.
    const width = 40;
    const height = 12;
    const tiles = new Uint8Array(width * height);
    const fill = (x0: number, z0: number, x1: number, z1: number) => {
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) tiles[z * width + x] = 1;
    };
    fill(0, 1, 39, 3);
    fill(16, 4, 16, 4);
    fill(12, 5, 20, 10);
    fill(30, 4, 30, 4);
    fill(26, 5, 34, 10);
    const dungeon: Dungeon = { seed: 1, floor: 1, width, height, tiles, rooms: [], startRoomId: 0, bossRoomId: 0 };
    const player: SimPlayer = { key: "a", x: 1.5 * TILE_SIZE, z: 2.5 * TILE_SIZE, alive: true };
    const flow = flowFor(dungeon, [player]);
    for (let seed = 1; seed <= 5; seed++) {
      const spots = new WaveDirector(dungeon, createRng(seed)).pickSpots(6, [player], flow);
      expect(spots).toHaveLength(6);
      for (const s of spots) expect(hasLineOfSight(dungeon, player.x, player.z, s.x, s.z, 0)).toBe(false);
    }
  });

  it("el respaldo también descarta las casillas a la vista", () => {
    // Pasillo recto corto (todo bajo la banda) con un nicho lateral escondido al fondo:
    // respaldo = (6,1) a la vista y (5,2), (6,2) escondidas.
    const width = 7;
    const height = 3;
    const tiles = new Uint8Array(width * height);
    for (let x = 0; x < width; x++) tiles[1 * width + x] = 1;
    tiles[2 * width + 5] = 1;
    tiles[2 * width + 6] = 1;
    const dungeon: Dungeon = { seed: 1, floor: 1, width, height, tiles, rooms: [], startRoomId: 0, bossRoomId: 0 };
    const player: SimPlayer = { key: "a", x: 0.5 * TILE_SIZE, z: 1.5 * TILE_SIZE, alive: true };
    const flow = flowFor(dungeon, [player]);
    const spots = new WaveDirector(dungeon, createRng(3)).pickSpots(3, [player], flow);
    expect(spots).toHaveLength(2);
    for (const s of spots) {
      expect(flow.distance(tileOf(s.x), tileOf(s.z))).toBeLessThan(WAVE_SPAWN_BAND.min);
      expect(hasLineOfSight(dungeon, player.x, player.z, s.x, s.z, 0)).toBe(false);
    }
  });

  it("si tampoco hay respaldo devuelve [] y avisa con console.warn", () => {
    const { dungeon, player } = corridor(1);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const director = new WaveDirector(dungeon, createRng(3));
    expect(director.pickSpots(2, [player], flowFor(dungeon, [player]))).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
