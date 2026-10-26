# Plan 4b-1: tres hechiceros con un ataque cada uno

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tres tipos de hechicero (arcano, piromante, invocador del rayo), cada uno con un solo ataque que mejora por tier, con avisos sincronizados (zonas y rayos), mejor aspecto visual y comandos de prueba en el panel F2.

**Architecture:**
- **shared:** define los tipos y sus hechizos por tier (`spells.ts`), además de qué hechiceros hay según el reloj.
- **servidor:**
  - `EnemySystem` resuelve el hueco de hechicero por el reloj y les da tier.
  - Dispara orbes en abanico y crea "peligros" (zonas y rayos) que viven en una lista propia y dañan al vencer.
  - `RunRoom` sincroniza los peligros en `RunState.hazards`.
- **cliente:** dibuja el tinte, el aura y la carga en la mano, orbes con estela y estallido, y zonas y rayos con `HazardViews`.

**Tech Stack:** TypeScript, Babylon.js (cliente), Colyseus 0.18 con schema 5 `t.*` (servidor), vitest.

**Spec:** `docs/specs/2026-10-26-hechiceros-design.md`. También importa `docs/specs/2026-10-26-sandbox-design.md` para el panel F2.

## Global Constraints

- Solo desarrollo local; `shared` determinista: usa `Rng` y nunca `Math.random`; servidor autoritativo.
- Tests en verde en los tres paquetes: `npm test`. Además, `npx tsc --noEmit -p .` en cada paquete que se toque.
- `PROTOCOL_VERSION` = 9, y se actualiza la aserción que lo fija en `packages/shared/test/cards.test.ts`.
- Cliente: solo materiales emisivos y partículas, **sin luces nuevas**. Los efectos usan el reloj de juego, así que se congelan en la pausa. Los materiales se clonan por tipo o tier, no por instancia.
- Sin verificaciones en navegador headless dentro de las tareas. Las capturas las hace el controlador al final, en el sandbox.
- Comentarios y textos en español, con el estilo y la densidad de comentarios del código vecino.
- Los números del spec son exactos. Copia del spec:
  - Arcano: daño 10, preferido de 6 a 10 m, preparación 0,7 s; tier 1: 1 orbe a 9 m/s; tier 2: 1 a 12 m/s; tier 3: 3 en abanico ±15° a 12 m/s.
  - Piromante: daño 14, preferido de 7 a 12 m, enfriamiento 3 s, vida 30, zona que explota 1,2 s después de aparecer; tier 1: radio 2,5; tier 2: 3,2; tier 3: 3 zonas de 2,5 m (en el objetivo y a ±3 m perpendicular a mago→objetivo).
  - Invocador: daño 12, preferido de 8 a 13 m, enfriamiento 3,5 s, vida 26, rayo de 14 m cortado por muros; sigue al objetivo el 60 % de la preparación; tier 1: 1,1 s y ancho 0,8; tier 2: 0,9 s y 0,8; tier 3: 0,9 s y 1,3.
  - Ambos tipos nuevos dan XP 8. El rayo se queda 0,15 s en `fire`.
  - Hechiceros disponibles: arcano desde 0 s (en oleadas desde 120 s, como hoy), piromante desde 240 s, invocador desde 360 s.

## Review Focus

1. **Un hechicero aturdido (Patada) o muerto mientras prepara el rayo:** su aviso debe desaparecer sin disparar. Una zona ya marcada sí explota aunque el piromante muera, porque el aviso ya estaba a la vista. Test en la tarea 3.
2. **Rayo desde un mago pegado a un muro, o con el objetivo detrás de una esquina:** el rayo se corta en el primer muro y no daña a través de él. Test en la tarea 3.
3. **Dos jugadores dentro de la misma zona o sobre el mismo rayo:** ambos reciben daño, una sola vez cada uno por peligro. Test en la tarea 3.
4. **Pausa de elección con peligros activos:** no avanzan ni explotan, y al reanudar les queda el mismo tiempo. Test en la tarea 4.
5. **Sandbox: "Hechizo ya" con "Enemigos quietos" activo:** los hechiceros quietos igual completan el ataque que empezaron; los cuerpo a cuerpo no se mueven. Test en la tarea 4.

---

### Task 1: shared, tipos de hechicero y sus hechizos

**Files:**
- Create: `packages/shared/src/spells.ts` (exportar desde `src/index.ts`)
- Modify: `packages/shared/src/combat.ts` (`EnemyKind`, `EnemyDef.ranged`, `ENEMY_DEFS`)
- Modify: `packages/shared/src/waves.ts` (`casterKinds`)
- Modify: `packages/shared/src/protocol.ts` (`PROTOCOL_VERSION = 9`)
- Test: `packages/shared/test/spells.test.ts`, `packages/shared/test/cards.test.ts` (versión 9)

**Interfaces:**
- Produces:
  - `type EnemyKind = "minion" | "brute" | "mage" | "pyromancer" | "stormcaller"`.
  - `type CasterKind = "mage" | "pyromancer" | "stormcaller"`.
  - `isCaster(kind: EnemyKind): kind is CasterKind`.
  - `EnemyDef.ranged` queda como `{ preferredMin: number; preferredMax: number; losRadius: number }`; los datos del orbe pasan a `SPELLS`.
  - `ORB = { radius: 0.3, lifetimeS: 3 }`.
  - `SPELLS`:
    - `mage`: `{ kind: "orb", tiers: Record<WeaponTier, { count: number; speed: number; spreadDeg: number }> }`.
    - `pyromancer`: `{ kind: "zone", fuseS: 1.2, sideOffsetM: 3, tiers: Record<WeaponTier, { count: 1 | 3; radius: number }> }`.
    - `stormcaller`: `{ kind: "beam", length: 14, trackFrac: 0.6, fireS: 0.15, tiers: Record<WeaponTier, { telegraphS: number; width: number }> }`.
  - `casterTelegraphS(kind: EnemyKind, tier: number): number`: el `telegraphS` de `ENEMY_DEFS`, salvo para `stormcaller`, que usa el de `SPELLS` según su tier. Un tier fuera de 1..3 se acota.
  - `casterKinds(floorTime: number): CasterKind[]`: `["mage"]` antes de 240 s; `["mage","pyromancer"]` desde 240 s; los tres desde 360 s.
  - `ENEMY_DEFS`:
    - `pyromancer`: `{ hp: 30, speed: 3, radius: 0.5, damage: 14, attackRange: 0, telegraphS: 0.6, cooldownS: 3, xp: 8, ranged: { preferredMin: 7, preferredMax: 12, losRadius: 0.3 } }`.
    - `stormcaller`: `{ hp: 26, speed: 3, radius: 0.5, damage: 12, attackRange: 0, telegraphS: 1.1, cooldownS: 3.5, xp: 8, ranged: { preferredMin: 8, preferredMax: 13, losRadius: 0.3 } }`.
    - `mage`: sin cambios, salvo `ranged: { preferredMin: 6, preferredMax: 10, losRadius: 0.3 }`.
  - `ARMED_CHANCE` suma `pyromancer: null` y `stormcaller: null`.

- [ ] **Step 1: Write failing tests** in `test/spells.test.ts`:
  - `casterKinds`: `(0)` → `["mage"]`; `(239.9)` → `["mage"]`; `(240)` → `["mage","pyromancer"]`; `(360)` → los tres.
  - `isCaster`: `"mage"`, `"pyromancer"` y `"stormcaller"` → `true`; `"brute"` → `false`.
  - `casterTelegraphS`: `("stormcaller",1)` → 1.1; `("stormcaller",2)` → 0.9; `("stormcaller",3)` → 0.9; `("stormcaller",0)` → 1.1 (acotado); `("pyromancer",3)` → 0.6; `("mage",2)` → 0.7; `("brute",1)` → 0.6.
  - `SPELLS.mage.tiers`: `{1:{count:1,speed:9,spreadDeg:0},2:{count:1,speed:12,spreadDeg:0},3:{count:3,speed:12,spreadDeg:15}}`.
  - `SPELLS.pyromancer.tiers`: `{1:{count:1,radius:2.5},2:{count:1,radius:3.2},3:{count:3,radius:2.5}}`.
  - `SPELLS.stormcaller.tiers`: `{1:{telegraphS:1.1,width:0.8},2:{telegraphS:0.9,width:0.8},3:{telegraphS:0.9,width:1.3}}`.
  - Los números de los dos tipos nuevos en `ENEMY_DEFS`, como arriba.
- [ ] **Step 2:** Correr `npx vitest run test/spells.test.ts` en `packages/shared` y ver el FAIL.
- [ ] **Step 3:** Implementar. Arreglar los usos de `ranged.projectileSpeed/projectileRadius/lifetimeS` en los tres paquetes, que pasan a `SPELLS.mage.tiers` y `ORB`. Los usos de `Record<EnemyKind, …>` que dejen de compilar se completan, también en el cliente: en `ENEMY_LOOKS`, los nuevos copian el look de `mage` con `asset: "mage"`. Ese parche en el cliente basta para compilar; el aspecto de verdad llega en la tarea 6.
- [ ] **Step 4:** Correr `npm test` en la raíz y `npx tsc --noEmit -p .` en los tres paquetes: todo PASS.
- [ ] **Step 5:** Commit con `feat(shared): tipos de hechicero y sus hechizos por tier`.

### Task 2: servidor, tier de hechiceros, hueco de hechicero y orbes por tier

**Files:**
- Modify: `packages/server/src/sim/EnemySystem.ts`
- Test: `packages/server/test/EnemySystem.test.ts`

**Interfaces:**
- Consumes: todo lo de la tarea 1.
- Produces:
  - `Enemy.spellTier: 0 | WeaponTier`: 0 para los que no son hechiceros. A un hechicero se le sortea con `rollTier(rng, floorTime, floor)` al crearlo.
  - `spawnAt(kind, x, z, tier: 0 | WeaponTier): Enemy` reemplaza la firma de loadout. Para `minion` y `brute`, tier 0 significa desarmado y 1..3 el arma de `ARMED_CHANCE` con ese tier. Para un hechicero, tier 0 cuenta como 1.
  - En `spawnWave` y `activateRooms`, cada `"mage"` pedido se cambia por un hechicero de `casterKinds(floorTime)`. Se elige con `rng.pick` **solo si hay más de uno** (con uno no se consume RNG, para no mover las secuencias sembradas de los tests existentes).
  - El arcano dispara `SPELLS.mage.tiers[t].count` proyectiles a `speed`. Con 3, van a −15°, 0° y +15° del rumbo al objetivo. Proyectil: `radius` y `life` de `ORB`.

- [ ] **Step 1: Write failing tests:**
  - Con el reloj en 400 s y la RNG sembrada, 30 `spawnWave` de un solo spot con `["mage"]` → aparecen los 3 tipos de hechicero, y todos con `spellTier` entre 1 y 3.
  - Con el reloj en 0, `spawnWave` con `["mage"]` → `kind === "mage"`.
  - `spawnAt("brute", x, z, 0)` → `loadout === null` y `spellTier === 0`.
  - `spawnAt("brute", x, z, 2)` → `loadout = { weaponId: "great-sword", tier: 2 }`.
  - `spawnAt("pyromancer", x, z, 0)` → `spellTier === 1` y `loadout === null`.
  - Un arcano tier 3 frente a un jugador a 8 m con vista: tras `telegraphS` crea 3 proyectiles con velocidad 12. Sus direcciones forman ángulos de −15°, 0° y +15° con el rumbo (`toBeCloseTo`, 6 decimales).
  - Un arcano tier 1: 1 proyectil con velocidad 9.
- [ ] **Step 2:** Correr `npx vitest run test/EnemySystem.test.ts` en `packages/server` y ver el FAIL.
- [ ] **Step 3:** Implementar. Actualizar el llamador de `spawnAt` en `RunRoom.ts` (comando `spawn` del sandbox): pasa `cmd.tier` directo.
- [ ] **Step 4:** `npm test` en `packages/server` y `npx tsc --noEmit -p .`: PASS.
- [ ] **Step 5:** Commit con `feat(server): hechiceros con tier y orbes del arcano por tier`.

### Task 3: servidor, zonas y rayos ("peligros")

**Files:**
- Create: `packages/server/src/sim/hazards.ts` (tipos y geometría pura)
- Modify: `packages/server/src/sim/EnemySystem.ts`
- Test: `packages/server/test/hazards.test.ts`, `packages/server/test/EnemySystem.test.ts`

**Interfaces:**
- Consumes: `SPELLS`, `casterTelegraphS` (tarea 1) y `Enemy.spellTier` (tarea 2).
- Produces:
  - `interface Hazard { id: string; kind: "zone" | "beam"; sourceId: string; x: number; z: number; dirX: number; dirZ: number; length: number; size: number; damage: number; left: number; total: number; phase: "warn" | "fire" }`:
    - `size` es el radio de una zona o el ancho de un rayo.
    - `length` es 0 en una zona.
    - Ids `"h1"`, `"h2"`, … por sistema.
  - `beamLength(dungeon, x, z, dirX, dirZ, max): number`: distancia hasta el primer punto no caminable, muestreando cada ≤ `TILE_SIZE/4`, con tope `max`.
  - `inBeam(h: Hazard, px, pz, pr): boolean`: distancia del punto al segmento `[origen, origen + dir·length]` ≤ `size/2 + pr`.
  - `inZone(h, px, pz, pr)`: distancia al centro ≤ `size + pr`.
  - `EnemySystem.hazards: readonly Hazard[]`.
  - Piromante:
    - Al **entrar** en `telegraph` crea las zonas en la posición del objetivo en ese momento. Cada una: `left = total = SPELLS.pyromancer.fuseS` (1,2), `phase "warn"` y daño `round(def.damage × damageMult)`.
    - Tier 3: 3 zonas, en el objetivo y a ±`sideOffsetM` en la perpendicular a mago→objetivo.
    - Al vencer `left`, cada zona daña una vez a cada jugador vivo dentro (`inZone`, con `PLAYER_RADIUS`) y se quita.
    - Si el mago muere o se aturde, las zonas ya creadas siguen.
  - Invocador:
    - Al entrar en `telegraph` crea un rayo `warn` de `total = left = casterTelegraphS(kind, tier)`, que sale del mago y apunta al objetivo.
    - Mientras `left > total × (1 − trackFrac)`, re-apunta cada tick al objetivo y sigue la posición del mago. Después queda fijo.
    - `length = beamLength(…, 14)` se recalcula al apuntar.
    - Al terminar la preparación, el enemigo no crea proyectil. El rayo pasa a `phase "fire"` con `left = total = fireS` (0,15), daña una vez a cada jugador vivo con `inBeam` y se quita al vencer.
    - Si el mago sale de `telegraph` sin disparar (aturdido o muerto), su rayo `warn` se quita.
  - Los golpes salen como `EnemyHit`, con `sourceX/sourceZ` en el centro de la zona o en el origen del rayo, así el Bloqueo funciona solo.
  - Los peligros avanzan en `step(players, dt)`, igual que los proyectiles.

- [ ] **Step 1: Write failing tests**, en `hazards.test.ts` (geometría) y `EnemySystem.test.ts` (comportamiento):
  - `beamLength` en un pasillo con muro a 5 m → entre 4,9 y 5,1; sin muro → 14.
  - `inBeam`: un punto a 0,3 m de la línea con ancho 0,8 y radio 0 → `true`; uno a 0,5 m → `false`; uno más allá del final → `false`.
  - Un piromante tier 1 con el objetivo a 9 m:
    - al entrar en telegrafía hay 1 zona `warn` de radio 2,5 centrada en el jugador;
    - el jugador se mueve 4 m y la zona no lo sigue;
    - tras 1,2 s la zona no daña a quien salió;
    - en otra corrida, daña 14 a quien se quedó, una sola vez.
  - Un piromante tier 3 → 3 zonas a ±3 m perpendiculares.
  - Dos jugadores dentro de la misma zona → un `EnemyHit` para cada uno.
  - Un piromante que muere tras marcar la zona → la zona igual explota.
  - Un invocador tier 2 con el objetivo a 10 m:
    - en el 60 % de los 0,9 s el rayo sigue al jugador que se mueve en perpendicular;
    - después no lo sigue;
    - al disparar daña 12 a quien está en la línea, y la entrada dura 0,15 s en `fire`.
  - Un invocador aturdido con `stun()` durante la telegrafía → su rayo `warn` desaparece y no daña.
  - Un rayo con un muro entre el mago y el jugador → `length` < distancia y sin daño.
- [ ] **Step 2:** Correr los tests y ver el FAIL.
- [ ] **Step 3:** Implementar. `killAll()` también quita los rayos `warn` de los muertos.
- [ ] **Step 4:** `npm test` en `packages/server` y `tsc`: PASS.
- [ ] **Step 5:** Commit con `feat(server): zonas del piromante y rayo del invocador`.

### Task 4: servidor, sincronización, pausa y sandbox

**Files:**
- Modify: `packages/server/src/rooms/RunState.ts` (`HazardState`, `hazards`, `EnemyState.spellTier`)
- Modify: `packages/server/src/rooms/syncState.ts`
- Modify: `packages/server/src/rooms/RunRoom.ts`
- Modify: `packages/server/src/sim/EnemySystem.ts` (`frozen`, `castNow`)
- Modify: `packages/shared/src/sandbox.ts` (`freeze` y `castNow` en `DevCommand`/`parseDevCommand`)
- Test: `packages/server/test/RunRoom.test.ts`, `packages/shared/test/sandbox.test.ts`

**Interfaces:**
- Consumes: `EnemySystem.hazards` (tarea 3).
- Produces:
  - `HazardState = schema({ kind: t.string(), x, z, dirX, dirZ, length, size, left, total: t.number(), phase: t.string() }, "HazardState")`, en `RunState.hazards: t.map(HazardState)` indexado por id.
  - `syncWorld` agrega, actualiza y borra peligros por id, igual que los proyectiles.
  - `EnemyState.spellTier: t.number()`.
  - `DevCommand` suma `{ cmd: "freeze"; on: boolean }` y `{ cmd: "castNow" }`.
  - `EnemySystem.frozen: boolean`: con él, `stepEnemy` no corre para los enemigos que no están en `telegraph`, así que no se mueven ni empiezan ataques. Los que ya preparan, terminan. Proyectiles y peligros siguen avanzando.
  - `EnemySystem.castNow(players: readonly SimPlayer[]): void`: cada hechicero vivo, no aturdido y fuera de `telegraph` apunta al jugador vivo más cercano. Queda con `targetKey` fijado, `cooldown = 0`, y entra en `telegraph` creando su aviso como en la tarea 3.
  - `RunRoom`: los comandos `freeze` y `castNow`, que en la pausa se ignoran como los demás.

- [ ] **Step 1: Write failing tests:**
  - `parseDevCommand` acepta `{cmd:"freeze",on:true}` y `{cmd:"castNow"}`, y rechaza `{cmd:"freeze"}`.
  - En una sala de prueba (como la sección "sandbox" de `RunRoom.test.ts`):
    - Crear un piromante y un bruto, `freeze on` y `castNow`: el bruto no se mueve en 30 ticks.
    - Aparece una entrada en `room.state.hazards` con `kind "zone"` que llega al cliente (`ana.client.state.hazards`), y desaparece al explotar.
    - Mientras tanto, el piromante no se mueve.
  - `EnemyState.spellTier` del piromante llega en 1..3.
  - Pausa: con una zona `warn` activa, abrir la pausa ("+1 nivel elegir carta"). Durante 20 ticks `left` no cambia y la zona sigue. Tras elegir, explota en el tiempo que le quedaba.
- [ ] **Step 2:** Correr y ver el FAIL.
- [ ] **Step 3:** Implementar. `PROTOCOL_VERSION` ya es 9 (tarea 1).
- [ ] **Step 4:** `npm test` en la raíz: PASS.
- [ ] **Step 5:** Commit con `feat(server): peligros sincronizados y comandos freeze/castNow`.

### Task 5: cliente, red y panel de pruebas

**Files:**
- Modify: `packages/client/src/net/connection.ts` (`EnemySnapshot.spellTier`, `WorldSnapshot.hazards`)
- Modify: `packages/client/src/ui/devPanel.ts`
- Test: `packages/client/test/devPanel.test.ts` y el test de `connection` más cercano al snapshot del mundo (si no hay uno, uno nuevo `test/hazardSnapshot.test.ts` sobre una función pura de parseo)

**Interfaces:**
- Produces:
  - `interface HazardSnapshot { kind: "zone" | "beam"; x; z; dirX; dirZ; length; size; left; total: number; phase: "warn" | "fire" }`.
  - `WorldSnapshot.hazards: Map<string, HazardSnapshot>`.
  - `parseHazard(raw: unknown): HazardSnapshot | null`, exportada: descarta un `kind` o `phase` desconocido y números no finitos.
  - `EnemySnapshot.spellTier: number`, 0 si falta.
  - Panel:
    - `ENEMY_LABELS` suma `pyromancer: "Piromante"` y `stormcaller: "Invocador del rayo"`.
    - Sección "Enemigos": el interruptor `"Enemigos quietos"` manda `freeze`, y el botón `"Hechizo ya"` manda `castNow`.

- [ ] **Step 1: Write failing tests:**
  - `parseHazard` de una zona válida → igual al objeto.
  - `{ ...zona, kind: "laser" }` → `null`.
  - `{ ...zona, left: NaN }` → `null`.
  - `{ ...zona, phase: "boom" }` → `null`.
- [ ] **Step 2:** Correr y ver el FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `npm test` en `packages/client` y `tsc`: PASS.
- [ ] **Step 5:** Commit con `feat(client): peligros y tier de hechiceros en la red; panel F2 con hechiceros`.

### Task 6: cliente, aspecto de los hechiceros y del orbe

**Files:**
- Create: `packages/client/src/render/casterLooks.ts`
- Modify: `packages/client/src/render/looks.ts`, `render/enemyViews.ts` y `render/projectileViews.ts`
- Test: `packages/client/test/casterLooks.test.ts`

**Interfaces:**
- Consumes: `isCaster`, `casterTelegraphS`, `ORB` (tarea 1) y `EnemySnapshot.spellTier` (tarea 5).
- Produces:
  - `CASTER_COLORS: Record<CasterKind, Color3>`: arcano `(0.3, 1, 0.55)`, piromante `(1, 0.45, 0.1)` e invocador `(0.45, 0.8, 1)`.
  - `casterTint(kind): { color: Color3; strength: number }`, con `strength` 0,35.
  - `chargeScale(aiTime, telegraphS): number`: crece de 0,15 a 1 a lo largo de la preparación, acotado a [0,15, 1].
- Comportamiento:
  - **Hechiceros:**
    - Tinte emisivo suave en el cuerpo, con un material clonado por tipo, en caché por `kind`.
    - Aura: un disco plano bajo los pies del color del tipo, con alfa ~0,35. En tier 2 y 3 lleva además un anillo fino con el color de `TIERS[t].glow`.
    - Durante `telegraph`: una esfera emisiva del color del tipo en el hueso `righthand` (o en el nodo de la mano que ya usa `setWeapon`), escalada con `chargeScale(aiTime, casterTelegraphS(kind, spellTier))`.
    - El anillo rojo de telegrafía **no** se muestra en los hechiceros; sigue igual para esbirros y brutos.
  - **Orbe:** un núcleo blanco verdoso (`diameter = ORB.radius × 1,2`) y un halo del color del arcano (`ORB.radius × 2,4`, alfa 0,4), con un pulso de escala ±10 % a 6 Hz por el reloj de juego. La estela es un `ParticleSystem` con la textura de gradiente radial que ya usan los efectos de habilidad (si es privada, moverla a un helper compartido de `render/`). Al desaparecer, un estallido corto de partículas (~0,25 s) en su última posición.
- [ ] **Step 1: Write failing tests:**
  - `chargeScale(0, 0.7)` → 0,15; `chargeScale(0.7, 0.7)` → 1; `chargeScale(2, 0.7)` → 1; `chargeScale(0.35, 0.7)` → 0,575.
  - `CASTER_COLORS` tiene las 3 claves.
- [ ] **Step 2:** Correr y ver el FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `npm test` en `packages/client` y `tsc`: PASS. `npm run build -w @roguelike/client` sin errores.
- [ ] **Step 5:** Commit con `feat(client): tinte, aura y carga de los hechiceros; orbe con estela`.

### Task 7: cliente, zonas y rayos

**Files:**
- Create: `packages/client/src/render/hazardViews.ts`
- Modify: `packages/client/src/main.ts` (crear, alimentar con `onWorld`, renderizar, `dispose`)
- Test: `packages/client/test/hazardViews.test.ts` (lógica pura)

**Interfaces:**
- Consumes: `HazardSnapshot` y `WorldSnapshot.hazards` (tarea 5), y `CASTER_COLORS` (tarea 6).
- Produces:
  - `zoneFill(left, total): number`: fracción llena, `1 − left/total`, acotada a [0, 1].
  - `beamWarnAlpha(left, total, trackFrac): number`: 0,25 mientras sigue al objetivo; desde que se fija, sube de 0,5 a 1. Debe parpadear con el reloj, así que el parpadeo se aplica aparte.
  - `class HazardViews { constructor(scene); push(world, receivedAtMs); render(gameNowMs); dispose() }`.
- Comportamiento:
  - **Zona `warn`:** un borde (toro fino) y un disco que crece con `zoneFill`, en naranja, a ras del suelo (`y` ≈ 0,04).
  - **Fin de una zona** (la entrada desaparece): estallido de partículas naranjas y una marca chamuscada oscura que se apaga en ~1,5 s.
  - **Rayo `warn`:** un plano fino (0,08 m) celeste del largo del rayo, a 1 m de altura, con `beamWarnAlpha` y parpadeo a 8 Hz.
  - **Rayo `fire`:** un plano del ancho `size` y brillo alto que se desvanece en 0,15 s, con chispas en el extremo.
  - La interpolación no hace falta (los peligros no se mueven, salvo el rayo mientras apunta): se usa el último snapshot.
- [ ] **Step 1: Write failing tests:**
  - `zoneFill(1.2, 1.2)` → 0; `zoneFill(0, 1.2)` → 1; `zoneFill(0.6, 1.2)` → 0,5.
  - `beamWarnAlpha(1.0, 1.1, 0.6)` → 0,25 (sigue al objetivo).
  - `beamWarnAlpha(0, 1.1, 0.6)` → 1.
  - `beamWarnAlpha(0.44, 1.1, 0.6)` → 0,5 (recién fijado: `left = total × 0,4`).
- [ ] **Step 2:** Correr y ver el FAIL.
- [ ] **Step 3:** Implementar y conectar en `main.ts`, junto a `projectiles`.
- [ ] **Step 4:** `npm test` en la raíz, `tsc` y el build del cliente: PASS.
- [ ] **Step 5:** Commit con `feat(client): zonas del piromante y rayo del invocador`.
