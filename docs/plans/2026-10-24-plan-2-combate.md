# Plan 2: Personajes reales y combate básico. Plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDA: usar superpowers:subagent-driven-development (recomendado) o superpowers:executing-plans para implementar este plan tarea por tarea. Los pasos usan checkboxes (`- [ ]`) para seguimiento.

**Objetivo:** Que los jugadores, ya como caballeros animados de KayKit en una mazmorra con muros y suelos reales, entren a una sala, vean aparecer esqueletos, peleen con un combo de espada de 3 golpes, reciban daño (y lo esquiven), maten enemigos, ganen experiencia compartida y suban de nivel. Todo en co-op por red y con compensación de retraso en los golpes.

**Arquitectura:** Igual que en el Plan 1: el servidor (Colyseus) es autoritativo y `shared` guarda la lógica determinista y las definiciones. Dos sistemas nuevos del servidor son **clases puras** que trabajan sobre objetos planos y se testean sin Colyseus: `EnemySystem` (aparición, IA, proyectiles) y `CombatSystem` (combo, golpes con rebobinado, daño, XP y niveles, muerte y reaparición). `RunRoom` solo los conecta y copia su estado al schema. El cliente reemplaza las primitivas por modelos KayKit con animaciones elegidas por una función pura.

**Stack:** El del Plan 1, más `@babylonjs/loaders@9.30.0` para glTF. Assets KayKit (CC0) descargados desde commits fijos y commiteados en el repo.

**Spec:** `docs/specs/2026-10-23-roguelike-coop-design.md` (§4.3 a §4.6, §4.8, §5.1 y §6, paso 3). También se apoya en el Plan 1, `docs/plans/2026-10-23-plan-1-base.md`, y en sus cambios posteriores: correr con Shift, saltar con Espacio, esquivar con C y pasillos de 3 o 5 casillas.

## Restricciones globales

- Las versiones del Plan 1 se mantienen. Se agrega `@babylonjs/loaders@9.30.0` (exacta) al cliente.
- **Assets KayKit, desde commits fijos** (CC0, `https://github.com/KayKit-Game-Assets/<repo>`):
  - `KayKit-Character-Pack-Adventures-1.0` @ `672074b73ba276876a19e8816ecdc5241817ab47`: `addons/kaykit_character_pack_adventures/Characters/gltf/Knight.glb`
  - `KayKit-Character-Pack-Skeletons-1.0` @ `15b62b9bad122f72926c10fb14d622c73819fa54`: `addons/kaykit_character_pack_skeletons/Characters/gltf/Skeleton_{Warrior,Minion,Mage}.glb`; `addons/kaykit_character_pack_skeletons/Assets/gltf/Skeleton_{Axe,Blade,Staff}.{gltf,bin}` y `skeleton_texture.png`
  - `KayKit-Dungeon-Remastered-1.0` @ `b0ca9bd96a8072ab36a3a5464f00ed1e06a16d07`: `addons/kaykit_dungeon_remastered/Assets/gltf/{wall,floor_tile_large,pillar}.gltf.glb`
  - Destino: `packages/client/public/assets/kaykit/` (se commitea). Créditos en `CREDITS.md`.
- **Escalas** (las piezas KayKit usan una grilla de 4 m; la nuestra es `TILE_SIZE = 2`): `DUNGEON_PIECE_SCALE = 0.5` en X/Z. Los muros miden en Y 0.75 (4 m → 3 m = `WALL_HEIGHT`). `CHARACTER_SCALE = 0.8`. Las armas del Caballero que se muestran son `1H_Sword` y `Round_Shield`; se ocultan `1H_Sword_Offhand`, `2H_Sword`, `Badge_Shield`, `Rectangle_Shield` y `Spike_Shield`.
- **Números de combate** (en `packages/shared/src/combat.ts`, una sola fuente de verdad; se ajustan después jugando):
  - Guerrero: `baseHp 120`, `hpPerLevel 12`, `baseDamage 12`, `damagePerLevel 2`. Combo `[{duration 0.35, damageMult 1, range 2.2, arcDeg 120}, {0.35, 1, 2.2, 120}, {0.5, 1.5, 2.6, 160}]`, `comboResetS 0.6`.
  - Enemigos:
    - `minion`: rápido. Hp 20, velocidad 6, radio 0.4, daño 6, alcance 1.2, telegrafía 0.4, enfriamiento 1.2, xp 4.
    - `brute`: cuerpo a cuerpo. Hp 45, velocidad 3.5, radio 0.5, daño 12, alcance 1.6, telegrafía 0.6, enfriamiento 1.6, xp 8.
    - `mage`: a distancia. Hp 30, velocidad 3, radio 0.45, daño 10, telegrafía 0.7, enfriamiento 2.2, xp 8. Además `ranged: {projectileSpeed 9, projectileRadius 0.3, lifetimeS 3, preferredMin 6, preferredMax 10}`.
  - `xpToNext(level) = 10 + 10 * level`. `enemiesForRoom(floor, players) = 3 + floor + (players - 1)`. Mezcla por sala: la mitad `brute` (redondeando hacia arriba), luego `minion` y luego `mage`, alternando con el `Rng` de la sala.
- **Constantes de red y combate** (en `constants.ts`): `REWIND_MAX_TICKS = 10` (~333 ms a 30 Hz), `HISTORY_TICKS = 14`, `RESPAWN_S = 5`, `RESPAWN_INVULN_S = 1`, `ENEMY_SPAWN_MIN_PLAYER_DIST_TILES = 3`. En `protocol.ts` (no en `constants.ts`, para no exportarla dos veces desde `index.ts`): `PROTOCOL_VERSION = 2`.
- Toda la lógica de combate y de IA en `shared`/`server` es determinista dado su `Rng`: **sin `Math.random`**.
- Textos visibles en español. Commits con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Decisiones de este plan** (son de Claude, no del usuario; ver el final):
  - Las puertas que se cierran pasan a un plan posterior.
  - Al morir se reaparece a los 5 s (provisorio hasta el Plan 6).
  - Los enemigos no bloquean a los jugadores; se separan solo entre ellos.
  - Atacar no frena el movimiento.
  - Los stats por nivel en este plan son solo vida y daño.

## Foco de revisión

1. **Enemigos que aparecen encima de un jugador o dentro de un muro** cuando alguien entra a la sala: deben aparecer en centros de casillas caminables de esa sala, a ≥ `ENEMY_SPAWN_MIN_PLAYER_DIST_TILES` de cualquier jugador. Test en la Tarea 3.
2. **Reconectar o tomar el control a mitad de pelea:** la vida, el estado de muerte y la reaparición pendiente sobreviven. `attach()` del registro reubica y resetea `lastSeq`, pero no cura ni revive. Test en la Tarea 5.
3. **Ráfaga de clics de ataque** (o inputs acumulados): nunca más de un golpe por swing. Un `attack` en medio de un swing se ignora. Test en la Tarea 4.
4. **El objetivo de un enemigo se desconecta o muere:** el enemigo cambia de objetivo, o queda quieto si no hay nadie, sin errores ni ataques a un jugador que ya no está. Test en la Tarea 3.
5. **Una pestaña con código viejo tras cambiar el protocolo** (lo que pasó en el Plan 1): la conexión se rechaza con un mensaje claro para recargar. Tests en las Tareas 5 y 8.

---

## Estructura de archivos

```
scripts/fetch-kaykit.mjs                     descarga los assets desde los commits fijos (Tarea 1)
CREDITS.md
packages/shared/src/
  combat.ts            ClassDef/EnemyDef, CLASS_DEFS, ENEMY_DEFS, xpToNext, playerStats, enemiesForRoom, inArc, circlesOverlap
  movement.ts          + moveCircle (refactor de moveAxis con radio); PlayerInput + attack, viewTick
  protocol.ts          + PROTOCOL_VERSION en JoinOptions, código 4104, MSG.combat, CombatEvent
  constants.ts         + constantes de combate/red
packages/server/src/sim/
  EnemySystem.ts       aparición por sala, IA, movimiento, proyectiles
  PositionHistory.ts   historial de posiciones de enemigos por tick
  CombatSystem.ts      combo, golpes con rebobinado, daño, XP/nivel, golpes pendientes con gracia de esquive, muerte/reaparición
packages/server/src/rooms/
  RunState.ts          + EnemyState, ProjectileState, campos de combate
  RunRoom.ts           conecta los sistemas; chequeo de versión
  PlayerRegistry.ts    + estado de combate persistente en PlayerRecord
packages/client/public/assets/kaykit/...     (Tarea 1)
packages/client/src/
  render/assets.ts         carga cada modelo una vez y lo instancia (AssetContainer)
  render/dungeonMeshes.ts  muros/suelos/pilares KayKit
  render/animState.ts      chooseHeroAnim / chooseEnemyAnim (puras)
  render/characterView.ts  modelo + AnimationGroups + cruce entre clips
  render/playerViews.ts    usa characterView (caballero)
  render/enemyViews.ts     esqueletos, barras de vida, aro de telegrafía
  render/projectileViews.ts
  render/fx.ts             números de daño, destello al recibir daño
  ui/hud.ts                vida, nivel, XP, pantalla de "caíste"
  input/InputState.ts      + clic izquierdo = attack
  net/connection.ts        + enemigos, proyectiles, tick del servidor, eventos de combate, versión
  main.ts                  cableado
```

---

### Tarea 1: Assets KayKit en el repo

**Archivos:**
- Crear: `scripts/fetch-kaykit.mjs`, `CREDITS.md`, `packages/client/public/assets/kaykit/**` (resultado del script)
- Modificar: `packages/client/package.json` (agregar `@babylonjs/loaders@9.30.0`), `README.md` (una línea sobre el script)

**Interfaces:**
- Produce: archivos en `packages/client/public/assets/kaykit/characters/Knight.glb`, `.../skeletons/Skeleton_{Warrior,Minion,Mage}.glb`, `.../skeletons/weapons/Skeleton_{Axe,Blade,Staff}.{gltf,bin}` + `skeleton_texture.png`, `.../dungeon/{wall,floor_tile_large,pillar}.glb`. Se sirven en la URL `/assets/kaykit/...`.

- [ ] **Paso 1:** Escribir `scripts/fetch-kaykit.mjs` (Node ≥ 24, sin dependencias). Tiene la lista de (repo, sha, ruta de origen, destino) de las Restricciones globales y descarga desde `https://raw.githubusercontent.com/KayKit-Game-Assets/<repo>/<sha>/<ruta>`. Falla con código ≠ 0 si una descarga no responde 200 o queda vacía. Lee cada `.gltf` de arma y verifica que todos sus `buffers[].uri` e `images[].uri` estén en la lista; si falta alguno, termina con error nombrándolo.
- [ ] **Paso 2:** `node scripts/fetch-kaykit.mjs`, y que `ls -R packages/client/public/assets/kaykit` muestre los 15 archivos.
- [ ] **Paso 3:** `CREDITS.md`: "KayKit: Adventurers Character Pack, Skeletons Character Pack y Dungeon Remastered, de Kay Lousberg (www.kaylousberg.com), licencia CC0", con los enlaces a los repos.
- [ ] **Paso 4:** `npm run build -w @roguelike/client` → los assets aparecen en `dist/assets/kaykit`.
- [ ] **Paso 5: Commit** `chore: assets KayKit (CC0) desde commits fijos`.

### Tarea 2: Definiciones de combate e input de ataque (shared)

**Archivos:**
- Crear: `packages/shared/src/combat.ts`, `packages/shared/test/combat.test.ts`
- Modificar: `packages/shared/src/{movement.ts,protocol.ts,constants.ts,index.ts}`, `packages/shared/test/movement.test.ts`

**Interfaces:**
- Produce:
  ```ts
  type ClassId = "warrior";
  interface ComboStep { duration: number; damageMult: number; range: number; arcDeg: number }
  interface ClassDef { baseHp: number; hpPerLevel: number; baseDamage: number; damagePerLevel: number; combo: readonly ComboStep[]; comboResetS: number }
  type EnemyKind = "minion" | "brute" | "mage";
  interface EnemyDef { hp: number; speed: number; radius: number; damage: number; attackRange: number; telegraphS: number; cooldownS: number; xp: number;
    ranged?: { projectileSpeed: number; projectileRadius: number; lifetimeS: number; preferredMin: number; preferredMax: number } }
  const CLASS_DEFS: Record<ClassId, ClassDef>; const ENEMY_DEFS: Record<EnemyKind, EnemyDef>;
  xpToNext(level: number): number
  playerStats(cls: ClassId, level: number): { maxHp: number; damage: number }     // base + perLevel*(level-1)
  enemiesForRoom(floor: number, players: number): number
  inArc(origin: { x: number; z: number; facing: number }, target: { x: number; z: number; radius: number }, range: number, arcDeg: number): boolean
  circlesOverlap(a: { x: number; z: number; radius: number }, b: { x: number; z: number; radius: number }): boolean
  // movement.ts
  moveCircle(d: Dungeon, x: number, z: number, dx: number, dz: number, radius: number): { x: number; z: number }
  // PlayerInput suma: attack: boolean; viewTick: number
  // protocol.ts
  const PROTOCOL_VERSION = 2                // solo aquí
  interface JoinOptions { name: string; token: string; version: number }
  JoinErrorCode suma "version-mismatch" → 4104
  MSG suma combat: "combat"
  type CombatEvent =
    | { type: "damage"; targetKind: "enemy" | "player"; targetId: string; amount: number; x: number; z: number }
    | { type: "swing"; key: string; step: number }          // step 1..3, para animar a los demás
    | { type: "levelUp"; level: number }
  ```

Reglas:
- `inArc`: el objetivo está dentro si la distancia entre centros menos `target.radius` es ≤ `range` y el ángulo entre la dirección `facing` (0 = +Z, π/2 = +X) y el vector al centro del objetivo es ≤ `arcDeg/2`. Un objetivo cuyo círculo contiene el origen siempre está dentro.
- `moveCircle` es el `moveAxis` del Plan 1 con el radio como parámetro: primero X y después Z. `stepPlayer` pasa a usarlo con `PLAYER_RADIUS`, sin cambiar su comportamiento; todos los tests de movimiento existentes deben seguir pasando.
- `sanitizeInput`: `attack` es true solo si llega `=== true`. `viewTick` debe ser un número finito ≥ 0; si no, queda en 0.

- [ ] **Paso 1: Tests que fallan:**
  - `playerStats("warrior", 1)` → `{maxHp: 120, damage: 12}`; nivel 3 → `{144, 16}`.
  - `xpToNext(1) === 20`, `xpToNext(4) === 50`.
  - `enemiesForRoom(1, 1) === 4`, `enemiesForRoom(3, 4) === 9`.
  - `inArc` con origen en (0,0) mirando a +Z: un objetivo en (0, 2) de radio 0.4 con rango 2.2 y arco 120 está dentro; en (0, 2.7) está fuera; en (2, 0.1) está fuera (ángulo ≈ 87° > 60°); en (0, −0.2) de radio 0.4 está dentro (contiene el origen); con facing π/2, (2, 0) está dentro.
  - `circlesOverlap`: tocándose en el borde exacto (distancia = suma de radios) → false; a 0.01 menos → true.
  - `moveCircle` con radio 0.5 en la sala del test de movimiento se detiene a `bordeDelMuro - 0.5`.
  - `sanitizeInput({seq: 1, attack: "y", viewTick: -3})` → `attack: false, viewTick: 0`; `{seq: 1, attack: true, viewTick: 41.5}` → `attack: true, viewTick: 41.5`.
- [ ] **Paso 2:** Correr → FALLA.
- [ ] **Paso 3:** Implementar. Actualizar en todo el repo los literales de `PlayerInput` y `JoinOptions` (tests de cliente y servidor, `InputState`, `connection.ts`) con `attack: false`, `viewTick: 0` y `version: PROTOCOL_VERSION`, para que `npm run typecheck` pase.
- [ ] **Paso 4:** `npm test` y `npm run typecheck` → PASAN.
- [ ] **Paso 5: Commit** `feat(shared): definiciones de combate, arco de golpe y input de ataque`.

### Tarea 3: Sistema de enemigos (servidor, puro)

**Archivos:**
- Crear: `packages/server/src/sim/EnemySystem.ts`, `packages/server/test/EnemySystem.test.ts`

**Interfaces:**
- Consume: `Dungeon`, `Rng`, `ENEMY_DEFS`, `enemiesForRoom`, `moveCircle`, `circlesOverlap`, `tileCenter`, `isWalkableTile`, constantes.
- Produce:
  ```ts
  type EnemyAi = "idle" | "chase" | "telegraph" | "recover" | "dead";
  interface Enemy { id: string; kind: EnemyKind; roomId: number; x: number; z: number; facing: number; hp: number; maxHp: number;
    ai: EnemyAi; aiTime: number /* s en el estado actual */; targetKey: string | null; cooldown: number }
  interface Projectile { id: string; x: number; z: number; dirX: number; dirZ: number; speed: number; radius: number; damage: number; life: number }
  interface SimPlayer { key: string; x: number; z: number; alive: boolean }   // solo conectados
  interface EnemyHit { targetKey: string; damage: number; sourceId: string }
  class EnemySystem {
    constructor(dungeon: Dungeon, rng: Rng)
    activateRooms(players: readonly SimPlayer[], playerCount: number): Enemy[]   // devuelve los recién creados
    step(players: readonly SimPlayer[], dt: number): EnemyHit[]
    damage(enemyId: string, amount: number): { killed: boolean; xp: number }       // id inexistente o muerto → {false, 0}
    get enemies(): readonly Enemy[]
    get projectiles(): readonly Projectile[]
  }
  ```

Reglas:
- **Activación:** una sala `combat` se activa una sola vez, la primera vez que un jugador vivo está dentro de su rectángulo. Las salas `start` y `boss` no generan enemigos en este plan. Se crean `enemiesForRoom(dungeon.floor, playerCount)` enemigos con la mezcla de las Restricciones globales, en centros de casillas caminables de la sala, a ≥ `ENEMY_SPAWN_MIN_PLAYER_DIST_TILES` (en casillas, Chebyshev) de todo jugador. Si no hay suficientes casillas así, se usan las más lejanas. Dos enemigos nunca comparten casilla. Los ids son `"e1"`, `"e2"`, ... en orden de creación. Los enemigos recién creados quedan en `chase`.
- **Objetivo:** el jugador vivo más cercano. Se reevalúa cada vez que el objetivo deja de estar en la lista de vivos. Si no queda nadie, el enemigo pasa a `idle` y no se mueve.
- **Cuerpo a cuerpo (`brute`, `minion`):**
  - En `chase` avanza hacia el objetivo a su `speed` con `moveCircle(…, def.radius)`.
  - Si la distancia al borde del objetivo (distancia entre centros − `PLAYER_RADIUS`) es ≤ `attackRange` y `cooldown <= 0`, pasa a `telegraph`, sin moverse y mirando al objetivo.
  - Al cumplir `telegraphS`: si el objetivo sigue a ≤ `attackRange + 0.3` (tolerancia), produce un `EnemyHit`. Después pasa a `recover` con `cooldown = cooldownS`, y vuelve a `chase` cuando `cooldown` llega a 0.
- **A distancia (`mage`):**
  - En `chase` intenta quedar entre `preferredMin` y `preferredMax` del objetivo: se acerca si está más lejos y retrocede si está más cerca.
  - Dentro de ese rango, con `cooldown <= 0`, pasa a `telegraph`. Al cumplirlo crea un `Projectile` hacia la posición **actual** del objetivo (ids `"p1"`, ...) y pasa a `recover`.
  - Los proyectiles avanzan cada paso. Desaparecen al entrar en una casilla de muro o al agotar `life`. Al tocar a un jugador vivo (`circlesOverlap` con `PLAYER_RADIUS`) producen un `EnemyHit` y desaparecen.
- **Separación:** después de moverse, cada par de enemigos que se superponga se empuja por igual hasta dejar de superponerse, usando `moveCircle`, así que nunca quedan dentro de un muro. Los enemigos no empujan a los jugadores.
- **Daño:** `damage` resta vida. Al llegar a 0 el enemigo pasa a `dead` y devuelve `{killed: true, xp: def.xp}` una sola vez. Un enemigo muerto se elimina de `enemies` tras 2 s (para la animación de muerte) y no ataca ni se mueve.

- [ ] **Paso 1: Tests que fallan** (dungeon de `generateDungeon(123, 1)` o una sala hecha a mano; RNG con semilla):
  - Un jugador fuera de toda sala de combate → `activateRooms` devuelve `[]`. Al entrar a una sala de combate devuelve 4 enemigos (1 jugador, piso 1) sobre casillas caminables de esa sala, a ≥ 3 casillas del jugador y en casillas distintas. Una segunda llamada estando adentro devuelve `[]`.
  - Las salas `start` y `boss` nunca generan enemigos.
  - Un `brute` a 5 m del jugador se acerca (la distancia baja tras 10 pasos). A 1 m entra en `telegraph`. Tras `telegraphS` produce exactamente un `EnemyHit` con `damage: 12`, y no produce otro antes de `cooldownS`.
  - Si el jugador se aleja 3 m durante la telegrafía, **no** hay golpe.
  - Un `mage` a 3 m retrocede y a 15 m se acerca. Dentro del rango dispara un proyectil que golpea a un jugador quieto en la línea de tiro (un `EnemyHit` con `damage: 10`). Un proyectil disparado hacia un muro desaparece sin golpear.
  - Dos enemigos superpuestos dejan de estarlo tras un `step`, y ninguno queda en una casilla de muro.
  - Si el objetivo desaparece de `players`, el enemigo elige a otro jugador vivo. Sin jugadores, todos pasan a `idle` y `step` devuelve `[]`.
  - `damage` hasta matar devuelve `{killed: true, xp}` una sola vez. El enemigo muerto no produce golpes y desaparece de `enemies` tras 2 s de `step`.
- [ ] **Paso 2:** Correr → FALLA.
- [ ] **Paso 3:** Implementar.
- [ ] **Paso 4:** Correr → PASA. `npm run typecheck` → PASA.
- [ ] **Paso 5: Commit** `feat(server): enemigos esqueleto (aparición, IA, proyectiles)`.

### Tarea 4: Sistema de combate de los jugadores (servidor, puro)

**Archivos:**
- Crear: `packages/server/src/sim/{PositionHistory.ts,CombatSystem.ts}`, `packages/server/test/{PositionHistory,CombatSystem}.test.ts`

**Interfaces:**
- Consume: `EnemySystem` (Tarea 3), `CLASS_DEFS`, `playerStats`, `xpToNext`, `inArc`, `isInvulnerable`, `KinematicState`, `PlayerInput`, constantes.
- Produce:
  ```ts
  class PositionHistory {
    record(tick: number, enemies: readonly { id: string; x: number; z: number }[]): void   // guarda HISTORY_TICKS ticks
    at(tick: number, id: string): { x: number; z: number } | undefined                    // tick exacto (redondeado)
  }
  interface CombatState { cls: ClassId; hp: number; maxHp: number; dead: boolean; respawnIn: number; invulnFor: number;
    comboStep: number /* 0 = ninguno, 1..3 */; swingTimer: number; comboTimer: number; pendingHits: { damage: number; deadline: number }[] }
  newCombatState(cls: ClassId, level: number): CombatState
  interface AttackResult { swung: boolean; step: number; hits: { enemyId: string; amount: number; killed: boolean; x: number; z: number }[]; xpGained: number }
  class CombatSystem {
    level: number; xp: number                                 // del grupo, empiezan en 1 y 0
    attack(c: CombatState, k: KinematicState, input: PlayerInput, nowTick: number, enemies: EnemySystem, history: PositionHistory): AttackResult
    queueEnemyHits(states: Map<string, CombatState>, hits: readonly EnemyHit[], nowS: number): void
    step(states: Map<string, CombatState>, kin: Map<string, KinematicState>, nowS: number, dt: number): { damaged: { key: string; amount: number }[]; died: string[]; respawned: string[] }
    grantXp(states: Map<string, CombatState>, xp: number): number[]   // niveles alcanzados (puede ser más de uno)
  }
  ```

Reglas:
- **Combo:**
  - `attack` no hace nada (`swung: false`) si `c.dead`, si `isInvulnerable(k)` (esquivando) o si `swingTimer > 0` (en medio de un swing).
  - Si se acepta: `step = comboTimer > 0 ? (comboStep % 3) + 1 : 1`. Luego `swingTimer = combo[step-1].duration` y `comboTimer = duration + comboResetS`.
  - `step()` descuenta `dt` de ambos timers. Si `comboTimer` llega a 0, `comboStep = 0`.
- **Golpe con rebobinado:**
  - `t = clamp(round(input.viewTick), nowTick - REWIND_MAX_TICKS, nowTick)`.
  - Para cada enemigo vivo: posición = `history.at(t, id) ?? posición actual`.
  - Golpea si `inArc({x: k.x, z: k.z, facing: input.facing}, {pos, radius}, range, arcDeg)`.
  - Daño = `round(playerStats(cls, level).damage * damageMult)`, aplicado con `enemies.damage`. Las muertes suman su xp con `grantXp`.
- **Golpes de enemigos con gracia de esquive:**
  - `queueEnemyHits` agrega `{damage, deadline: nowS + DODGE_GRACE_S}` al jugador objetivo, si está vivo.
  - En cada `step`, un golpe pendiente se **descarta** si el jugador está esquivando (`isInvulnerable(kin)`) o tiene `invulnFor > 0`, y se **aplica** si pasó su `deadline`.
- **Muerte y reaparición:**
  - Al llegar a hp ≤ 0: `dead = true`, `respawnIn = RESPAWN_S`, y se vacían los golpes pendientes.
  - Al cumplirse: `dead = false`, `hp = maxHp`, `invulnFor = RESPAWN_INVULN_S`, y aparece en `respawned` para que `RunRoom` lo reubique.
- **Niveles:** `grantXp` suma al xp del grupo. Mientras `xp >= xpToNext(level)` resta y sube `level`. A todos los estados les recalcula `maxHp` y les suma a `hp` la diferencia, sin revivir a los muertos.

- [ ] **Paso 1: Tests que fallan:**
  - `PositionHistory`: con 15 ticks registrados, `at` del más viejo devuelve `undefined` y `at` de los últimos 10 devuelve las posiciones guardadas.
  - **Combo:** tres `attack` separados por 0.4 s (con `step` intermedios) dan los pasos 1, 2 y 3. Un cuarto tras 2 s da el paso 1. Un `attack` 0.1 s después de otro da `swung: false`.
  - **Ráfaga:** 50 `attack` en el mismo tick producen exactamente un swing y, como mucho, un golpe por enemigo.
  - **Daño:** el paso 3 contra un enemigo en el arco hace `round(12 * 1.5) = 18`. Un enemigo detrás (fuera del arco) no recibe daño.
  - **Rebobinado:** el enemigo estaba en el arco en el tick 100 y en el tick 104 ya no. Con `viewTick = 100` y `nowTick = 104` lo golpea. Con `viewTick = 90` y `nowTick = 104`, el tick usado queda limitado a 98; si ahí estaba fuera del arco, no hay golpe.
  - **Esquive:** un golpe encolado se descarta si dentro de los 0.15 s el jugador empieza a esquivar, y se aplica si no esquiva.
  - **Muerte:** con hp 10, un golpe de 12 deja `dead: true` y `respawnIn: 5`. Tras 5 s de `step` reaparece con hp lleno, `invulnFor = 1`, y en `respawned`. Durante la invulnerabilidad, los golpes se descartan.
  - **Niveles:** `grantXp(20)` en nivel 1 sube a 2 y devuelve `[2]`. El `maxHp` pasa de 120 a 132 y el hp sube 12. `grantXp(100)` puede subir varios niveles.
- [ ] **Paso 2:** Correr → FALLA.
- [ ] **Paso 3:** Implementar.
- [ ] **Paso 4:** Correr → PASA. `npm run typecheck` → PASA.
- [ ] **Paso 5: Commit** `feat(server): combo, golpes con rebobinado, daño, XP y reaparición`.

### Tarea 5: Conectar el combate a la sala (servidor)

**Archivos:**
- Modificar: `packages/server/src/rooms/{RunState.ts,RunRoom.ts,PlayerRegistry.ts}`, `packages/server/test/{RunRoom,PlayerRegistry}.test.ts`

**Interfaces:**
- Consume: Tareas 2 a 4.
- Produce (schema, lo que lee el cliente):
  - `PlayerState` suma `hp`, `maxHp`, `dead` (boolean), `respawnIn`, `comboStep` y `swingTimer`.
  - `EnemyState = schema({ kind: string, x, z, facing, hp, maxHp, ai: string, aiTime })`.
  - `ProjectileState = schema({ x, z })`.
  - `RunState` suma `tick` (número de tick de simulación), `level`, `xp`, `xpToNext`, `enemies: map<EnemyState>` (indexado por id) y `projectiles: map<ProjectileState>`.
  - Mensaje `MSG.combat` con `CombatEvent`, enviado a todos.
  - `PlayerRecord` suma `combat: CombatState`.

Comportamiento:
- **onCreate:** crea `EnemySystem` (con `createRng(seed ^ 0x5eed)`), `PositionHistory` y `CombatSystem`.
- **onJoin:**
  - Si `options.version !== PROTOCOL_VERSION`, rechaza con `ServerError(4104, "version-mismatch")` antes de tocar el registro.
  - Un `PlayerRecord` nuevo nace con `newCombatState("warrior", level del grupo)`.
  - `reconnect` y `takeover` **conservan** `combat` (Foco 2).
- **tick:**
  1. Se procesan los inputs de cada jugador conectado como en el Plan 1. Si el jugador está muerto, el input se simula sin movimiento ni salto, esquiva o ataque, pero su `seq` se confirma igual. Si `input.attack`, se llama a `combat.attack`, se emite `swing` y se emite un `damage` por golpe.
  2. `state.tick++`.
  3. `enemySystem.activateRooms` con los jugadores vivos y conectados, y `registry.size()` como cantidad de jugadores.
  4. `enemySystem.step` → `combat.queueEnemyHits`.
  5. `combat.step`: emite `damage` de jugador; a los reaparecidos los ubica con `spawnFor` y les reinicia el `KinematicState`.
  6. `history.record(state.tick, enemies)`.
  7. Se copian jugadores, enemigos, proyectiles, nivel y xp al schema, y se eliminan del schema los enemigos y proyectiles que ya no existen.
- Un `levelUp` se emite una vez por cada nivel alcanzado.

- [ ] **Paso 1: Tests que fallan** (`@colyseus/testing`, como en el Plan 1):
  - Unirse con `version: 1` es rechazado con 4104.
  - Un jugador recién entrado tiene `hp = maxHp = 120`, `dead = false`, y `state.level === 1`.
  - Si se teletransporta al jugador (en el servidor del test, vía `room`) dentro de una sala de combate, tras un tick hay 4 entradas en `state.enemies`.
  - Si un enemigo está frente al jugador y este envía 3 inputs `attack: true` separados por ≥ 0.4 s, el enemigo pierde vida y el cliente recibe eventos `swing` y `damage`.
  - **Foco 2:** con el jugador en hp 50 (forzado en el test), un `leave` y luego volver a entrar con el mismo nombre conserva hp 50. Lo mismo con un takeover.
  - `PlayerRegistry`: `attach` en reconnect no toca `combat`.
- [ ] **Paso 2:** Correr → FALLA.
- [ ] **Paso 3:** Implementar.
- [ ] **Paso 4:** `npm test` y `npm run typecheck` → PASAN.
- [ ] **Paso 5: Commit** `feat(server): combate en la sala, versión de protocolo y eventos`.

### Tarea 6: Mazmorra con piezas KayKit (cliente)

**Archivos:**
- Crear: `packages/client/src/render/assets.ts`
- Modificar: `packages/client/src/render/dungeonMeshes.ts`, `packages/client/src/main.ts`

**Interfaces:**
- Produce:
  ```ts
  // assets.ts
  type AssetId = "knight" | "skeletonWarrior" | "skeletonMinion" | "skeletonMage" | "axe" | "blade" | "staff" | "wall" | "floor" | "pillar";
  loadAssets(scene: Scene): Promise<Assets>          // carga todo una vez (SceneLoader/LoadAssetContainerAsync de @babylonjs/loaders)
  interface Assets { container(id: AssetId): AssetContainer }
  // dungeonMeshes.ts
  buildDungeonMeshes(scene: Scene, d: Dungeon, assets: Assets): { dispose(): void }
  ```

Reglas:
- **Suelo:** un `floor_tile_large` por casilla caminable, escalado `DUNGEON_PIECE_SCALE` en X/Z y centrado en la casilla.
- **Muros:**
  - Por cada casilla caminable y cada vecino ortogonal que sea muro, se pone un `wall` sobre ese borde, rotado para quedar a lo largo del borde.
  - Escala (0.5, 0.75, 0.5), así que mide 2 m de largo, 3 m de alto y 0.5 m de grosor.
  - Se desplaza 0.25 m **hacia la casilla de muro**, para que su cara quede justo en el límite de la colisión (si no, el jugador se ve 0.25 m metido en el muro).
- **Pilares:** un `pillar` escalado en cada esquina de casilla donde se juntan dos muros en ángulo, para que no queden huecos visibles.
- **Rendimiento:** usar instancias (`instantiateModelsToScene` una vez y luego `createInstance`, o thin instances por pieza) para no crear miles de mallas independientes.
- La cámara y su raycast siguen usando la grilla de casillas; no se tocan.

- [ ] **Paso 1:** Implementar `assets.ts` y el nuevo `dungeonMeshes.ts`. `main.ts` espera a `loadAssets` antes de construir la escena y muestra "Cargando…" mientras tanto.
- [ ] **Paso 2:** `npm run typecheck` y `npm run build -w @roguelike/client` → PASAN.
- [ ] **Paso 3: Verificación** con Chrome headless (como en el Plan 1, sin commitear el script), en `http://localhost:5173`:
  - El juego carga sin errores en consola.
  - Hay mallas de muro y suelo.
  - Una captura de pantalla de una sala y de un pasillo muestra muros alineados con el suelo y sin huecos en las esquinas.
  - Guardar las capturas en el scratchpad y nombrarlas en el informe.
- [ ] **Paso 4: Commit** `feat(client): mazmorra con piezas KayKit`.

### Tarea 7: Caballero y esqueletos animados (cliente)

**Archivos:**
- Crear: `packages/client/src/render/{animState.ts,characterView.ts,enemyViews.ts,projectileViews.ts}`, `packages/client/test/animState.test.ts`
- Modificar: `packages/client/src/render/playerViews.ts`, `packages/client/src/net/connection.ts`, `packages/client/src/main.ts`

**Interfaces:**
- Produce:
  ```ts
  // animState.ts
  interface AnimChoice { clip: string; loop: boolean; speed: number }
  interface HeroAnimInput { speed: number /* m/s en el plano */; airborne: boolean; dodging: boolean; comboStep: number; swingTimer: number; dead: boolean; hurtRecently: boolean }
  chooseHeroAnim(a: HeroAnimInput, clipLengths?: ReadonlyMap<string, number>): AnimChoice
  interface EnemyAnimInput { kind: EnemyKind; ai: string; speed: number; hurtRecently: boolean }
  chooseEnemyAnim(e: EnemyAnimInput, clipLengths?: ReadonlyMap<string, number>): AnimChoice
  // characterView.ts
  class CharacterView { constructor(scene: Scene, assets: Assets, model: AssetId, opts: { weapon?: AssetId; showMeshes?: string[]; hideMeshes?: string[] });
    setPose(x: number, y: number, z: number, facing: number): void; play(choice: AnimChoice): void /* cruce de ~0.15 s, sin reiniciar si el clip ya suena */; dispose(): void }
  // connection.ts: GameConnection suma onWorld(cb: (w: WorldSnapshot, receivedAtMs: number) => void) y onCombat(cb: (e: CombatEvent) => void)
  interface WorldSnapshot { tick: number; level: number; xp: number; xpToNext: number;
    enemies: Map<string, { kind: EnemyKind; x: number; z: number; facing: number; hp: number; maxHp: number; ai: string; aiTime: number }>;
    projectiles: Map<string, { x: number; z: number }> }
  ```
  `PlayerSnapshot` suma `hp`, `maxHp`, `dead`, `respawnIn`, `comboStep` y `swingTimer`.

Reglas de animación (prioridad de arriba hacia abajo):
- **Héroe:**
  - `dead` → `Death_A`, sin bucle (queda en la última pose).
  - `dodging` → `Dodge_Forward`.
  - `swingTimer > 0` → según `comboStep`: `1H_Melee_Attack_Chop`, `1H_Melee_Attack_Slice_Diagonal` o `1H_Melee_Attack_Stab`, sin bucle y con `speed` ajustada para que dure lo mismo que el swing.
  - `airborne` → `Jump_Idle`.
  - `hurtRecently` → `Hit_A`.
  - `speed > 6` → `Running_A` a ×1.4; `speed > 0.2` → `Running_A` a ×1.
  - Si no, `Idle`.
- **Enemigo:**
  - `dead` → `Death_A`, sin bucle.
  - `telegraph` → `1H_Melee_Attack_Chop` (`brute`/`minion`) o `Spellcast_Shoot` (`mage`), sin bucle, con `speed` para que termine al final de la telegrafía.
  - `hurtRecently` → `Hit_A`.
  - `speed > 0.2` → `Running_A`, a ×1.3 si es `minion`.
  - Si no, `Idle`.

Comportamiento:
- **Jugadores:** cada jugador es un `CharacterView("knight")` con `CHARACTER_SCALE`, mostrando `1H_Sword` y `Round_Shield` y ocultando las demás armas. Se conserva la etiqueta con el nombre.
  - La velocidad del jugador propio sale de la diferencia entre frames de la posición dibujada.
  - La de los remotos, de la interpolación.
  - Cada `swing` de otro jugador dispara su clip de ataque.
- **Enemigos:** se interpolan con un `SnapshotBuffer` por id (igual que los jugadores remotos).
  - Modelo: `brute` → `skeletonWarrior` con `axe`; `minion` → `skeletonMinion` con `blade`; `mage` → `skeletonMage` con `staff`. El arma se cuelga del nodo `handslot.r`.
  - Una barra de vida encima, visible solo si `hp < maxHp`.
  - Durante `telegraph`, un **aro rojo en el suelo** que se llena con `aiTime / telegraphS`.
- **Proyectiles:** esferas brillantes interpoladas.

- [ ] **Paso 1: Tests que fallan** de `chooseHeroAnim` y `chooseEnemyAnim`:
  - Una prueba por cada fila de las reglas, incluida la prioridad: `dead` gana a todo; `dodging` gana al ataque; un swing en el aire muestra el ataque.
  - El `speed` del clip de ataque hace que dure lo mismo que `combo[step-1].duration`, suponiendo la duración del clip como dato de entrada. Para eso, la función recibe un mapa opcional `clipLengths` con las duraciones; sin el mapa, `speed = 1`.
- [ ] **Paso 2:** Correr → FALLA. **Paso 3:** Implementar `animState.ts` → PASA.
- [ ] **Paso 4:** Implementar `characterView.ts`, las vistas y los cambios de `connection.ts` y `main.ts`.
- [ ] **Paso 5:** `npm test`, `npm run typecheck` y build → PASAN.
- [ ] **Paso 6: Verificación** headless con capturas:
  - Un caballero con espada y escudo, del tamaño correcto respecto del muro (~1,85 m contra 3 m).
  - Al entrar a una sala aparecen esqueletos animados que se acercan.
  - Se ve el aro de telegrafía.
  - Sin errores en consola.
- [ ] **Paso 7: Commit** `feat(client): caballero y esqueletos animados`.

### Tarea 8: Combate en el cliente (input, HUD, efectos, versión)

**Archivos:**
- Crear: `packages/client/src/ui/hud.ts`, `packages/client/src/render/fx.ts`, `packages/client/test/{hud,viewTick}.test.ts`
- Modificar: `packages/client/src/input/{InputState.ts,browserInput.ts}`, `packages/client/test/InputState.test.ts`, `packages/client/src/ui/errors.ts`, `packages/client/test/errors.test.ts`, `packages/client/src/main.ts`, `README.md`, `docs/specs/2026-10-23-roguelike-coop-design.md` (§4.2: clic izquierdo = atacar, ya estaba; agregar nota de las decisiones de este plan)

**Interfaces:**
- Produce:
  ```ts
  // InputState: "Mouse0" en keyDown/keyUp = ataque. sample() devuelve attack=true una vez por clic (como el salto).
  // Mientras se mantiene el clic, repite el ataque cada vez que se puede: attack=true en cada sample mientras siga presionado.
  // viewTick: SnapshotBuffer<number> de state.tick (por receivedAt); se envía sample(renderAt) en cada input.
  formatHp(hp: number, maxHp: number): string            // "Vida 96/120"
  formatXp(level: number, xp: number, toNext: number): string   // "Nivel 2 · 14/30 XP"
  ```

Comportamiento:
- **Ataque:** `browserInput` traduce `mousedown`/`mouseup` del botón 0 sobre el canvas (con el puntero bloqueado) en `keyDown("Mouse0")`/`keyUp("Mouse0")`. El primer clic, el que bloquea el puntero, **no** ataca.
- **Al atacar el jugador propio:** el clip de ataque arranca de inmediato, sin esperar al servidor (solo lo visual). El daño lo decide el servidor.
- **Eventos `damage`:** número flotante sobre el objetivo, blanco si es contra un enemigo y rojo si es contra un jugador. Si el objetivo es el jugador propio, además hay un destello rojo en los bordes de la pantalla.
- **HUD:** abajo a la izquierda, barra de vida con `formatHp` y barra de XP con `formatXp`. Si `levelUp`, el texto "¡Nivel N!" aparece 2 s en el centro.
- **Muerte propia:** overlay "Caíste — reapareces en N…" con la cuenta regresiva de `respawnIn`. Mientras está muerto, el cliente no envía movimiento.
- **Versión:** `joinErrorMessage` mapea 4104 a "Hay una versión nueva del juego: recarga la página (Cmd+Shift+R)".
- **README:** agregar "clic izquierdo para atacar (mantener para encadenar el combo)".

- [ ] **Paso 1: Tests que fallan:**
  - `InputState`: un clic produce `attack: true` en un `sample`. Mantener el clic produce `attack: true` en samples sucesivos. `blur` lo suelta.
  - `formatHp(96, 120) === "Vida 96/120"`. `formatXp(2, 14, 30) === "Nivel 2 · 14/30 XP"`.
  - `joinErrorMessage({code: 4104})` → el texto de versión.
  - `viewTick`: con snapshots de tick 10 en t=0 y tick 13 en t=100 ms, `sample(50)` da 11.5.
- [ ] **Paso 2:** Correr → FALLA. **Paso 3:** Implementar la parte pura → PASA.
- [ ] **Paso 4:** Implementar HUD, efectos, cableado en `main.ts`, README y la nota del spec.
- [ ] **Paso 5:** `npm test`, `npm run typecheck` y build → PASAN.
- [ ] **Paso 6: Verificación headless** (sin commitear el script):
  - Con un cliente, entrar a una sala, hacer clic repetido frente a un esqueleto y ver bajar su barra de vida y aparecer números.
  - Dejarse golpear: baja la vida y aparece el destello.
  - Morir: aparece el overlay y se reaparece a los 5 s.
  - Conectarse con `version: 1` (vía SDK desde Node): el error es 4104.
  - Capturas en el scratchpad.
- [ ] **Paso 7: Commit** `feat(client): atacar, HUD, números de daño y aviso de versión`.

### Tarea 9: Revisión manual para el usuario

**Archivos:** solo `README.md` (sección "Qué probar en el Plan 2"), si hace falta.

- [ ] **Paso 1:** Escribir en el informe la lista de chequeos manuales para el usuario, con `npm run dev` en `http://localhost:5173` y dos ventanas:
  - La sensación del combo.
  - Si los golpes "entran" con `?lag=150`.
  - Esquivar golpes telegrafiados con C.
  - Subir de nivel en co-op (la XP compartida se refleja en ambos).
  - Morir y reaparecer.
  - Recargar a mitad de pelea y conservar la vida.
  - Si los FPS se mantienen con 4 jugadores y unos 9 esqueletos.
- [ ] **Paso 2: Commit** si hubo cambios en el README.

---

## Decisiones de este plan que conviene revisar

- **Puertas que se cierran (spec §4.8): pasan a un plan posterior.** Bloquear casillas en tiempo de ejecución obliga a que la colisión del cliente (predicción) y la del servidor conozcan el estado de las puertas, y a no atrapar a quien esté en el umbral. Es mejor hacerlo con el combate ya probado.
- **Al morir se reaparece a los 5 s junto a un aliado**, con 1 s de invulnerabilidad. Es provisorio: el spec §4.6 (caídos, revivir y derrota) llega en el Plan 6.
- **Los enemigos no bloquean a los jugadores; solo se separan entre ellos.** Que el servidor empuje a un jugador rompería la predicción.
- **Atacar no frena el movimiento**, y el golpe sale hacia donde mira la cámara.
- **Stats por nivel en este plan: solo vida y daño.** Velocidad de movimiento y de ataque quedan para el Plan 3, junto con las curvas por clase.
- **Los élites (spec §4.8) quedan para el Plan 4**, junto con los cofres.
- **La gracia de esquive es de 150 ms:** un golpe se descarta si el jugador empieza a esquivar hasta 150 ms después de que el servidor lo resolvió. Es la forma simple de que el esquive "cuente desde que se presionó" (spec §5.1).
