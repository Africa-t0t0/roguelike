# Plan 3b: Presión por tiempo, orbes de XP y enemigos armados. Plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDA: usar superpowers:subagent-driven-development (recomendado) o superpowers:executing-plans para implementar este plan tarea por tarea. Los pasos usan checkboxes (`- [ ]`) para seguimiento.

**Objetivo:** Cada piso tiene un reloj, y un director hace llegar enemigos cada vez más seguido; esos enemigos rodean paredes para llegar a los jugadores. La XP cae en orbes que hay que recoger, y los enemigos llevan armas con tier que a veces sueltan.

**Arquitectura:**
- **`shared`** concentra toda la lógica pura y determinista, con tests:
  - tiers de arma y daño de enemigos armados (`weapons.ts`);
  - curva del director y números de los orbes (`waves.ts`);
  - mapa de flujo y línea de vista sobre la grilla (`nav.ts`).
- **Servidor:**
  - `EnemySystem` gana equipamiento (`loadout`) y navegación, y crea enemigos de oleada.
  - Hay dos sistemas nuevos: `WaveDirector` y `OrbSystem`.
  - `RunRoom` los conecta y reparte el botín.
- **Cliente:** muestra el reloj, los orbes, el tier del arma, las armas de los enemigos y su clip de ataque con espada.

**Stack:** el mismo, sin dependencias nuevas.

**Spec:** `docs/specs/2026-10-25-presion-botin-design.md`. Antes: `docs/specs/2026-10-24-elenco-armas-estilos-design.md` y `docs/specs/2026-10-23-roguelike-coop-design.md`.

## Restricciones globales

- **Tiers** (`WeaponTier = 1 | 2 | 3`, en `packages/shared/src/weapons.ts`):
  - `1`: sufijo "oxidada"/"oxidado", `damageMult 1.0`, `dropChance 0.10`, sin brillo.
  - `2`: "templada"/"templado", `1.3`, `0.14`, brillo `[0.35, 0.55, 1.0]`.
  - `3`: "rúnica"/"rúnico", `1.7`, `0.18`, brillo `[0.65, 0.3, 1.0]`.
  - El sufijo concuerda con el género del nombre del arma: `kingslayer-sword` "f", `guard-sword` "f", `great-sword` "m".
  - Nombre visible: `${WEAPONS[id].name} ${sufijo}`, por ejemplo "Mandoble templado".
- **Daño del jugador:** `round((weapon.damage + damagePerLevel × (nivel − 1)) × golpe.damageMult × tier.damageMult)`.
- **Enemigo armado:**
  - Daño: `round(ENEMY_DEFS[kind].damage × (WEAPONS[w].damage / 12) × tier.damageMult)`.
  - Alcance de ataque: `max(ENEMY_DEFS[kind].attackRange, 0.75 × strikeOf(w, 1).range)`.
- **Quién va armado** (`ARMED_CHANCE`):
  - `minion`: 0.6 con `guard-sword`.
  - `brute`: 0.6 con `great-sword`.
  - `mage`: nunca.
  - Solo los armados tienen tier y pueden soltar su arma.
- **Pesos de tier** (por enemigo armado, con `t = floorTime + 60 × (floor − 1)` en segundos):
  - `t < 120`: `[1, 0, 0]`.
  - `t < 240`: `[0.70, 0.25, 0.05]`.
  - Si no: `[0.40, 0.40, 0.20]`.
- **Director:**
  - Intensidad `I = 1 + floorTime / 60`.
  - Intervalo `max(2, 10 / I)` s.
  - Tamaño del grupo `1 + floor(floorTime / 90) + (jugadores − 1)`.
  - Tipos permitidos: `floorTime < 60`: solo `minion`; `< 120`: `minion`, `brute`; si no: los tres.
  - Tope de vivos: `30 + 10 × (jugadores − 1)`, contando todos los enemigos que no están en `dead`.
  - El primer grupo sale cuando `floorTime ≥ 10`.
- **Dónde aparecen los de oleada:**
  - Casillas caminables con distancia de recorrido de 8 a 30 casillas al jugador vivo más cercano, fuera de toda sala con un jugador vivo dentro.
  - Si no hay ninguna, las más lejanas alcanzables con distancia ≥ 6, también fuera de esas salas.
  - Si tampoco hay, el grupo se salta con `console.warn`.
  - Los de oleada nacen en `chase`, con `roomId = -1`.
- **Orbes:**
  - Al morir, la XP del enemigo se reparte en orbes de 1 a 4 XP (`splitXp`).
  - Imán: radio `3` m, velocidad `8` m/s.
  - Se recogen a `0.8` m.
  - Tope de `150` orbes: al pasarlo, el más viejo se fusiona con su vecino más cercano.
  - Son compartidos: cualquier jugador vivo los recoge y suman al grupo.
  - Matar ya no da XP directamente.
- **Arma soltada:**
  - Con `tier.dropChance`, cada jugador **conectado** recibe su propia copia `{weaponId, tier, x, z}` en `floorWeapons`, en la posición del enemigo.
  - Las armas del suelo iniciales y la Kingslayer inicial son tier 1.
- **Reloj:** `RunState.floorTime` avanza `SIM_DT` por tick solo si hay al menos un jugador conectado. El HUD lo muestra como `mm:ss`.
- **Protocolo:** `PROTOCOL_VERSION = 5`.
  - `PlayerState.weaponTier: number`.
  - `EnemyState.weaponId: string` (`""` si va desarmado) y `EnemyState.weaponTier: number` (`0` si va desarmado).
  - `RunState.floorTime: number` y `RunState.orbs: map<OrbState{x, z, value}>`.
  - Los ítems de `floorWeapons` suman `tier`.
- **Navegación:**
  - Mapa de flujo por BFS sobre la grilla, con 8 vecinos, sin cortar esquinas (una diagonal exige que las dos ortogonales sean caminables). Es multi-fuente: parte de las casillas de los jugadores vivos.
  - Se recalcula cuando cambia el conjunto de casillas de los jugadores vivos.
  - Con línea de vista al objetivo, el enemigo va directo; sin ella, sigue el flujo.
- **Sin `Math.random`** en `shared` ni en `server/src/sim`; todo con la `Rng` sembrada.
- Textos visibles en español. Commits con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Los tres paquetes en verde al final de cada tarea (`npm test` en la raíz).

## Foco de revisión

1. **Enemigo de oleada encerrado:** un enemigo que nace en una sala sin línea de vista al jugador tiene que llegar hasta él rodeando paredes, sin quedarse frotándose contra un muro. Test en la Tarea 4 (dungeon en "L").
2. **Jugadores que se separan:** con dos jugadores lejos uno del otro, cada enemigo sigue el flujo hacia el más cercano por recorrido, y el director no aparece enemigos dentro de la sala de ninguno de los dos. Tests en las Tareas 3 y 5.
3. **Sala vacía o todos muertos:** sin jugadores conectados, `floorTime` no avanza y el director no crea nada. Con todos muertos, no aparecen grupos ni se mueven orbes. Test en la Tarea 5.
4. **Recarga a mitad del piso** (reconexión o unirse tarde): el arma con su tier y las armas del suelo con tier se conservan, y el reloj y los orbes llegan en el estado. Test en la Tarea 6.
5. **Muchas muertes juntas:** un golpe del mandoble que mata a 5 enemigos crea los orbes de todos, el tope de 150 se respeta y la XP total recogida es exactamente la suma de la XP de los muertos. Tests en las Tareas 2 y 6.

---

## Estructura de archivos

```
packages/shared/src/weapons.ts       (mod) tiers, nombre con tier, daño con tier, ataque de enemigo armado
packages/shared/src/waves.ts         (nuevo) curva del director, pesos de tier, splitXp, constantes de orbes
packages/shared/src/nav.ts           (nuevo) FlowField + línea de vista
packages/shared/src/protocol.ts      (mod) PROTOCOL_VERSION 5
packages/shared/src/index.ts         (mod) exporta waves y nav
packages/server/src/sim/EnemySystem.ts   (mod) loadout, navegación, spawnWave, botín al morir
packages/server/src/sim/WaveDirector.ts  (nuevo)
packages/server/src/sim/OrbSystem.ts     (nuevo)
packages/server/src/sim/CombatSystem.ts  (mod) tier en el daño, kills en vez de xpGained
packages/server/src/rooms/*              (mod) estado, sync, integración
packages/client/src/net/connection.ts    (mod) parseo de lo nuevo
packages/client/src/ui/hud.ts            (mod) reloj, nombre con tier
packages/client/src/render/orbViews.ts   (nuevo)
packages/client/src/render/floorWeaponViews.ts, enemyViews.ts, characterView.ts, animState.ts, looks.ts (mod)
```

---

### Tarea 1: Tiers de arma y ataque de enemigos armados (shared)

**Archivos:**
- Modificar: `packages/shared/src/weapons.ts` y `packages/shared/src/protocol.ts`
- Test: `packages/shared/test/weapons.test.ts`

**Interfaces:**
- Produce:
  - `type WeaponTier = 1 | 2 | 3`.
  - `TIERS: Record<WeaponTier, { suffix: { f: string; m: string }; damageMult: number; dropChance: number; glow: [number, number, number] | null }>`.
  - `isWeaponTier(v: unknown): v is WeaponTier`.
  - `Weapon.gender: "f" | "m"`.
  - `weaponDisplayName(id: WeaponId, tier: WeaponTier): string`.
  - `strikeDamage(weaponId, cls, level, step, tier: WeaponTier = 1): number`.
  - `type EnemyLoadout = { weaponId: WeaponId; tier: WeaponTier }`.
  - `ARMED_CHANCE: Record<EnemyKind, { chance: number; weaponId: WeaponId } | null>`.
  - `enemyAttack(kind: EnemyKind, loadout: EnemyLoadout | null): { damage: number; attackRange: number }`.
  - `PROTOCOL_VERSION = 5`.

- [ ] **Paso 1: Tests que fallan** en `weapons.test.ts`:
  - `weaponDisplayName("great-sword", 2) === "Mandoble templado"`, `weaponDisplayName("guard-sword", 3) === "Espada de guardia rúnica"`, `weaponDisplayName("kingslayer-sword", 1) === "Espada del Kingslayer oxidada"`.
  - `strikeDamage("great-sword", "warrior", 1, 1, 3) === Math.round(18 * 1 * 1.7)` (31), y sin tier sigue igual que hoy.
  - `enemyAttack("minion", null)` da `{ damage: 6, attackRange: 1.2 }`.
  - `enemyAttack("brute", { weaponId: "great-sword", tier: 2 })` da `damage = Math.round(12 * 18 / 12 * 1.3)` (23) y `attackRange = 2.25`.
  - `enemyAttack("minion", { weaponId: "guard-sword", tier: 1 })` da `damage = 5` y `attackRange ≈ 1.485`.
  - `ARMED_CHANCE.mage === null`.
  - `isWeaponTier(0)`, `isWeaponTier(4)` y `isWeaponTier("2")` dan false.
- [ ] **Paso 2:** `npm test -w packages/shared` → FALLA.
- [ ] **Paso 3:** implementar con los números de las Restricciones globales; subir `PROTOCOL_VERSION` a 5.
- [ ] **Paso 4:** `npm test` en la raíz → los tres paquetes PASAN. Si un test de servidor o cliente compara la versión del protocolo, sale de la constante.
- [ ] **Paso 5:** commit `feat(shared): tiers de arma y ataque de enemigos armados`.

### Tarea 2: Curva del director y orbes (shared)

**Archivos:**
- Crear: `packages/shared/src/waves.ts` y `packages/shared/test/waves.test.ts`
- Modificar: `packages/shared/src/index.ts`

**Interfaces:**
- Consume: `WeaponTier`, `EnemyKind`, `Rng`.
- Produce:
  - `waveInterval(floorTime: number): number`.
  - `waveGroupSize(floorTime: number, players: number): number`.
  - `waveKinds(floorTime: number): EnemyKind[]`.
  - `maxLiveEnemies(players: number): number`.
  - `WAVE_FIRST_AT_S = 10`.
  - `tierWeights(floorTime: number, floor: number): [number, number, number]`.
  - `rollTier(rng: Rng, floorTime: number, floor: number): WeaponTier`.
  - `splitXp(xp: number, rng: Rng): number[]`: valores enteros de 1 a 4 cuya suma es `xp`; con `xp ≤ 0`, `[]`.
  - Constantes: `ORB_MAGNET_RADIUS = 3`, `ORB_SPEED = 8`, `ORB_PICKUP_RADIUS = 0.8`, `MAX_ORBS = 150`.
  - `WAVE_SPAWN_BAND = { min: 8, max: 30 }`, `WAVE_SPAWN_FALLBACK_MIN = 6`.

- [ ] **Paso 1: Tests que fallan:**
  - `waveInterval(0) === 10`, `waveInterval(60) === 5`, `waveInterval(600) === 2`.
  - `waveGroupSize(0, 1) === 1`, `waveGroupSize(180, 3) === 5`.
  - `waveKinds(30)` da `["minion"]`, `waveKinds(90)` da `["minion", "brute"]` y `waveKinds(130)` da los tres.
  - `maxLiveEnemies(1) === 30`, `maxLiveEnemies(4) === 60`.
  - `tierWeights(0, 1)` da `[1, 0, 0]`, `tierWeights(150, 1)` da `[0.7, 0.25, 0.05]`, `tierWeights(60, 2)` da `[0.7, 0.25, 0.05]` y `tierWeights(300, 1)` da `[0.4, 0.4, 0.2]`.
  - `rollTier` con 2000 sorteos a `t = 300` cae en cada tier dentro de ±5 puntos de los pesos.
  - `splitXp` para `xp` de 1 a 40, con 20 semillas: suma exacta y todos los valores en `[1, 4]`.
- [ ] **Paso 2:** FALLA. **Paso 3:** implementar y exportar desde `index.ts`. **Paso 4:** PASA (`npm test`).
- [ ] **Paso 5:** commit `feat(shared): curva del director, tiers por tiempo y reparto de XP en orbes`.

### Tarea 3: Mapa de flujo y línea de vista (shared)

**Archivos:**
- Crear: `packages/shared/src/nav.ts` y `packages/shared/test/nav.test.ts`
- Modificar: `packages/shared/src/index.ts`

**Interfaces:**
- Consume: `Dungeon`, `isWalkableTile`, `TILE_SIZE`.
- Produce:
  - `class FlowField`:
    - `constructor(dungeon: Dungeon)`.
    - `rebuild(sources: readonly { tx: number; tz: number }[]): void`.
    - `distance(tx: number, tz: number): number`: pasos de recorrido; `Infinity` si es inalcanzable o es muro.
    - `next(tx: number, tz: number): { tx: number; tz: number } | null`: la casilla vecina con menor distancia; `null` si está en una fuente o es inalcanzable.
    - `readonly sourcesKey: string`: las fuentes ordenadas y serializadas, para saber si hace falta recalcular.
  - `hasLineOfSight(dungeon: Dungeon, ax: number, az: number, bx: number, bz: number, radius: number): boolean`: en metros. Muestrea el segmento cada ≤ `TILE_SIZE / 4` y comprueba que cada punto y sus cuatro desplazamientos `±radius` estén en casillas caminables.

- [ ] **Paso 1: Tests que fallan.** Arman un `Dungeon` a mano (helper en el test) con forma de "L": dos salas unidas por un pasillo que dobla.
  - `distance` en una fuente da 0, en un muro `Infinity`, y en la otra punta de la L el largo exacto del recorrido.
  - Seguir `next` desde la punta llega a la fuente en `distance` pasos, sin pisar muros y sin diagonales que corten una esquina.
  - Con dos fuentes en salas distintas, cada casilla apunta hacia la fuente más cercana por recorrido.
  - `hasLineOfSight` da true dentro de una sala, false a través del codo de la L, y false si el segmento roza un muro a menos de `radius`.
  - `rebuild` con un tablero de 60×60 corre en menos de 5 ms de media (100 repeticiones).
- [ ] **Paso 2:** FALLA. **Paso 3:** implementar (BFS con cola en `Int32Array`). **Paso 4:** PASA.
- [ ] **Paso 5:** commit `feat(shared): mapa de flujo y línea de vista sobre la grilla`.

### Tarea 4: Enemigos armados, navegación y oleadas (EnemySystem)

**Archivos:**
- Modificar: `packages/server/src/sim/EnemySystem.ts`
- Test: `packages/server/test/EnemySystem.test.ts`

**Interfaces:**
- Consume: Tareas 1–3.
- Produce:
  - `Enemy` suma `loadout: EnemyLoadout | null`.
  - `EnemySystem.constructor(dungeon, rng)` igual que hoy.
  - `setFloorClock(floorTime: number, floor: number): void`: con estos valores se sortean los tiers de los enemigos que se crean después.
  - `spawnWave(spots: readonly { x: number; z: number }[], kinds: readonly EnemyKind[]): Enemy[]`: un enemigo por spot, de tipo `kinds[i % kinds.length]`, en `chase`, con `roomId -1`.
  - `liveCount(): number`: los que no están en `dead`.
  - `damage(enemyId, amount): { killed: boolean; xp: number; x: number; z: number; drop: EnemyLoadout | null }`. `drop` solo se sortea al morir un armado, con `TIERS[tier].dropChance`.
  - `get flow(): FlowField`: el campo que usa `step`; el director también lo lee.
  - `step(players, dt)`:
    - al principio recalcula el flujo si cambió `sourcesKey`;
    - el ataque cuerpo a cuerpo usa `enemyAttack(kind, loadout)`;
    - el movimiento de persecución va directo con línea de vista y, sin ella, hacia el centro de `flow.next(...)`;
    - los magos que retroceden siguen moviéndose como hoy.

- [ ] **Paso 1: Tests que fallan:**
  - Con una `Rng` sembrada y 500 esbirros creados con `spawnWave`, la fracción de armados con `guard-sword` está en 0,6 ± 0,06; los magos nunca van armados.
  - Con `setFloorClock(0, 1)`, todos los armados son tier 1.
  - Un bruto armado con `great-sword` tier 2 que golpea a un jugador quieto genera un `EnemyHit` de 23 de daño, desde 2,2 m de distancia.
  - **(Foco 1)** En el dungeon en L de la Tarea 3, un esbirro de oleada en una punta y un jugador quieto en la otra: en ≤ 30 s simulados llega a menos de 1,5 m, y nunca termina un tick dentro de un muro.
  - `damage` hasta matar a un armado devuelve su posición, la XP de `ENEMY_DEFS` y, con una semilla elegida, un `drop` igual a su `loadout`. Con un desarmado, `drop` es siempre `null`.
  - `liveCount()` no cuenta a los que están en su animación de muerte.
  - Los tests actuales de `activateRooms` siguen pasando; los enemigos de sala también sortean su `loadout`.
- [ ] **Paso 2:** FALLA. **Paso 3:** implementar. **Paso 4:** `npm test` PASA. `CombatSystem` se adapta a la nueva forma de `damage` sin cambiar su comportamiento (el `xp` sigue llegando a `xpGained` por ahora; la Tarea 6 lo cambia).
- [ ] **Paso 5:** commit `feat(server): enemigos armados con tier, navegación por flujo y oleadas`.

### Tarea 5: Reloj del piso y director de oleadas

**Archivos:**
- Crear: `packages/server/src/sim/WaveDirector.ts` y `packages/server/test/WaveDirector.test.ts`
- Modificar: `packages/server/src/rooms/RunState.ts`, `syncState.ts` y `RunRoom.ts`; test en `packages/server/test/RunRoom.test.ts`

**Interfaces:**
- Consume: Tareas 2 y 4.
- Produce:
  - `class WaveDirector`:
    - `constructor(dungeon: Dungeon, rng: Rng)`.
    - `step(floorTime: number, alive: readonly SimPlayer[], playerCount: number, enemies: EnemySystem): Enemy[]`: los creados en este tick.
    - `pickSpots(n: number, alive: readonly SimPlayer[], flow: FlowField): { x: number; z: number }[]`: público para testear; aplica la banda y el respaldo de las Restricciones globales.
  - `RunState.floorTime: number`.
  - `RunRoom.tick`:
    - si hay al menos un conectado, `floorTime += SIM_DT`;
    - `enemySystem.setFloorClock(floorTime, floor)`;
    - después de `activateRooms`, `director.step(...)`;
    - nada de esto corre si no hay conectados.

- [ ] **Paso 1: Tests que fallan** (`WaveDirector.test.ts`):
  - Con un jugador quieto y `floorTime` de 0 a 9,9 s, no crea nada.
  - De 10 a 70 s, los grupos salen en los instantes 10, 10 + `waveInterval(10)`, etc. (con tolerancia de un tick), con tamaño `waveGroupSize` y solo tipos de `waveKinds`.
  - Con `liveCount()` en el tope, no crea nada hasta que baja.
  - **(Foco 2)** Ningún spot cae dentro de una sala con un jugador vivo, y todos tienen `flow.distance` entre 8 y 30. En un mapa sin casillas en esa banda, usa el respaldo (≥ 6), y si tampoco hay, devuelve `[]` y emite `console.warn` (con un spy).
  - **(Foco 3)** Con `alive` vacío, no crea nada.
- [ ] **Paso 1b: test en `RunRoom.test.ts`:** con un cliente conectado, `state.floorTime` crece unos 1/30 por tick. Al irse el cliente, deja de crecer. Con una semilla fija y el reloj adelantado a 120 s (exponer `__setFloorTimeForTest` o equivalente en modo test), en pocos ticks aparecen enemigos de oleada en `state.enemies`.
- [ ] **Paso 2:** FALLA. **Paso 3:** implementar. **Paso 4:** PASA.
- [ ] **Paso 5:** commit `feat(server): reloj del piso y director de oleadas`.

### Tarea 6: Orbes de XP, tier del jugador y botín de armas

**Archivos:**
- Crear: `packages/server/src/sim/OrbSystem.ts` y `packages/server/test/OrbSystem.test.ts`
- Modificar: `CombatSystem.ts`, `PlayerRegistry.ts`, `RunState.ts`, `syncState.ts` y `RunRoom.ts`, con sus tests

**Interfaces:**
- Consume: Tareas 1, 2 y 4.
- Produce:
  - `interface Orb { id: string; x: number; z: number; value: number; bornTick: number }`.
  - `class OrbSystem`:
    - `constructor(rng: Rng)`.
    - `spawn(x: number, z: number, xp: number, tick: number): void`: usa `splitXp` y reparte los orbes en un radio de 0,6 m.
    - `step(alive: readonly SimPlayer[], dt: number): number`: XP recogida en este tick.
    - `get orbs(): readonly Orb[]`.
  - `ImpactResult.xpGained` se reemplaza por `kills: { x: number; z: number; xp: number; drop: EnemyLoadout | null }[]`.
  - `CombatState.weaponTier: WeaponTier`; `newCombatState(cls, level, weaponId?, tier = 1)`. El daño del impacto usa `strikeDamage(..., c.weaponTier)`.
  - `FloorWeapon` suma `tier: WeaponTier`; el mensaje `floorWeapons` envía `{ weaponId, tier, x, z }`.
  - El intercambio con E cambia también el tier.
  - Estado:
    - `PlayerState.weaponTier`.
    - `EnemyState.weaponId` y `EnemyState.weaponTier` (`""`/`0` si va desarmado).
    - `OrbState { x, z, value }` en `RunState.orbs`, indexado por id ("o1", …).
  - **`RunRoom`:**
    - en el impacto, por cada kill: `orbs.spawn(...)`; si hay `drop`, se agrega `{ ...drop, x, z }` a `floorWeapons` de cada conectado y se le reenvía su lista;
    - en cada tick, `grantXp(allStates, orbs.step(alive, SIM_DT))` emite `levelUp` como hoy.

- [ ] **Paso 1: Tests que fallan** (`OrbSystem.test.ts`):
  - Un orbe a 2,5 m de un jugador se le acerca 8 × dt por tick y se recoge al quedar a ≤ 0,8 m. `step` devuelve su valor una sola vez.
  - Un orbe a 5 m no se mueve.
  - Con dos jugadores, va hacia el más cercano.
  - Con `alive` vacío, nada se mueve ni se recoge.
  - **(Foco 5)** Generar 60 kills de 8 XP: nunca hay más de 150 orbes, y la XP total recogida después (jugador encima de todo) es exactamente 480.
- [ ] **Paso 1b: tests en `CombatSystem.test.ts` y `RunRoom.test.ts`:**
  - Un impacto de la Kingslayer tier 3 hace `round(12 × 1.7)` de daño.
  - Matar a un enemigo ya no sube `state.xp` en ese tick, pero deja orbes en `state.orbs`; al pararse encima, `state.xp` sube por la XP del enemigo.
  - Con un drop forzado (semilla o stub), los dos clientes conectados reciben un `floorWeapons` con el ítem nuevo y su tier, y cada uno puede tomarlo con E sin afectar la lista del otro.
  - **(Foco 4)** Al reconectarse por nombre, conserva `weaponTier` en `PlayerState` y el tier de sus armas del suelo.
- [ ] **Paso 2:** FALLA. **Paso 3:** implementar. **Paso 4:** `npm test` PASA.
- [ ] **Paso 5:** commit `feat(server): orbes de XP, tier del arma del jugador y botín de armas`.

### Tarea 7: Cliente: reloj, orbes y tier del arma

**Archivos:**
- Crear: `packages/client/src/render/orbViews.ts`
- Modificar: `packages/client/src/net/connection.ts`, `ui/hud.ts`, `render/floorWeaponViews.ts` y `main.ts`, con sus tests (`hud.test.ts`, `floorWeapons.test.ts` y uno nuevo, `orbViews.test.ts`, si hay lógica pura)

**Interfaces:**
- Consume: Tareas 1, 5 y 6.
- Produce:
  - `WorldSnapshot` suma `floorTime: number` y `orbs: Map<string, { x: number; z: number; value: number }>`.
  - `EnemySnapshot` suma `weaponId: WeaponId | null` y `weaponTier: WeaponTier | null`.
  - `PlayerSnapshot` suma `weaponTier: WeaponTier`.
  - `FloorWeapon` del cliente suma `tier`: `parseFloorWeapons` lo valida con `isWeaponTier` y usa 1 si falta.
  - `formatFloorTime(s: number): string`: `"00:00"`, `"01:05"`, `"61:00"`.
  - `formatWeapon(weaponId, tier)` y `pickupPrompt(weaponId, tier)` usan `weaponDisplayName`.
  - `OrbViews`: una esfera pequeña emisiva y cálida por orbe. Comparte un material, sin luz propia (respeta el presupuesto de luces) y con un brillo que pulsa. Suaviza su posición hacia la del estado (lerp exponencial, τ ≈ 0,05 s) y libera los orbes que desaparecen.
  - Arma del suelo con tier ≥ 2: el aro y la hoja con color emisivo `TIERS[tier].glow`. El material se clona una vez por (arma, tier) y se cachea.

- [ ] **Paso 1: Tests que fallan:**
  - `formatFloorTime` con los tres casos de arriba.
  - `formatWeapon("great-sword", 2) === "Mandoble templado"`.
  - `parseFloorWeapons` acepta `tier: 3`, usa 1 si falta y descarta un ítem con `tier: 7`.
  - Si `OrbViews` tiene lógica separable (diff de ids), testearla con `NullEngine` como en `lighting.test.ts`.
- [ ] **Paso 2:** FALLA. **Paso 3:** implementar. El reloj va arriba al centro, sin tapar la línea de ayuda.
- [ ] **Paso 4:** `npm test` PASA. Verificación headless con un Vite aparte en el puerto 5174 y Chrome con swiftshader (scripts en el scratchpad, sin commitear). Hay que ver el reloj avanzando, los orbes tras matar a un enemigo y la XP subiendo al recogerlos. No usar los puertos 5173 ni 2567: son los servidores del usuario.
- [ ] **Paso 5:** commit `feat(client): reloj del piso, orbes de XP y tier en el arma`.

### Tarea 8: Cliente: enemigos armados

**Archivos:**
- Modificar: `packages/client/src/render/enemyViews.ts`, `characterView.ts`, `animState.ts` y `looks.ts`; tests en `animState.test.ts` y `looks.test.ts`

**Interfaces:**
- Consume: Tareas 1, 6 y 7.
- Produce:
  - `EnemyLook` suma `gripScale?: number` (multiplica `grip.scale` y `grip.position` de `WEAPON_LOOKS`; por defecto 1), ajustado a ojo en `dev/grip.html` para `brute` y `minion`.
  - `CharacterView.setWeapon(weaponId, opts?: { tier?: WeaponTier; gripScale?: number })`: aplica el brillo del tier igual que la Tarea 7 (reusar el helper de materiales por tier en un módulo compartido del cliente).
  - `EnemyAnimInput` suma `weaponId: WeaponId | null`. `chooseEnemyAnim` en `telegraph` usa, si va armado, `strikeOf(weaponId, 1).clip` ajustado a `telegraphS`. El resto de los clips no cambia.
  - `dev/grip.html` permite elegir el arma también para `brute` y `minion`.

- [ ] **Paso 1: Tests que fallan:**
  - `chooseEnemyAnim` de un bruto armado con `great-sword` en `telegraph` da `gs_slash`, con velocidad = largo / 0,6 cuando hay largo; desarmado sigue dando `cr_swiping`.
  - Un esbirro armado con `guard-sword` da `ss_slash`.
  - `looks.test`: todo clip que pueda elegir `chooseEnemyAnim` con cualquier arma de `ARMED_CHANCE` existe en `allClipIds()` y en `public/assets/mixamo/anims/`.
- [ ] **Paso 2:** FALLA. **Paso 3:** implementar. Ajustar `gripScale` con capturas de `dev/grip.html` en el puerto 5174.
- [ ] **Paso 4:** `npm test` PASA. Verificación headless: se ven enemigos con espada y con mandoble; uno tier 2 o 3 brilla (adelantar el reloj con el hook de test de la Tarea 5 o con una semilla); su ataque usa el clip de espada; matar a varios a veces deja un arma en el suelo con el aviso "E: tomar … templado/a".
- [ ] **Paso 5:** commit `feat(client): enemigos con armas visibles, tier y ataque con espada`.
