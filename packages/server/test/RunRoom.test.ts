import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import type { Room as ClientRoom } from "@colyseus/sdk";
import { ErrorCode, matchMaker } from "colyseus";
import {
  generateDungeon,
  isWalkableTile,
  roomSpawnPoints,
  JOIN_ERROR_STATUS,
  MAX_INPUTS_PER_TICK,
  MAX_PLAYERS,
  PICKUP_RANGE,
  strikeOf,
  MAX_QUEUED_INPUTS,
  MSG,
  PLAYER_SPEED,
  PROTOCOL_VERSION,
  REWIND_MAX_TICKS,
  SIM_DT,
  TAKEOVER_CLOSE_CODE,
  TILE_SIZE,
  tileCenter,
  waveGroupSize,
  type CombatEvent,
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

type FloorMsg = { items: { weaponId: string; x: number; z: number }[] };

async function join(
  name: string,
  token: string,
): Promise<{ client: ClientRoom; welcome: Promise<unknown>; floors: FloorMsg[] }> {
  const client = await colyseus.sdk.joinById(room.roomId, { name, token, version: PROTOCOL_VERSION });
  // Sin reconexión automática del SDK: la reconexión del juego es por nombre.
  client.reconnection.enabled = false;
  const floors: FloorMsg[] = [];
  client.onMessage(MSG.floorWeapons, (m: FloorMsg) => floors.push(m));
  return { client, welcome: client.waitForMessage(MSG.welcome), floors };
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

describe("RunRoom: reloj del piso y oleadas", () => {
  it("floorTime crece ~1/30 por tick con un cliente y se detiene cuando se va", async () => {
    const ana = await join("Ana", "t-ana");
    await ana.welcome;
    await room.waitForNextTimestep();
    const t0 = room.state.floorTime;
    const k0 = room.state.tick;
    for (let i = 0; i < 10; i++) await room.waitForNextTimestep();
    const ticks = room.state.tick - k0;
    expect(ticks).toBeGreaterThanOrEqual(10);
    expect(room.state.floorTime - t0).toBeCloseTo(ticks * SIM_DT, 6);

    await ana.client.leave();
    await ticksUntil(() => room.clients.length === 0);
    await room.waitForNextTimestep();
    const frozen = room.state.floorTime;
    for (let i = 0; i < 5; i++) await room.waitForNextTimestep();
    expect(room.state.floorTime).toBe(frozen);
  });

  it("con el reloj adelantado a 120 s aparecen enemigos de oleada en pocos ticks", async () => {
    await colyseus.cleanup();
    room = await colyseus.createRoom<RunRoom>("run", { seed: SEED, emptyRoomTtlMs: 200, floorTimeStart: 120 });
    expect(room.state.floorTime).toBe(120);
    const ana = await join("Ana", "t-ana");
    await ana.welcome;
    await ticksUntil(() => room.state.enemies.size > 0, 10);
    // Los de oleada no pertenecen a ninguna sala y persiguen desde que nacen.
    expect(room.state.enemies.size).toBeLessThanOrEqual(waveGroupSize(120, 1));
    const aiStates = new Set([...room.state.enemies.values()].map((e) => e.ai));
    expect([...aiStates].every((a) => a === "chase" || a === "telegraph" || a === "recover")).toBe(true);
  });
});

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
    await expect(colyseus.sdk.joinById(room.roomId, { name: "ANA", token: "otro", version: PROTOCOL_VERSION })).rejects.toMatchObject({
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
    await expect(colyseus.sdk.joinById(room.roomId, { name: "   ", token: "t", version: PROTOCOL_VERSION })).rejects.toMatchObject({
      code: JOIN_ERROR_STATUS["invalid-name"],
    });
  });

  it("con 4 jugadores, una quinta persona nueva es rechazada con 4103", async () => {
    const all = await Promise.all(["Ana", "Beto", "Caro", "Dani"].map((n) => join(n, `t-${n}`)));
    await Promise.all(all.map((p) => p.welcome));
    await expect(colyseus.sdk.joinById(room.roomId, { name: "Eva", token: "t-eva", version: PROTOCOL_VERSION })).rejects.toMatchObject({
      code: JOIN_ERROR_STATUS["room-full"],
    });
  });

  it("rechaza un código de sala inexistente", async () => {
    await expect(colyseus.sdk.joinById("ZZZZZ", { name: "Ana", token: "t", version: PROTOCOL_VERSION })).rejects.toMatchObject({
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

// Acceso de prueba a la sala del servidor (campos privados por índice; producción no cambia).
const record = (key: string) => {
  const r = room["registry"].all().find((x) => x.key === key);
  if (!r) throw new Error(`no hay registro ${key}`);
  return r;
};
const teleport = (key: string, p: { x: number; z: number }) => {
  const r = record(key);
  r.kinematic = { ...r.kinematic, x: p.x, z: p.z, y: 0, vy: 0, dodgeTime: 0 };
};
const combatRoom = () => {
  const d = generateDungeon(SEED, 1);
  const cr = d.rooms.find((r) => r.kind === "combat");
  if (!cr) throw new Error("sin sala de combate");
  return { d, cr };
};
const collect = (client: ClientRoom) => {
  const events: CombatEvent[] = [];
  client.onMessage(MSG.combat, (e: CombatEvent) => events.push(e));
  return events;
};
const attackInput = (seq: number, facing: number, viewTick: number) => ({
  seq, moveX: 0, moveZ: 0, facing, dodge: false, sprint: false, jump: false, attack: true, interact: false, viewTick,
});

describe("RunRoom: combate", () => {
  it("rechaza una versión de protocolo distinta con 4104", async () => {
    await expect(colyseus.sdk.joinById(room.roomId, { name: "Ana", token: "t", version: PROTOCOL_VERSION - 1 })).rejects.toMatchObject({
      code: JOIN_ERROR_STATUS["version-mismatch"],
    });
    await expect(colyseus.sdk.joinById(room.roomId, { name: "Ana", token: "t" })).rejects.toMatchObject({
      code: JOIN_ERROR_STATUS["version-mismatch"],
    });
    expect(room["registry"].size()).toBe(0);
  });

  it("un jugador recién entrado tiene 120 de vida y el grupo nivel 1", async () => {
    const ana = await join("Ana", "t-ana");
    await ana.welcome;
    const p = player("ana");
    expect(p.hp).toBe(120);
    expect(p.maxHp).toBe(120);
    expect(p.dead).toBe(false);
    expect(room.state.level).toBe(1);
    expect(room.state.xp).toBe(0);
    expect(room.state.xpToNext).toBe(20);
    await ticksUntil(() => ana.client.state.players.get("ana")?.hp === 120 && ana.client.state.level === 1);
  });

  it("al entrar a una sala de combate aparecen 4 enemigos", async () => {
    const ana = await join("Ana", "t-ana");
    await ana.welcome;
    const { d, cr } = combatRoom();
    teleport("ana", roomSpawnPoints(d, cr.id, 1)[0]!);
    await room.waitForNextTimestep();
    await ticksUntil(() => room.state.enemies.size > 0, 3);
    expect(room.state.enemies.size).toBe(4);
    for (const e of room.state.enemies.values()) {
      expect(["minion", "brute", "mage"]).toContain(e.kind);
      expect(e.hp).toBe(e.maxHp);
    }
    await ticksUntil(() => ana.client.state.enemies.size === 4);
    expect(room.state.tick).toBeGreaterThan(0);
  });

  it("tres ataques separados por 12 inputs (0,4 s) dañan al enemigo de enfrente y emiten swing y damage", async () => {
    const ana = await join("Ana", "t-ana");
    await ana.welcome;
    const events = collect(ana.client);
    const { d, cr } = combatRoom();
    teleport("ana", roomSpawnPoints(d, cr.id, 1)[0]!);
    await ticksUntil(() => room.state.enemies.size === 4, 5);

    // Ubica a Ana en una casilla caminable junto a un enemigo.
    const sys = room["enemySystem"];
    const target = sys.enemies.find((e) => {
      const [tx, tz] = [tileOf(e.x), tileOf(e.z)];
      return [[0, -1], [0, 1], [-1, 0], [1, 0]].some(([dx, dz]) => isWalkableTile(d, tx + dx!, tz + dz!));
    })!;
    const [tx, tz] = [tileOf(target.x), tileOf(target.z)];
    const [dx, dz] = [[0, -1], [0, 1], [-1, 0], [1, 0]].find(([dx, dz]) => isWalkableTile(d, tx + dx!, tz + dz!))!;
    teleport("ana", tileCenter(tx + dx!, tz + dz!));

    const hpBefore = target.hp;
    let seq = 0;
    for (let i = 0; i < 3; i++) {
      const me = record("ana").kinematic;
      const e = room["enemySystem"].enemies.find((x) => x.id === target.id);
      const aim = e ?? target;
      const facing = Math.atan2(aim.x - me.x, aim.z - me.z);
      ana.client.send(MSG.input, attackInput(++seq, facing, room.state.tick));
      // El golpe avanza por input: 11 inputs quietos más (12 en total ≈ 0,4 s) antes del siguiente.
      for (let j = 0; j < 11; j++) ana.client.send(MSG.input, { ...attackInput(++seq, facing, room.state.tick), attack: false });
      await ticksUntil(() => player("ana").lastSeq === seq, 10);
    }
    const after = room["enemySystem"].enemies.find((x) => x.id === target.id);
    expect(after === undefined || after.hp < hpBefore).toBe(true);

    await ticksUntil(() => events.filter((e) => e.type === "swing").length === 3, 10);
    // Separados por 0,4 s caen dentro de la ventana del combo: pasos 1, 2 y 3.
    expect(events.filter((e) => e.type === "swing")).toEqual([1, 2, 3].map((step) => ({ type: "swing", key: "ana", step })));
    const dmg = events.find((e) => e.type === "damage" && e.targetKind === "enemy");
    expect(dmg).toMatchObject({ type: "damage", targetKind: "enemy", amount: 12, sourceKey: "ana" });
  });

  it("Foco 2: salir y volver conserva la vida", async () => {
    const ana = await join("Ana", "t-ana");
    await ana.welcome;
    record("ana").combat.hp = 50;
    await ticksUntil(() => player("ana").hp === 50, 3);
    await ana.client.leave();
    await ticksUntil(() => !room.state.players.has("ana"));

    const back = await join("Ana", "t-otro");
    await back.welcome;
    expect(player("ana").hp).toBe(50);
    expect(player("ana").maxHp).toBe(120);
    await room.waitForNextTimestep();
    expect(player("ana").hp).toBe(50);
  });

  it("Foco 2: un takeover conserva la vida y el estado de muerte", async () => {
    const ana = await join("Ana", "t-ana");
    await ana.welcome;
    record("ana").combat.hp = 50;
    await ticksUntil(() => player("ana").hp === 50, 3);

    const ana2 = await join("Ana", "t-ana");
    await ana2.welcome;
    expect(player("ana").hp).toBe(50);
    await room.waitForNextTimestep();
    expect(player("ana").hp).toBe(50);

    const c = record("ana").combat;
    c.hp = 0;
    c.dead = true;
    c.respawnIn = 3;
    await ticksUntil(() => player("ana").dead, 3);
    const ana3 = await join("Ana", "t-ana");
    await ana3.welcome;
    expect(player("ana").dead).toBe(true);
    expect(player("ana").respawnIn).toBeGreaterThan(2.5);
  });

  /** Mata a `key` con un golpe pendiente ya vencido; devuelve los eventos vistos por `client`. */
  async function killByHit(key: string, client: ClientRoom): Promise<CombatEvent[]> {
    const events = collect(client);
    record(key).combat.pendingHits.push({ damage: 999, resolveTick: -REWIND_MAX_TICKS });
    await ticksUntil(() => player(key).dead, 5);
    return events;
  }
  async function respawnNow(key: string): Promise<void> {
    record(key).combat.respawnIn = SIM_DT;
    await ticksUntil(() => !player(key).dead, 5);
  }
  const chebyshevTiles = (a: { x: number; z: number }, b: { x: number; z: number }) =>
    Math.max(Math.abs(tileOf(a.x) - tileOf(b.x)), Math.abs(tileOf(a.z) - tileOf(b.z)));
  const kill = (key: string) => {
    const c = record(key).combat;
    c.hp = 0;
    c.dead = true;
    c.respawnIn = 999;
  };

  it("daño → muerte → cuenta atrás → reaparece en la sala inicial si no hay aliados vivos", async () => {
    const ana = await join("Ana", "t-ana");
    const beto = await join("Beto", "t-beto");
    await Promise.all([ana.welcome, beto.welcome]);
    const d = generateDungeon(SEED, 1);
    const boss = roomSpawnPoints(d, d.bossRoomId, 2);
    // Beto, muerto y lejos; Ana, también lejos de la sala inicial.
    teleport("beto", boss[0]!);
    kill("beto");
    teleport("ana", boss[1]!);

    const events = await killByHit("ana", ana.client);
    await ticksUntil(() => events.some((e) => e.type === "damage" && e.targetKind === "player" && e.targetId === "ana"), 5);
    const r0 = player("ana").respawnIn;
    expect(r0).toBeGreaterThan(4.5);
    for (let i = 0; i < 3; i++) await room.waitForNextTimestep();
    expect(player("ana").respawnIn).toBeLessThan(r0);

    await respawnNow("ana");
    expect(player("ana").hp).toBe(120);
    const start = d.rooms.find((r) => r.id === d.startRoomId)!;
    const [tx, tz] = [tileOf(player("ana").x), tileOf(player("ana").z)];
    expect(tx >= start.x && tx < start.x + start.w && tz >= start.z && tz < start.z + start.h).toBe(true);
  });

  it("reaparece junto a un aliado vivo, no junto a uno muerto", async () => {
    // En orden: Beto queda antes que Caro en la lista de conectados.
    const ana = await join("Ana", "t-ana");
    const beto = await join("Beto", "t-beto");
    const caro = await join("Caro", "t-caro");
    await Promise.all([ana.welcome, beto.welcome, caro.welcome]);
    const d = generateDungeon(SEED, 1);
    // Beto (primero en la lista) está muerto en la sala inicial; Caro, viva en la del jefe.
    kill("beto");
    teleport("caro", roomSpawnPoints(d, d.bossRoomId, 1)[0]!);

    await killByHit("ana", ana.client);
    await respawnNow("ana");
    expect(chebyshevTiles(player("ana"), player("caro"))).toBeLessThanOrEqual(2);
  });

  it("un jugador muerto no se mueve, pero su seq se confirma", async () => {
    const ana = await join("Ana", "t-ana");
    await ana.welcome;
    const c = record("ana").combat;
    c.hp = 0;
    c.dead = true;
    c.respawnIn = 3;
    const x0 = player("ana").x;
    ana.client.send(MSG.input, input(1));
    await ticksUntil(() => player("ana").lastSeq === 1, 5);
    expect(player("ana").x).toBe(x0);
  });
});

describe("RunRoom: armas", () => {
  const d = generateDungeon(SEED, 1);
  // Puntos de la sala inicial: los primeros MAX_PLAYERS son de aparición; luego, guardia y mandoble.
  const starts = roomSpawnPoints(d, d.startRoomId, MAX_PLAYERS + 2);
  const guardAt = starts[MAX_PLAYERS]!;
  const greatAt = starts[MAX_PLAYERS + 1]!;
  const initialFloor = [
    { weaponId: "guard-sword", x: guardAt.x, z: guardAt.z },
    { weaponId: "great-sword", x: greatAt.x, z: greatAt.z },
  ];
  const idle = (seq: number, extra: Partial<ReturnType<typeof attackInput>> = {}) => ({
    ...attackInput(seq, 0, room.state.tick),
    attack: false,
    ...extra,
  });
  const floorsUntil = (floors: FloorMsg[], n: number) => ticksUntil(() => floors.length >= n, 10);

  /** Teletransporta a Ana junto al mandoble y lo toma; devuelve el próximo seq. */
  async function takeGreatSword(ana: Awaited<ReturnType<typeof join>>, seq: number): Promise<number> {
    const before = ana.floors.length;
    teleport("ana", greatAt);
    ana.client.send(MSG.input, idle(seq, { interact: true }));
    await ticksUntil(() => player("ana").lastSeq === seq, 5);
    await floorsUntil(ana.floors, before + 1);
    return seq + 1;
  }

  it("un jugador nuevo lleva la espada del Kingslayer y recibe sus 2 armas del suelo en la sala de inicio", async () => {
    expect(PICKUP_RANGE).toBe(1.5);
    const ana = await join("Ana", "t-ana");
    await ana.welcome;
    expect(player("ana").weaponId).toBe("kingslayer-sword");
    await floorsUntil(ana.floors, 1);
    expect(ana.floors).toEqual([{ items: initialFloor }]);
    const start = d.rooms[d.startRoomId]!;
    for (const it of ana.floors[0]!.items) {
      const [tx, tz] = [tileOf(it.x), tileOf(it.z)];
      expect(tx >= start.x && tx < start.x + start.w && tz >= start.z && tz < start.z + start.h).toBe(true);
      expect(isWalkableTile(d, tx, tz)).toBe(true);
    }
    expect(record("ana").floorWeapons).toEqual(initialFloor);
    await ticksUntil(() => ana.client.state.players.get("ana")?.weaponId === "kingslayer-sword", 5);
  });

  it("interact junto al mandoble lo equipa y deja la espada del Kingslayer en su lugar", async () => {
    const ana = await join("Ana", "t-ana");
    await ana.welcome;
    await floorsUntil(ana.floors, 1);
    // Combo a medias pero sin swing en curso: el cambio lo reinicia.
    Object.assign(record("ana").combat, { comboStep: 1, comboTimer: 0.3 });
    await takeGreatSword(ana, 1);
    expect(player("ana").weaponId).toBe("great-sword");
    expect(record("ana").combat).toMatchObject({ weaponId: "great-sword", comboStep: 0, comboTimer: 0, swingTimer: 0, impactPending: false });
    expect(ana.floors).toHaveLength(2);
    expect(ana.floors[1]).toEqual({
      items: [initialFloor[0], { weaponId: "kingslayer-sword", x: greatAt.x, z: greatAt.z }],
    });
    await ticksUntil(() => ana.client.state.players.get("ana")?.weaponId === "great-sword", 5);
  });

  it("interact a más de 1,5 m de toda arma no cambia nada", async () => {
    const ana = await join("Ana", "t-ana");
    await ana.welcome;
    await floorsUntil(ana.floors, 1);
    // Otra casilla de la sala: su centro queda a ≥ 2 m de cualquier arma.
    teleport("ana", starts[0]!);
    ana.client.send(MSG.input, idle(1, { interact: true }));
    await ticksUntil(() => player("ana").lastSeq === 1, 5);
    for (let i = 0; i < 3; i++) await room.waitForNextTimestep();
    expect(player("ana").weaponId).toBe("kingslayer-sword");
    expect(record("ana").floorWeapons).toEqual(initialFloor);
    expect(ana.floors).toHaveLength(1);
  });

  it("Foco 3: interact con un swing en curso se ignora y el combo sigue sano", async () => {
    const ana = await join("Ana", "t-ana");
    await ana.welcome;
    collect(ana.client); // el swing se difunde; sin handler el SDK avisa por consola
    await floorsUntil(ana.floors, 1);
    teleport("ana", greatAt);
    ana.client.send(MSG.input, { ...attackInput(1, 0, room.state.tick) });
    ana.client.send(MSG.input, idle(2, { interact: true }));
    await ticksUntil(() => player("ana").lastSeq === 2, 5);
    const c = record("ana").combat;
    expect(c.weaponId).toBe("kingslayer-sword");
    expect(c.comboStep).toBe(1);
    expect(c.swingTimer).toBeGreaterThan(0);
    expect(record("ana").floorWeapons).toEqual(initialFloor);
    expect(ana.floors).toHaveLength(1);

    // El swing termina tras ceil(duración / SIM_DT) inputs posteriores al clic; luego el mismo interact sí funciona.
    const swingInputs = Math.ceil(strikeOf("kingslayer-sword", 1).duration / SIM_DT);
    let seq = 2;
    while (seq < 1 + swingInputs) ana.client.send(MSG.input, idle(++seq));
    await ticksUntil(() => player("ana").lastSeq === seq, 10);
    expect(record("ana").combat.swingTimer).toBe(0);
    await takeGreatSword(ana, seq + 1);
    expect(player("ana").weaponId).toBe("great-sword");
    expect(record("ana").combat).toMatchObject({ comboStep: 0, swingTimer: 0, impactPending: false });
  });

  it("Foco 4: salir y volver, o tomar el control, conserva el arma y reenvía las armas del suelo", async () => {
    const ana = await join("Ana", "t-ana");
    await ana.welcome;
    await floorsUntil(ana.floors, 1);
    await takeGreatSword(ana, 1);
    const swapped = ana.floors[1]!;

    await ana.client.leave();
    await ticksUntil(() => !room.state.players.has("ana"));
    const back = await join("Ana", "t-otro");
    await back.welcome;
    expect(player("ana").weaponId).toBe("great-sword");
    await floorsUntil(back.floors, 1);
    expect(back.floors).toEqual([swapped]);

    const again = await join("Ana", "t-otro");
    await again.welcome;
    expect(player("ana").weaponId).toBe("great-sword");
    await floorsUntil(again.floors, 1);
    expect(again.floors).toEqual([swapped]);
    await ticksUntil(() => again.client.state.players.get("ana")?.weaponId === "great-sword", 5);
  });

  it("las armas del suelo de un jugador no le llegan a otro", async () => {
    const ana = await join("Ana", "t-ana");
    const beto = await join("Beto", "t-beto");
    await Promise.all([ana.welcome, beto.welcome]);
    await floorsUntil(beto.floors, 1);
    await floorsUntil(ana.floors, 1);
    await takeGreatSword(ana, 1);
    for (let i = 0; i < 3; i++) await room.waitForNextTimestep();
    expect(beto.floors).toEqual([{ items: initialFloor }]);
    expect(record("beto").floorWeapons).toEqual(initialFloor);
    expect(player("beto").weaponId).toBe("kingslayer-sword");
  });

  it("el daño contra un enemigo llega en el impacto, no en el tick del clic", async () => {
    const ana = await join("Ana", "t-ana");
    await ana.welcome;
    // Tick del servidor en el momento en que el cliente recibe cada evento.
    const seen: { e: CombatEvent; tick: number }[] = [];
    ana.client.onMessage(MSG.combat, (e: CombatEvent) => seen.push({ e, tick: room.state.tick }));
    const { d: dd, cr } = combatRoom();
    teleport("ana", roomSpawnPoints(dd, cr.id, 1)[0]!);
    await ticksUntil(() => room.state.enemies.size === 4, 5);
    const sys = room["enemySystem"];
    const sides = [[0, -1], [0, 1], [-1, 0], [1, 0]] as const;
    const target = sys.enemies.find((e) => sides.some(([dx, dz]) => isWalkableTile(dd, tileOf(e.x) + dx, tileOf(e.z) + dz)))!;
    const [dx, dz] = sides.find(([dx, dz]) => isWalkableTile(dd, tileOf(target.x) + dx, tileOf(target.z) + dz))!;
    teleport("ana", tileCenter(tileOf(target.x) + dx, tileOf(target.z) + dz));

    const me = record("ana").kinematic;
    const facing = Math.atan2(target.x - me.x, target.z - me.z);
    // Un input por tick, para que el swing avance en ticks reales.
    const strike = strikeOf("kingslayer-sword", 1);
    const total = Math.ceil(strike.duration / SIM_DT);
    for (let seq = 1; seq <= total; seq++) {
      ana.client.send(MSG.input, { ...attackInput(seq, facing, room.state.tick), attack: seq === 1 });
      await ticksUntil(() => player("ana").lastSeq === seq, 5);
    }
    await ticksUntil(() => seen.some((s) => s.e.type === "damage" && s.e.targetKind === "enemy"), 10);
    const swingIdx = seen.findIndex((s) => s.e.type === "swing");
    const dmgIdx = seen.findIndex((s) => s.e.type === "damage" && s.e.targetKind === "enemy");
    expect(swingIdx).toBeGreaterThanOrEqual(0);
    expect(dmgIdx).toBeGreaterThan(swingIdx);
    const minTicks = Math.ceil((strike.impactAt * strike.duration) / SIM_DT) - 1;
    expect(seen[dmgIdx]!.tick - seen[swingIdx]!.tick).toBeGreaterThanOrEqual(minTicks);
  });
});

describe("HTTP", () => {
  it("GET /health responde 200", async () => {
    const res = await fetch("http://localhost:2568/health");
    expect(res.status).toBe(200);
  });

  it("fuera de producción no sirve el cliente compilado (aunque exista packages/client/dist)", async () => {
    // En desarrollo el cliente lo sirve Vite; un dist viejo mezclaría dos versiones del mapa.
    // Colyseus responde "/" con su saludo; lo que no debe llegar es el index.html del cliente.
    const body = await (await fetch("http://localhost:2568/")).text();
    expect(body).not.toMatch(/<script/i);
  });
});
