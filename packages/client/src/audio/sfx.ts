/** Volumen general (0 a 1) de los efectos, todos generados al vuelo: no hay archivos de sonido. */
const MASTER = 0.3;

/**
 * Efectos de sonido sintetizados con Web Audio. El navegador solo deja sonar tras un gesto del usuario:
 * `unlock()` se llama en el primer clic, toque o tecla. Sin audio disponible, no hace nada.
 */
export class Sfx {
  private ctx: AudioContext | undefined;
  private out: GainNode | undefined;
  private noise: AudioBuffer | undefined;
  muted = false;

  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    if (typeof AudioContext === "undefined") return;
    this.ctx = new AudioContext();
    this.out = this.ctx.createGain();
    this.out.gain.value = MASTER;
    this.out.connect(this.ctx.destination);
    // Un segundo de ruido blanco, la base de los soplidos y los chasquidos.
    this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    return this.muted;
  }

  /** Soplido de la espada al golpear; `volume` baja el de los compañeros. */
  swing(volume = 1): void {
    this.blow(0.16, 700, 2200, 0.22 * volume);
  }

  /** Golpe que conecta: un topetazo grave y un chasquido; `weight` (0 a 1) lo hace más grave y fuerte. */
  hit(weight: number): void {
    this.tone("sine", 190 - 50 * weight, 55, 0.13 + 0.08 * weight, 0.4 + 0.35 * weight);
    this.blow(0.05, 2600, 1800, 0.22 + 0.15 * weight);
  }

  /** Daño recibido. */
  hurt(): void {
    this.tone("sawtooth", 230, 95, 0.18, 0.28, 900);
  }

  /** Lanzamiento de una habilidad: soplido largo. */
  cast(): void {
    this.blow(0.32, 350, 1500, 0.26);
  }

  /** Impacto del Golpe sísmico: estampido grave. */
  boom(): void {
    this.tone("sine", 95, 32, 0.6, 0.9);
    this.blow(0.4, 500, 120, 0.5);
  }

  /** Subida de nivel: tres notas ascendentes. */
  levelUp(): void {
    [523, 659, 784].forEach((f, i) => this.tone("triangle", f, f, 0.45, 0.22, undefined, i * 0.09));
  }

  /** Oscilador de `from` a `to` Hz que se apaga en `durS`; con `lowpass`, filtrado. */
  private tone(type: OscillatorType, from: number, to: number, durS: number, gain: number, lowpass?: number, delayS = 0): void {
    const ctx = this.ctx;
    if (!ctx || !this.out || this.muted) return;
    const t = ctx.currentTime + delayS;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + durS);
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + durS);
    let tail: AudioNode = osc;
    if (lowpass) {
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = lowpass;
      osc.connect(f);
      tail = f;
    }
    tail.connect(env).connect(this.out);
    osc.start(t);
    osc.stop(t + durS + 0.02);
  }

  /** Ruido por un filtro pasabanda que barre de `from` a `to` Hz, con subida y caída suaves. */
  private blow(durS: number, from: number, to: number, gain: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.out || !this.noise || this.muted) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.Q.value = 1.1;
    band.frequency.setValueAtTime(from, t);
    band.frequency.exponentialRampToValueAtTime(to, t + durS);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.001, t);
    env.gain.linearRampToValueAtTime(gain, t + durS * 0.3);
    env.gain.exponentialRampToValueAtTime(0.001, t + durS);
    src.connect(band).connect(env).connect(this.out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + durS + 0.02);
  }

  dispose(): void {
    void this.ctx?.close();
    this.ctx = undefined;
  }
}
