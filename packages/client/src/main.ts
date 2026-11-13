import { Engine } from "@babylonjs/core/Engines/engine";
import type { Scene } from "@babylonjs/core/scene";
import {
  ABILITIES,
  deadInput,
  generateDungeon,
  INTERP_DELAY_MS,
  JOIN_ERROR_STATUS,
  normalizeName,
  sanitizeInput,
  startSeals,
  STARTING_WEAPON,
  SPELL_AIM_MAX_M,
  isRanged,
  isWalkableTile,
  MAGE_LEGENDARY,
  MOVESETS,
  strikeOf,
  TILE_SIZE,
  WEAPONS,
  type Nature,
  spellAimDist,
  LEAP_STEPS,
  leapLanding,
  leapSpeed,
  SLAM_IMPACT_S,
  SLAM_LEAP_MAX_M,
  SIM_DT,
  THRUST_DASH_S,
  type AbilityId,
  type ClassId,
  type DevCommand,
  type GearItem,
  type GearSlot,
  type KinematicState,
  type LegendaryId,
  roomCenterPoint,
  type TotemPhase,
} from "@roguelike/shared";
import { InputState } from "./input/InputState";
import { Sfx } from "./audio/sfx";
import { attachBrowserInput } from "./input/browserInput";
import { PadInput } from "./input/gamepad";
import { chooseAim } from "./input/sticks";
import { TouchControls } from "./input/touchSticks";
import { connect, parseFloorTimeStart, parseSandbox, type GameConnection, type PlayerSnapshot } from "./net/connection";
import { FixedStep } from "./net/fixedStep";
import { parseLagParams } from "./net/LagSimulator";
import { LocalAbility } from "./net/LocalAbility";
import { LocalCombo } from "./net/LocalCombo";
import { PauseClock } from "./net/pauseClock";
import { Predictor, type LeapMove } from "./net/Predictor";
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
import { ENEMY_BUFF_COLOR, EnemyViews } from "./render/enemyViews";
import { descendPrompt, FloorWeaponViews, WAKE_TOTEM_PROMPT } from "./render/floorWeaponViews";
import { BossHazardViews } from "./render/bossHazardViews";
import { DragonViews } from "./render/dragonViews";
import { TotemView } from "./render/totemView";
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
import { HitScale } from "./render/flinch";
import { BannerViews } from "./render/bannerViews";
import { SpellZoneViews } from "./render/spellZoneViews";
import { IsoCamera } from "./render/IsoCamera";
import { PLAYER_LOOK } from "./render/looks";
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

/** Al conectar un golpe propio: pausa del clip (ms) y temblor de cámara (m), del golpe más flojo al más pesado. */
const HIT_STOP_MS = { min: 30, max: 85 } as const;
const HIT_SHAKE = { durationS: 0.1, min: 0.01, max: 0.06 } as const;
/** Con mando o táctil y el stick derecho suelto, el Golpe sísmico salta esta fracción de su alcance. */
const STICK_LEAP_FRAC = 0.6;
/** Avisos del jefe (despierta, se enfurece, cae): más largos que el de subir de nivel. */
const BOSS_BANNER_MS = 2600;
/** El chispazo del golpe sale a esta fracción del alto del enemigo. */
const HIT_SPARK_HEIGHT = 0.6;

let lastJoin: { code: string; name: string; cls: ClassId } | undefined;
const lobby = new Lobby(
  { onCreate: (name, cls) => void join({ name, cls }), onJoin: (name, code, cls) => void join({ name, code, cls }) },
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

async function join(opts: { name: string; code?: string; cls: ClassId }): Promise<void> {
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
  lastJoin = { code: conn.roomCode, name: opts.name, cls: opts.cls };
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

  // Carga la escena y arranca la sesión; al bajar de piso se rehace entera con la mazmorra nueva.
  const boot = async (): Promise<void> => {
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
    loading.textContent = "Cargando…";
    stop = startSession(conn, scene, assets, anims, (floor) => {
      stop?.();
      stop = undefined;
      conn.detach();
      loading.textContent = `Bajando al piso ${floor}…`;
      void boot();
    });
  };
  await boot();
}

/**
 * Mazmorra, vistas y bucle de tiempo fijo para una conexión, sobre una escena con los modelos y
 * las animaciones ya cargados. Devuelve la función que lo desarma todo.
 */
function startSession(conn: GameConnection, scene: Scene, assets: Assets, anims: AnimLibrary, onFloor: (floor: number) => void): () => void {
  const dungeon = generateDungeon(conn.seed, conn.floor);
  const dungeonMeshes = buildDungeonMeshes(scene, dungeon, assets);
  const torches = createTorches(scene, dungeon);
  const views = new PlayerViews(scene, assets, anims);
  const enemies = new EnemyViews(scene, assets, anims);
  const projectiles = new ProjectileViews(scene);
  const hazards = new HazardViews(scene);
  const bossHazards = new BossHazardViews(scene);
  const dragons = new DragonViews(scene, assets, dungeon.floor);
  const totemAt = roomCenterPoint(dungeon, dungeon.bossRoomId);
  const totem = new TotemView(scene, totemAt.x, totemAt.z);
  let totemPhase: TotemPhase = "idle";
  const banners = new BannerViews(scene);
  const spellZones = new SpellZoneViews(scene);
  const seals = new SealViews(scene, startSeals(dungeon));
  const chests = new ChestViews(scene);
  const chainFx = new ChainFx(scene);
  const playerShots = new PlayerShotViews(scene);
  playerShots.myKey = conn.myKey;
  const floorWeapons = new FloorWeaponViews(scene, assets);
  const orbs = new OrbViews(scene);
  const abilityFx = new AbilityFx(scene);
  const hits = new RecentHits();
  const hitScale = new HitScale();
  const camera = new IsoCamera(scene, canvas);
  scene.activeCamera = camera.camera;
  const input = new InputState();
  const browserInput = attachBrowserInput(input, canvas);
  // Mando y pantalla táctil: mientras se usen, se apunta con el stick; al mover el ratón, vuelve el cursor.
  const pad = new PadInput(input);
  const touch = new TouchControls(input);
  let aimDevice: "mouse" | "stick" = "mouse";
  let lastAim = 0;
  let lastAimDist = 0;
  // Salto del Golpe sísmico propio en curso (se predice paso a paso, como lo mueve el servidor) y cuánto saltó
  // cada uno la última vez (el propio, predicho; los ajenos, por evento), para dibujar el efecto donde cae.
  // Los hechizos apuntados del mago guardan ahí mismo a cuántos metros caen.
  let leap: (LeapMove & { stepsLeft: number }) | undefined;
  const leapDists = new Map<string, number>();
  /** Hechizos cuyo efecto de lanzamiento se dibuja en el punto apuntado, no en el mago. */
  const AIMED_SPELLS: readonly AbilityId[] = ["frost", "mine", "meteors"];
  const onMouseAim = (e: PointerEvent) => {
    if (e.pointerType === "mouse") aimDevice = "mouse";
  };
  window.addEventListener("pointermove", onMouseAim);
  // Sonido: el navegador lo deja sonar desde el primer gesto; M lo silencia.
  const sfx = new Sfx();
  const onGesture = (e: Event) => {
    sfx.unlock();
    if (e instanceof KeyboardEvent && e.code === "KeyM" && !(e.target instanceof HTMLInputElement)) sfx.toggleMute();
  };
  window.addEventListener("pointerdown", onGesture);
  window.addEventListener("keydown", onGesture);
  const hud = new Hud();
  if (dungeon.floor > 1) hud.announce(`Piso ${dungeon.floor}`, BOSS_BANNER_MS);
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
  // Sala de pruebas: los mismos comandos del panel, desde la consola o un script (`__devCmd({ cmd: "heal" })`).
  if (conn.sandbox) (window as unknown as { __devCmd?: (cmd: DevCommand) => void }).__devCmd = (cmd) => conn.sendDev(cmd);
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
  let myLegendaries: LegendaryId[] = []; // efectos legendarios propios (cargas de habilidades, proyectiles del bastón)
  let lastDashMs = -Infinity; // reloj de juego en que arrancó el último retroceso del Remolino (`gustDash`) propio
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
    // El Golpe sísmico se dibuja donde va a caer el salto, no donde arranca.
    const aimed = leapDists.get(key) ?? 0;
    const at =
      id === "slam" ? { ...pose, ...leapLanding(dungeon, pose.x, pose.z, pose.facing, aimed) }
      : AIMED_SPELLS.includes(id) ? { ...pose, x: pose.x + Math.sin(pose.facing) * aimed, z: pose.z + Math.cos(pose.facing) * aimed }
      : pose;
    // El Torbellino gira mientras el jugador camina: su efecto va con él.
    const follow = id === "whirlwind" ? () => drawnPoses.get(key) : undefined;
    abilityFx.play(id, at, rank, frameNow - elapsedS * 1000, lastPlayers.get(key)?.weaponNature ?? "none", follow);
    if (key === conn.myKey) sfx.cast();
  };
  // El golpe pega hacia donde se apunta en su impacto, no hacia donde empezó: su efecto (el tajo, el destello del
  // bastón) espera a ese instante y se dibuja con la pose que el jugador tenga entonces.
  type PendingSwing = { key: string; strike: Parameters<NonNullable<typeof views.onSwingStart>>[1]; step: number; startMs: number; ranged: boolean };
  const pendingSwings: PendingSwing[] = [];
  const drawnPoses = new Map<string, { x: number; z: number; facing: number }>();
  /** Cuánto antes del impacto (ms) se suelta el efecto: el tajo se adelanta un poco al golpe. */
  const SWING_FX_LEAD_MS = 60;
  views.onSwingStart = (key, strike, step, _pose, elapsedS) => {
    const p = lastPlayers.get(key);
    const ranged = p !== undefined && isRanged(p.weaponId);
    pendingSwings.push({ key, strike, step, startMs: frameNow - elapsedS * 1000, ranged });
    if (ranged) {
      if (key === conn.myKey) sfx.cast();
    } else sfx.swing(key === conn.myKey ? 1 : 0.4);
  };
  /**
   * Los proyectiles del bastón propio salen ya en pantalla, desde donde se ve al mago y hacia donde apunta (como en
   * el servidor, que usa la puntería del input del impacto); con `tripleShot`, el último golpe sale en abanico.
   */
  const predictStaffBolts = (pose: { x: number; z: number }, step: number, nature: Nature) => {
    const weaponId = mine?.weaponId ?? STARTING_WEAPON;
    const moveset = MOVESETS[WEAPONS[weaponId].movesetId];
    if (!moveset.ranged) return;
    // Sin el Alcance: al mago no le sale ni en cartas ni en equipo.
    const range = strikeOf(weaponId, step).range;
    const fan = step === moveset.combo.length && myLegendaries.includes("tripleShot");
    const spread = MAGE_LEGENDARY.tripleShotSpreadRad;
    for (const off of fan ? [-spread, 0, spread] : [0]) {
      playerShots.predictBolt(pose.x, pose.z, lastAim + off, { ...moveset.ranged, range, nature }, frameNow);
    }
  };
  const flushSwings = (nowMs: number) => {
    for (let i = pendingSwings.length - 1; i >= 0; i--) {
      const s = pendingSwings[i]!;
      if (nowMs < s.startMs + s.strike.impactAt * s.strike.duration * 1000 - SWING_FX_LEAD_MS) continue;
      pendingSwings.splice(i, 1);
      const pose = drawnPoses.get(s.key);
      if (!pose) continue;
      const nature = lastPlayers.get(s.key)?.weaponNature ?? "none";
      // El bastón no da un tajo: suelta un proyectil con un destello en la punta.
      if (s.ranged) {
        abilityFx.staffCast(pose, s.strike, s.startMs, nature);
        if (s.key === conn.myKey) predictStaffBolts(pose, s.step, nature);
      } else abilityFx.slash(pose, s.strike, s.step, s.startMs, nature);
    }
  };
  abilityFx.onSlamImpact = (x, z) => {
    const me = predictor?.current;
    if (!me || Math.hypot(me.x - x, me.z - z) >= SLAM_SHAKE.rangeM) return;
    camera.shake(SLAM_SHAKE.durationS, SLAM_SHAKE.intensity);
    sfx.boom();
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
      myLegendaries = Object.values(p.gear).flatMap((g) => (g.item.legendary ? [g.item.legendary] : []));
      ability.setLegendaries(myLegendaries);
      ability.setServer(p.abilities, clock.now(performance.now()));
      if (!predictor || !prev) {
        predictor = new Predictor(p, dungeon);
        prev = { ...p };
        seq = p.lastSeq; // el servidor descarta seq ≤ lastSeq
      } else {
        const before = predictor.current;
        const after = predictor.reconcile(p, p.lastSeq, p.dead);
        // Remolino con `gustDash`: el servidor mueve 4 m y el cliente no lo predice; si fue un lanzamiento propio
        // reciente, esa corrección se desliza (~0,15 s) en vez de teletransportar.
        const dashing = clock.now(performance.now()) - lastDashMs < ABILITIES.gust.animS * 1000 + DASH_WINDOW_MS;
        smoother.correct(before, after, dashing);
        prev = { ...prev, x: prev.x + after.x - before.x, z: prev.z + after.z - before.z };
      }
    }
    for (const key of remotes.keys()) if (!players.has(key)) remotes.delete(key);
  });

  conn.onFloorWeapons((items) => floorWeapons.set(items, clock.now(performance.now())));

  let floorChanged = false;
  conn.onWorld((world, receivedAt) => {
    // Bajaron de piso: la sesión se rehace con la mazmorra nueva.
    if (world.floor !== dungeon.floor) {
      if (!floorChanged) {
        floorChanged = true;
        onFloor(world.floor);
      }
      return;
    }
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
    dragons.push(world, at);
    projectiles.push(world, at);
    hazards.push(world, at);
    bossHazards.push(world);
    if (world.totem.phase !== totemPhase) {
      totemPhase = world.totem.phase;
      totem.setPhase(totemPhase);
    }
    banners.push(world);
    spellZones.push(world, at);
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
      else {
        if (event.aimDist !== undefined || event.id === "slam") leapDists.set(event.key, event.aimDist ?? 0);
        views.ability(event.key, event.id, now, event.rank ?? 1);
      }
    } else if (event.type === "damage") {
      const t = damageTiming(event, conn.myKey, now);
      hits.hit(`${event.targetKind}:${event.targetId}`, t.hitAt);
      const height = event.targetKind === "enemy" ? (enemies.heightOf(event.targetId) ?? dragons.heightOf(event.targetId)) : undefined;
      const weight = event.targetKind === "enemy" ? hitScale.weigh(event.amount) : 0;
      damageNumbers.spawn(event.amount, event.x, event.z, event.targetKind, t.numberAt, height, weight);
      if (t.hurtMe) {
        hurtFlash.flash();
        sfx.hurt();
      }
      if (event.targetKind === "enemy") {
        // Se aleja de quien le pegó: el propio jugador, donde se ve (predicho); los demás, donde dice el servidor.
        const mineHit = event.sourceKey === conn.myKey;
        const from = mineHit ? predictor?.current : event.sourceKey ? lastPlayers.get(event.sourceKey) : undefined;
        const dir = from ? Math.atan2(event.x - from.x, event.z - from.z) : undefined;
        enemies.flinch(event.targetId, t.hitAt, event.amount, dir);
        dragons.flinch(event.targetId);
        const nature = (event.sourceKey ? lastPlayers.get(event.sourceKey)?.weaponNature : undefined) ?? "none";
        abilityFx.impact(event.x, event.z, (height ?? PLAYER_LOOK.height) * HIT_SPARK_HEIGHT, dir ?? 0, weight, t.numberAt, nature);
        // Al conectar uno mismo: el clip se clava un instante y la cámara acusa el golpe, más cuanto más pesa.
        if (mineHit) {
          sfx.hit(weight);
          views.hitStop(conn.myKey, now + HIT_STOP_MS.min + (HIT_STOP_MS.max - HIT_STOP_MS.min) * weight);
          camera.shake(HIT_SHAKE.durationS, HIT_SHAKE.min + (HIT_SHAKE.max - HIT_SHAKE.min) * weight);
        }
      }
    } else if (event.type === "chain") {
      chainFx.play(event.points, now);
    } else if (event.type === "beam") {
      // El haz propio sale de donde se ve al mago (predicho), no de donde lo tenía el servidor.
      const me = event.key === conn.myKey ? predictor?.current : undefined;
      const points = me && event.points.length > 1 ? ([[me.x, me.z], ...event.points.slice(1)] as [number, number][]) : event.points;
      chainFx.beam(points, now, "arcane", event.nature ?? "none");
    } else if (event.type === "blast") {
      abilityFx.blast(event.kind, event.x, event.z, event.radius, now, event.nature ?? "none");
      if (event.kind === "meteorBig") {
        camera.shake(SLAM_SHAKE.durationS * 1.6, SLAM_SHAKE.intensity * 1.5);
        sfx.boom();
      }
    } else if (event.type === "enemyBuff") {
      // Lo de los enemigos se dibuja INTERP_DELAY_MS tarde, como ellos.
      abilityFx.enemyBuff(event.x, event.z, event.radius, event.castS, ENEMY_BUFF_COLOR, now + INTERP_DELAY_MS);
    } else if (event.type === "enemyHeal") {
      chainFx.beam([event.from, event.to], now, "heal");
      abilityFx.healed(event.to[0], event.to[1], now + INTERP_DELAY_MS);
    } else if (event.type === "heal") {
      for (const key of event.keys) {
        const p = key === conn.myKey ? predictor?.current : lastPlayers.get(key);
        if (p) abilityFx.healed(p.x, p.z, now);
      }
    } else if (event.type === "boss") {
      if (event.phase === "awake") {
        hud.announce("¡El dragón despierta!", BOSS_BANNER_MS);
        camera.shake(SLAM_SHAKE.durationS * 2, SLAM_SHAKE.intensity * 1.4);
        sfx.boom();
      } else if (event.phase === "enraged") {
        hud.announce("¡El dragón se enfurece!", BOSS_BANNER_MS);
        sfx.boom();
      } else {
        hud.announce("¡Dragón derrotado! El tótem se abrió", BOSS_BANNER_MS);
        camera.shake(SLAM_SHAKE.durationS * 1.5, SLAM_SHAKE.intensity);
        sfx.levelUp();
      }
    } else if (event.type === "levelUp") {
      hud.levelUp(event.level);
      sfx.levelUp();
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

    const shown = cardPanel.render(pause, group, mine?.choosing ?? false, realNow);
    panelShown = shown;
    touch.setEnabled(!shown);
    hud.setChoiceOpen(shown);

    const padNow = pad.poll();
    if (padNow.used || touch.takeUsed()) aimDevice = "stick";
    const stickMove = padNow.move ?? touch.move;
    input.setMove(stickMove);
    if (predictor) {
      const mouse = camera.aim(predictor.current.x, predictor.current.z);
      const stickAim = padNow.aim ?? touch.aim;
      lastAim = chooseAim({ device: aimDevice, mouseAim: mouse?.facing, aim: stickAim, move: stickMove, last: lastAim });
      // A cuántos metros se apunta (el salto del Golpe sísmico): el cursor; con sticks, cuánto se empuja el derecho.
      if (aimDevice === "mouse") lastAimDist = mouse?.dist ?? lastAimDist;
      else lastAimDist = (mine?.cls === "mage" ? SPELL_AIM_MAX_M : SLAM_LEAP_MAX_M) * (stickAim ? Math.hypot(stickAim.x, stickAim.y) : STICK_LEAP_FRAC);
    }
    if (predictor && prev) {
      // En la pausa no se predice ni se envía nada (seq queda igual; el servidor descarta lo que llegue y
      // confirma su seq). Lo que se apriete en ella se descarta; las teclas mantenidas siguen valiendo.
      if (paused) input.sample(seq, camera.yaw);
      for (let n = steps.advance(dt, paused); n > 0; n--) {
        // Se predice y se envía lo mismo que el servidor va a simular (ya saneado). Muerto, nada
        // de acciones (el servidor igual las ignora).
        const dead = mine?.dead ?? false;
        const raw = input.sample(++seq, camera.yaw, tickClock.sample(now - INTERP_DELAY_MS), lastAim, lastAimDist);
        // Aturdido tampoco ataca ni lanza habilidades (el servidor las ignora; no se predicen).
        const stunned = (mine?.stunLeft ?? 0) > 0;
        const clean = sanitizeInput(dead ? deadInput(raw, predictor.current) : raw);
        if (!clean) continue;
        // En el salto no se camina: lo mueve la habilidad, igual en el servidor y en la predicción.
        if (dead) leap = undefined;
        const leaping = leap !== undefined && leap.stepsLeft > 0;
        const sampled = leaping ? { ...clean, moveX: 0, moveZ: 0, jump: false } : clean;
        prev = predictor.current;
        // Como el servidor: con lo que frenan sus estados y sus habilidades en curso (sincronizado en `statusSpeedMult`).
        const moveSpeedMult = mine?.moveSpeedMult ?? 1;
        const statusSpeedMult = mine?.statusSpeedMult ?? 1;
        predictor.setMoveMods({ speedMult: moveSpeedMult * statusSpeedMult });
        predictor.applyLocal(sampled, leaping ? leap : undefined);
        if (leap && leaping) leap.stepsLeft--;
        // El golpe y la habilidad propios arrancan su clip ya (como el servidor: tras moverse, el combo
        // avanza, luego la habilidad y al final el ataque); el daño lo decide él. Con el arma que dice el
        // servidor: al tomar otra, el combo local vuelve a empezar.
        const weaponId = mine?.weaponId ?? STARTING_WEAPON;
        combo.advance(weaponId);
        ability.setCooldownMult(mine?.cooldownMult ?? 1);
        const cast = ability.tick(sampled.abilities, { dead, stunned, swingTimer: combo.state().swingTimer }, now);
        if (cast === "gust") lastDashMs = now;
        if (cast && ABILITIES[cast].cls === "mage") leapDists.set(conn.myKey, spellAimDist(sampled.aimDist));
        if (cast === "slam") {
          const speed = leapSpeed(sampled.aimDist);
          leap = { facing: sampled.facing, speed, stepsLeft: speed > 0 ? LEAP_STEPS : 0 };
          leapDists.set(conn.myKey, speed * SLAM_IMPACT_S);
        }
        // La embestida del Tajo frontal se predice igual que el salto: los mismos pasos que da el servidor.
        if (cast === "thrust") {
          const rank = mine?.abilities.find((a) => a.id === "thrust")?.rank ?? 1;
          const range = ABILITIES.thrust.ranks[rank - 1]!.range!;
          leap = { facing: sampled.facing, speed: range / THRUST_DASH_S, stepsLeft: Math.ceil(THRUST_DASH_S / SIM_DT - 1e-6) };
        }
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
        attackSpeedMult: mine?.attackSpeedMult ?? 1,
        ability: heroAbility,
        gear: mine?.gear,
        relic: mine?.relic,
      };
      views.render(conn.myKey, pose, state, hits.recently(`player:${conn.myKey}`, now), now, dt);
      drawnPoses.set(conn.myKey, pose);
      // La cámara sigue solo en XZ: con saltos de ~1 m queda más estable.
      camera.follow(x, z, dt);
      torches.update(x, z, now);
      // El aviso sale con la posición predicha (la que ve el jugador); el servidor decide igual.
      const canPickUp = !(mine?.dead ?? true) && swing.swingTimer <= 0 && !heroAbility;
      const totemPrompt = totemPhase === "idle" ? WAKE_TOTEM_PROMPT : totemPhase === "open" ? descendPrompt(dungeon.floor) : null;
      floorWeapons.render(dt, { x: cur.x, z: cur.z, canPickUp, gear: myGear, abilities: myAbilityIds }, now, chestList, { ...totemAt, prompt: totemPrompt });
    }

    const renderAt = now - INTERP_DELAY_MS;
    allies.length = 0;
    for (const [key, buffer] of remotes) {
      const s = buffer.sample(renderAt);
      if (!s) continue;
      views.render(key, s, s, hits.recently(`player:${key}`, renderAt), renderAt, dt);
      drawnPoses.set(key, s);
      allies.push(s);
    }
    // Con todos ya dibujados en este cuadro: los efectos de los golpes cuyo impacto llegó (sus inicios están en el reloj de juego).
    flushSwings(now);
    for (const key of drawnPoses.keys()) if (key !== conn.myKey && !remotes.has(key)) drawnPoses.delete(key);
    compass.render(camera.yaw);
    if (predictor) minimap.render(predictor.current, camera.yaw, allies, chestList);
    enemies.render(renderAt, dt, (id) => hits.recently(`enemy:${id}`, renderAt));
    dragons.render(renderAt, dt);
    const boss = dragons.boss();
    hud.setBoss(boss && boss.ai !== "dead" ? { hp: boss.hp, maxHp: boss.maxHp, enraged: boss.enraged, floor: dungeon.floor } : null);
    bossHazards.render(now);
    totem.render(now);
    projectiles.render(renderAt);
    hazards.render(renderAt);
    banners.render(now);
    spellZones.render(now);
    seals.render(now);
    chests.render(renderAt);
    chainFx.render(renderAt);
    playerShots.render(renderAt);
    playerShots.renderLocal(now, (x, z) => !isWalkableTile(dungeon, Math.floor(x / TILE_SIZE), Math.floor(z / TILE_SIZE)), [...enemies.liveBodies(), ...dragons.liveBodies()]);
    // Enfriamientos con el reloj de juego (quietos en la pausa); el local manda al apretar la tecla.
    abilityBar.render(
      abilityBarModel(mine?.abilities ?? [], (id) => ability.cooldownLeft(id, now), mine?.cooldownMult ?? 1, (id) => ability.chargesOf(id, now)),
      mine?.passiveRank ?? 0,
    );
    orbs.render(dt, now);
    abilityFx.setPaused(paused);
    views.setPaused(paused);
    enemies.setPaused(paused);
    dragons.setPaused(paused);
    bossHazards.setPaused(paused);
    totem.setPaused(paused);
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
    touch.dispose();
    window.removeEventListener("pointermove", onMouseAim);
    window.removeEventListener("pointerdown", onGesture);
    window.removeEventListener("keydown", onGesture);
    sfx.dispose();
    views.dispose();
    enemies.dispose();
    dragons.dispose();
    bossHazards.dispose();
    totem.dispose();
    projectiles.dispose();
    hazards.dispose();
    banners.dispose();
    spellZones.dispose();
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
