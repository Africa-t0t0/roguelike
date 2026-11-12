import { TargetCamera } from "@babylonjs/core/Cameras/targetCamera";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import "@babylonjs/core/Culling/ray";

const DISTANCE = 26; // m, de partida
const DISTANCE_MIN = 16;
const DISTANCE_MAX = 34;
const PITCH = (58 * Math.PI) / 180; // hacia abajo (90° sería cenital)
const FOV = 0.5; // rad: estrecho, para aplanar la perspectiva
const AIM_HEIGHT = 1; // m: altura del plano donde se proyecta el cursor (el pecho)
/** frecuencias (rad/s) del temblor por eje: distintas para que no se vea periódico */
const SHAKE_FREQ = [83, 71, 97] as const;

/**
 * Cámara fija desde arriba, estilo Diablo: sigue al jugador sin girar (arriba en pantalla es +Z), el ratón
 * queda libre y la rueda acerca o aleja.
 */
export class IsoCamera {
  /** Giro de la vista: siempre 0 (el movimiento y el minimapa son relativos a +Z). */
  readonly yaw = 0;
  readonly camera: TargetCamera;
  private distance = DISTANCE;
  /** temblor en curso: segundos que le quedan, su duración e intensidad (m) y su fase (s) */
  private shakeState = { left: 0, durationS: 0, intensity: 0, phase: 0 };
  /** cursor en píxeles del canvas; undefined hasta que se mueva */
  private mouse: { x: number; y: number } | undefined;
  // Con `pointermove`, no `mousemove`: Babylon cancela el `pointerdown` del canvas y, con el botón apretado, el
  // navegador deja de mandar `mousemove` hasta soltarlo (la puntería se quedaba clavada mientras se atacaba).
  private readonly onMouseMove = (e: PointerEvent) => {
    if (e.pointerType === "touch") return; // el toque apunta con los sticks
    const r = this.canvas.getBoundingClientRect();
    this.mouse = { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  private readonly onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.distance = Math.min(DISTANCE_MAX, Math.max(DISTANCE_MIN, this.distance + Math.sign(e.deltaY) * 2));
  };

  constructor(
    private readonly scene: Scene,
    private readonly canvas: HTMLCanvasElement,
  ) {
    this.camera = new TargetCamera("iso", new Vector3(0, 10, -10), scene);
    this.camera.minZ = 0.5;
    this.camera.fov = FOV;
    document.addEventListener("pointermove", this.onMouseMove);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
  }

  /**
   * Hace temblar la cámara `durationS` segundos con `intensity` metros que decaen hasta 0. Si ya temblaba,
   * se queda con el más fuerte.
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
    this.camera.position.set(x, AIM_HEIGHT + Math.sin(PITCH) * this.distance, z - Math.cos(PITCH) * this.distance);
    this.camera.setTarget(new Vector3(x, AIM_HEIGHT, z));
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

  /**
   * Punto del suelo bajo el cursor visto desde quien está en (x, z): hacia dónde queda (`facing`) y a cuántos
   * metros (`dist`). Sin cursor aún, undefined.
   */
  aim(x: number, z: number): { facing: number; dist: number } | undefined {
    if (!this.mouse) return undefined;
    const ray = this.scene.createPickingRay(this.mouse.x, this.mouse.y, Matrix.Identity(), this.camera);
    if (ray.direction.y >= 0) return undefined;
    const t = (AIM_HEIGHT - ray.origin.y) / ray.direction.y;
    const dx = ray.origin.x + ray.direction.x * t - x;
    const dz = ray.origin.z + ray.direction.z * t - z;
    const dist = Math.hypot(dx, dz);
    return dist < 0.05 ? undefined : { facing: Math.atan2(dx, dz), dist };
  }

  dispose(): void {
    document.removeEventListener("pointermove", this.onMouseMove);
    this.canvas.removeEventListener("wheel", this.onWheel);
    this.camera.dispose();
  }
}
