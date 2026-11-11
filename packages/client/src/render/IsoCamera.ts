// PRUEBA DESECHABLE (spike): cámara fija desde arriba estilo Diablo. Se activa con ?cam=iso.
import { TargetCamera } from "@babylonjs/core/Cameras/targetCamera";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import "@babylonjs/core/Culling/ray";

const DEG = Math.PI / 180;
const DISTANCE = 26; // m, de partida: la rueda del ratón lo cambia
const PITCH = 58 * DEG; // hacia abajo, de partida (90° = cenital): Mayús + rueda lo cambia
const FOV = 0.5; // rad: estrecho, para aplanar la perspectiva
const FOG_AT_1M = 0.34; // densidad de niebla × distancia: se ve igual de lejos al alejar
const AIM_HEIGHT = 1; // m: altura del plano donde se proyecta el cursor (el pecho)
const SHAKE_FREQ = [83, 71, 97] as const;

/** Misma interfaz que `ThirdPersonCamera`; no gira (yaw 0: arriba en pantalla es +Z) y el ratón queda libre. */
export class IsoCamera {
  readonly yaw = 0;
  readonly camera: TargetCamera;
  pointerLockAllowed = false;
  private shakeState = { left: 0, durationS: 0, intensity: 0, phase: 0 };
  private mouse: { x: number; y: number } | undefined;
  private distance = DISTANCE;
  private pitch = PITCH;
  private readonly readout = document.createElement("div");
  private readonly onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const step = Math.sign(e.deltaY || e.deltaX); // en macOS, Mayús convierte la rueda en desplazamiento horizontal
    if (e.shiftKey) this.pitch = Math.min(88 * DEG, Math.max(30 * DEG, this.pitch + step * 2 * DEG));
    else this.distance = Math.min(60, Math.max(8, this.distance + step));
    this.applyTuning();
  };
  private readonly onMouseMove = (e: MouseEvent) => {
    const r = this.canvas.getBoundingClientRect();
    this.mouse = { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  constructor(
    private readonly scene: Scene,
    private readonly canvas: HTMLCanvasElement,
  ) {
    this.camera = new TargetCamera("iso", new Vector3(0, 10, -10), scene);
    this.camera.minZ = 0.5;
    this.camera.fov = FOV;
    this.readout.style.cssText = "position:fixed;left:8px;bottom:8px;z-index:50;font:12px monospace;color:#fff;background:#0008;padding:4px 6px;pointer-events:none";
    document.body.appendChild(this.readout);
    this.applyTuning();
    document.addEventListener("mousemove", this.onMouseMove);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
  }

  private applyTuning(): void {
    this.scene.fogDensity = FOG_AT_1M / this.distance;
    this.readout.textContent = `cámara: distancia ${this.distance} m · inclinación ${Math.round(this.pitch / DEG)}° (rueda / Mayús+rueda)`;
  }

  shake(durationS: number, intensity: number): void {
    const s = this.shakeState;
    const current = s.durationS > 0 ? s.intensity * (s.left / s.durationS) : 0;
    if (intensity < current) return;
    this.shakeState = { left: durationS, durationS, intensity, phase: s.phase };
  }

  follow(x: number, z: number, dtS = 0): void {
    const target = new Vector3(x, AIM_HEIGHT, z);
    this.camera.position.set(x, AIM_HEIGHT + Math.sin(this.pitch) * this.distance, z - Math.cos(this.pitch) * this.distance);
    this.camera.setTarget(target);
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

  /** Hacia dónde mira el héroe en (x, z): al punto del suelo bajo el cursor. Sin cursor aún, undefined. */
  aimFacing(x: number, z: number): number | undefined {
    if (!this.mouse) return undefined;
    const ray = this.scene.createPickingRay(this.mouse.x, this.mouse.y, Matrix.Identity(), this.camera);
    if (ray.direction.y >= 0) return undefined;
    const t = (AIM_HEIGHT - ray.origin.y) / ray.direction.y;
    const dx = ray.origin.x + ray.direction.x * t - x;
    const dz = ray.origin.z + ray.direction.z * t - z;
    return Math.hypot(dx, dz) < 0.05 ? undefined : Math.atan2(dx, dz);
  }

  dispose(): void {
    document.removeEventListener("mousemove", this.onMouseMove);
    this.canvas.removeEventListener("wheel", this.onWheel);
    this.readout.remove();
    this.camera.dispose();
  }
}
