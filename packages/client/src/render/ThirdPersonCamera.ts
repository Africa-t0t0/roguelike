import { TargetCamera } from "@babylonjs/core/Cameras/targetCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import { isWalkableTile, TILE_SIZE, type Dungeon } from "@roguelike/shared";
import { WALL_HEIGHT } from "./dungeonMeshes";

const DISTANCE = 6; // m
const PIVOT_HEIGHT = 1.5; // m sobre los pies
const SHOULDER = 0.6; // m a la derecha
const PITCH_MIN = -0.2;
const PITCH_MAX = 1.0;
const DEFAULT_PITCH = 0.25; // ≈ 3 m de altura a 6 m de distancia
const SENSITIVITY = 0.0025; // rad por píxel
const RAY_STEP = 0.1; // m
const WALL_MARGIN = 0.3; // m antes del muro
/** frecuencias (rad/s) del temblor por eje: distintas para que no se vea periódico */
const SHAKE_FREQ = [83, 71, 97] as const;

/** Cámara detrás del hombro. Con yaw 0 mira hacia +Z; el mouse controla yaw y pitch con pointer lock. */
export class ThirdPersonCamera {
  yaw = 0;
  pitch = DEFAULT_PITCH;
  readonly camera: TargetCamera;
  /** false mientras un panel (p. ej. el de cartas) necesita el puntero libre: el clic no lo captura. */
  pointerLockAllowed = true;
  // requestPointerLock puede rechazar (p. ej. clic justo después de soltar con Esc): se reintenta al próximo clic.
  /** temblor en curso: segundos que le quedan, su duración e intensidad (m) y su fase (s) */
  private shakeState = { left: 0, durationS: 0, intensity: 0, phase: 0 };
  private readonly onClick = () => {
    if (!this.pointerLockAllowed) return;
    void Promise.resolve(this.canvas.requestPointerLock()).catch(() => undefined);
  };
  private readonly onMouseMove = (e: MouseEvent) => {
    if (document.pointerLockElement !== this.canvas) return;
    this.yaw += e.movementX * SENSITIVITY;
    this.pitch = Math.min(PITCH_MAX, Math.max(PITCH_MIN, this.pitch + e.movementY * SENSITIVITY));
  };

  constructor(
    scene: Scene,
    private readonly canvas: HTMLCanvasElement,
    private readonly dungeon: Dungeon,
  ) {
    this.camera = new TargetCamera("thirdPerson", new Vector3(0, 5, -5), scene);
    this.camera.minZ = 0.1;
    canvas.addEventListener("click", this.onClick);
    document.addEventListener("mousemove", this.onMouseMove);
  }

  /**
   * Hace temblar la cámara `durationS` segundos con `intensity` metros que decaen hasta 0. Solo desplaza la
   * posición: no toca el yaw ni el pitch (los del input). Si ya temblaba, se queda con el más fuerte.
   */
  shake(durationS: number, intensity: number): void {
    const s = this.shakeState;
    const current = s.durationS > 0 ? s.intensity * (s.left / s.durationS) : 0;
    if (intensity < current) return;
    this.shakeState = { left: durationS, durationS, intensity, phase: s.phase };
  }

  /**
   * Coloca la cámara siguiendo al jugador en (x, z). `dtS`: tiempo de juego del cuadro, con el que decae el
   * temblor (0 en la pausa: queda quieto).
   */
  follow(x: number, z: number, dtS = 0): void {
    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);
    // Pivote sobre el hombro derecho; la derecha de la cámara es (cos yaw, −sin yaw).
    let pivot = new Vector3(x + cosY * SHOULDER, PIVOT_HEIGHT, z - sinY * SHOULDER);
    // Pegado a un muro por la derecha, el hombro quedaría dentro: se centra sobre el jugador.
    if (!this.walkableAt(pivot.x, pivot.z)) pivot = new Vector3(x, PIVOT_HEIGHT, z);
    const back = new Vector3(-sinY * Math.cos(this.pitch), Math.sin(this.pitch), -cosY * Math.cos(this.pitch));
    const dist = this.clearDistance(pivot, back);
    this.camera.position.copyFrom(pivot.add(back.scale(dist)));
    this.camera.setTarget(pivot);
    this.applyShake(dtS);
  }

  /** Desplaza la posición (no el objetivo) según el temblor, que decae linealmente con `dtS`. */
  private applyShake(dtS: number): void {
    const s = this.shakeState;
    if (s.left <= 0) return;
    s.left = Math.max(0, s.left - dtS);
    s.phase += dtS;
    const amp = s.intensity * (s.left / s.durationS);
    const [fx, fy, fz] = SHAKE_FREQ;
    this.camera.position.x += amp * Math.sin(s.phase * fx);
    this.camera.position.y += amp * Math.sin(s.phase * fy + 1.3);
    this.camera.position.z += amp * Math.sin(s.phase * fz + 2.1);
  }

  dispose(): void {
    this.canvas.removeEventListener("click", this.onClick);
    document.removeEventListener("mousemove", this.onMouseMove);
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.camera.dispose();
  }

  /** Raycast en la grilla: acorta la distancia si un muro queda entre el pivote y la cámara. */
  private clearDistance(from: Vector3, dir: Vector3): number {
    for (let t = RAY_STEP; t <= DISTANCE; t += RAY_STEP) {
      const y = from.y + dir.y * t;
      if (y >= WALL_HEIGHT) break; // por encima de los muros no hay con qué chocar
      if (!this.walkableAt(from.x + dir.x * t, from.z + dir.z * t)) return Math.max(RAY_STEP, t - WALL_MARGIN);
    }
    return DISTANCE;
  }

  private walkableAt(x: number, z: number): boolean {
    return isWalkableTile(this.dungeon, Math.floor(x / TILE_SIZE), Math.floor(z / TILE_SIZE));
  }
}
