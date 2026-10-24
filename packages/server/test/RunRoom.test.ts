import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import type { Room as ClientRoom } from "@colyseus/sdk";
import { ErrorCode, matchMaker } from "colyseus";
import {
  generateDungeon,
  isWalkableTile,
  JOIN_ERROR_STATUS,
  MAX_INPUTS_PER_TICK,
  MAX_QUEUED_INPUTS,
  MSG,
  PLAYER_SPEED,
  SIM_DT,
  TAKEOVER_CLOSE_CODE,
  TILE_SIZE,
  tileCenter,
} from "@roguelike/shared";
import { appConfig } from "../src/app.config";
import type { RunRoom } from "../src/rooms/RunRoom";

const SEED = 123;
const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/;
const STEP = PLAYER_SPEED * SIM_DT;

let colyseus: ColyseusTestServer;
let room: RunRoom;

beforeAll(async () => {
  colyseus = await boot(appConfig);
});
afterAll(async () => {
  await colyseus.shutdown();
});

beforeEach(async () => {
  // El SDK avisa por consola cuando el servidor cierra una conexión rechazada; es el caso esperado aquí.
  const warn = console.warn.bind(console);
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    if (String(args[0]).startsWith("Room connection was closed unexpectedly")) return;
    warn(...args);
  });
  room = await colyseus.createRoom<RunRoom>("run", { seed: SEED, emptyRoomTtlMs: 200 });
});
afterEach(async () => {
  await colyseus.cleanup();
  vi.restoreAllMocks();
});

async function join(name: string, token: string): Promise<{ client: ClientRoom; welcome: Promise<unknown> }> {
  const client = await colyseus.sdk.joinById(room.roomId, { name, token });
  // Sin reconexión automática del SDK: la reconexión del juego es por nombre.
  client.reconnection.enabled = false;
  return { client, welcome: client.waitForMessage(MSG.welcome) };
}

async function ticksUntil(cond: () => boolean, maxTicks = 90): Promise<void> {
  for (let i = 0; i < maxTicks; i++) {
    if (cond()) return;
    await room.waitForNextTimestep();
  }
  throw new Error("condición no cumplida a tiempo");
}

const player = (key: string) => {
  const p = room.state.players.get(key);
  if (!p) throw new Error(`no hay jugador ${key}`);
  return p;
};
const input = (seq: number) => ({ seq, moveX: 1, moveZ: 0, facing: Math.PI / 2, dodge: false });
const tileOf = (v: number) => Math.floor(v / TILE_SIZE);

describe("RunRoom", () => {
  it("usa un código de sala válido y la semilla de las opciones", () => {
    expect(room.roomId).toMatch(CODE_RE);
    expect(room.state.seed).toBe(SEED);
    expect(room.state.floor).toBe(1);
  });

  it("Ana y Beto entran, reciben su clave y Beto aparece cerca de Ana", async () => {
    const ana = await join("Ana", "t-ana");
    const beto = await join("Beto", "t-beto");
    expect(await ana.welcome).toEqual({ key: "ana" });
    expect(await beto.welcome).toEqual({ key: "beto" });
    await room.waitForNextPatch();
    expect([...room.state.players.keys()].sort()).toEqual(["ana", "beto"]);
    await ticksUntil(() => ana.client.state.players.size === 2);
    expect(ana.client.state.players.get("beto").name).toBe("Beto");

    const d = generateDungeon(SEED, 1);
    const a = player("ana");
    const b = player("beto");
    const [btx, btz] = [tileOf(b.x), tileOf(b.z)];
    expect(isWalkableTile(d, btx, btz)).toBe(true);
    expect(tileCenter(btx, btz)).toEqual({ x: b.x, z: b.z });
    expect(Math.max(Math.abs(btx - tileOf(a.x)), Math.abs(btz - tileOf(a.z)))).toBeLessThanOrEqual(2);
    expect([btx, btz]).not.toEqual([tileOf(a.x), tileOf(a.z)]);
    // Es la casilla libre más cercana a Ana.
    const [atx, atz] = [tileOf(a.x), tileOf(a.z)];
    const dist2 = (x: number, z: number) => (x - atx) ** 2 + (z - atz) ** 2;
    for (let z = atz - 2; z <= atz + 2; z++) {
      for (let x = atx - 2; x <= atx + 2; x++) {
        if (isWalkableTile(d, x, z) && (x !== atx || z !== atz)) expect(dist2(x, z)).toBeGreaterThanOrEqual(dist2(btx, btz));
      }
    }
  });

  it("30 inputs en 30 ticks mueven PLAYER_SPEED metros", async () => {
    const ana = await join("Ana", "t-ana");
    await ana.welcome;
    const x0 = player("ana").x;
    for (let seq = 1; seq <= 30; seq++) {
      ana.client.send(MSG.input, input(seq));
      await ticksUntil(() => player("ana").lastSeq === seq);
    }
    expect(Math.abs(player("ana").x - (x0 + PLAYER_SPEED * 1))).toBeLessThan(1e-3);
    expect(player("ana").lastSeq).toBe(30);
  });

  it("una ráfaga de 100 inputs se procesa a MAX_INPUTS_PER_TICK por tick y descarta los viejos", async () => {
    const ana = await join("Ana", "t-ana");
    await ana.welcome;
    const x0 = player("ana").x;
    for (let seq = 1; seq <= 100; seq++) ana.client.send(MSG.input, input(seq));

    await ticksUntil(() => player("ana").x !== x0);
    expect(player("ana").x - x0).toBeLessThanOrEqual(MAX_INPUTS_PER_TICK * STEP + 1e-6);

    for (let i = 0; i < 60; i++) await room.waitForNextTimestep();
    expect(player("ana").lastSeq).toBe(100);
    expect(player("ana").x - x0).toBeLessThanOrEqual((MAX_QUEUED_INPUTS + MAX_INPUTS_PER_TICK) * STEP + 1e-6);
  });

  it("descarta inputs repetidos, viejos o inválidos", async () => {
    const ana = await join("Ana", "t-ana");
    await ana.welcome;
    const x0 = player("ana").x;
    ana.client.send(MSG.input, input(2));
    ana.client.send(MSG.input, input(2));
    ana.client.send(MSG.input, input(1));
    ana.client.send(MSG.input, { seq: "3", moveX: 1 });
    await ticksUntil(() => player("ana").lastSeq === 2);
    for (let i = 0; i < 3; i++) await room.waitForNextTimestep();
    expect(player("ana").lastSeq).toBe(2);
    expect(player("ana").x - x0).toBeCloseTo(STEP, 9);
  });

  it("mismo nombre con otro token es rechazado; con el mismo token toma el control", async () => {
    const ana = await join("Ana", "t-ana");
    await ana.welcome;
    await expect(colyseus.sdk.joinById(room.roomId, { name: "ANA", token: "otro" })).rejects.toMatchObject({
      code: JOIN_ERROR_STATUS["name-taken"],
    });

    const oldLeft = new Promise<number>((resolve) => ana.client.onLeave((code) => resolve(code)));
    const ana2 = await join("ANA", "t-ana");
    expect(await ana2.welcome).toEqual({ key: "ana" });
    expect(await oldLeft).toBe(TAKEOVER_CLOSE_CODE);

    await ticksUntil(() => room.clients.length === 1);
    expect([...room.state.players.keys()]).toEqual(["ana"]);
    expect(player("ana").name).toBe("Ana");
    ana2.client.send(MSG.input, input(1));
    await ticksUntil(() => player("ana").lastSeq === 1);
  });

  it("Beto se va y vuelve con otro token", async () => {
    const ana = await join("Ana", "t-ana");
    const beto = await join("Beto", "t-beto");
    await Promise.all([ana.welcome, beto.welcome]);
    await beto.client.leave();
    await ticksUntil(() => !room.state.players.has("beto"));

    const beto2 = await join("Beto", "t-otro");
    expect(await beto2.welcome).toEqual({ key: "beto" });
    expect(room.state.players.has("beto")).toBe(true);
  });

  it("una desconexión abrupta libera al jugador y puede volver con otro token", async () => {
    const ana = await join("Ana", "t-ana");
    const beto = await join("Beto", "t-beto");
    await Promise.all([ana.welcome, beto.welcome]);
    beto.client.connection.close(); // cierra el socket sin avisar a la sala (sin LEAVE_ROOM)
    await ticksUntil(() => !room.state.players.has("beto"));

    const beto2 = await join("Beto", "t-otro");
    expect(await beto2.welcome).toEqual({ key: "beto" });
    expect(room.state.players.has("beto")).toBe(true);
  });

  it("rechaza nombres inválidos con 4101", async () => {
    await expect(colyseus.sdk.joinById(room.roomId, { name: "   ", token: "t" })).rejects.toMatchObject({
      code: JOIN_ERROR_STATUS["invalid-name"],
    });
  });

  it("con 4 jugadores, una quinta persona nueva es rechazada con 4103", async () => {
    const all = await Promise.all(["Ana", "Beto", "Caro", "Dani"].map((n) => join(n, `t-${n}`)));
    await Promise.all(all.map((p) => p.welcome));
    await expect(colyseus.sdk.joinById(room.roomId, { name: "Eva", token: "t-eva" })).rejects.toMatchObject({
      code: JOIN_ERROR_STATUS["room-full"],
    });
  });

  it("rechaza un código de sala inexistente", async () => {
    await expect(colyseus.sdk.joinById("ZZZZZ", { name: "Ana", token: "t" })).rejects.toMatchObject({
      code: ErrorCode.MATCHMAKE_INVALID_ROOM_ID,
    });
  });

  it("una sala a la que nunca entra nadie se cierra tras emptyRoomTtlMs", async () => {
    const deadline = Date.now() + 1000;
    while ((await matchMaker.query({ roomId: room.roomId })).length > 0) {
      if (Date.now() > deadline) throw new Error("la sala sigue viva");
      await new Promise((r) => setTimeout(r, 20));
    }
  });

  it("la sala vacía se cierra tras emptyRoomTtlMs, salvo que alguien vuelva antes", async () => {
    const ana = await join("Ana", "t-ana");
    const beto = await join("Beto", "t-beto");
    await Promise.all([ana.welcome, beto.welcome]);
    await ana.client.leave();
    await beto.client.leave();
    await ticksUntil(() => room.clients.length === 0);
    expect(await matchMaker.query({ roomId: room.roomId })).toHaveLength(1);

    await new Promise((r) => setTimeout(r, 100));
    const back = await join("Ana", "t-ana");
    await back.welcome;
    await new Promise((r) => setTimeout(r, 200));
    expect(await matchMaker.query({ roomId: room.roomId })).toHaveLength(1);

    await back.client.leave();
    await new Promise((r) => setTimeout(r, 300));
    expect(await matchMaker.query({ roomId: room.roomId })).toHaveLength(0);
  });
});

describe("HTTP", () => {
  it("GET /health responde 200", async () => {
    const res = await fetch("http://localhost:2568/health");
    expect(res.status).toBe(200);
  });
});
