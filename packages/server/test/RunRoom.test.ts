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
  enemyScale,
  FLOOR_WEAPON_TTL_S,
  ENEMY_DEFS,
  xpToNext,
  TIERS,
  CHOICE_TIME_S,
  BASE_REGEN,
  applyCard,
  playerMods,
  SANDBOX_COOLDOWN_MULT,
  type CardOffer,
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

type FloorMsg = { items: { weaponId: string; tier: number; x: number; z: number; ttl: number }[] };
/** Solo arma y posición (sin vencimiento): para comparar listas de armas del suelo. */
const place = (items: readonly { weaponId: string; tier: number; x: number; z: number }[]) =>
  items.map(({ weaponId, tier, x, z }) => ({ weaponId, tier, x, z }));
type ChoiceMsg = { offerId: number; cards: unknown[]; index: number; total: number; deadlineS: number };

async function join(
  name: string,
  token: string,
): Promise<{ client: ClientRoom; welcome: Promise<unknown>; floors: FloorMsg[]; choices: ChoiceMsg[] }> {
  const client = await colyseus.sdk.joinById(room.roomId, { name, token, version: PROTOCOL_VERSION });
  // Sin reconexión automática del SDK: la reconexión del juego es por nombre.
  client.reconnection.enabled = false;
  const floors: FloorMsg[] = [];
  client.onMessage(MSG.floorWeapons, (m: FloorMsg) => floors.push(m));
  const choices: ChoiceMsg[] = [];
  client.onMessage(MSG.levelChoice, (m: ChoiceMsg) => choices.push(m));
  return { client, welcome: client.waitForMessage(MSG.welcome), floors, choices };
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
const input = (seq: number) => ({ seq, moveX: 1, moveZ: 0, facing: Math.PI / 2 });
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
    expect(await ana.welcome).toEqual({ key: "ana", sandbox: false });
    expect(await beto.welcome).toEqual({ key: "beto", sandbox: false });
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
    expect(await ana2.welcome).toEqual({ key: "ana", sandbox: false });
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
    expect(await beto2.welcome).toEqual({ key: "beto", sandbox: false });
    expect(room.state.players.has("beto")).toBe(true);
  });

  it("una desconexión abrupta libera al jugador y puede volver con otro token", async () => {
    const ana = await join("Ana", "t-ana");
    const beto = await join("Beto", "t-beto");
    await Promise.all([ana.welcome, beto.welcome]);
    beto.client.connection.close(); // cierra el socket sin avisar a la sala (sin LEAVE_ROOM)
    await ticksUntil(() => !room.state.players.has("beto"));

    const beto2 = await join("Beto", "t-otro");
    expect(await beto2.welcome).toEqual({ key: "beto", sandbox: false });
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
  r.kinematic = { ...r.kinematic, x: p.x, z: p.z, y: 0, vy: 0 };
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
  seq, moveX: 0, moveZ: 0, facing, sprint: false, jump: false, attack: true, interact: false, abilities: 0, viewTick,
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
    expect(room.state.xpToNext).toBe(xpToNext(1));
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
    // La regeneración (0,5/s) la mueve apenas: se compara con margen.
    await ticksUntil(() => Math.abs(player("ana").hp - 50) < 0.5, 3);
    await ana.client.leave();
    await ticksUntil(() => !room.state.players.has("ana"));

    const back = await join("Ana", "t-otro");
    await back.welcome;
    expect(player("ana").hp).toBeCloseTo(50, 0);
    expect(player("ana").maxHp).toBe(120);
    await room.waitForNextTimestep();
    expect(player("ana").hp).toBeCloseTo(50, 0);
  });

  it("Foco 2: un takeover conserva la vida y el estado de muerte", async () => {
    const ana = await join("Ana", "t-ana");
    await ana.welcome;
    record("ana").combat.hp = 50;
    await ticksUntil(() => Math.abs(player("ana").hp - 50) < 0.5, 3);

    const ana2 = await join("Ana", "t-ana");
    await ana2.welcome;
    expect(player("ana").hp).toBeCloseTo(50, 0);
    await room.waitForNextTimestep();
    expect(player("ana").hp).toBeCloseTo(50, 0);

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
    record(key).combat.pendingHits.push({ damage: 999, resolveTick: -REWIND_MAX_TICKS, sourceX: 0, sourceZ: 0 });
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
    { weaponId: "guard-sword", tier: 1, x: guardAt.x, z: guardAt.z },
    { weaponId: "great-sword", tier: 1, x: greatAt.x, z: greatAt.z },
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
    expect(player("ana").weaponTier).toBe(1);
    await floorsUntil(ana.floors, 1);
    expect(ana.floors.map((m) => place(m.items))).toEqual([initialFloor]);
    // Vencen a los FLOOR_WEAPON_TTL_S simulados desde que se crean, al entrar.
    const born = record("ana").floorWeapons[0]!.expiresAt - FLOOR_WEAPON_TTL_S;
    expect(born).toBeGreaterThanOrEqual(0);
    expect(born).toBeLessThanOrEqual(room.state.floorTime);
    for (const f of record("ana").floorWeapons) expect(f.expiresAt).toBe(born + FLOOR_WEAPON_TTL_S);
    for (const it of ana.floors[0]!.items) expect(it.ttl).toBeCloseTo(FLOOR_WEAPON_TTL_S, 0);
    const start = d.rooms[d.startRoomId]!;
    for (const it of ana.floors[0]!.items) {
      const [tx, tz] = [tileOf(it.x), tileOf(it.z)];
      expect(tx >= start.x && tx < start.x + start.w && tz >= start.z && tz < start.z + start.h).toBe(true);
      expect(isWalkableTile(d, tx, tz)).toBe(true);
    }
    expect(place(record("ana").floorWeapons)).toEqual(initialFloor);
    await ticksUntil(() => ana.client.state.players.get("ana")?.weaponId === "kingslayer-sword", 5);
  });

  it("interact junto al mandoble lo equipa y deja la espada del Kingslayer en su lugar", async () => {
    const ana = await join("Ana", "t-ana");
    await ana.welcome;
    await floorsUntil(ana.floors, 1);
    // Combo a medias pero sin swing en curso: el cambio lo reinicia.
    Object.assign(record("ana").combat, { comboStep: 1, comboTimer: 0.3 });
    // Reloj adelantado 10 s: la que se deje al cambiar vence 10 s después que las iniciales.
    room["floorTime"] += 10;
    await takeGreatSword(ana, 1);
    expect(player("ana").weaponId).toBe("great-sword");
    expect(record("ana").combat).toMatchObject({ weaponId: "great-sword", comboStep: 0, comboTimer: 0, swingTimer: 0, impactPending: false });
    expect(ana.floors).toHaveLength(2);
    expect(place(ana.floors[1]!.items)).toEqual([
      initialFloor[0], { weaponId: "kingslayer-sword", tier: 1, x: greatAt.x, z: greatAt.z },
    ]);
    // La que se deja al cambiar vence a los FLOOR_WEAPON_TTL_S desde el cambio; la otra conserva su plazo.
    const [kept, left] = record("ana").floorWeapons;
    expect(left!.expiresAt).toBeGreaterThan(kept!.expiresAt);
    expect(left!.expiresAt).toBeLessThanOrEqual(room.state.floorTime + FLOOR_WEAPON_TTL_S);
    expect(ana.floors[1]!.items[1]!.ttl).toBeCloseTo(FLOOR_WEAPON_TTL_S, 0);
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
    expect(place(record("ana").floorWeapons)).toEqual(initialFloor);
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
    expect(place(record("ana").floorWeapons)).toEqual(initialFloor);
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
    expect(back.floors.map((m) => place(m.items))).toEqual([place(swapped.items)]);

    const again = await join("Ana", "t-otro");
    await again.welcome;
    expect(player("ana").weaponId).toBe("great-sword");
    await floorsUntil(again.floors, 1);
    expect(again.floors.map((m) => place(m.items))).toEqual([place(swapped.items)]);
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
    expect(beto.floors.map((m) => place(m.items))).toEqual([initialFloor]);
    expect(place(record("beto").floorWeapons)).toEqual(initialFloor);
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

describe("RunRoom: orbes y botín", () => {
  const idle = (seq: number, extra: Partial<ReturnType<typeof attackInput>> = {}) => ({
    ...attackInput(seq, 0, room.state.tick),
    attack: false,
    ...extra,
  });
  const sides = [[0, -1], [0, 1], [-1, 0], [1, 0]] as const;

  /**
   * Lleva a `key` a una sala de combate, deja a un enemigo con 1 de vida (los demás con mucha) y lo
   * mata a espadazos. `prepare` puede ajustar al blanco antes. Devuelve el enemigo muerto y el próximo seq.
   */
  async function killOne(
    key: string,
    client: ClientRoom,
    prepare: (e: { loadout: unknown }) => void = () => {},
    seq0 = 1,
  ) {
    const { d, cr } = combatRoom();
    teleport(key, roomSpawnPoints(d, cr.id, 1)[0]!);
    await ticksUntil(() => room["enemySystem"].enemies.length >= 4, 5);
    const sys = room["enemySystem"];
    const target = sys.enemies.find((e) => sides.some(([dx, dz]) => isWalkableTile(d, tileOf(e.x) + dx, tileOf(e.z) + dz)))!;
    for (const e of sys.enemies) e.hp = e.maxHp = 9999;
    target.hp = 1;
    prepare(target);
    let seq = seq0;
    for (let attempt = 0; attempt < 5 && target.ai !== "dead"; attempt++) {
      const [dx, dz] = sides.find(([dx, dz]) => isWalkableTile(d, tileOf(target.x) + dx, tileOf(target.z) + dz))!;
      teleport(key, tileCenter(tileOf(target.x) + dx, tileOf(target.z) + dz));
      await room.waitForNextTimestep();
      const me = record(key).kinematic;
      const facing = Math.atan2(target.x - me.x, target.z - me.z);
      client.send(MSG.input, attackInput(seq++, facing, room.state.tick));
      for (let j = 0; j < 11; j++) client.send(MSG.input, { ...attackInput(seq++, facing, room.state.tick), attack: false });
      const last = seq - 1;
      await ticksUntil(() => player(key).lastSeq === last, 10);
    }
    expect(target.ai).toBe("dead");
    return { target, seq };
  }

  it("matar no sube la xp en el impacto: deja orbes y la xp llega al pararse encima", async () => {
    const ana = await join("Ana", "t-ana");
    await ana.welcome;
    collect(ana.client);
    // Orbes congelados mientras se mata: cualquier xp ganada vendría del impacto.
    const orbs = room["orbs"];
    const stepSpy = vi.spyOn(orbs, "step").mockReturnValue(0);
    const { target } = await killOne("ana", ana.client);
    await room.waitForNextTimestep();
    expect(room.state.xp).toBe(0);
    expect(room.state.level).toBe(1);
    const xp = ENEMY_DEFS[target.kind].xp;
    expect(room.state.orbs.size).toBeGreaterThan(0);
    expect([...room.state.orbs.values()].reduce((s, o) => s + o.value, 0)).toBe(xp);
    await ticksUntil(() => ana.client.state.orbs?.size === room.state.orbs.size, 10);

    stepSpy.mockRestore();
    teleport("ana", { x: target.x, z: target.z });
    await ticksUntil(() => room.state.orbs.size === 0, 30);
    expect(room.state.xp).toBe(xp);
  });

  it("un solo impacto que mata a varios deja los orbes de todos y suman su xp", async () => {
    const ana = await join("Ana", "t-ana");
    await ana.welcome;
    collect(ana.client);
    const { d, cr } = combatRoom();
    teleport("ana", roomSpawnPoints(d, cr.id, 1)[0]!);
    await ticksUntil(() => room["enemySystem"].enemies.length >= 4, 5);
    const sys = room["enemySystem"];
    // Enemigos quietos y orbes congelados: solo cuenta lo que deja el impacto.
    vi.spyOn(sys, "step").mockReturnValue([]);
    vi.spyOn(room["orbs"], "step").mockReturnValue(0);
    const kills: number[] = [];
    const impact = room["impact"].bind(room);
    vi.spyOn(room as unknown as { impact: typeof impact }, "impact").mockImplementation((r, res) => {
      if (res.kills.length > 0) kills.push(res.kills.length);
      impact(r, res);
    });

    // Ana en el centro de la sala mirando a +x; tres enemigos con 1 de vida en abanico frente a ella.
    const c = tileCenter(cr.x + Math.floor(cr.w / 2), cr.z + Math.floor(cr.h / 2));
    teleport("ana", c);
    const [far, ...victims] = sys.enemies.slice(0, 4);
    far!.hp = far!.maxHp = 9999;
    far!.x = c.x - 6;
    far!.z = c.z;
    victims.forEach((e, i) => {
      const a = Math.PI / 2 + ((i - 1) * Math.PI) / 4;
      e.hp = 1;
      e.x = c.x + 1.6 * Math.sin(a);
      e.z = c.z + 1.6 * Math.cos(a);
    });
    await room.waitForNextTimestep();
    let seq = 1;
    ana.client.send(MSG.input, attackInput(seq++, Math.PI / 2, room.state.tick));
    for (let j = 0; j < 11; j++) ana.client.send(MSG.input, { ...attackInput(seq++, Math.PI / 2, room.state.tick), attack: false });
    await ticksUntil(() => player("ana").lastSeq === seq - 1, 10);
    await room.waitForNextTimestep();

    for (const e of victims) expect(e.ai).toBe("dead");
    expect(kills).toEqual([victims.length]);
    const xp = victims.reduce((s, e) => s + ENEMY_DEFS[e.kind].xp, 0);
    expect(room.state.orbs.size).toBeGreaterThanOrEqual(victims.length);
    expect([...room.state.orbs.values()].reduce((s, o) => s + o.value, 0)).toBe(xp);
    expect(room.state.xp).toBe(0);
  });

  it("un arma soltada llega a cada conectado con su tier, y cada uno la toma sin tocar la lista del otro", async () => {
    const ana = await join("Ana", "t-ana");
    const beto = await join("Beto", "t-beto");
    await Promise.all([ana.welcome, beto.welcome]);
    collect(ana.client);
    collect(beto.client);
    await ticksUntil(() => ana.floors.length >= 1 && beto.floors.length >= 1, 10);
    // Drop forzado: el tier 2 suelta siempre durante esta prueba (el sorteo real sigue en EnemySystem.damage).
    const tier2 = TIERS[2] as { dropChance: number };
    const chance = tier2.dropChance;
    tier2.dropChance = 1;
    let target;
    let seq;
    try {
      ({ target, seq } = await killOne("ana", ana.client, (e) => {
        e.loadout = { weaponId: "great-sword", tier: 2 };
      }));
    } finally {
      tier2.dropChance = chance;
    }
    const dropped = { weaponId: "great-sword", tier: 2, x: target.x, z: target.z };
    await ticksUntil(() => ana.floors.length >= 2 && beto.floors.length >= 2, 10);
    expect(place(ana.floors.at(-1)!.items)).toEqual(place([...ana.floors[0]!.items, dropped]));
    expect(place(beto.floors.at(-1)!.items)).toEqual(place([...beto.floors[0]!.items, dropped]));
    expect(ana.floors.at(-1)!.items.at(-1)!.ttl).toBeCloseTo(FLOOR_WEAPON_TTL_S, 0);

    // Ana la toma: deja su Kingslayer tier 1 en su lugar; la lista de Beto no cambia.
    teleport("ana", dropped);
    ana.client.send(MSG.input, idle(seq, { interact: true }));
    await ticksUntil(() => player("ana").lastSeq === seq, 5);
    expect(record("ana").combat).toMatchObject({ weaponId: "great-sword", weaponTier: 2 });
    expect(player("ana").weaponTier).toBe(2);
    expect(record("ana").floorWeapons.at(-1)).toMatchObject({ ...dropped, weaponId: "kingslayer-sword", tier: 1 });
    expect(record("beto").floorWeapons.at(-1)).toMatchObject(dropped);

    // Beto también puede tomar su copia.
    teleport("beto", dropped);
    beto.client.send(MSG.input, idle(1, { interact: true }));
    await ticksUntil(() => player("beto").lastSeq === 1, 5);
    expect(player("beto").weaponId).toBe("great-sword");
    expect(player("beto").weaponTier).toBe(2);
    expect(record("ana").floorWeapons.at(-1)).toMatchObject({ ...dropped, weaponId: "kingslayer-sword", tier: 1 });
    await ticksUntil(() => beto.client.state.players.get("beto")?.weaponTier === 2, 5);
  });

  it("un arma del suelo con naturaleza se toma, y la anterior queda con la suya", async () => {
    const ana = await join("Ana", "t-ana");
    await ana.welcome;
    await ticksUntil(() => ana.floors.length >= 1, 10);
    const r = record("ana");
    r.combat.weaponNature = "ice";
    const me = r.kinematic;
    r.floorWeapons = [{ weaponId: "great-sword", tier: 2, nature: "fire", x: me.x + 1, z: me.z, expiresAt: room["floorTime"] + 30 }];
    const sent = ana.floors.length;
    ana.client.send(MSG.input, idle(1, { interact: true }));
    await ticksUntil(() => player("ana").lastSeq === 1, 5);
    expect(r.combat).toMatchObject({ weaponId: "great-sword", weaponTier: 2, weaponNature: "fire" });
    expect(r.floorWeapons[0]).toMatchObject({ nature: "ice" });
    await ticksUntil(() => player("ana").weaponNature === "fire" && ana.floors.length > sent, 5);
    expect(ana.floors.at(-1)!.items[0]).toMatchObject({ nature: "ice" });
  });

  it("un arma soltada por un enemigo con naturaleza la conserva en floorWeapons", async () => {
    const ana = await join("Ana", "t-ana");
    await ana.welcome;
    await ticksUntil(() => ana.floors.length >= 1, 10);
    const tier2 = TIERS[2] as { dropChance: number };
    const chance = tier2.dropChance;
    tier2.dropChance = 1;
    try {
      await killOne("ana", ana.client, (e) => {
        e.loadout = { weaponId: "great-sword", tier: 2, nature: "lightning" };
      });
    } finally {
      tier2.dropChance = chance;
    }
    await ticksUntil(() => ana.floors.length >= 2, 10);
    expect(ana.floors.at(-1)!.items.at(-1)).toMatchObject({ weaponId: "great-sword", tier: 2, nature: "lightning" });
    expect(record("ana").floorWeapons.at(-1)).toMatchObject({ nature: "lightning" });
  });

  it("los enemigos llevan su arma y su tier en el estado (\"\" y 0 si van desarmados)", async () => {
    const ana = await join("Ana", "t-ana");
    await ana.welcome;
    const { d, cr } = combatRoom();
    teleport("ana", roomSpawnPoints(d, cr.id, 1)[0]!);
    await ticksUntil(() => room.state.enemies.size >= 4, 5);
    for (const e of room["enemySystem"].enemies) {
      const es = room.state.enemies.get(e.id)!;
      expect(es.weaponId).toBe(e.loadout?.weaponId ?? "");
      expect(es.weaponTier).toBe(e.loadout?.tier ?? 0);
      expect(es.weaponNature).toBe(e.loadout?.nature ?? "none");
    }
  });

  it("Foco 4: al volver por nombre conserva el tier del arma, el de sus armas del suelo, el reloj y los orbes", async () => {
    const ana = await join("Ana", "t-ana");
    await ana.welcome;
    await ticksUntil(() => ana.floors.length >= 1, 10);
    const r = record("ana");
    r.combat.weaponId = "great-sword";
    r.combat.weaponTier = 3;
    r.floorWeapons[0] = { ...r.floorWeapons[0]!, tier: 2 };
    const floor = r.floorWeapons.map((f) => ({ ...f }));
    room["orbs"].spawn(1000, 1000, 7, room.state.tick);
    await ticksUntil(() => player("ana").weaponTier === 3 && room.state.orbs.size > 0, 5);
    const orbCount = room.state.orbs.size;

    await ana.client.leave();
    await ticksUntil(() => !room.state.players.has("ana"));
    const back = await join("Ana", "t-otro");
    await back.welcome;
    expect(player("ana").weaponId).toBe("great-sword");
    expect(player("ana").weaponTier).toBe(3);
    await ticksUntil(() => back.floors.length >= 1, 10);
    expect(place(back.floors[0]!.items)).toEqual(place(floor));
    await ticksUntil(
      () => back.client.state.players.get("ana")?.weaponTier === 3 && back.client.state.orbs?.size === orbCount,
      10,
    );
    expect(back.client.state.floorTime).toBeGreaterThan(0);
  });
});

describe("RunRoom: subir de nivel y elegir cartas", () => {
  const moveInput = (seq: number) => ({ ...attackInput(seq, 0, room.state.tick), attack: false, moveX: 1 });

  it("Foco 2: al subir de nivel el juego se pausa y nada se mueve; al elegir sigue", async () => {
    const ana = await join("Ana", "t-ana");
    await ana.welcome;
    const { d, cr } = combatRoom();
    teleport("ana", roomSpawnPoints(d, cr.id, 1)[0]!);
    await ticksUntil(() => room["enemySystem"].enemies.length >= 4, 5);
    // Un orbe lejano que no se recoge y uno bajo los pies con la xp justa para subir.
    room["orbs"].spawn(1000, 1000, 1, room.state.tick);
    const me = record("ana").kinematic;
    room["orbs"].spawn(me.x, me.z, xpToNext(1), room.state.tick);
    await ticksUntil(() => room.state.paused, 30);
    expect(room.state.level).toBe(2);
    await ticksUntil(() => ana.choices.length === 1, 10);
    expect(ana.choices[0]).toMatchObject({ index: 1, total: 1, deadlineS: CHOICE_TIME_S });
    expect(ana.choices[0]!.cards).toHaveLength(3);
    expect(player("ana").choosing).toBe(true);
    await ticksUntil(() => ana.client.state.paused === true, 10);

    const tick = room.state.tick;
    const floorTime = room.state.floorTime;
    const pos = record("ana").kinematic;
    const enemies = room["enemySystem"].enemies.map((e) => [e.x, e.z]);
    const orbs = room["orbs"].orbs.map((o) => [o.x, o.z]);
    expect(orbs.length).toBeGreaterThan(0);
    const pauseLeft = room.state.pauseLeft;
    for (let seq = 1; seq <= 30; seq++) ana.client.send(MSG.input, moveInput(seq));
    for (let i = 0; i < 30; i++) await room.waitForNextTimestep();
    expect(room.state.tick).toBe(tick);
    expect(room.state.floorTime).toBe(floorTime);
    expect(record("ana").kinematic).toEqual(pos);
    expect(room["enemySystem"].enemies.map((e) => [e.x, e.z])).toEqual(enemies);
    expect(room["orbs"].orbs.map((o) => [o.x, o.z])).toEqual(orbs);
    expect(player("ana").lastSeq).toBe(30);
    expect(room.state.pauseLeft).toBeLessThan(pauseLeft);
    expect(room.state.paused).toBe(true);

    ana.client.send(MSG.chooseCard, { offerId: ana.choices[0]!.offerId, index: 0 });
    await ticksUntil(() => !room.state.paused, 10);
    expect(player("ana").choosing).toBe(false);
    expect(record("ana").pendingChoices).toBe(0);
    const p = record("ana").progress;
    expect(Object.keys(p.stats).length + p.abilities.length).toBe(1);
    // Al aplicarse, los multiplicadores salen del progreso y se sincronizan.
    expect(record("ana").combat.mods).toEqual(playerMods(p));
    expect(player("ana").moveSpeedMult).toBe(playerMods(p).moveSpeedMult);
    expect(player("ana").attackSpeedMult).toBe(playerMods(p).attackSpeedMult);
    const t1 = room.state.tick;
    await room.waitForNextTimestep();
    await room.waitForNextTimestep();
    expect(room.state.tick).toBeGreaterThan(t1);
  });

  it("Foco 5: al volver con una elección pendiente la recibe sin pausar y conserva sus cartas", async () => {
    const ana = await join("Ana", "t-ana");
    await ana.welcome;
    await ana.client.leave();
    await ticksUntil(() => !room.state.players.has("ana"));
    const r = record("ana");
    r.progress.stats.strength = 2;
    r.progress.abilities.push({ id: "kick", rank: 2 });
    room["levelUp"].onLevelsGained(1, [], room["registry"].all());
    expect(r.pendingChoices).toBe(1);

    const back = await join("Ana", "t-otro");
    await back.welcome;
    await ticksUntil(() => back.choices.length === 1, 10);
    expect(back.choices[0]).toMatchObject({ index: 1, total: 1, deadlineS: CHOICE_TIME_S });
    expect(room.state.paused).toBe(false);
    expect(player("ana").choosing).toBe(true);
    expect(record("ana").progress.stats.strength).toBe(2);
    expect(record("ana").progress.abilities).toEqual([{ id: "kick", rank: 2 }]);
    // Sigue jugando mientras elige.
    const t0 = room.state.tick;
    back.client.send(MSG.input, moveInput(1));
    await ticksUntil(() => player("ana").lastSeq === 1, 5);
    expect(room.state.tick).toBeGreaterThan(t0);

    back.client.send(MSG.chooseCard, { offerId: back.choices[0]!.offerId, index: 1 });
    await ticksUntil(() => !player("ana").choosing, 10);
    expect(record("ana").pendingChoices).toBe(0);
    expect(room.state.paused).toBe(false);
  });

  it("un takeover en plena pausa recibe de nuevo la oferta abierta", async () => {
    const ana = await join("Ana", "t-ana");
    await ana.welcome;
    room["levelUp"].onLevelsGained(1, room["registry"].connected(), room["registry"].all());
    await ticksUntil(() => ana.choices.length === 1, 10);
    const other = await join("Ana", "t-ana");
    await other.welcome;
    await ticksUntil(() => other.choices.length === 1, 10);
    expect(other.choices[0]!.cards).toEqual(ana.choices[0]!.cards);
    expect(room.state.paused).toBe(true);
    expect(other.choices[0]!.offerId).toBe(ana.choices[0]!.offerId);
    other.client.send(MSG.chooseCard, { offerId: other.choices[0]!.offerId, index: 0 });
    await ticksUntil(() => !room.state.paused, 10);
  });

  it("quien entra tarde recibe level − 1 elecciones sin pausa", async () => {
    const ana = await join("Ana", "t-ana");
    await ana.welcome;
    room["combat"].level = 3;
    const beto = await join("Beto", "t-beto");
    await beto.welcome;
    expect(record("beto").pendingChoices).toBe(2);
    expect(record("ana").pendingChoices).toBe(0);
    await ticksUntil(() => beto.choices.length === 1, 10);
    expect(beto.choices[0]).toMatchObject({ index: 1, total: 2 });
    expect(ana.choices).toEqual([]);
    expect(room.state.paused).toBe(false);
  });

  it("un chooseCard con un offerId viejo, llegado tras abrirse la siguiente oferta, se ignora", async () => {
    const ana = await join("Ana", "t-ana");
    await ana.welcome;
    room["levelUp"].onLevelsGained(2, room["registry"].connected(), room["registry"].all());
    await ticksUntil(() => ana.choices.length === 1, 10);
    const oldId = ana.choices[0]!.offerId;
    ana.client.send(MSG.chooseCard, { offerId: oldId, index: 0 });
    await ticksUntil(() => ana.choices.length === 2, 10);
    expect(ana.choices[1]).toMatchObject({ index: 2, total: 2 });
    expect(ana.choices[1]!.offerId).not.toBe(oldId);
    expect(record("ana").pendingChoices).toBe(1);
    // El doble clic llega con la oferta ya cambiada.
    ana.client.send(MSG.chooseCard, { offerId: oldId, index: 1 });
    ana.client.send(MSG.chooseCard, { index: 1 });
    for (let i = 0; i < 5; i++) await room.waitForNextTimestep();
    expect(record("ana").pendingChoices).toBe(1);
    expect(player("ana").choosing).toBe(true);
    expect(room.state.paused).toBe(true);
    ana.client.send(MSG.chooseCard, { offerId: ana.choices[1]!.offerId, index: 1 });
    await ticksUntil(() => !room.state.paused, 10);
    expect(record("ana").pendingChoices).toBe(0);
  });
});

describe("RunRoom: vencimiento de las armas del suelo", () => {
  /** Ana sin sus armas iniciales y con una soltada en (x, z); devuelve el arma soltada de su registro. */
  async function withDrop(ana: Awaited<ReturnType<typeof join>>) {
    await ticksUntil(() => ana.floors.length >= 1, 10);
    record("ana").floorWeapons = [];
    const me = record("ana").kinematic;
    room["dropWeapon"]({ weaponId: "great-sword", tier: 2, nature: "none", x: me.x + 5, z: me.z });
    await ticksUntil(() => ana.floors.length >= 2, 10);
    const f = record("ana").floorWeapons[0]!;
    expect(f.expiresAt).toBeCloseTo(room["floorTime"] + FLOOR_WEAPON_TTL_S, 0);
    expect(ana.floors[1]!.items).toHaveLength(1);
    expect(ana.floors[1]!.items[0]!.ttl).toBeCloseTo(FLOOR_WEAPON_TTL_S, 0);
    return f;
  }

  it("un arma soltada vence a los 40 s simulados y se reenvía la lista vacía", async () => {
    const ana = await join("Ana", "t-ana");
    await ana.welcome;
    const f = await withDrop(ana);
    // Se adelanta el reloj hasta 0,2 s antes del vencimiento: en el próximo tick aún está.
    room["floorTime"] = f.expiresAt - 0.2;
    await room.waitForNextTimestep();
    expect(record("ana").floorWeapons).toHaveLength(1);
    const sent = ana.floors.length;
    await ticksUntil(() => record("ana").floorWeapons.length === 0, 10);
    expect(room["floorTime"]).toBeGreaterThanOrEqual(f.expiresAt);
    await ticksUntil(() => ana.floors.length === sent + 1, 10);
    expect(ana.floors.at(-1)).toEqual({ items: [] });
    // Sin cambios no se reenvía.
    for (let i = 0; i < 3; i++) await room.waitForNextTimestep();
    expect(ana.floors).toHaveLength(sent + 1);
  });

  it("Foco 1: en la pausa no vence y al reanudar le queda lo mismo", async () => {
    const ana = await join("Ana", "t-ana");
    await ana.welcome;
    const f = await withDrop(ana);
    room["floorTime"] = f.expiresAt - 0.5;
    room["levelUp"].onLevelsGained(1, room["registry"].connected(), room["registry"].all());
    await ticksUntil(() => room.state.paused, 5);
    const left = f.expiresAt - room["floorTime"];
    expect(left).toBeGreaterThan(0);
    const sent = ana.floors.length;
    for (let i = 0; i < 30; i++) await room.waitForNextTimestep();
    expect(room.state.paused).toBe(true);
    expect(record("ana").floorWeapons).toEqual([f]);
    expect(f.expiresAt - room["floorTime"]).toBe(left);
    expect(ana.floors).toHaveLength(sent);

    await ticksUntil(() => ana.choices.length === 1, 10);
    ana.client.send(MSG.chooseCard, { offerId: ana.choices[0]!.offerId, index: 0 });
    await ticksUntil(() => !room.state.paused, 10);
    // Al reanudar vence tras los `left` segundos simulados que le quedaban.
    const resumedAt = room["floorTime"];
    await ticksUntil(() => record("ana").floorWeapons.length === 0, 30);
    expect(room["floorTime"] - resumedAt).toBeGreaterThanOrEqual(left - 0.04);
    await ticksUntil(() => ana.floors.length === sent + 1, 10);
    expect(ana.floors.at(-1)).toEqual({ items: [] });
  });
});

describe("RunRoom: escalado de enemigos", () => {
  it("Foco 2: con nivel de grupo 3 y 300 s los enemigos nuevos llegan al cliente con su maxHp escalado", async () => {
    const ana = await join("Ana", "t-ana");
    await ana.welcome;
    room["floorTime"] = 300;
    room["combat"].level = 3;
    const { hpMult } = enemyScale(300, 3);
    const { d, cr } = combatRoom();
    teleport("ana", roomSpawnPoints(d, cr.id, 1)[0]!);
    await ticksUntil(() => room["enemySystem"].enemies.length >= 4, 5);
    const enemies = room["enemySystem"].enemies;
    for (const e of enemies) expect(e.maxHp).toBe(Math.round(ENEMY_DEFS[e.kind].hp * hpMult));
    await ticksUntil(() => enemies.every((e) => ana.client.state.enemies?.get(e.id)?.maxHp === e.maxHp), 10);
  });
});

describe("RunRoom: efectos de las mejoras de stat", () => {
  /** Registra la carta y la atiende como el "applied" de LevelUpSystem. */
  const grant = (key: string, card: CardOffer) => {
    applyCard(record(key).progress, card);
    room["handleChoices"]([{ type: "applied", key, card }]);
  };
  const stat = (id: Extract<CardOffer, { kind: "stat" }>["id"]): CardOffer => ({ kind: "stat", id });

  it("Foco 4: con agility el servidor mueve PLAYER_SPEED × 1,08 × dt y sincroniza moveSpeedMult 1,08", async () => {
    const ana = await join("Ana", "t-ana");
    await ana.welcome;
    grant("ana", stat("agility"));
    expect(record("ana").combat.mods.moveSpeedMult).toBeCloseTo(1.08, 12);
    const x0 = player("ana").x;
    ana.client.send(MSG.input, input(1));
    await ticksUntil(() => player("ana").lastSeq === 1);
    expect(player("ana").x - x0).toBeCloseTo(PLAYER_SPEED * 1.08 * SIM_DT, 9);
    expect(player("ana").moveSpeedMult).toBeCloseTo(1.08, 12);
    expect(player("ana").attackSpeedMult).toBe(1);
    await ticksUntil(() => ana.client.state.players.get("ana")?.moveSpeedMult > 1, 10);
  });

  it("vitality sube 20 la vida máxima y cura 20; fury se sincroniza", async () => {
    const ana = await join("Ana", "t-ana");
    await ana.welcome;
    const base = record("ana").combat.maxHp;
    record("ana").combat.hp = 50;
    grant("ana", stat("vitality"));
    expect(record("ana").combat.maxHp).toBe(base + 20);
    expect(record("ana").combat.hp).toBe(70);
    grant("ana", stat("fury"));
    await room.waitForNextTimestep();
    expect(player("ana").maxHp).toBe(base + 20);
    expect(player("ana").attackSpeedMult).toBeCloseTo(1.1, 12);
  });

  it("haste sincroniza cooldownMult", async () => {
    const ana = await join("Ana", "t-ana");
    await ana.welcome;
    await room.waitForNextTimestep();
    expect(player("ana").cooldownMult).toBe(1);
    grant("ana", stat("haste"));
    await room.waitForNextTimestep();
    expect(player("ana").cooldownMult).toBeCloseTo(0.9, 12);
  });

  it("regenera BASE_REGEN por segundo fuera de la pausa y nada en la pausa", async () => {
    const ana = await join("Ana", "t-ana");
    await ana.welcome;
    const c = record("ana").combat;
    c.hp = 50;
    for (let i = 0; i < 30; i++) await room.waitForNextTimestep();
    expect(c.hp).toBeGreaterThan(50);
    expect(c.hp).toBeLessThanOrEqual(50 + BASE_REGEN * 1.2);
    room["levelUp"].onLevelsGained(1, room["registry"].connected(), room["registry"].all());
    await ticksUntil(() => room.state.paused, 5);
    const hp = c.hp;
    for (let i = 0; i < 30; i++) await room.waitForNextTimestep();
    expect(room.state.paused).toBe(true);
    expect(c.hp).toBe(hp);
  });

  it("con magnet 2 atrae un orbe a 5 m", async () => {
    const ana = await join("Ana", "t-ana");
    await ana.welcome;
    grant("ana", stat("magnet"));
    grant("ana", stat("magnet"));
    const me = record("ana").kinematic;
    room["orbs"].spawn(me.x, me.z, 1, room.state.tick);
    const orb = room["orbs"].orbs[0]!;
    orb.x = me.x;
    orb.z = me.z + 5;
    await room.waitForNextTimestep();
    await room.waitForNextTimestep();
    expect(Math.hypot(orb.x - me.x, orb.z - me.z)).toBeLessThan(5);
  });
});

describe("RunRoom: habilidades", () => {
  const grant = (key: string, card: CardOffer) => {
    applyCard(record(key).progress, card);
    room["handleChoices"]([{ type: "applied", key, card }]);
  };
  const keyInput = (seq: number, abilities: number) => ({ ...attackInput(seq, 0, room.state.tick), attack: false, abilities });

  it("la tecla 1 lanza la primera activa (la pasiva no ocupa casilla), avisa a todos y sincroniza las casillas", async () => {
    const ana = await join("Ana", "t-ana");
    await ana.welcome;
    const beto = await join("Beto", "t-beto");
    await beto.welcome;
    const seen = collect(beto.client);
    grant("ana", { kind: "ability", id: "cleave", rank: 1 });
    grant("ana", { kind: "ability", id: "whirlwind", rank: 1 });
    grant("ana", { kind: "ability", id: "block", rank: 2 });

    ana.client.send(MSG.input, keyInput(1, 1));
    await ticksUntil(() => player("ana").lastSeq === 1, 10);
    expect(record("ana").combat.abilityCd.whirlwind).toBeGreaterThan(7.9);
    await ticksUntil(() => seen.some((e) => e.type === "ability"), 10);
    expect(seen.find((e) => e.type === "ability")).toEqual({ type: "ability", key: "ana", id: "whirlwind" });

    await ticksUntil(() => beto.client.state.players.get("ana")?.abilities?.length === 2, 10);
    const synced = beto.client.state.players.get("ana");
    expect(synced.passiveRank).toBe(1);
    expect(synced.abilities[0].id).toBe("whirlwind");
    expect(synced.abilities[0].cooldown).toBeGreaterThan(7);
    expect(synced.abilities[1]).toMatchObject({ id: "block", rank: 2, cooldown: 0 });
  });

  it("los enfriamientos y el Grito no avanzan en la pausa", async () => {
    const ana = await join("Ana", "t-ana");
    await ana.welcome;
    grant("ana", { kind: "ability", id: "warcry", rank: 1 });
    ana.client.send(MSG.input, keyInput(1, 1));
    await ticksUntil(() => player("ana").lastSeq === 1, 10);
    const c = record("ana").combat;
    expect(c.buffDamage).toBe(0.25);
    room["levelUp"].onLevelsGained(1, room["registry"].connected(), room["registry"].all());
    await ticksUntil(() => room.state.paused, 5);
    const [cd, buff] = [c.abilityCd.warcry, c.buffLeft];
    for (let i = 0; i < 30; i++) await room.waitForNextTimestep();
    expect(c.abilityCd.warcry).toBe(cd);
    expect(c.buffLeft).toBe(buff);
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

describe("RunRoom: sandbox", () => {
  const sandboxRoom = async () => {
    await colyseus.cleanup();
    room = await colyseus.createRoom<RunRoom>("run", { seed: SEED, emptyRoomTtlMs: 200, sandbox: true });
    const ana = await join("Ana", "t-ana");
    return { ana, welcome: (await ana.welcome) as { key: string; sandbox: boolean } };
  };
  const dev = (client: ClientRoom, cmd: unknown) => client.send(MSG.dev, cmd);
  const settle = async (n = 3) => {
    for (let i = 0; i < n; i++) await room.waitForNextTimestep();
  };

  it("una sala normal avisa sandbox: false e ignora los comandos", async () => {
    const ana = await join("Ana", "t-ana");
    expect(await ana.welcome).toEqual({ key: "ana", sandbox: false });
    dev(ana.client, { cmd: "spawn", kind: "minion", count: 3, tier: 1 });
    dev(ana.client, { cmd: "levelUp", count: 2, choose: false });
    await settle();
    expect(room["enemySystem"].enemies).toHaveLength(0);
    expect(room.state.level).toBe(1);
  });

  it("en el sandbox no hay oleadas ni llenado de salas hasta encenderlas", async () => {
    const { ana, welcome } = await sandboxRoom();
    expect(welcome.sandbox).toBe(true);
    room["floorTime"] = 300;
    const { d, cr } = combatRoom();
    teleport("ana", roomSpawnPoints(d, cr.id, 1)[0]!);
    await settle(10);
    expect(room["enemySystem"].enemies).toHaveLength(0);
    dev(ana.client, { cmd: "waves", on: true });
    await ticksUntil(() => room["enemySystem"].enemies.length > 0, 10);
  });

  it("spawn crea enemigos armados con el tier pedido cerca del jugador, y killAll los mata sin orbes", async () => {
    const { ana } = await sandboxRoom();
    dev(ana.client, { cmd: "spawn", kind: "brute", count: 3, tier: 2 });
    dev(ana.client, { cmd: "spawn", kind: "mage", count: 1, tier: 3 });
    await ticksUntil(() => room["enemySystem"].enemies.length === 4, 10);
    const me = record("ana").kinematic;
    const [b1, b2, b3, mage] = room["enemySystem"].enemies;
    for (const e of [b1!, b2!, b3!]) {
      expect(e).toMatchObject({ kind: "brute", roomId: -1, loadout: { weaponId: "great-sword", tier: 2 } });
      expect(Math.hypot(e.x - me.x, e.z - me.z)).toBeLessThan(10);
    }
    expect(mage).toMatchObject({ kind: "mage", loadout: null });
    dev(ana.client, { cmd: "killAll" });
    await settle();
    expect(room["enemySystem"].enemies.every((e) => e.ai === "dead")).toBe(true);
    expect(room["orbs"].orbs).toHaveLength(0);
  });

  it("weapon con nature la sincroniza en el estado del jugador", async () => {
    const { ana } = await sandboxRoom();
    expect(player("ana").weaponNature).toBe("none");
    dev(ana.client, { cmd: "weapon", weaponId: "great-sword", tier: 3, nature: "ice" });
    await ticksUntil(() => player("ana").weaponNature === "ice", 10);
    expect(record("ana").combat).toMatchObject({ weaponId: "great-sword", weaponTier: 3, weaponNature: "ice" });
  });

  it("levelUp sin elegir sube niveles sin pausa; con elegir abre la elección con pausa", async () => {
    const { ana } = await sandboxRoom();
    dev(ana.client, { cmd: "levelUp", count: 3, choose: false });
    await settle();
    expect(room.state.level).toBe(4);
    expect(room.state.paused).toBe(false);
    expect(record("ana").pendingChoices).toBe(0);
    expect(ana.choices).toHaveLength(0);
    dev(ana.client, { cmd: "levelUp", count: 1, choose: true });
    await ticksUntil(() => room.state.paused && ana.choices.length === 1, 10);
    expect(room.state.level).toBe(5);
    // En la pausa se ignora (salvo los interruptores).
    dev(ana.client, { cmd: "levelUp", count: 1, choose: false });
    await settle();
    expect(room.state.level).toBe(5);
  });

  it("card da cartas y habilidades (sin pasar de 4 activas) y clearCards las quita", async () => {
    const { ana } = await sandboxRoom();
    for (const id of ["whirlwind", "kick", "warcry", "slam", "thrust"]) {
      dev(ana.client, { cmd: "card", card: { kind: "ability", id, rank: 3 } });
    }
    dev(ana.client, { cmd: "card", card: { kind: "ability", id: "cleave", rank: 2 } });
    dev(ana.client, { cmd: "card", card: { kind: "stat", id: "haste" } });
    await settle();
    const p = record("ana").progress;
    expect(p.abilities).toEqual([
      { id: "whirlwind", rank: 3 }, { id: "kick", rank: 3 }, { id: "warcry", rank: 3 }, { id: "slam", rank: 3 },
      { id: "cleave", rank: 2 },
    ]);
    expect(player("ana").cooldownMult).toBeCloseTo(0.9, 12);
    expect(player("ana").abilities.map((a) => a.id)).toEqual(["whirlwind", "kick", "warcry", "slam"]);

    dev(ana.client, { cmd: "clearCards" });
    await settle();
    expect(record("ana").progress).toEqual({ stats: {}, abilities: [] });
    expect(record("ana").combat.abilities).toHaveLength(0);
    expect(player("ana").cooldownMult).toBe(1);
  });

  it("god anula el daño recibido y noCooldown sincroniza el multiplicador del sandbox", async () => {
    const { ana } = await sandboxRoom();
    dev(ana.client, { cmd: "god", on: true });
    dev(ana.client, { cmd: "noCooldown", on: true });
    dev(ana.client, { cmd: "spawn", kind: "minion", count: 5, tier: 3 });
    await settle();
    expect(player("ana").cooldownMult).toBe(SANDBOX_COOLDOWN_MULT);
    const hp = player("ana").hp;
    for (let i = 0; i < 120; i++) await room.waitForNextTimestep();
    expect(player("ana").hp).toBe(hp);
    // Una carta después no borra los interruptores.
    dev(ana.client, { cmd: "card", card: { kind: "stat", id: "ironskin" } });
    await settle();
    expect(record("ana").combat.mods.damageTakenMult).toBe(0);
    dev(ana.client, { cmd: "god", on: false });
    await settle();
    expect(record("ana").combat.mods.damageTakenMult).toBeCloseTo(0.92, 12);
  });

  it("clock adelanta el reloj, weapon equipa el arma con su tier y los comandos inválidos se ignoran", async () => {
    const { ana } = await sandboxRoom();
    await settle();
    const t0 = room.state.floorTime;
    dev(ana.client, { cmd: "clock", seconds: 60 });
    dev(ana.client, { cmd: "weapon", weaponId: "great-sword", tier: 3 });
    dev(ana.client, { cmd: "weapon", weaponId: "axe", tier: 1 });
    dev(ana.client, { cmd: "clock", seconds: -60 });
    await settle();
    expect(room.state.floorTime - t0).toBeGreaterThanOrEqual(60);
    expect(room.state.floorTime - t0).toBeLessThan(61);
    expect(player("ana")).toMatchObject({ weaponId: "great-sword", weaponTier: 3 });
  });

  it("freeze + castNow: el piromante lanza una zona que llega al cliente y explota, y el bruto no se mueve", async () => {
    const { ana } = await sandboxRoom();
    dev(ana.client, { cmd: "god", on: true });
    dev(ana.client, { cmd: "freeze", on: true });
    dev(ana.client, { cmd: "spawn", kind: "pyromancer", count: 1, tier: 2 });
    dev(ana.client, { cmd: "spawn", kind: "brute", count: 1, tier: 0 });
    await ticksUntil(() => room["enemySystem"].enemies.length === 2, 10);
    const [pyro, brute] = room["enemySystem"].enemies;
    expect(pyro!.kind).toBe("pyromancer");
    const p0 = { x: pyro!.x, z: pyro!.z };
    const b0 = { x: brute!.x, z: brute!.z };
    for (let i = 0; i < 30; i++) await room.waitForNextTimestep();
    expect({ x: brute!.x, z: brute!.z }).toEqual(b0);
    expect(room.state.hazards.size).toBe(0);

    dev(ana.client, { cmd: "castNow" });
    await ticksUntil(() => room.state.hazards.size === 1, 10);
    const [h] = [...room.state.hazards.values()];
    expect(h).toMatchObject({ kind: "zone", phase: "warn" });
    await ticksUntil(() => ana.client.state.hazards.size === 1, 10);
    for (let i = 0; i < 30; i++) await room.waitForNextTimestep();
    expect({ x: pyro!.x, z: pyro!.z }).toEqual(p0);
    expect({ x: brute!.x, z: brute!.z }).toEqual(b0);
    await ticksUntil(() => room.state.hazards.size === 0, 60);
    await ticksUntil(() => ana.client.state.hazards.size === 0, 10);
    const es = [...room.state.enemies.values()].find((e) => e.kind === "pyromancer")!;
    expect(es.spellTier).toBe(2);
  });

  it("el rayo del invocador sincroniza su dirección al cliente mientras sigue al objetivo", async () => {
    const { ana } = await sandboxRoom();
    dev(ana.client, { cmd: "god", on: true });
    dev(ana.client, { cmd: "freeze", on: true });
    dev(ana.client, { cmd: "spawn", kind: "stormcaller", count: 1, tier: 1 });
    await ticksUntil(() => room["enemySystem"].enemies.length === 1, 10);
    dev(ana.client, { cmd: "castNow" });
    await ticksUntil(() => ana.client.state.hazards.size === 1, 10);
    const h = [...ana.client.state.hazards.values()][0]!;
    expect(h.kind).toBe("beam");
    const d0 = { x: h.dirX, z: h.dirZ };
    // El jugador se mueve en perpendicular al rayo mientras este lo sigue.
    const perp = Math.abs(d0.x) < Math.abs(d0.z) ? { moveX: 1, moveZ: 0 } : { moveX: 0, moveZ: 1 };
    let seq = 1;
    for (let i = 0; i < 10; i++) {
      ana.client.send(MSG.input, { seq: seq++, ...perp, facing: 0 });
      await room.waitForNextTimestep();
    }
    await settle();
    expect(room.state.hazards.get([...room.state.hazards.keys()][0]!)!.phase).toBe("warn");
    expect(Math.hypot(h.dirX - d0.x, h.dirZ - d0.z)).toBeGreaterThan(0.01);
  });

  it("pausa: una zona en aviso no avanza con la elección abierta y explota en el tiempo que le quedaba", async () => {
    const { ana } = await sandboxRoom();
    dev(ana.client, { cmd: "god", on: true });
    dev(ana.client, { cmd: "freeze", on: true });
    dev(ana.client, { cmd: "spawn", kind: "pyromancer", count: 1, tier: 1 });
    await ticksUntil(() => room["enemySystem"].enemies.length === 1, 10);
    dev(ana.client, { cmd: "castNow" });
    await ticksUntil(() => room.state.hazards.size === 1, 10);
    dev(ana.client, { cmd: "levelUp", count: 1, choose: true });
    await ticksUntil(() => room.state.paused && ana.choices.length === 1, 10);
    const h = [...room.state.hazards.values()][0]!;
    const left = h.left;
    for (let i = 0; i < 20; i++) await room.waitForNextTimestep();
    expect(room.state.hazards.size).toBe(1);
    expect(h.left).toBe(left);
    ana.client.send(MSG.chooseCard, { offerId: ana.choices[0]!.offerId, index: 0 });
    await ticksUntil(() => !room.state.paused, 10);
    expect(room.state.hazards.size).toBe(1);
    await ticksUntil(() => room.state.hazards.size === 0, Math.ceil(left * 30) + 10);
  });
});
