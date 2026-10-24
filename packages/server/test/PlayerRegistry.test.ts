import { describe, expect, it } from "vitest";
import type { KinematicState } from "@roguelike/shared";
import { normalizeName } from "@roguelike/shared";
import { PlayerRegistry } from "../src/rooms/PlayerRegistry";

const spawn = (): KinematicState => ({ x: 1, z: 2, facing: 0, dodgeTime: 0, dodgeCooldown: 0, dodgeDirX: 0, dodgeDirZ: 0, y: 0, vy: 0 });

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
    first.record.inputQueue.push({ seq: 5, moveX: 0, moveZ: 1, facing: 0, dodge: false, sprint: false, jump: false });
    first.record.lastSeq = 5;
    first.record.kinematic.x = 99;
    const res = r.join({ name: "Jorge", token: "t1", sessionId: "s2" }, spawn);
    if (!res.ok) throw new Error();
    expect(res.record.inputQueue).toEqual([]);
    expect(res.record.lastSeq).toBe(0);
    expect(res.record.kinematic.x).toBe(1);
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
