import { describe, expect, it } from "vitest";
import type { KinematicState, WeaponId } from "@roguelike/shared";
import { newComboTimers, normalizeName } from "@roguelike/shared";
import { PlayerRegistry, pruneFloorWeapons } from "../src/rooms/PlayerRegistry";
import { newCombatState } from "../src/sim/CombatSystem";

const spawn = (): KinematicState => ({ x: 1, z: 2, facing: 0, y: 0, vy: 0 });

describe("normalizeName", () => {
  it("recorta, colapsa espacios y baja a minúsculas para la clave", () => {
    expect(normalizeName("  Ana   María_2 ")).toEqual({ display: "Ana María_2", key: "ana maría_2" });
  });
  it("rechaza vacío, solo espacios, largo, HTML y no-strings", () => {
    for (const bad of ["", "   ", "x".repeat(17), "<b>x</b>", 42, null, undefined]) {
      expect(normalizeName(bad)).toBeNull();
    }
  });
  it("normaliza a NFC: 'José' compuesto y descompuesto dan la misma clave", () => {
    const composed = normalizeName("Jos\u00e9");
    const decomposed = normalizeName("Jose\u0301");
    expect(composed).not.toBeNull();
    expect(decomposed).not.toBeNull();
    expect(decomposed?.key).toBe(composed?.key);
    expect(decomposed?.display).toBe(composed?.display);
  });
  it("acepta 16 caracteres", () => {
    expect(normalizeName("x".repeat(16))).not.toBeNull();
  });
});

describe("PlayerRegistry", () => {
  it("mismo nombre, otro token, conectado: name-taken", () => {
    const r = new PlayerRegistry();
    expect(r.join({ name: "Jorge", token: "t1", sessionId: "s1" }, spawn).ok).toBe(true);
    expect(r.join({ name: " jorge ", token: "t2", sessionId: "s2" }, spawn)).toEqual({ ok: false, code: "name-taken" });
  });

  it("mismo nombre y token: takeover conservando displayName", () => {
    const r = new PlayerRegistry();
    r.join({ name: "Jorge", token: "t1", sessionId: "s1" }, spawn);
    const res = r.join({ name: "JORGE", token: "t1", sessionId: "s2" }, spawn);
    expect(res.ok && res.kind).toBe("takeover");
    if (!res.ok) throw new Error();
    expect(res.replacedSessionId).toBe("s1");
    expect(res.record.displayName).toBe("Jorge");
    expect(res.record.sessionId).toBe("s2");
    expect(r.bySession("s1")).toBeUndefined();
    expect(r.size()).toBe(1);
  });

  it("takeover vacía la cola, reinicia lastSeq y reubica", () => {
    const r = new PlayerRegistry();
    const first = r.join({ name: "Jorge", token: "t1", sessionId: "s1" }, spawn);
    if (!first.ok) throw new Error();
    first.record.inputQueue.push({ seq: 5, moveX: 0, moveZ: 1, facing: 0, sprint: false, jump: false, attack: false, interact: false, abilities: 0, viewTick: 0 });
    first.record.lastSeq = 5;
    first.record.kinematic.x = 99;
    const res = r.join({ name: "Jorge", token: "t1", sessionId: "s2" }, spawn);
    if (!res.ok) throw new Error();
    expect(res.record.inputQueue).toEqual([]);
    expect(res.record.lastSeq).toBe(0);
    expect(res.record.kinematic.x).toBe(1);
  });

  it("un registro nuevo nace con el estado de combate dado; reconnect y takeover no lo tocan", () => {
    const r = new PlayerRegistry();
    const first = r.join({ name: "Jorge", token: "t1", sessionId: "s1" }, spawn, () => newCombatState("warrior", 3));
    if (!first.ok) throw new Error();
    const combat = first.record.combat;
    expect(combat.maxHp).toBe(newCombatState("warrior", 3).maxHp);
    combat.hp = 50;
    combat.dead = true;
    combat.respawnIn = 2.5;

    const taken = r.join({ name: "Jorge", token: "t1", sessionId: "s2" }, spawn, () => newCombatState("warrior", 1));
    if (!taken.ok) throw new Error();
    expect(taken.kind).toBe("takeover");
    expect(taken.record.combat).toBe(combat);

    r.leave("s2");
    const back = r.join({ name: "Jorge", token: "otro", sessionId: "s3" }, spawn, () => newCombatState("warrior", 1));
    if (!back.ok) throw new Error();
    expect(back.kind).toBe("reconnect");
    expect(back.record.combat).toBe(combat);
    expect(back.record.combat).toMatchObject({ hp: 50, dead: true, respawnIn: 2.5 });
  });

  it("reconnect y takeover vacían los golpes pendientes", () => {
    const r = new PlayerRegistry();
    const first = r.join({ name: "Jorge", token: "t1", sessionId: "s1" }, spawn);
    if (!first.ok) throw new Error();
    first.record.combat.pendingHits.push({ damage: 6, resolveTick: 100, sourceX: 0, sourceZ: 0 });
    const taken = r.join({ name: "Jorge", token: "t1", sessionId: "s2" }, spawn);
    if (!taken.ok) throw new Error();
    expect(taken.kind).toBe("takeover");
    expect(taken.record.combat.pendingHits).toEqual([]);

    taken.record.combat.pendingHits.push({ damage: 6, resolveTick: 200, sourceX: 0, sourceZ: 0 });
    r.leave("s2");
    const back = r.join({ name: "Jorge", token: "otro", sessionId: "s3" }, spawn);
    if (!back.ok) throw new Error();
    expect(back.kind).toBe("reconnect");
    expect(back.record.combat.pendingHits).toEqual([]);
  });

  it("reconnect y takeover reinician el combo (sin impacto pendiente) y conservan arma, vida y muerte", () => {
    const r = new PlayerRegistry();
    const first = r.join({ name: "Jorge", token: "t1", sessionId: "s1" }, spawn);
    if (!first.ok) throw new Error();
    const c = first.record.combat;
    const swingMidway = () => Object.assign(c, { comboStep: 2, swingTimer: 0.2, comboTimer: 0.8, impactTimer: 0.05, impactPending: true });
    Object.assign(c, { weaponId: "great-sword", hp: 40, dead: true, respawnIn: 2 });
    swingMidway();
    const taken = r.join({ name: "Jorge", token: "t1", sessionId: "s2" }, spawn);
    if (!taken.ok) throw new Error();
    expect(taken.kind).toBe("takeover");
    expect(c).toMatchObject({ ...newComboTimers(), weaponId: "great-sword", hp: 40, dead: true, respawnIn: 2 });

    swingMidway();
    r.leave("s2");
    const back = r.join({ name: "Jorge", token: "otro", sessionId: "s3" }, spawn);
    if (!back.ok) throw new Error();
    expect(back.kind).toBe("reconnect");
    expect(c).toMatchObject({ ...newComboTimers(), weaponId: "great-sword", hp: 40, dead: true, respawnIn: 2 });
  });

  it("las armas del suelo se crean una vez con el arma equipada y se conservan al volver", () => {
    const r = new PlayerRegistry();
    const seen: string[] = [];
    const floor = (equipped: WeaponId) => {
      seen.push(equipped);
      return [{ weaponId: "great-sword" as const, tier: 2 as const, nature: "none" as const, x: 3, z: 5, expiresAt: 40 }];
    };
    const first = r.join({ name: "Jorge", token: "t1", sessionId: "s1" }, spawn, undefined, floor);
    if (!first.ok) throw new Error();
    expect(seen).toEqual(["kingslayer-sword"]);
    expect(first.record.floorWeapons).toEqual([{ weaponId: "great-sword", tier: 2, nature: "none", x: 3, z: 5, expiresAt: 40 }]);
    first.record.floorWeapons[0] = { weaponId: "kingslayer-sword", tier: 3, nature: "none", x: 3, z: 5, expiresAt: 40 };

    const taken = r.join({ name: "Jorge", token: "t1", sessionId: "s2" }, spawn, undefined, floor);
    if (!taken.ok) throw new Error();
    r.leave("s2");
    const back = r.join({ name: "Jorge", token: "x", sessionId: "s3" }, spawn, undefined, floor);
    if (!back.ok) throw new Error();
    expect(seen).toEqual(["kingslayer-sword"]);
    expect(back.record.floorWeapons).toEqual([{ weaponId: "kingslayer-sword", tier: 3, nature: "none", x: 3, z: 5, expiresAt: 40 }]);
  });

  it("sin fábrica, un registro nuevo no tiene armas del suelo", () => {
    const r = new PlayerRegistry();
    const res = r.join({ name: "Jorge", token: "t1", sessionId: "s1" }, spawn);
    if (!res.ok) throw new Error();
    expect(res.record.floorWeapons).toEqual([]);
  });

  it("all() incluye a los desconectados", () => {
    const r = new PlayerRegistry();
    r.join({ name: "A", token: "a", sessionId: "sA" }, spawn);
    r.join({ name: "B", token: "b", sessionId: "sB" }, spawn);
    r.leave("sB");
    expect(r.all().map((x) => x.key).sort()).toEqual(["a", "b"]);
    expect(r.connected().map((x) => x.key)).toEqual(["a"]);
  });

  it("leave tardío del sessionId viejo tras un takeover no desconecta", () => {
    const r = new PlayerRegistry();
    r.join({ name: "Jorge", token: "t1", sessionId: "s1" }, spawn);
    r.join({ name: "Jorge", token: "t1", sessionId: "s2" }, spawn);
    expect(r.leave("s1")).toBeUndefined();
    expect(r.bySession("s2")?.sessionId).toBe("s2");
    expect(r.connected()).toHaveLength(1);
  });

  it("leave de sesión desconocida no cambia nada", () => {
    const r = new PlayerRegistry();
    r.join({ name: "Jorge", token: "t1", sessionId: "s1" }, spawn);
    expect(r.leave("nope")).toBeUndefined();
    expect(r.connected()).toHaveLength(1);
  });

  it("leave y join con otro token: reconnect con la misma key", () => {
    const r = new PlayerRegistry();
    const first = r.join({ name: "Jorge", token: "t1", sessionId: "s1" }, spawn);
    if (!first.ok) throw new Error();
    const left = r.leave("s1");
    expect(left?.sessionId).toBeNull();
    expect(r.connected()).toHaveLength(0);
    expect(r.size()).toBe(1);
    const res = r.join({ name: "jorge", token: "t2", sessionId: "s2" }, spawn);
    if (!res.ok) throw new Error();
    expect(res.kind).toBe("reconnect");
    expect(res.record.key).toBe(first.record.key);
    expect(res.record.token).toBe("t2");
    expect(r.connected()).toHaveLength(1);
  });

  it("token faltante o no string nunca hace takeover", () => {
    const r = new PlayerRegistry();
    r.join({ name: "Jorge", token: "t1", sessionId: "s1" }, spawn);
    expect(r.join({ name: "Jorge", token: undefined, sessionId: "s2" }, spawn)).toEqual({ ok: false, code: "name-taken" });
    expect(r.join({ name: "Jorge", token: "", sessionId: "s2" }, spawn)).toEqual({ ok: false, code: "name-taken" });
    r.leave("s1");
    const res = r.join({ name: "Jorge", token: 7, sessionId: "s3" }, spawn);
    expect(res.ok && res.kind).toBe("reconnect");
  });

  it("sala llena: nombre nuevo falla, el desconectado puede reconectar", () => {
    const r = new PlayerRegistry(4);
    for (const n of ["A", "B", "C", "D"]) r.join({ name: n, token: n, sessionId: `s${n}` }, spawn);
    r.leave("sD");
    expect(r.size()).toBe(4);
    expect(r.join({ name: "E", token: "E", sessionId: "sE" }, spawn)).toEqual({ ok: false, code: "room-full" });
    const res = r.join({ name: "D", token: "x", sessionId: "sD2" }, spawn);
    expect(res.ok && res.kind).toBe("reconnect");
  });

  it("nombre inválido: invalid-name", () => {
    const r = new PlayerRegistry();
    for (const bad of ["", "   ", "x".repeat(17), "<b>x</b>", 42]) {
      expect(r.join({ name: bad, token: "t", sessionId: "s" }, spawn)).toEqual({ ok: false, code: "invalid-name" });
    }
    expect(r.join({ name: "Ana María_2", token: "t", sessionId: "s" }, spawn).ok).toBe(true);
  });
});

describe("pruneFloorWeapons", () => {
  it("quita las vencidas (expiresAt ≤ floorTime) y dice si cambió la lista", () => {
    const r = new PlayerRegistry();
    const res = r.join({ name: "Ana", token: "t", sessionId: "s" }, spawn, undefined, () => [
      { weaponId: "great-sword", tier: 1, nature: "none", x: 0, z: 0, expiresAt: 40 },
      { weaponId: "guard-sword", tier: 1, nature: "none", x: 0, z: 0, expiresAt: 50 },
    ]);
    if (!res.ok) throw new Error();
    expect(pruneFloorWeapons(res.record, 39.9)).toBe(false);
    expect(res.record.floorWeapons).toHaveLength(2);
    expect(pruneFloorWeapons(res.record, 40)).toBe(true);
    expect(res.record.floorWeapons.map((f) => f.weaponId)).toEqual(["guard-sword"]);
    expect(pruneFloorWeapons(res.record, 45)).toBe(false);
  });
});
