import { Engine } from "@babylonjs/core/Engines/engine";
import {
  generateDungeon,
  INTERP_DELAY_MS,
  SIM_DT,
  type KinematicState,
} from "@roguelike/shared";
import { InputState } from "./input/InputState";
import { attachBrowserInput } from "./input/browserInput";
import { connect, type GameConnection, type PlayerSnapshot } from "./net/connection";
import { parseLagParams } from "./net/LagSimulator";
import { Predictor } from "./net/Predictor";
import { SnapshotBuffer } from "./net/SnapshotBuffer";
import { createScene } from "./render/createScene";
import { buildDungeonMeshes } from "./render/dungeonMeshes";
import { CorrectionSmoother, lerpAngle, lerpSnapshot } from "./render/interpolation";
import { PlayerViews } from "./render/playerViews";
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

async function join(opts: { name: string; code?: string }): Promise<void> {
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
  const stop = startSession(conn);
  conn.onDisconnect((reason) => {
    stop();
    if (reason === "takeover") lobby.showLobby("Abriste el juego en otra pestaña");
    else lobby.showConnectionLost();
  });
}

/** Escena + bucle de tiempo fijo para una conexión. Devuelve la función que lo desarma todo. */
function startSession(conn: GameConnection): () => void {
  const dungeon = generateDungeon(conn.seed, conn.floor);
  const scene = createScene(engine);
  buildDungeonMeshes(scene, dungeon);
  const views = new PlayerViews(scene, conn.myKey);
  const camera = new ThirdPersonCamera(scene, canvas, dungeon);
  scene.activeCamera = camera.camera;
  const input = new InputState();
  const detachInput = attachBrowserInput(input, canvas);

  const remotes = new Map<string, SnapshotBuffer<PlayerSnapshot>>();
  const smoother = new CorrectionSmoother();
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
      } else if (!predictor || !prev) {
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

  const frame = () => {
    const now = performance.now();
    const dt = Math.min(MAX_FRAME_S, (now - lastFrame) / 1000);
    lastFrame = now;

    if (predictor && prev) {
      acc += dt;
      while (acc >= SIM_DT) {
        acc -= SIM_DT;
        const sampled = input.sample(++seq, camera.yaw);
        prev = predictor.current;
        predictor.applyLocal(sampled);
        conn.sendInput(sampled);
      }
      smoother.decay(dt);
      const a = acc / SIM_DT;
      const cur = predictor.current;
      const x = prev.x + (cur.x - prev.x) * a + smoother.x;
      const z = prev.z + (cur.z - prev.z) * a + smoother.z;
      views.place(conn.myKey, x, z, lerpAngle(prev.facing, cur.facing, a));
      camera.follow(x, z);
    }

    const renderAt = now - INTERP_DELAY_MS;
    for (const [key, buffer] of remotes) {
      const s = buffer.sample(renderAt);
      if (s) views.place(key, s.x, s.z, s.facing);
    }
    scene.render();
  };
  engine.runRenderLoop(frame);

  return () => {
    engine.stopRenderLoop(frame);
    detachInput();
    camera.dispose();
    views.dispose();
    scene.dispose();
  };
}
