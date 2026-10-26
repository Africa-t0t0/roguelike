import {
  MAX_PLAYERS,
  newComboTimers,
  newProgress,
  normalizeName,
  type GearItem,
  type GearSlot,
  type RelicId,
  type JoinErrorCode,
  type KinematicState,
  type PlayerInput,
  type Progress,
  type Nature,
  type WeaponId,
  type WeaponTier,
} from "@roguelike/shared";
import { newCombatState, type CombatState } from "../sim/CombatSystem";

/** Posición y vencimiento comunes a todo objeto del suelo. */
interface FloorSpot {
  x: number;
  z: number;
  /** `floorTime` en que vence (tiempo simulado: se congela en la pausa) */
  expiresAt: number;
}

export type FloorWeapon = { kind: "weapon"; weaponId: WeaponId; tier: WeaponTier; nature: Nature } & FloorSpot;
export type FloorGear = { kind: "gear"; item: GearItem } & FloorSpot;
export type FloorRelic = { kind: "relic"; id: RelicId } & FloorSpot;

/** Objeto del suelo propio de un jugador (cada uno ve y toma solo los suyos): arma, pieza de equipo o reliquia. */
export type FloorItem = FloorWeapon | FloorGear | FloorRelic;

/** Quita del registro los objetos del suelo vencidos en `floorTime`; devuelve si quitó alguna. */
export function pruneFloorWeapons(record: PlayerRecord, floorTime: number): boolean {
  const keep = record.floorWeapons.filter((f) => f.expiresAt > floorTime);
  if (keep.length === record.floorWeapons.length) return false;
  record.floorWeapons = keep;
  return true;
}

export interface PlayerRecord {
  key: string;
  displayName: string;
  token: string;
  sessionId: string | null;
  kinematic: KinematicState;
  lastSeq: number;
  inputQueue: PlayerInput[];
  /**
   * Se crea una sola vez; attach() (reconnect/takeover) ni cura ni revive ni cambia el arma ni su tier: solo
   * vacía los golpes pendientes y reinicia el combo (ningún impacto sobrevive a una desconexión).
   */
  combat: CombatState;
  /** Se crean con el registro; reconnect y takeover las conservan. */
  floorWeapons: FloorItem[];
  /** Equipo puesto, por ranura; reconnect y takeover lo conservan. */
  gear: Partial<Record<GearSlot, GearItem>>;
  /** Reliquia puesta, si la tiene; reconnect y takeover la conservan. */
  relic: RelicId | null;
  /** Cartas y habilidades elegidas; reconnect y takeover las conservan. */
  progress: Progress;
  /** Elecciones de carta que le faltan (también se suman estando desconectado). */
  pendingChoices: number;
}

export type JoinResult =
  | { ok: true; kind: "new" | "reconnect" | "takeover"; record: PlayerRecord; replacedSessionId?: string }
  | { ok: false; code: JoinErrorCode };

export class PlayerRegistry {
  private readonly records = new Map<string, PlayerRecord>();

  constructor(private readonly maxPlayers: number = MAX_PLAYERS) {}

  join(
    opts: { name: unknown; token: unknown; sessionId: string },
    spawn: () => KinematicState,
    makeCombat: () => CombatState = () => newCombatState("warrior", 1),
    makeFloorWeapons: (equipped: WeaponId) => FloorItem[] = () => [],
  ): JoinResult {
    const name = normalizeName(opts.name);
    if (!name) return { ok: false, code: "invalid-name" };
    // Token ausente o inválido: no coincide con nadie (nunca takeover); se guarda "" que tampoco coincide.
    const token = typeof opts.token === "string" && opts.token.length > 0 ? opts.token : null;

    const existing = this.records.get(name.key);
    if (existing) {
      let replacedSessionId: string | undefined;
      let kind: "reconnect" | "takeover";
      if (existing.sessionId !== null) {
        if (token === null || existing.token !== token) return { ok: false, code: "name-taken" };
        kind = "takeover";
        replacedSessionId = existing.sessionId;
      } else {
        kind = "reconnect";
      }
      existing.token = token ?? "";
      this.attach(existing, opts.sessionId, spawn);
      return replacedSessionId === undefined
        ? { ok: true, kind, record: existing }
        : { ok: true, kind, record: existing, replacedSessionId };
    }

    if (this.records.size >= this.maxPlayers) return { ok: false, code: "room-full" };
    const record: PlayerRecord = {
      key: name.key,
      displayName: name.display,
      token: token ?? "",
      sessionId: null,
      kinematic: spawn(),
      lastSeq: 0,
      inputQueue: [],
      combat: makeCombat(),
      floorWeapons: [],
      gear: {},
      relic: null,
      progress: newProgress(),
      pendingChoices: 0,
    };
    record.floorWeapons = makeFloorWeapons(record.combat.weaponId);
    this.records.set(record.key, record);
    this.attach(record, opts.sessionId, spawn);
    return { ok: true, kind: "new", record };
  }

  leave(sessionId: string): PlayerRecord | undefined {
    const record = this.bySession(sessionId);
    if (!record) return undefined;
    record.sessionId = null;
    return record;
  }

  bySession(sessionId: string): PlayerRecord | undefined {
    for (const r of this.records.values()) if (r.sessionId === sessionId) return r;
    return undefined;
  }

  connected(): PlayerRecord[] {
    return [...this.records.values()].filter((r) => r.sessionId !== null);
  }

  /** Todos los registros, incluidos los desconectados. */
  all(): PlayerRecord[] {
    return [...this.records.values()];
  }

  size(): number {
    return this.records.size;
  }

  private attach(record: PlayerRecord, sessionId: string, spawn: () => KinematicState): void {
    record.sessionId = sessionId;
    record.kinematic = spawn();
    record.lastSeq = 0;
    record.inputQueue = [];
    // Al volver no caen golpes recibidos antes de irse.
    record.combat.pendingHits = [];
    Object.assign(record.combat, newComboTimers());
    // Tampoco sobreviven la animación de una habilidad ni el Bloqueo; los enfriamientos y el Grito sí.
    record.combat.abilityAnim = null;
    record.combat.heldMask = 0;
    record.combat.blocking = false;
  }
}
