import { describe, expect, it } from "vitest";
import {
  DODGE_COOLDOWN,
  DODGE_DURATION,
  DODGE_SPEED,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  SIM_DT,
  TILE_SIZE,
  isInvulnerable,
  sanitizeInput,
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
  dodgeTime: 0,
  dodgeCooldown: 0,
  dodgeDirX: 0,
  dodgeDirZ: 0,
});
const input = (p: Partial<PlayerInput> = {}): PlayerInput => ({
  seq: 0,
  moveX: 0,
  moveZ: 0,
  facing: 0,
  dodge: false,
  ...p,
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

  it("esquive recorre exactamente DODGE_SPEED * DODGE_DURATION", () => {
    let s = stepPlayer(initial(), input({ moveX: 1, dodge: true }), d, SIM_DT);
    expect(isInvulnerable(s)).toBe(true);
    expect(s.dodgeCooldown).toBeCloseTo(DODGE_COOLDOWN, 9);
    for (let i = 0; i < 8; i++) s = stepPlayer(s, input(), d, SIM_DT);
    expect(s.x - center).toBeCloseTo(DODGE_SPEED * DODGE_DURATION, 6);
    expect(isInvulnerable(s)).toBe(false);
    expect(s.dodgeTime).toBe(0);
  });

  it("un segundo esquive antes del cooldown no hace nada", () => {
    let s = stepPlayer(initial(), input({ moveX: 1, dodge: true }), d, SIM_DT);
    for (let i = 0; i < 8; i++) s = stepPlayer(s, input(), d, SIM_DT);
    expect(s.dodgeCooldown).toBeGreaterThan(0);
    s = stepPlayer(s, input({ moveX: 1, dodge: true }), d, SIM_DT);
    expect(isInvulnerable(s)).toBe(false);
  });

  it("esquivar sin movimiento no hace nada ni gasta cooldown", () => {
    const s = stepPlayer(initial(), input({ dodge: true }), d, SIM_DT);
    expect(isInvulnerable(s)).toBe(false);
    expect(s.dodgeCooldown).toBe(0);
  });

  it("el cooldown vuelve a permitir esquivar y los timers no son negativos", () => {
    let s = stepPlayer(initial(), input({ moveX: 1, dodge: true }), d, SIM_DT);
    for (let i = 0; i < 40; i++) s = stepPlayer(s, input(), d, SIM_DT);
    expect(s.dodgeCooldown).toBe(0);
    s = stepPlayer(s, input({ moveZ: 1, dodge: true }), d, SIM_DT);
    expect(isInvulnerable(s)).toBe(true);
  });

  it("no muta su argumento", () => {
    const s = initial();
    const copy = JSON.parse(JSON.stringify(s)) as KinematicState;
    stepPlayer(s, input({ moveX: 1, dodge: true }), d, SIM_DT);
    expect(s).toEqual(copy);
  });
});

describe("sanitizeInput", () => {
  it("limpia valores inválidos", () => {
    expect(sanitizeInput({ seq: 1, moveX: NaN, moveZ: 5, facing: 0, dodge: "yes" })).toEqual({
      seq: 1,
      moveX: 0,
      moveZ: 1,
      facing: 0,
      dodge: false,
    });
  });
  it("rechaza entradas que no son input", () => {
    expect(sanitizeInput("x")).toBeNull();
    expect(sanitizeInput({ seq: -1 })).toBeNull();
    expect(sanitizeInput({ seq: 1.5 })).toBeNull();
    expect(sanitizeInput(null)).toBeNull();
  });
});
