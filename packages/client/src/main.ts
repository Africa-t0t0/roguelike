import { Engine } from "@babylonjs/core/Engines/engine";
import type { Scene } from "@babylonjs/core/scene";
import {
  generateDungeon,
  INTERP_DELAY_MS,
  JOIN_ERROR_STATUS,
  normalizeName,
  sanitizeInput,
  SIM_DT,
  type KinematicState,
} from "@roguelike/shared";
import { InputState } from "./input/InputState";
import { attachBrowserInput } from "./input/browserInput";
import { connect, type GameConnection, type PlayerSnapshot } from "./net/connection";
import { parseLagParams } from "./net/LagSimulator";
import { Predictor } from "./net/Predictor";
import { SnapshotBuffer } from "./net/SnapshotBuffer";
import { RecentHits } from "./render/animState";
import { loadAssets, type Assets } from "./render/assets";
import { createScene } from "./render/createScene";
import { buildDungeonMeshes } from "./render/dungeonMeshes";
import { EnemyViews } from "./render/enemyViews";
import { CorrectionSmoother, lerpAngle, lerpSnapshot } from "./render/interpolation";
import { PlayerViews } from "./render/playerViews";
import { ProjectileViews } from "./render/projectileViews";
import { ThirdPersonCamera } from "./render/ThirdPersonCamera";
import { joinErrorMessage } from "./ui/errors";
import { Lobby } from "./ui/lobby";

const MAX_FRAME_S = 0.25; // tras un tirón no se simulan más de ~7 pasos de golpe

const canvas = document.getElementById("game") as HTMLCanvasElement;
const engine = new Engine(canvas, true);
window.addEventListener("resize", () => engine.resize());
const lag = parseLagParams(location.search);

let lastJoin: { code: string; name: string } | undefined;
const lobby = new Lobby(
  { onCreate: (name) => void join({ name }), onJoin: (name, code) => void join({ name, code }) },
  () => void (lastJoin && join(lastJoin)),
);
lobby.showLobby();

/** Aviso mientras se cargan los modelos; solo DOM, encima del canvas. */
const loading = document.createElement("div");
loading.className = "panel";
loading.textContent = "Cargando…";
loading.style.textAlign = "center";
loading.hidden = true;
document.body.append(loading);

async function join(opts: { name: string; code?: string }): Promise<void> {
  // Mismo criterio que el servidor, sin tocarlo: así no queda viva una sala vacía por un nombre inválido.
  if (!normalizeName(opts.name)) {
    lobby.showLobby(joinErrorMessage({ code: JOIN_ERROR_STATUS["invalid-name"] }));
    return;
  }
  let conn: GameConnection;
  try {
    conn = await connect({ ...opts, lag });
  } catch (err) {
    lobby.showLobby(joinErrorMessage(err));
    return;
  }
  // Reconectar es volver a entrar con el mismo código, nombre y token.
  lastJoin = { code: conn.roomCode, name: opts.name };
  lobby.showGame(conn.roomCode);
  // Se escucha el corte antes de cargar: si llega durante la carga, la sesión no arranca.
  let stop: (() => void) | undefined;
  let gone = false;
  conn.onDisconnect((reason) => {
    gone = true;
    loading.hidden = true;
    stop?.();
    if (reason === "takeover") lobby.showLobby("Abriste el juego en otra pestaña");
    else lobby.showConnectionLost();
  });

  const scene = createScene(engine);
  let assets: Assets;
  loading.hidden = false;
  try {
    assets = await loadAssets(scene);
  } catch (err) {
    console.error(err);
    scene.dispose();
    if (!gone) {
      gone = true;
      conn.leave();
      loading.hidden = true;
      lobby.showLobby("No se pudieron cargar los modelos. Recarga la página.");
    }
    return;
  }
  if (gone) {
    scene.dispose();
    return;
  }
  loading.hidden = true;
  stop = startSession(conn, scene, assets);
}

/**
 * Mazmorra, vistas y bucle de tiempo fijo para una conexión, sobre una escena con los modelos ya
 * cargados. Devuelve la función que lo desarma todo.
 */
function startSession(conn: GameConnection, scene: Scene, assets: Assets): () => void {
  const dungeon = generateDungeon(conn.seed, conn.floor);
  const dungeonMeshes = buildDungeonMeshes(scene, dungeon, assets);
  const views = new PlayerViews(scene, assets);
  const enemies = new EnemyViews(scene, assets);
  const projectiles = new ProjectileViews(scene);
  const hits = new RecentHits();
  const camera = new ThirdPersonCamera(scene, canvas, dungeon);
  scene.activeCamera = camera.camera;
  const input = new InputState();
  const detachInput = attachBrowserInput(input, canvas);

  const remotes = new Map<string, SnapshotBuffer<PlayerSnapshot>>();
  const smoother = new CorrectionSmoother();
  let mine: PlayerSnapshot | undefined; // último estado del servidor para el propio jugador
  let predictor: Predictor | undefined;
  let prev: KinematicState | undefined; // estado antes del último paso, para dibujar entre pasos
  let seq = 0;
  let acc = 0;
  let lastFrame = performance.now();

  conn.onPlayers((players, receivedAt) => {
    views.sync(players);
    for (const [key, p] of players) {
      if (key !== conn.myKey) {
        let buffer = remotes.get(key);
        if (!buffer) remotes.set(key, (buffer = new SnapshotBuffer(lerpSnapshot)));
        buffer.push(receivedAt, p);
        continue;
      }
      mine = p;
      if (!predictor || !prev) {
        predictor = new Predictor(p, dungeon);
        prev = { ...p };
        seq = p.lastSeq; // el servidor descarta seq ≤ lastSeq
      } else {
        const before = predictor.current;
        const after = predictor.reconcile(p, p.lastSeq);
        smoother.correct(before, after);
        prev = { ...prev, x: prev.x + after.x - before.x, z: prev.z + after.z - before.z };
      }
    }
    for (const key of remotes.keys()) if (!players.has(key)) remotes.delete(key);
  });

  conn.onWorld((world, receivedAt) => {
    enemies.push(world, receivedAt);
    projectiles.push(world, receivedAt);
  });

  // Los eventos se marcan en el reloj de recepción; lo remoto se dibuja INTERP_DELAY_MS después.
  conn.onCombat((event) => {
    const now = performance.now();
    if (event.type === "swing") {
      if (event.key !== conn.myKey) views.swing(event.key, event.step, now);
    } else if (event.type === "damage") {
      hits.hit(`${event.targetKind}:${event.targetId}`, now);
    }
  });

  const frame = () => {
    const now = performance.now();
    const dt = Math.min(MAX_FRAME_S, (now - lastFrame) / 1000);
    lastFrame = now;

    if (predictor && prev) {
      acc += dt;
      while (acc >= SIM_DT) {
        acc -= SIM_DT;
        // Se predice y se envía lo mismo que el servidor va a simular (ya saneado).
        const sampled = sanitizeInput(input.sample(++seq, camera.yaw));
        if (!sampled) continue;
        prev = predictor.current;
        predictor.applyLocal(sampled);
        conn.sendInput(sampled);
      }
      smoother.decay(dt);
      const a = acc / SIM_DT;
      const cur = predictor.current;
      const x = prev.x + (cur.x - prev.x) * a + smoother.x;
      const z = prev.z + (cur.z - prev.z) * a + smoother.z;
      const y = prev.y + (cur.y - prev.y) * a;
      const pose = { x, y, z, facing: lerpAngle(prev.facing, cur.facing, a) };
      // La esquiva es predicha; el combo y la muerte, por ahora, vienen del servidor.
      const state = {
        dodgeTime: cur.dodgeTime,
        comboStep: mine?.comboStep ?? 0,
        swingTimer: mine?.swingTimer ?? 0,
        dead: mine?.dead ?? false,
      };
      views.render(conn.myKey, pose, state, hits.recently(`player:${conn.myKey}`, now), now, dt);
      // La cámara sigue solo en XZ: con saltos de ~1 m queda más estable.
      camera.follow(x, z);
    }

    const renderAt = now - INTERP_DELAY_MS;
    for (const [key, buffer] of remotes) {
      const s = buffer.sample(renderAt);
      if (s) views.render(key, s, s, hits.recently(`player:${key}`, renderAt), renderAt, dt);
    }
    enemies.render(renderAt, dt, (id) => hits.recently(`enemy:${id}`, renderAt));
    projectiles.render(renderAt);
    scene.render();
  };
  engine.runRenderLoop(frame);

  return () => {
    engine.stopRenderLoop(frame);
    detachInput();
    camera.dispose();
    views.dispose();
    enemies.dispose();
    projectiles.dispose();
    dungeonMeshes.dispose();
    scene.dispose();
  };
}
