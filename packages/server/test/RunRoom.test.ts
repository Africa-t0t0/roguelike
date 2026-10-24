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
  MAX_QUEUED_INPUTS,
  MSG,
  PLAYER_SPEED,
  PROTOCOL_VERSION,
  REWIND_MAX_TICKS,
  SIM_DT,
  TAKEOVER_CLOSE_CODE,
  TILE_SIZE,
  tileCenter,
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

async function join(name: string, token: string): Promise<{ client: ClientRoom; welcome: Promise<unknown> }> {
  const client = await colyseus.sdk.joinById(room.roomId, { name, token, version: PROTOCOL_VERSION });
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
  seq, moveX: 0, moveZ: 0, facing, dodge: false, sprint: false, jump: false, attack: true, viewTick,
});

describe("RunRoom: combate", () => {
  it("rechaza una versión de protocolo distinta con 4104", async () => {
    expect(PROTOCOL_VERSION).toBe(3); // 3: los daños a enemigos llevan sourceKey
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
