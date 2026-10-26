import { describe, expect, it } from "vitest";
import {
  PLAYER_RADIUS,
  PLAYER_SPEED,
  SIM_DT,
  SPRINT_SPEED,
  TILE_SIZE,
  NO_MOVE_MODS,
  sanitizeInput,
  deadInput,
  stepPlayer,
  type Dungeon,
  type KinematicState,
  type PlayerInput,
} from "../src/index";

// Sala abierta de 10x10 casillas (tx,tz en 1..10) rodeada de muro (12x12).
function makeDungeon(): Dungeon {
  const width = 12;
  const height = 12;
  const tiles = new Uint8Array(width * height);
  for (let z = 1; z <= 10; z++) for (let x = 1; x <= 10; x++) tiles[z * width + x] = 1;
  return {
    seed: 0,
    floor: 1,
    width,
    height,
    tiles,
    rooms: [],
    startRoomId: 0,
    bossRoomId: 0,
  } as unknown as Dungeon;
}

const center = 6 * TILE_SIZE;
const initial = (): KinematicState => ({
  x: center,
  z: center,
  facing: 0,
  y: 0,
  vy: 0,
});
const input = (p: Partial<PlayerInput> = {}): PlayerInput => ({
  seq: 0,
  moveX: 0,
  moveZ: 0,
  facing: 0,
  sprint: false,
  jump: false,
  attack: false,
  interact: false,
  abilities: 0,
  viewTick: 0,
  ...p,
});

describe("correr y saltar", () => {
  const d = makeDungeon();

  it("con sprint, 30 pasos avanzan SPRINT_SPEED * 1s", () => {
    let s = initial();
    for (let i = 0; i < 30; i++) s = stepPlayer(s, input({ moveX: 1, sprint: true }), d, SIM_DT);
    expect(s.x - center).toBeCloseTo(SPRINT_SPEED, 6);
  });

  it("el salto sube ~1,2 m y vuelve al suelo en ~0,7 s", () => {
    let s = stepPlayer(initial(), input({ jump: true }), d, SIM_DT);
    let apex = s.y;
    let steps = 1;
    while (s.y > 0 && steps < 100) {
      s = stepPlayer(s, input(), d, SIM_DT);
      apex = Math.max(apex, s.y);
      steps++;
    }
    expect(apex).toBeGreaterThan(1.0);
    expect(apex).toBeLessThan(1.3);
    expect(steps * SIM_DT).toBeGreaterThan(0.6);
    expect(steps * SIM_DT).toBeLessThan(0.8);
    expect(s.y).toBe(0);
    expect(s.vy).toBe(0);
  });

  it("no se puede saltar en el aire (sin doble salto)", () => {
    let s = stepPlayer(initial(), input({ jump: true }), d, SIM_DT);
    for (let i = 0; i < 5; i++) s = stepPlayer(s, input(), d, SIM_DT);
    const vyBefore = s.vy;
    s = stepPlayer(s, input({ jump: true }), d, SIM_DT);
    expect(s.vy).toBeLessThan(vyBefore); // solo la gravedad, sin nuevo impulso
  });

  it("se puede saltar corriendo y moverse en el aire", () => {
    let s = initial();
    for (let i = 0; i < 10; i++) s = stepPlayer(s, input({ moveX: 1, sprint: true, jump: i === 0 }), d, SIM_DT);
    expect(s.y).toBeGreaterThan(0);
    expect(s.x - center).toBeCloseTo(SPRINT_SPEED * 10 * SIM_DT, 6);
  });

  it("sanitizeInput solo acepta sprint/jump === true", () => {
    expect(sanitizeInput({ seq: 1, sprint: "yes", jump: 1 })).toMatchObject({ sprint: false, jump: false });
    expect(sanitizeInput({ seq: 1, sprint: true, jump: true })).toMatchObject({ sprint: true, jump: true });
  });
});

describe("stepPlayer", () => {
  const d = makeDungeon();

  it("30 pasos con moveX=1 avanzan PLAYER_SPEED * 1s", () => {
    let s = initial();
    for (let i = 0; i < 30; i++) s = stepPlayer(s, input({ moveX: 1 }), d, SIM_DT);
    expect(s.x - center).toBeCloseTo(PLAYER_SPEED, 6);
    expect(s.z).toBeCloseTo(center, 6);
  });

  it("el movimiento diagonal se normaliza", () => {
    let s = initial();
    for (let i = 0; i < 30; i++) s = stepPlayer(s, input({ moveX: 1, moveZ: 1 }), d, SIM_DT);
    expect(Math.hypot(s.x - center, s.z - center)).toBeCloseTo(PLAYER_SPEED, 6);
  });

  it("se detiene contra el muro a bordeDelMuro - PLAYER_RADIUS", () => {
    let s = initial();
    for (let i = 0; i < 300; i++) s = stepPlayer(s, input({ moveX: 1 }), d, SIM_DT);
    const bordeDelMuro = 11 * TILE_SIZE;
    expect(s.x).toBeCloseTo(bordeDelMuro - PLAYER_RADIUS, 6);
  });

  it("desliza por el muro en diagonal", () => {
    let s = initial();
    for (let i = 0; i < 300; i++) s = stepPlayer(s, input({ moveX: 1 }), d, SIM_DT);
    const z0 = s.z;
    for (let i = 0; i < 10; i++) s = stepPlayer(s, input({ moveX: 1, moveZ: 1 }), d, SIM_DT);
    expect(s.z).toBeGreaterThan(z0 + 1);
    expect(s.x).toBeCloseTo(11 * TILE_SIZE - PLAYER_RADIUS, 6);
  });

  it("con speedMult 1.5 avanza PLAYER_SPEED × 1.5 × dt", () => {
    const s = stepPlayer(initial(), input({ moveX: 1 }), d, SIM_DT, { speedMult: 1.5 });
    expect(s.x - center).toBeCloseTo(PLAYER_SPEED * 1.5 * SIM_DT, 9);
  });

  it("con sprint y speedMult 1.5 avanza SPRINT_SPEED × 1.5 × dt", () => {
    const s = stepPlayer(initial(), input({ moveX: 1, sprint: true }), d, SIM_DT, { speedMult: 1.5 });
    expect(s.x - center).toBeCloseTo(SPRINT_SPEED * 1.5 * SIM_DT, 9);
  });

  it("sin mods es lo mismo que NO_MOVE_MODS (speedMult 1)", () => {
    expect(NO_MOVE_MODS).toEqual({ speedMult: 1 });
    const a = stepPlayer(initial(), input({ moveX: 1 }), d, SIM_DT);
    const b = stepPlayer(initial(), input({ moveX: 1 }), d, SIM_DT, NO_MOVE_MODS);
    expect(a).toEqual(b);
  });

  it("no muta su argumento", () => {
    const s = initial();
    const copy = JSON.parse(JSON.stringify(s)) as KinematicState;
    stepPlayer(s, input({ moveX: 1, jump: true }), d, SIM_DT);
    expect(s).toEqual(copy);
  });
});

describe("sanitizeInput", () => {
  it("limpia valores inválidos", () => {
    expect(sanitizeInput({ seq: 1, moveX: NaN, moveZ: 5, facing: 0, dodge: true })).toEqual({
      seq: 1,
      moveX: 0,
      moveZ: 1,
      facing: 0,
      sprint: false,
      jump: false,
      attack: false,
      interact: false,
      abilities: 0,
      viewTick: 0,
    });
  });
  it("acota abilities a un entero de 0 a 15", () => {
    expect(sanitizeInput({ seq: 1, abilities: 5 })?.abilities).toBe(5);
    expect(sanitizeInput({ seq: 1, abilities: 15 })?.abilities).toBe(15);
    expect(sanitizeInput({ seq: 1, abilities: 16 })?.abilities).toBe(15);
    expect(sanitizeInput({ seq: 1, abilities: -1 })?.abilities).toBe(0);
    expect(sanitizeInput({ seq: 1, abilities: "3" })?.abilities).toBe(0);
    expect(sanitizeInput({ seq: 1, abilities: 2.7 })?.abilities).toBe(2);
    expect(sanitizeInput({ seq: 1, abilities: NaN })?.abilities).toBe(0);
  });
  it("ignora un dodge que venga", () => {
    expect(sanitizeInput({ seq: 1, dodge: true })).not.toHaveProperty("dodge");
  });
  it("rechaza entradas que no son input", () => {
    expect(sanitizeInput("x")).toBeNull();
    expect(sanitizeInput({ seq: -1 })).toBeNull();
    expect(sanitizeInput({ seq: 1.5 })).toBeNull();
    expect(sanitizeInput(null)).toBeNull();
  });
});

describe("deadInput", () => {
  it("anula movimiento, salto, sprint y acciones y conserva la orientación del cuerpo", () => {
    const raw = { seq: 9, moveX: 1, moveZ: 0, facing: 2, sprint: true, jump: true, attack: true, interact: true, abilities: 3, viewTick: 5 };
    const k = { x: 1, z: 1, facing: 0.7, y: 1, vy: 2 };
    expect(deadInput(raw, k)).toEqual({
      seq: 9, moveX: 0, moveZ: 0, facing: 0.7, sprint: false, jump: false, attack: false, interact: false, abilities: 0, viewTick: 5,
    });
  });
});
