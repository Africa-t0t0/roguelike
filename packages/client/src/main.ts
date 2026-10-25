import { Engine } from "@babylonjs/core/Engines/engine";
import type { Scene } from "@babylonjs/core/scene";
import {
  generateDungeon,
  INTERP_DELAY_MS,
  JOIN_ERROR_STATUS,
  normalizeName,
  sanitizeInput,
  SIM_DT,
  STARTING_WEAPON,
  type KinematicState,
} from "@roguelike/shared";
import { InputState, withoutActions } from "./input/InputState";
import { attachBrowserInput } from "./input/browserInput";
import { connect, type GameConnection, type PlayerSnapshot } from "./net/connection";
import { parseLagParams } from "./net/LagSimulator";
import { LocalCombo } from "./net/LocalCombo";
import { Predictor } from "./net/Predictor";
import { SnapshotBuffer } from "./net/SnapshotBuffer";
import { createTickClock } from "./net/tickClock";
import { RecentHits } from "./render/animState";
import { AnimLibrary } from "./render/animLibrary";
import { loadAssets, type Assets } from "./render/assets";
import { createScene } from "./render/createScene";
import { damageTiming } from "./render/damageTiming";
import { buildDungeonMeshes } from "./render/dungeonMeshes";
import { EnemyViews } from "./render/enemyViews";
import { FloorWeaponViews } from "./render/floorWeaponViews";
import { DamageNumbers, HurtFlash } from "./render/fx";
import { CorrectionSmoother, lerpAngle, lerpSnapshot } from "./render/interpolation";
import { allClipIds } from "./render/looks";
import { PlayerViews } from "./render/playerViews";
import { ProjectileViews } from "./render/projectileViews";
import { ThirdPersonCamera } from "./render/ThirdPersonCamera";
import { joinErrorMessage } from "./ui/errors";
import { Hud } from "./ui/hud";
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
  const anims = new AnimLibrary(scene);
  loading.hidden = false;
  try {
    [assets] = await Promise.all([loadAssets(scene), anims.load(allClipIds())]);
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
  stop = startSession(conn, scene, assets, anims);
}

/**
 * Mazmorra, vistas y bucle de tiempo fijo para una conexión, sobre una escena con los modelos y
 * las animaciones ya cargados. Devuelve la función que lo desarma todo.
 */
function startSession(conn: GameConnection, scene: Scene, assets: Assets, anims: AnimLibrary): () => void {
  const dungeon = generateDungeon(conn.seed, conn.floor);
  const dungeonMeshes = buildDungeonMeshes(scene, dungeon, assets);
  const views = new PlayerViews(scene, assets, anims);
  const enemies = new EnemyViews(scene, assets, anims);
  const projectiles = new ProjectileViews(scene);
  const floorWeapons = new FloorWeaponViews(scene, assets);
  const hits = new RecentHits();
  const camera = new ThirdPersonCamera(scene, canvas, dungeon);
  scene.activeCamera = camera.camera;
  const input = new InputState();
  const detachInput = attachBrowserInput(input, canvas);
  const hud = new Hud();
  const damageNumbers = new DamageNumbers(scene, canvas);
  const hurtFlash = new HurtFlash();
  const tickClock = createTickClock(); // tick del servidor que se está viendo → viewTick
  const combo = new LocalCombo();

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
      hud.setPlayer(p);
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

  conn.onFloorWeapons((items) => floorWeapons.set(items));

  conn.onWorld((world, receivedAt) => {
    tickClock.push(receivedAt, world.tick);
    hud.setWorld(world);
    enemies.push(world, receivedAt);
    projectiles.push(world, receivedAt);
  });

  // Los eventos se marcan en el reloj de recepción; lo remoto se dibuja INTERP_DELAY_MS después.
  // Lo propio (daño recibido, golpes dados) se ve sin ese retardo.
  conn.onCombat((event) => {
    const now = performance.now();
    if (event.type === "swing") {
      if (event.key !== conn.myKey) views.swing(event.key, event.step, now);
    } else if (event.type === "damage") {
      const t = damageTiming(event, conn.myKey, now);
      hits.hit(`${event.targetKind}:${event.targetId}`, t.hitAt);
      const height = event.targetKind === "enemy" ? enemies.heightOf(event.targetId) : undefined;
      damageNumbers.spawn(event.amount, event.x, event.z, event.targetKind, t.numberAt, height);
      if (t.hurtMe) hurtFlash.flash();
    } else if (event.type === "levelUp") {
      hud.levelUp(event.level);
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
        // Se predice y se envía lo mismo que el servidor va a simular (ya saneado). Muerto, nada
        // de acciones (el servidor igual las ignora).
        const dead = mine?.dead ?? false;
        const raw = input.sample(++seq, camera.yaw, tickClock.sample(now - INTERP_DELAY_MS));
        const sampled = sanitizeInput(dead ? withoutActions(raw) : raw);
        if (!sampled) continue;
        prev = predictor.current;
        predictor.applyLocal(sampled);
        // El golpe propio arranca su clip ya (como el servidor: tras moverse); el daño lo decide él.
        // Con el arma que dice el servidor: al tomar otra, el combo local vuelve a empezar.
        const weaponId = mine?.weaponId ?? STARTING_WEAPON;
        combo.tick(sampled.attack, { dead, dodging: predictor.current.dodgeTime > 0 }, now, weaponId);
        conn.sendInput(sampled);
      }
      smoother.decay(dt);
      const a = acc / SIM_DT;
      const cur = predictor.current;
      const x = prev.x + (cur.x - prev.x) * a + smoother.x;
      const z = prev.z + (cur.z - prev.z) * a + smoother.z;
      const y = prev.y + (cur.y - prev.y) * a;
      const pose = { x, y, z, facing: lerpAngle(prev.facing, cur.facing, a) };
      // La esquiva y el arranque del golpe son predichos; la muerte viene del servidor.
      const swing = combo.heroCombat({ comboStep: mine?.comboStep ?? 0, swingTimer: mine?.swingTimer ?? 0 }, now);
      const state = {
        dodgeTime: cur.dodgeTime,
        ...swing,
        dead: mine?.dead ?? false,
        weaponId: mine?.weaponId ?? STARTING_WEAPON,
      };
      views.render(conn.myKey, pose, state, hits.recently(`player:${conn.myKey}`, now), now, dt);
      // La cámara sigue solo en XZ: con saltos de ~1 m queda más estable.
      camera.follow(x, z);
      // El aviso sale con la posición predicha (la que ve el jugador); el servidor decide igual.
      floorWeapons.render(dt, { x: cur.x, z: cur.z, canPickUp: !(mine?.dead ?? true) && swing.swingTimer <= 0 });
    }

    const renderAt = now - INTERP_DELAY_MS;
    for (const [key, buffer] of remotes) {
      const s = buffer.sample(renderAt);
      if (s) views.render(key, s, s, hits.recently(`player:${key}`, renderAt), renderAt, dt);
    }
    enemies.render(renderAt, dt, (id) => hits.recently(`enemy:${id}`, renderAt));
    projectiles.render(renderAt);
    scene.render();
    damageNumbers.render(now); // tras render: usa las matrices de cámara de este frame
  };
  engine.runRenderLoop(frame);

  return () => {
    engine.stopRenderLoop(frame);
    detachInput();
    hud.dispose();
    damageNumbers.dispose();
    hurtFlash.dispose();
    camera.dispose();
    views.dispose();
    enemies.dispose();
    projectiles.dispose();
    floorWeapons.dispose();
    dungeonMeshes.dispose();
    scene.dispose();
  };
}
