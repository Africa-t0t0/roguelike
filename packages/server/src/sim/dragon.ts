import { DRAGON, ENEMY_DEFS, inArc, PLAYER_RADIUS, type DragonMove, type Dungeon } from "@roguelike/shared";
import { beamLength, inBeam, type Hazard } from "./hazards";

/** Estado del jefe dentro de su `Enemy`: qué ataque hace y en qué tramo va. */
export interface BossState {
  move: DragonMove | null;
  /** aviso en el suelo, el ataque en curso (lanzallamas quemando, vuelo) o el aterrizaje */
  stage: "warn" | "act" | "land";
  stageLeft: number;
  /** ataques especiales hechos (lanzallamas y pasadas); cada `everyNth` toca pasada */
  specials: number;
  enraged: boolean;
  /** volando en la pasada: no recibe daño */
  airborne: boolean;
  /** segundos de entrada antes de empezar a atacar */
  intro: number;
  /** peligros vivos de su ataque en curso (sin las franjas de fuego, que siguen solas) */
  hazardIds: string[];
  /** pasada en llamas: dirección, largo del vuelo y lo recorrido */
  flight: { dirX: number; dirZ: number; length: number; travelled: number } | null;
  /** lanzallamas: segundos hasta el siguiente pulso de daño y hasta dónde llega (lo cortan los muros) */
  tickLeft: number;
  flameRange: number;
  /** del piso (`dragonFloorScale`): divide sus tiempos y multiplica su paso */
  tempo: number;
  /** del piso: fracción del daño recibido que ignora */
  armor: number;
}

export function newBossState(scale: { tempo: number; armor: number } = { tempo: 1, armor: 0 }): BossState {
  return {
    move: null, stage: "warn", stageLeft: 0, specials: 0, enraged: false, airborne: false, intro: DRAGON.introS, hazardIds: [], flight: null,
    tickLeft: 0, flameRange: DRAGON.flame.range, tempo: scale.tempo, armor: scale.armor,
  };
}

/** Lo que el cerebro necesita del cuerpo del dragón y del mundo (EnemySystem lo da). */
export interface DragonBody {
  id: string;
  x: number;
  z: number;
  facing: number;
  hp: number;
  maxHp: number;
  damageMult: number;
  slowFrac: number;
  cooldown: number;
  boss: BossState;
}

export interface DragonPlayer {
  key: string;
  x: number;
  z: number;
}

/** Un golpe del dragón a un jugador (`push`: metros que lo aparta, alejándolo del dragón). */
export interface DragonHit {
  targetKey: string;
  damage: number;
  sourceX: number;
  sourceZ: number;
  burnDps?: number;
  push?: number;
}

export interface DragonWorld {
  dungeon: Dungeon;
  addHazard(h: Omit<Hazard, "id">): string;
  removeHazard(id: string): void;
  hazard(id: string): Hazard | undefined;
  /** mueve al dragón contra los muros */
  move(dirX: number, dirZ: number, len: number): void;
  /** lo pone en (x, z) sin chocar (la pasada vuela por encima de todo) */
  place(x: number, z: number): void;
  setAnim(ai: "chase" | "telegraph" | "recover"): void;
  enraged(): void;
}

/** La pasada termina a esta distancia del muro, para que el cuerpo no quede dentro. */
const BODY_MARGIN_M = 1.7;

/** Multiplicador de los tiempos: el ritmo del piso y la furia. */
const timeMult = (b: BossState) => (b.enraged ? DRAGON.enrageTimeMult : 1) / b.tempo;

/** Elige el ataque según dónde están los jugadores: pisotón si lo rodean, zarpazo de cerca y si no, fuego. */
export function chooseMove(body: DragonBody, target: DragonPlayer, players: readonly DragonPlayer[]): DragonMove {
  const d = Math.hypot(target.x - body.x, target.z - body.z);
  const near = players.filter((p) => Math.hypot(p.x - body.x, p.z - body.z) <= DRAGON.stomp.triggerM);
  if (near.length >= DRAGON.stomp.minPlayers) return "stomp";
  if (d <= DRAGON.claw.triggerM) return "claw";
  const flybyTurn = body.boss.specials % DRAGON.flyby.everyNth === DRAGON.flyby.everyNth - 1;
  return flybyTurn || d > DRAGON.flame.triggerM ? "flyby" : "flame";
}

/**
 * Un tick del dragón: entrada, furia, persecución entre ataques y cada ataque con su aviso. Devuelve sus golpes
 * del tick. `target`: el jugador al que va (el más cercano); sin jugadores vivos solo espera.
 */
export function stepDragon(body: DragonBody, players: readonly DragonPlayer[], target: DragonPlayer | undefined, dt: number, world: DragonWorld): DragonHit[] {
  const b = body.boss;
  const hits: DragonHit[] = [];
  if (!b.enraged && body.hp <= body.maxHp * DRAGON.enrageFrac) {
    b.enraged = true;
    world.enraged();
  }
  if (b.intro > 0) {
    b.intro = Math.max(0, b.intro - dt);
    if (target) face(body, target);
    return hits;
  }
  if (b.move === null) {
    if (!target) return hits;
    face(body, target);
    const d = Math.hypot(target.x - body.x, target.z - body.z);
    if (body.cooldown > 0) {
      // Entre ataques camina hacia su objetivo, sin pegarse del todo.
      if (d > DRAGON.claw.triggerM * 0.8) world.move((target.x - body.x) / d, (target.z - body.z) / d, Math.min(d, ENEMY_DEFS.dragon.speed * b.tempo * (1 - body.slowFrac) * dt));
      return hits;
    }
    start(body, chooseMove(body, target, players), world);
    return hits;
  }
  b.stageLeft -= dt;
  switch (b.move) {
    case "claw":
      if (b.stageLeft <= 0) {
        for (const p of players) {
          if (inArc(body, { x: p.x, z: p.z, radius: PLAYER_RADIUS }, DRAGON.claw.range, DRAGON.claw.arcDeg)) {
            hits.push({ targetKey: p.key, damage: dmg(body, DRAGON.claw.damage), sourceX: body.x, sourceZ: body.z });
          }
        }
        finish(body, world);
      }
      break;
    case "stomp":
      if (b.stageLeft <= 0) {
        for (const p of players) {
          if (Math.hypot(p.x - body.x, p.z - body.z) <= DRAGON.stomp.radius + PLAYER_RADIUS) {
            hits.push({ targetKey: p.key, damage: dmg(body, DRAGON.stomp.damage), sourceX: body.x, sourceZ: body.z, push: DRAGON.stomp.pushM });
          }
        }
        finish(body, world);
      }
      break;
    case "flame":
      if (b.stage === "warn") {
        if (b.stageLeft > 0) break;
        b.stage = "act";
        b.stageLeft = DRAGON.flame.fireS;
        b.tickLeft = 0;
        for (const id of b.hazardIds) {
          const h = world.hazard(id);
          if (h) Object.assign(h, { phase: "fire", left: DRAGON.flame.fireS, total: DRAGON.flame.fireS });
        }
      }
      b.tickLeft -= dt;
      if (b.tickLeft <= 0) {
        b.tickLeft += DRAGON.flame.tickS;
        for (const p of players) {
          if (inArc(body, { x: p.x, z: p.z, radius: PLAYER_RADIUS }, b.flameRange, DRAGON.flame.arcDeg)) {
            hits.push({ targetKey: p.key, damage: dmg(body, DRAGON.flame.damage), sourceX: body.x, sourceZ: body.z, burnDps: DRAGON.flame.burnDps * body.damageMult });
          }
        }
      }
      if (b.stageLeft <= 0) finish(body, world);
      break;
    case "flyby":
      stepFlyby(body, world, dt);
      break;
  }
  return hits;
}

/** Golpes de las franjas de fuego de la pasada: a pulsos, a quien pisa el tramo ya quemado. */
export function stripHits(h: Hazard, players: readonly DragonPlayer[]): DragonHit[] {
  const burnt = stripBurnt(h);
  const lit = { ...h, length: burnt };
  return players
    .filter(() => burnt > 0)
    .filter((p) => inBeam(lit, p.x, p.z, PLAYER_RADIUS))
    .map((p) => ({ targetKey: p.key, damage: h.damage, sourceX: p.x, sourceZ: p.z, burnDps: h.burnDps }));
}

/** Metros de franja ya quemados: avanza con el dragón desde que pasa a fuego (velocidad de vuelo). */
export function stripBurnt(h: Pick<Hazard, "phase" | "left" | "total" | "length">): number {
  if (h.phase !== "fire") return 0;
  return Math.min(h.length, (h.total - h.left) * DRAGON.flyby.speed);
}

function dmg(body: DragonBody, base: number): number {
  return Math.round(base * body.damageMult);
}

function face(body: DragonBody, p: DragonPlayer): void {
  const dx = p.x - body.x;
  const dz = p.z - body.z;
  if (Math.hypot(dx, dz) > 1e-6) body.facing = Math.atan2(dx, dz);
}

function start(body: DragonBody, move: DragonMove, world: DragonWorld): void {
  const b = body.boss;
  const tm = timeMult(b);
  b.move = move;
  b.stage = "warn";
  b.hazardIds = [];
  const dirX = Math.sin(body.facing);
  const dirZ = Math.cos(body.facing);
  const base = { sourceId: body.id, x: body.x, z: body.z, dirX, dirZ, phase: "warn" as const };
  world.setAnim("telegraph");
  switch (move) {
    case "claw": {
      b.stageLeft = DRAGON.claw.warnS * tm;
      b.hazardIds.push(world.addHazard({ ...base, kind: "arc", length: DRAGON.claw.range, size: DRAGON.claw.arcDeg, damage: 0, left: b.stageLeft, total: b.stageLeft }));
      break;
    }
    case "stomp": {
      b.stageLeft = DRAGON.stomp.warnS * tm;
      b.hazardIds.push(world.addHazard({ ...base, kind: "ring", length: 0, size: DRAGON.stomp.radius, damage: 0, left: b.stageLeft, total: b.stageLeft }));
      break;
    }
    case "flame": {
      b.stageLeft = DRAGON.flame.warnS * tm;
      // El fuego no atraviesa los muros: llega hasta el primero que tenga delante.
      b.flameRange = beamLength(world.dungeon, body.x, body.z, dirX, dirZ, DRAGON.flame.range);
      b.hazardIds.push(world.addHazard({ ...base, kind: "cone", length: b.flameRange, size: DRAGON.flame.arcDeg, damage: 0, left: b.stageLeft, total: b.stageLeft }));
      break;
    }
    case "flyby": {
      b.stageLeft = DRAGON.flyby.takeoffS * tm;
      // Vuela a través del objetivo hasta el muro (o el largo máximo), sin meter el cuerpo en la pared.
      const reach = beamLength(world.dungeon, body.x, body.z, dirX, dirZ, DRAGON.flyby.maxLength);
      b.flight = { dirX, dirZ, length: Math.max(0, reach - BODY_MARGIN_M), travelled: 0 };
      const offsets = b.enraged ? [-DRAGON.flyby.enragedOffsetM, DRAGON.flyby.enragedOffsetM] : [0];
      for (const off of offsets) {
        b.hazardIds.push(world.addHazard({
          ...base, kind: "strip", x: body.x + dirZ * off, z: body.z - dirX * off, length: b.flight.length, size: DRAGON.flyby.width,
          damage: dmg(body, DRAGON.flyby.damage), burnDps: DRAGON.flame.burnDps * body.damageMult, left: b.stageLeft, total: b.stageLeft,
        }));
      }
      break;
    }
  }
}

function stepFlyby(body: DragonBody, world: DragonWorld, dt: number): void {
  const b = body.boss;
  const f = b.flight;
  if (!f) return finish(body, world);
  if (b.stage === "warn") {
    if (b.stageLeft > 0) return;
    // Despega: las franjas pasan a fuego y arden mientras vuela y `burnS` más.
    b.stage = "act";
    b.airborne = true;
    world.setAnim("recover");
    const burn = f.length / DRAGON.flyby.speed + DRAGON.flyby.burnS;
    for (const id of b.hazardIds) {
      const h = world.hazard(id);
      if (h) Object.assign(h, { phase: "fire", left: burn, total: burn, tickLeft: 0 });
    }
    // Las franjas siguen solas: ya no son parte del ataque en curso.
    b.hazardIds = [];
  }
  if (b.stage === "act") {
    const step = Math.min(DRAGON.flyby.speed * dt, f.length - f.travelled);
    f.travelled += step;
    world.place(body.x + f.dirX * step, body.z + f.dirZ * step);
    if (f.travelled >= f.length - 1e-6) {
      b.stage = "land";
      b.stageLeft = DRAGON.flyby.landS * timeMult(b);
      b.airborne = false;
      world.setAnim("telegraph");
    }
    return;
  }
  if (b.stageLeft <= 0) finish(body, world);
}

function finish(body: DragonBody, world: DragonWorld): void {
  const b = body.boss;
  for (const id of b.hazardIds) world.removeHazard(id);
  if (b.move === "flame" || b.move === "flyby") b.specials++;
  b.move = null;
  b.hazardIds = [];
  b.flight = null;
  b.airborne = false;
  body.cooldown = DRAGON.restS * timeMult(b);
  world.setAnim("chase");
}
