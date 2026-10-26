import { describe, expect, it } from "vitest";
import { MAX_ORBS, ORB_PICKUP_RADIUS, ORB_SPEED, SIM_DT, createRng } from "@roguelike/shared";
import { OrbSystem, type Orb } from "../src/sim/OrbSystem";
import type { SimPlayer } from "../src/sim/EnemySystem";

const P = (key: string, x: number, z: number): SimPlayer => ({ key, x, z, alive: true });
const dist = (o: Orb, p: SimPlayer) => Math.hypot(o.x - p.x, o.z - p.z);

/** Un sistema con un único orbe de `value` en (x, z). */
function single(x: number, z: number, value = 3): OrbSystem {
  const sys = new OrbSystem(createRng(1));
  sys.spawn(0, 0, value, 0);
  // splitXp puede partir en varios; se deja uno solo con todo el valor, en la posición pedida.
  const orbs = sys.orbs as Orb[];
  orbs.splice(1);
  orbs[0]!.x = x;
  orbs[0]!.z = z;
  orbs[0]!.value = value;
  return sys;
}

describe("OrbSystem", () => {
  it("spawn reparte la XP en orbes de 1 a 4 que suman exacto, a ≤ 0,6 m, con ids o1, o2, …", () => {
    const sys = new OrbSystem(createRng(5));
    sys.spawn(10, 20, 23, 7);
    const orbs = sys.orbs;
    expect(orbs.reduce((s, o) => s + o.value, 0)).toBe(23);
    orbs.forEach((o, i) => {
      expect(o.id).toBe(`o${i + 1}`);
      expect(o.value).toBeGreaterThanOrEqual(1);
      expect(o.value).toBeLessThanOrEqual(4);
      expect(Math.hypot(o.x - 10, o.z - 20)).toBeLessThanOrEqual(0.6 + 1e-9);
      expect(o.bornTick).toBe(7);
    });
    sys.spawn(0, 0, 1, 8);
    expect(sys.orbs.at(-1)!.id).toBe(`o${orbs.length}`);
  });

  it("un orbe a 2,5 m se acerca 8 × dt por tick y se recoge a ≤ 0,8 m, devolviendo su valor una sola vez", () => {
    const sys = single(2.5, 0, 3);
    const p = P("a", 0, 0);
    let prev = 2.5;
    let total = 0;
    let ticks = 0;
    while (sys.orbs.length > 0) {
      const got = sys.step([p], SIM_DT);
      total += got;
      ticks++;
      if (sys.orbs.length > 0) {
        const d = dist(sys.orbs[0]!, p);
        expect(prev - d).toBeCloseTo(ORB_SPEED * SIM_DT, 9);
        expect(d).toBeGreaterThan(ORB_PICKUP_RADIUS);
        expect(got).toBe(0);
        prev = d;
      } else {
        expect(got).toBe(3);
        expect(prev - ORB_SPEED * SIM_DT).toBeLessThanOrEqual(ORB_PICKUP_RADIUS);
      }
      expect(ticks).toBeLessThan(30);
    }
    expect(ticks).toBe(Math.ceil((2.5 - ORB_PICKUP_RADIUS) / (ORB_SPEED * SIM_DT)));
    expect(total).toBe(3);
    expect(sys.step([p], SIM_DT)).toBe(0);
  });

  it("un orbe a 5 m no se mueve", () => {
    const sys = single(5, 0);
    for (let i = 0; i < 10; i++) expect(sys.step([P("a", 0, 0)], SIM_DT)).toBe(0);
    expect(sys.orbs[0]).toMatchObject({ x: 5, z: 0 });
  });

  it("con dos jugadores va hacia el más cercano", () => {
    const sys = single(0, 0);
    const near = P("a", 2, 0);
    const far = P("b", 0, -2.5);
    sys.step([far, near], SIM_DT);
    expect(sys.orbs[0]!.x).toBeCloseTo(ORB_SPEED * SIM_DT, 9);
    expect(sys.orbs[0]!.z).toBeCloseTo(0, 9);
  });

  it("con magnet 2 un orbe a 5 m va hacia ese jugador (radio 6 m) y no hacia otro más cercano sin la carta", () => {
    const sys = single(0, 0);
    const magnet: SimPlayer = { ...P("a", 5, 0), magnetMult: 2 };
    const plain = P("b", 0, -4);
    sys.step([plain, magnet], SIM_DT);
    expect(sys.orbs[0]!.x).toBeCloseTo(ORB_SPEED * SIM_DT, 9);
    expect(sys.orbs[0]!.z).toBeCloseTo(0, 9);
    // Sin la carta, a 5 m no se mueve.
    const still = single(0, 0);
    still.step([P("a", 5, 0)], SIM_DT);
    expect(still.orbs[0]).toMatchObject({ x: 0, z: 0 });
  });

  it("con alive vacío nada se mueve ni se recoge", () => {
    const sys = single(0.1, 0);
    for (let i = 0; i < 5; i++) expect(sys.step([], SIM_DT)).toBe(0);
    expect(sys.orbs).toHaveLength(1);
    expect(sys.orbs[0]).toMatchObject({ x: 0.1, z: 0 });
  });

  it("Foco 5: 60 kills de 8 XP nunca dejan más de 150 orbes y se recogen exactamente 480", () => {
    const sys = new OrbSystem(createRng(42));
    const rng = createRng(9);
    let merged = false;
    for (let i = 0; i < 60; i++) {
      sys.spawn(rng.next() * 2 - 1, rng.next() * 2 - 1, 8, i);
      expect(sys.orbs.length).toBeLessThanOrEqual(MAX_ORBS);
      if (sys.orbs.length === MAX_ORBS) merged = true;
      // El tope nunca pierde XP: lo que hay en el suelo sigue sumando 8 por kill.
      expect(sys.orbs.reduce((s, o) => s + o.value, 0)).toBe(8 * (i + 1));
    }
    expect(merged).toBe(true);
    const p = P("a", 0, 0);
    let total = 0;
    for (let i = 0; i < 60 && sys.orbs.length > 0; i++) total += sys.step([p], SIM_DT);
    expect(sys.orbs).toHaveLength(0);
    expect(total).toBe(480);
  });

  it("al pasar el tope, el más viejo se fusiona con su vecino más cercano", () => {
    const sys = new OrbSystem(createRng(3));
    const orbs = sys.orbs as Orb[];
    for (let i = 0; i < MAX_ORBS; i++) orbs.push({ id: `x${i}`, x: 100 + i * 10, z: 0, value: 1, bornTick: i + 1 });
    // El más viejo (bornTick 1) está en x = 100; su vecino más cercano, en x = 110.
    sys.spawn(-500, 0, 1, 999);
    expect(sys.orbs).toHaveLength(MAX_ORBS);
    expect(sys.orbs.find((o) => o.id === "x0")).toBeUndefined();
    expect(sys.orbs.find((o) => o.id === "x1")!.value).toBe(2);
  });
});

describe("OrbSystem: Aprendizaje", () => {
  it("con learning 1 (xpMult 1,15) un orbe de 4 suma 4,6 para quien lo recoge", () => {
    const sys = single(0.5, 0, 4);
    const gained = sys.step([{ ...P("a", 0, 0), xpMult: 1.15 }], SIM_DT);
    expect(gained).toBeCloseTo(4.6, 12);
    expect(sys.orbs).toHaveLength(0);
  });
});
