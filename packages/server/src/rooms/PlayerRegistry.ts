import {
  MAX_PLAYERS,
  normalizeName,
  type JoinErrorCode,
  type KinematicState,
  type PlayerInput,
} from "@roguelike/shared";

export interface PlayerRecord {
  key: string;
  displayName: string;
  token: string;
  sessionId: string | null;
  kinematic: KinematicState;
  lastSeq: number;
  inputQueue: PlayerInput[];
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
    };
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

  size(): number {
    return this.records.size;
  }

  private attach(record: PlayerRecord, sessionId: string, spawn: () => KinematicState): void {
    record.sessionId = sessionId;
    record.kinematic = spawn();
    record.lastSeq = 0;
    record.inputQueue = [];
  }
}
