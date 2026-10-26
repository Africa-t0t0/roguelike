import { TILE_SIZE, isWalkableTile, type Dungeon } from "@roguelike/shared";

/** Casillas (Chebyshev) que se descubren alrededor del jugador. */
export const REVEAL_RADIUS_TILES = 6;

/**
 * Qué casillas del piso ya vio el jugador: las que tuvo a ≤ REVEAL_RADIUS_TILES y, al entrar en una sala, la sala
 * entera. Solo casillas caminables; los muros se dibujan como borde de lo descubierto.
 */
export class FogOfWar {
  readonly seen: Uint8Array;
  /** casillas descubiertas en la última llamada a `reveal` (índice z*width+x) */
  readonly fresh: number[] = [];

  constructor(private readonly dungeon: Dungeon) {
    this.seen = new Uint8Array(dungeon.width * dungeon.height);
  }

  isSeen(tx: number, tz: number): boolean {
    const d = this.dungeon;
    return tx >= 0 && tz >= 0 && tx < d.width && tz < d.height && this.seen[tz * d.width + tx] === 1;
  }

  /** Descubre alrededor de la casilla (tx, tz). Devuelve true si apareció algo nuevo (ver `fresh`). */
  reveal(tx: number, tz: number): boolean {
    this.fresh.length = 0;
    const r = REVEAL_RADIUS_TILES;
    for (let z = tz - r; z <= tz + r; z++) for (let x = tx - r; x <= tx + r; x++) this.mark(x, z);
    const room = this.dungeon.rooms.find((m) => tx >= m.x && tx < m.x + m.w && tz >= m.z && tz < m.z + m.h);
    if (room) {
      for (let z = room.z; z < room.z + room.h; z++) for (let x = room.x; x < room.x + room.w; x++) this.mark(x, z);
    }
    return this.fresh.length > 0;
  }

  private mark(x: number, z: number): void {
    if (!isWalkableTile(this.dungeon, x, z)) return;
    const i = z * this.dungeon.width + x;
    if (this.seen[i]) return;
    this.seen[i] = 1;
    this.fresh.push(i);
  }
}

const PX_PER_TILE = 6; // en el lienzo del mapa completo
const VIEW_RADIUS_TILES = 13; // lo que cabe del centro al borde del círculo
const FLOOR = "rgba(150, 132, 104, 0.55)";
const EDGE = "rgba(214, 178, 112, 0.85)";

/** Cofre cerrado: rombo dorado intenso con borde oscuro (los aliados son puntos pálidos); abierto: gris. */
export function chestStyle(open: boolean): string {
  return open ? "#8a8a8a" : "#ffb000";
}

/**
 * Minimapa circular arriba a la derecha (canvas 2D), con el norte arriba: lo descubierto del piso, la flecha del
 * jugador según hacia dónde mira la cámara y los aliados como puntos dorados.
 */
export class Minimap {
  private readonly root = document.createElement("div");
  private readonly canvas = document.createElement("canvas");
  private readonly ctx: CanvasRenderingContext2D;
  private readonly map = document.createElement("canvas");
  private readonly mapCtx: CanvasRenderingContext2D;
  private readonly fog: FogOfWar;
  private lastTile = "";

  constructor(
    private readonly dungeon: Dungeon,
    parent: HTMLElement = document.body,
  ) {
    this.fog = new FogOfWar(dungeon);
    this.root.className = "minimap";
    const ring = document.createElement("div");
    ring.className = "minimap-ring";
    for (const [cls, label] of [["n", "N"], ["e", "E"], ["s", "S"], ["w", "O"]] as const) {
      const el = document.createElement("span");
      el.className = `minimap-card minimap-${cls}`;
      el.textContent = label;
      ring.append(el);
    }
    this.root.append(this.canvas, ring);
    parent.append(this.root);

    this.ctx = this.canvas.getContext("2d")!;
    this.map.width = dungeon.width * PX_PER_TILE;
    this.map.height = dungeon.height * PX_PER_TILE;
    this.mapCtx = this.map.getContext("2d")!;
  }

  /** `yaw` de la cámara (0 = norte = +Z). `allies` en metros. */
  render(me: { x: number; z: number }, yaw: number, allies: readonly { x: number; z: number }[], chests: readonly { x: number; z: number; open: boolean }[] = []): void {
    const tx = Math.floor(me.x / TILE_SIZE);
    const tz = Math.floor(me.z / TILE_SIZE);
    const key = `${tx},${tz}`;
    if (key !== this.lastTile) {
      this.lastTile = key;
      if (this.fog.reveal(tx, tz)) this.paint(this.fog.fresh);
    }

    const size = this.canvas.clientWidth;
    if (size === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const px = Math.round(size * dpr);
    if (this.canvas.width !== px) this.canvas.width = this.canvas.height = px;
    const ctx = this.ctx;
    const c = px / 2;
    const scale = c / (VIEW_RADIUS_TILES * PX_PER_TILE); // píxeles del lienzo por píxel del mapa
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, px, px);
    ctx.save();
    ctx.beginPath();
    ctx.arc(c, c, c, 0, Math.PI * 2);
    ctx.clip();
    // Norte (+Z) arriba: el mapa se voltea en vertical.
    const mx = (me.x / TILE_SIZE) * PX_PER_TILE;
    const mz = (me.z / TILE_SIZE) * PX_PER_TILE;
    ctx.setTransform(scale, 0, 0, -scale, c - mx * scale, c + mz * scale);
    ctx.drawImage(this.map, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#e8c67a";
    for (const a of allies) {
      const ax = c + ((a.x - me.x) / TILE_SIZE) * PX_PER_TILE * scale;
      const ay = c - ((a.z - me.z) / TILE_SIZE) * PX_PER_TILE * scale;
      ctx.beginPath();
      ctx.arc(ax, ay, 3 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const ch of chests) {
      // Solo los de casillas ya descubiertas: el mapa no revela dónde hay cofres sin explorar.
      if (!this.fog.isSeen(Math.floor(ch.x / TILE_SIZE), Math.floor(ch.z / TILE_SIZE))) continue;
      ctx.fillStyle = chestStyle(ch.open);
      const cx = c + ((ch.x - me.x) / TILE_SIZE) * PX_PER_TILE * scale;
      const cy = c - ((ch.z - me.z) / TILE_SIZE) * PX_PER_TILE * scale;
      const h = (ch.open ? 3 : 4.5) * dpr;
      ctx.beginPath();
      ctx.moveTo(cx, cy - h);
      ctx.lineTo(cx + h, cy);
      ctx.lineTo(cx, cy + h);
      ctx.lineTo(cx - h, cy);
      ctx.closePath();
      ctx.fill();
      ctx.lineWidth = 1.5 * dpr;
      ctx.strokeStyle = "rgba(20, 12, 4, 0.95)";
      ctx.stroke();
    }
    ctx.restore();
    // Flecha del jugador: apunta hacia donde mira la cámara (yaw 0 = arriba, π/2 = derecha).
    ctx.setTransform(1, 0, 0, 1, c, c);
    ctx.rotate(yaw);
    ctx.fillStyle = "#f3dfae";
    ctx.strokeStyle = "rgba(0, 0, 0, 0.7)";
    ctx.lineWidth = 1.5 * dpr;
    const s = 7 * dpr;
    ctx.beginPath();
    ctx.moveTo(0, -s);
    ctx.lineTo(s * 0.7, s * 0.8);
    ctx.lineTo(0, s * 0.35);
    ctx.lineTo(-s * 0.7, s * 0.8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  dispose(): void {
    this.root.remove();
  }

  /** Pinta en el mapa completo las casillas nuevas y el borde de muro que tocan. */
  private paint(fresh: readonly number[]): void {
    const w = this.dungeon.width;
    const ctx = this.mapCtx;
    ctx.fillStyle = FLOOR;
    for (const i of fresh) ctx.fillRect((i % w) * PX_PER_TILE, Math.floor(i / w) * PX_PER_TILE, PX_PER_TILE, PX_PER_TILE);
    ctx.fillStyle = EDGE;
    for (const i of fresh) {
      const x = i % w;
      const z = Math.floor(i / w);
      const X = x * PX_PER_TILE;
      const Z = z * PX_PER_TILE;
      if (!isWalkableTile(this.dungeon, x - 1, z)) ctx.fillRect(X, Z, 1, PX_PER_TILE);
      if (!isWalkableTile(this.dungeon, x + 1, z)) ctx.fillRect(X + PX_PER_TILE - 1, Z, 1, PX_PER_TILE);
      if (!isWalkableTile(this.dungeon, x, z - 1)) ctx.fillRect(X, Z, PX_PER_TILE, 1);
      if (!isWalkableTile(this.dungeon, x, z + 1)) ctx.fillRect(X, Z + PX_PER_TILE - 1, PX_PER_TILE, 1);
    }
  }
}
