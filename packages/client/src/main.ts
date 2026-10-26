import { Engine } from "@babylonjs/core/Engines/engine";
import type { Scene } from "@babylonjs/core/scene";
import {
  ABILITIES,
  BLOCK_MOVE_MULT,
  generateDungeon,
  INTERP_DELAY_MS,
  JOIN_ERROR_STATUS,
  normalizeName,
  sanitizeInput,
  startSeals,
  STARTING_WEAPON,
  type AbilityId,
  type GearItem,
  type GearSlot,
  type KinematicState,
} from "@roguelike/shared";
import { InputState, withoutActions } from "./input/InputState";
import { attachBrowserInput } from "./input/browserInput";
import { connect, parseFloorTimeStart, parseSandbox, type GameConnection, type PlayerSnapshot } from "./net/connection";
import { FixedStep } from "./net/fixedStep";
import { parseLagParams } from "./net/LagSimulator";
import { LocalAbility } from "./net/LocalAbility";
import { LocalCombo } from "./net/LocalCombo";
import { PauseClock } from "./net/pauseClock";
import { Predictor } from "./net/Predictor";
import { SnapshotBuffer } from "./net/SnapshotBuffer";
import { createTickClock } from "./net/tickClock";
import { AbilityFx, SLAM_SHAKE } from "./render/abilityFx";
import { RecentHits } from "./render/animState";
import { AnimLibrary } from "./render/animLibrary";
import { loadAssets, type Assets } from "./render/assets";
import { ChainFx } from "./render/chainFx";
import { ChestViews } from "./render/chestViews";
import { createScene } from "./render/createScene";
import { damageTiming } from "./render/damageTiming";
import { buildDungeonMeshes } from "./render/dungeonMeshes";
import { EnemyViews } from "./render/enemyViews";
import { FloorWeaponViews } from "./render/floorWeaponViews";
import { DamageNumbers, HurtFlash } from "./render/fx";
import { CorrectionSmoother, lerpAngle, lerpSnapshot } from "./render/interpolation";
import { createTorches } from "./render/lighting";
import { allClipIds } from "./render/looks";
import { OrbViews } from "./render/orbViews";
import { PlayerShotViews } from "./render/playerShotViews";
import { PlayerViews } from "./render/playerViews";
import { HazardViews } from "./render/hazardViews";
import { ProjectileViews } from "./render/projectileViews";
import { SealViews } from "./render/sealViews";
import { ThirdPersonCamera } from "./render/ThirdPersonCamera";
import { AbilityBar, abilityBarModel } from "./ui/abilityBar";
import { CardPanel } from "./ui/cardPanel";
import { joinErrorMessage } from "./ui/errors";
import { Compass } from "./ui/compass";
import { DevPanel } from "./ui/devPanel";
import { Hud } from "./ui/hud";
import { Minimap } from "./ui/minimap";
import { Lobby } from "./ui/lobby";

const MAX_FRAME_S = 0.25; // tras un tirón no se simulan más de ~7 pasos de golpe

const canvas = document.getElementById("game") as HTMLCanvasElement;
const engine = new Engine(canvas, true);
window.addEventListener("resize", () => engine.resize());
const lag = parseLagParams(location.search);
// Solo en desarrollo: crear la sala con el reloj del piso adelantado (`?floorTimeStart=300`).
const floorTimeStart = import.meta.env.DEV ? parseFloorTimeStart(location.search) : undefined;
// Solo en desarrollo: sala de pruebas con el panel de F2 (`?sandbox=1`).
const sandbox = import.meta.env.DEV && parseSandbox(location.search);

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
    conn = await connect({ ...opts, lag, floorTimeStart, sandbox });
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
  const torches = createTorches(scene, dungeon);
  const views = new PlayerViews(scene, assets, anims);
  const enemies = new EnemyViews(scene, assets, anims);
  const projectiles = new ProjectileViews(scene);
  const hazards = new HazardViews(scene);
  const seals = new SealViews(scene, startSeals(dungeon));
  const chests = new ChestViews(scene);
  const chainFx = new ChainFx(scene);
  const playerShots = new PlayerShotViews(scene);
  const floorWeapons = new FloorWeaponViews(scene, assets);
  const orbs = new OrbViews(scene);
  const abilityFx = new AbilityFx(scene);
  const hits = new RecentHits();
  const camera = new ThirdPersonCamera(scene, canvas, dungeon);
  scene.activeCamera = camera.camera;
  const input = new InputState();
  const browserInput = attachBrowserInput(input, canvas);
  const hud = new Hud();
  const abilityBar = new AbilityBar();
  const compass = new Compass();
  const minimap = new Minimap(dungeon);
  const allies: { x: number; z: number }[] = [];
  const damageNumbers = new DamageNumbers(scene, canvas);
  const hurtFlash = new HurtFlash();
  const tickClock = createTickClock(); // tick del servidor que se está viendo → viewTick
  const combo = new LocalCombo();
  const ability = new LocalAbility();
  // Pausa del grupo: el reloj de juego se detiene y con él la predicción, la interpolación y los efectos.
  const clock = new PauseClock();
  const steps = new FixedStep();
  const cardPanel = new CardPanel((index) => conn.chooseCard(index));
  const devPanel = conn.sandbox
    ? new DevPanel((cmd) => {
        // Lo que vacía los enfriamientos en el servidor también los vacía en la predicción.
        if (cmd.cmd === "heal" || cmd.cmd === "clearCards" || (cmd.cmd === "noCooldown" && cmd.on)) ability.resetCooldowns();
        conn.sendDev(cmd);
      })
    : undefined;
  let pause = { paused: false, pauseLeft: 0 };
  let group: { name: string; choosing: boolean }[] = [];
  let panelShown = false;

  const remotes = new Map<string, SnapshotBuffer<PlayerSnapshot>>();
  const smoother = new CorrectionSmoother();
  let mine: PlayerSnapshot | undefined; // último estado del servidor para el propio jugador
  let predictor: Predictor | undefined;
  let prev: KinematicState | undefined; // estado antes del último paso, para dibujar entre pasos
  // Margen tras la animación del Tajo frontal para que el impulso del servidor llegue (ida y vuelta) y se reconcilie.
  const DASH_WINDOW_MS = 600;
  let myGear: Partial<Record<GearSlot, GearItem>> = {}; // lo puesto y las habilidades propias, para el aviso de E
  let myAbilityIds: AbilityId[] = [];
  let lastThrustMs = -Infinity; // reloj de juego en que arrancó el último Tajo frontal propio
  let seq = 0;
  let lastFrame = performance.now();
  let frameNow = clock.now(lastFrame); // reloj de juego del cuadro en curso
  let chestList: { x: number; z: number; open: boolean }[] = []; // para el minimapa
  let lastPlayers = new Map<string, PlayerSnapshot>(); // para el rango de las habilidades de cada uno

  // Efectos de habilidad: una vez por lanzamiento, cuando su clip empieza a dibujarse (propia predicha o
  // ajena por evento), con la pose dibujada. Lo que ya lleve se descuenta del inicio: así el efecto queda
  // alineado con el clip también para los remotos, dibujados INTERP_DELAY_MS tarde.
  views.onAbilityStart = (key, id, pose, elapsedS) => {
    const rank = lastPlayers.get(key)?.abilities.find((a) => a.id === id)?.rank ?? 1;
    abilityFx.play(id, pose, rank, frameNow - elapsedS * 1000, lastPlayers.get(key)?.weaponNature ?? "none");
  };
  abilityFx.onSlamImpact = (x, z) => {
    const me = predictor?.current;
    if (me && Math.hypot(me.x - x, me.z - z) < SLAM_SHAKE.rangeM) camera.shake(SLAM_SHAKE.durationS, SLAM_SHAKE.intensity);
  };

  conn.onPlayers((players, receivedAt) => {
    views.sync(players);
    lastPlayers = players;
    group = [...players.values()].map((p) => ({ name: p.name, choosing: p.choosing }));
    // En la pausa los parches repiten las mismas posiciones: no se apilan en los buffers.
    const at = clock.now(receivedAt);
    for (const [key, p] of players) {
      if (key !== conn.myKey) {
        let buffer = remotes.get(key);
        if (!buffer) remotes.set(key, (buffer = new SnapshotBuffer(lerpSnapshot)));
        if (!clock.paused) buffer.push(at, p);
        continue;
      }
      mine = p;
      myGear = Object.fromEntries(Object.entries(p.gear).map(([slot, g]) => [slot, g.item]));
      myAbilityIds = p.abilities.map((a) => a.id);
      hud.setPlayer(p);
      ability.setLegendaries(Object.values(p.gear).flatMap((g) => (g.item.legendary ? [g.item.legendary] : [])));
      ability.setServer(p.abilities, clock.now(performance.now()));
      if (!predictor || !prev) {
        predictor = new Predictor(p, dungeon);
        prev = { ...p };
        seq = p.lastSeq; // el servidor descarta seq ≤ lastSeq
      } else {
        const before = predictor.current;
        const after = predictor.reconcile(p, p.lastSeq);
        // Tajo frontal con `thrustDash`: el servidor mueve ~3 m y el cliente no lo predice; si fue una habilidad propia
        // reciente, esa corrección se desliza (~0,15 s) en vez de teletransportar.
        const dashing = clock.now(performance.now()) - lastThrustMs < ABILITIES.thrust.animS * 1000 + DASH_WINDOW_MS;
        smoother.correct(before, after, dashing);
        prev = { ...prev, x: prev.x + after.x - before.x, z: prev.z + after.z - before.z };
      }
    }
    for (const key of remotes.keys()) if (!players.has(key)) remotes.delete(key);
  });

  conn.onFloorWeapons((items) => floorWeapons.set(items, clock.now(performance.now())));

  conn.onWorld((world, receivedAt) => {
    // El parche que abre la pausa trae el último tick simulado: ese sí se interpola. Los siguientes, no.
    const wasPaused = clock.paused;
    clock.setPaused(world.paused, receivedAt);
    // Congela los clips (foto fija); las vistas interpoladas se quedan quietas con el reloj de juego.
    scene.animationsEnabled = !world.paused;
    pause = { paused: world.paused, pauseLeft: world.pauseLeft };
    hud.setWorld(world);
    compass.setFloorTime(world.floorTime);
    compass.setStarted(world.started);
    seals.setStarted(world.started, clock.now(receivedAt));
    orbs.sync(world.orbs);
    if (wasPaused && world.paused) return;
    const at = clock.now(receivedAt);
    tickClock.push(at, world.tick);
    enemies.push(world, at);
    projectiles.push(world, at);
    hazards.push(world, at);
    chests.push(world, at);
    chestList = [...world.chests.values()];
    playerShots.push(world, at);
  });

  // La cuenta sin pausa es local, en tiempo real (el juego sigue).
  conn.onLevelChoice((choice) => cardPanel.open(choice, performance.now()));

  // Los eventos se marcan en el reloj de recepción; lo remoto se dibuja INTERP_DELAY_MS después.
  // Lo propio (daño recibido, golpes dados) se ve sin ese retardo.
  conn.onCombat((event) => {
    const now = clock.now(performance.now());
    if (event.type === "swing") {
      if (event.key !== conn.myKey) views.swing(event.key, event.step, now);
    } else if (event.type === "ability") {
      // La propia se predice al apretar la tecla; el evento solo cuenta si no se predijo.
      if (event.key === conn.myKey) ability.fromServer(event.id, now);
      else views.ability(event.key, event.id, now);
    } else if (event.type === "damage") {
      const t = damageTiming(event, conn.myKey, now);
      hits.hit(`${event.targetKind}:${event.targetId}`, t.hitAt);
      const height = event.targetKind === "enemy" ? enemies.heightOf(event.targetId) : undefined;
      damageNumbers.spawn(event.amount, event.x, event.z, event.targetKind, t.numberAt, height);
      if (t.hurtMe) hurtFlash.flash();
    } else if (event.type === "chain") {
      chainFx.play(event.points, now);
    } else if (event.type === "levelUp") {
      hud.levelUp(event.level);
    }
  });

  const frame = () => {
    const realNow = performance.now();
    const paused = clock.paused;
    // En la pausa el tiempo de juego no corre: dt 0 y `now` fijo (todo lo dibujado queda quieto).
    const now = clock.now(realNow);
    frameNow = now;
    const dt = paused ? 0 : Math.min(MAX_FRAME_S, (realNow - lastFrame) / 1000);
    lastFrame = realNow;

    // El panel de cartas necesita el puntero libre; se vuelve a capturar con un clic en el canvas al cerrarse.
    const shown = cardPanel.render(pause, group, mine?.choosing ?? false, realNow);
    if (shown && !panelShown) browserInput.releasePointer();
    camera.pointerLockAllowed = !shown;
    // Elección sin pausa: se sigue jugando (mover y atacar) con el puntero libre, solo no se gira la cámara.
    browserInput.attackWithoutLock = shown && !pause.paused;
    panelShown = shown;
    hud.setChoiceOpen(shown);

    if (predictor && prev) {
      // En la pausa no se predice ni se envía nada (seq queda igual; el servidor descarta lo que llegue y
      // confirma su seq). Lo que se apriete en ella se descarta; las teclas mantenidas siguen valiendo.
      if (paused) input.sample(seq, camera.yaw);
      for (let n = steps.advance(dt, paused); n > 0; n--) {
        // Se predice y se envía lo mismo que el servidor va a simular (ya saneado). Muerto, nada
        // de acciones (el servidor igual las ignora).
        const dead = mine?.dead ?? false;
        const raw = input.sample(++seq, camera.yaw, tickClock.sample(now - INTERP_DELAY_MS));
        // Aturdido tampoco ataca ni lanza habilidades (el servidor las ignora; no se predicen).
        const stunned = (mine?.stunLeft ?? 0) > 0;
        const sampled = sanitizeInput(dead ? withoutActions(raw) : raw);
        if (!sampled) continue;
        prev = predictor.current;
        // Como el servidor: se mueve con el Bloqueo del input anterior y luego se actualiza.
        const moveSpeedMult = mine?.moveSpeedMult ?? 1;
        const statusSpeedMult = mine?.statusSpeedMult ?? 1;
        predictor.setMoveMods({ speedMult: moveSpeedMult * statusSpeedMult * (ability.isBlocking ? BLOCK_MOVE_MULT : 1) });
        predictor.applyLocal(sampled);
        // El golpe y la habilidad propios arrancan su clip ya (como el servidor: tras moverse, el combo
        // avanza, luego la habilidad y al final el ataque); el daño lo decide él. Con el arma que dice el
        // servidor: al tomar otra, el combo local vuelve a empezar.
        const weaponId = mine?.weaponId ?? STARTING_WEAPON;
        combo.advance(weaponId);
        ability.setCooldownMult(mine?.cooldownMult ?? 1);
        if (ability.tick(sampled.abilities, { dead, stunned, swingTimer: combo.state().swingTimer }, now) === "thrust") lastThrustMs = now;
        combo.attack(sampled.attack, { dead: dead || stunned, locked: ability.locked() }, now, weaponId, mine?.attackSpeedMult ?? 1);
        conn.sendInput(sampled);
      }
      smoother.decay(dt);
      const a = steps.alpha;
      const cur = predictor.current;
      const x = prev.x + (cur.x - prev.x) * a + smoother.x;
      const z = prev.z + (cur.z - prev.z) * a + smoother.z;
      const y = prev.y + (cur.y - prev.y) * a;
      const pose = { x, y, z, facing: lerpAngle(prev.facing, cur.facing, a) };
      // El arranque del golpe es predicho; la muerte viene del servidor.
      const swing = combo.heroCombat({ comboStep: mine?.comboStep ?? 0, swingTimer: mine?.swingTimer ?? 0 }, now);
      const heroAbility = ability.heroAbility(now);
      const state = {
        ...swing,
        dead: mine?.dead ?? false,
        weaponId: mine?.weaponId ?? STARTING_WEAPON,
        weaponTier: mine?.weaponTier ?? 1,
        weaponNature: mine?.weaponNature ?? "none",
        blocking: ability.isBlocking,
        attackSpeedMult: mine?.attackSpeedMult ?? 1,
        ability: heroAbility,
        gear: mine?.gear,
        relic: mine?.relic,
      };
      views.render(conn.myKey, pose, state, hits.recently(`player:${conn.myKey}`, now), now, dt);
      // La cámara sigue solo en XZ: con saltos de ~1 m queda más estable.
      camera.follow(x, z, dt);
      torches.update(x, z, now);
      // El aviso sale con la posición predicha (la que ve el jugador); el servidor decide igual.
      const canPickUp = !(mine?.dead ?? true) && swing.swingTimer <= 0 && !heroAbility;
      floorWeapons.render(dt, { x: cur.x, z: cur.z, canPickUp, gear: myGear, abilities: myAbilityIds }, now, chestList);
    }

    const renderAt = now - INTERP_DELAY_MS;
    allies.length = 0;
    for (const [key, buffer] of remotes) {
      const s = buffer.sample(renderAt);
      if (!s) continue;
      views.render(key, s, s, hits.recently(`player:${key}`, renderAt), renderAt, dt);
      allies.push(s);
    }
    compass.render(camera.yaw);
    if (predictor) minimap.render(predictor.current, camera.yaw, allies, chestList);
    enemies.render(renderAt, dt, (id) => hits.recently(`enemy:${id}`, renderAt));
    projectiles.render(renderAt);
    hazards.render(renderAt);
    seals.render(now);
    chests.render(renderAt);
    chainFx.render(renderAt);
    playerShots.render(renderAt);
    // Enfriamientos con el reloj de juego (quietos en la pausa); el local manda al apretar la tecla.
    abilityBar.render(
      abilityBarModel(mine?.abilities ?? [], (id) => ability.cooldownLeft(id, now), ability.isBlocking, mine?.cooldownMult ?? 1, (id) => ability.chargesOf(id, now)),
      mine?.passiveRank ?? 0,
    );
    orbs.render(dt, now);
    abilityFx.setPaused(paused);
    views.setPaused(paused);
    enemies.setPaused(paused);
    floorWeapons.setPaused(paused);
    projectiles.setPaused(paused);
    hazards.setPaused(paused);
    seals.setPaused(paused);
    chests.setPaused(paused);
    abilityFx.update(now);
    scene.render();
    damageNumbers.render(now); // tras render: usa las matrices de cámara de este frame
  };
  engine.runRenderLoop(frame);

  return () => {
    engine.stopRenderLoop(frame);
    browserInput.detach();
    cardPanel.dispose();
    devPanel?.dispose();
    hud.dispose();
    abilityBar.dispose();
    compass.dispose();
    minimap.dispose();
    damageNumbers.dispose();
    hurtFlash.dispose();
    camera.dispose();
    views.dispose();
    enemies.dispose();
    projectiles.dispose();
    hazards.dispose();
    seals.dispose();
    chests.dispose();
    chainFx.dispose();
    playerShots.dispose();
    floorWeapons.dispose();
    orbs.dispose();
    abilityFx.dispose();
    torches.dispose();
    dungeonMeshes.dispose();
    scene.dispose();
  };
}
