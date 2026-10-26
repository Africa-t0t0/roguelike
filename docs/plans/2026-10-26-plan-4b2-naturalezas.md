# Plan 4b-2: naturalezas, élites y cofres

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Las armas (y con ellas las habilidades) pueden tener naturaleza (fuego, hielo o rayo) con efectos en los enemigos. Los élites aplican su naturaleza al jugador y sueltan armas de su elemento. Hay cofres con botín individual y un tier 4 legendario.

**Architecture:**
- **`shared`** define los datos:
  - naturalezas, tier 4 y `CasterTier`;
  - probabilidades de élite;
  - posiciones de cofres por piso;
  - la carta Afinidad;
  - los comandos de prueba.
- **Servidor:**
  - `EnemySystem.strike()` reemplaza a `damage()` en los golpes del jugador: aplica la naturaleza y devuelve el golpe y los encadenados.
  - Los estados de los enemigos y del jugador avanzan por tick.
  - `RunRoom` saca las kills por quemadura, abre cofres y reparte el botín.
- **Cliente:** muestra la naturaleza en armas y habilidades, los estados, los élites, los arcos de cadena, los cofres y el HUD.

**Tech Stack:** TypeScript, Babylon.js, Colyseus 0.18 (schema 5 `t.*`), vitest.

**Spec:** `docs/specs/2026-10-26-naturalezas-design.md`. También importan `docs/specs/2026-10-26-hechiceros-design.md` y `docs/specs/2026-10-26-sandbox-design.md`.

## Global Constraints

- Solo desarrollo local; `shared` determinista (`Rng`, nunca `Math.random`); servidor autoritativo.
- Tests verdes: `npm test` en la raíz y `npx tsc --noEmit -p .` en cada paquete tocado. Cuando la tarea toca el cliente, también `npm run build -w @roguelike/client`.
- `PROTOCOL_VERSION` = 10; actualizar la aserción en `packages/shared/test/cards.test.ts`.
- Cliente: solo emisivos y partículas, **sin luces nuevas**. Efectos con el reloj de juego (`setPaused` en la pausa). Materiales compartidos por tipo, naturaleza o tier, nunca por instancia. Todo se libera al quitar la vista y en `dispose()`.
- Sin navegador headless en las tareas. **Nunca** levantar servidores en 2567, 5173 ni 2568 (2568 es el puerto de los tests de `RunRoom`).
- Comentarios y textos en español, con el estilo del código vecino.
- Valores exactos del spec:
  - **Fuego:** quema 3 s; cada segundo hace el 20 % del daño del golpe. No se apila: un golpe nuevo renueva la quemadura y se queda con el mayor daño.
  - **Hielo:** ralentiza 30 % durante 2 s. Con 3 golpes de hielo en menos de 3 s, el enemigo queda congelado 0,8 s; después tiene 4 s de inmunidad al congelamiento. Los élites no se congelan.
  - **Rayo:** 25 % de probabilidad de encadenar a hasta 2 enemigos a ≤ 4 m, con el 50 % del daño. La cadena no vuelve a encadenar.
  - **Afinidad (`affinity`):** +25 % a los efectos por carta: daño de quemadura × (1 + 0,25n); ralentización 30 % × (1 + 0,25n), con 60 % como máximo; probabilidad de cadena 25 % + 6 puntos por carta. Solo se ofrece si el jugador lleva un arma con naturaleza.
  - **Élites:** desde el minuto 3, cada enemigo de oleada es élite con probabilidad `min(0,15, 0,05 + 0,01·floor(min − 3))`; en las salas no hay élites. Vida ×3, daño ×1,5, tamaño ×1,2; no se aturden ni se congelan.
    - Al jugador le aplican: fuego, quemadura de 3 s a 4 por segundo (× su `damageMult`); hielo, ralentiza 30 % durante 2 s; rayo, aturde 0,3 s.
    - Los hechiceros élite alternan su ataque con el del siguiente tipo: mage → pyromancer → stormcaller → mage.
    - Botín: siempre orbes con 4× su XP; además, con 50 %, un arma de su naturaleza para cada jugador conectado, de tier = (tier de su arma, o `spellTier`) + 1, con 4 como máximo.
  - **Cofres:** 1 por cada 2 salas de combate. Se abren con E a ≤ `PICKUP_RANGE`.
    - Contenido: 60 % un arma con naturaleza para cada jugador conectado (tier = `rollTier` + 1 con 30 % de probabilidad, con 4 como máximo); 25 % una lluvia de orbes de 30 XP; 15 % curación completa del grupo.
  - **Tier 4:** sufijo "legendaria/o", daño ×2,2, brillo `(1, 0.78, 0.25)`. Ningún enemigo lleva tier 4.
  - **Colores:** fuego `(1, 0.45, 0.1)`; hielo `(0.55, 0.95, 1)`; rayo `(1, 0.92, 0.4)`. El invocador del rayo pasa al color del rayo.
  - **Nombres:** arma "… de fuego", "… de hielo", "… del rayo"; élite "Bruto de hielo" (tipo + "de fuego" / "de hielo" / "del rayo").

## Review Focus

1. **Un enemigo muere por la quemadura** (sin golpe del jugador en ese tick): suelta orbes y su arma como cualquier muerte, y el número de daño sale con la clave de quien lo quemó. Test en la tarea 3.
2. **Rayo que encadena a un enemigo que ya murió en el mismo golpe**, o tiene menos de 2 vecinos: no falla ni daña dos veces al mismo. Test en la tarea 3.
3. **Jugador ralentizado o aturdido:** el cliente recibe el multiplicador y la predicción no da saltos. Con "Invulnerable" no se aplican estados. Test en la tarea 4.
4. **Dos jugadores y un cofre:** lo abre uno y cada uno recibe su propia arma, que el otro no ve. Abrirlo de nuevo no hace nada. Al volver a entrar a la sala, el cofre sigue abierto. Test en la tarea 5.
5. **Pausa de elección con quemaduras, ralentizaciones o congelamientos activos:** no avanzan. Test en la tarea 3.

---

### Task 1: shared, datos de naturalezas, tier 4, élites, cofres y Afinidad

**Files:**
- Create: `packages/shared/src/natures.ts` y `packages/shared/src/chests.ts` (exportar desde `index.ts`)
- Modify:
  - `packages/shared/src/weapons.ts` (`WeaponTier` 1..4, `TIERS[4]`, `EnemyLoadout.nature`, `weaponDisplayName` con naturaleza)
  - `packages/shared/src/spells.ts` (`CasterTier`)
  - `packages/shared/src/waves.ts` (`eliteChance`)
  - `packages/shared/src/cards.ts` (Afinidad)
  - `packages/shared/src/protocol.ts` (versión 10 y evento `chain`)
- Test: `packages/shared/test/natures.test.ts`, `packages/shared/test/chests.test.ts` y los tests existentes que haya que ajustar.

**Interfaces (Produces):**
- `type Nature = "none" | "fire" | "ice" | "lightning"` y `ELEMENTS: readonly Exclude<Nature, "none">[] = ["fire", "ice", "lightning"]`.
- `NATURE = { burnS: 3, burnFrac: 0.2, slowFrac: 0.3, slowS: 2, slowMax: 0.6, freezeHits: 3, freezeWindowS: 3, freezeS: 0.8, freezeImmuneS: 4, chainChance: 0.25, chainPerAffinity: 0.06, chainTargets: 2, chainRangeM: 4, chainFrac: 0.5, affinityStep: 0.25 }`.
- `ELITE = { hpMult: 3, damageMult: 1.5, scale: 1.2, xpMult: 4, dropChance: 0.5, playerBurnDps: 4, playerBurnS: 3, playerSlowFrac: 0.3, playerSlowS: 2, playerStunS: 0.3 }`.
- `natureSuffix(n: Nature): string`: `""`, `"de fuego"`, `"de hielo"` o `"del rayo"`.
- `natureEffects(n: Nature, affinity: number): { burnFrac: number; slowFrac: number; chainChance: number }`, con las fórmulas de Afinidad (la ralentización se acota a `slowMax`).
- `eliteChance(floorTime: number): number`.
- `TIERS[4] = { suffix: { f: "legendaria", m: "legendario" }, damageMult: 2.2, dropChance: 0, glow: [1, 0.78, 0.25] }`.
- `rollTier` sigue devolviendo 1..3.
- `type CasterTier = 1 | 2 | 3`; las tablas de `SPELLS` pasan a `Record<CasterTier, …>`.
- `EnemyLoadout = { weaponId; tier: WeaponTier; nature: Nature }`.
- `weaponDisplayName(id, tier, nature = "none")`: "Mandoble templado de fuego".
- `chestSpots(d: Dungeon): { x: number; z: number }[]`:
  - Recorre las salas de combate por id y toma las de índice par (0, 2, 4, …).
  - En cada una elige la primera casilla caminable con un vecino no caminable (pegada a la pared), recorriendo la sala por z y luego por x.
  - Esa casilla no puede estar entre las primeras `MAX_PLAYERS + armas iniciales` de `roomSpawnPoints`, ni ser un punto de aparición de enemigos de la sala.
  - Devuelve el centro de la casilla y es determinista.
- `CHEST_LOOT = { weapon: 0.6, orbs: 0.25, heal: 0.15, orbXp: 30, tierBumpChance: 0.3 }`.
- `STAT_CARDS.affinity = { name: "Afinidad", text: "+25% a los efectos de naturaleza" }`.
- `PlayerMods.natureMult`: `1 + 0.25 × n`, guardado como el conteo `affinity: n`.
- `rollOffer(rng, p, opts?: { natureWeapon?: boolean })`: sin `natureWeapon`, `affinity` no entra en la bolsa de stats.
- `CombatEvent` suma `{ type: "chain"; points: [number, number][] }`.
- `PROTOCOL_VERSION = 10`.

- [ ] **Step 1: Write failing tests:**
  - `natureEffects("fire", 0).burnFrac` → 0,2; con Afinidad 2 → 0,3.
  - `natureEffects("ice", 4).slowFrac` → 0,6 (acotado); con 0 → 0,3.
  - `natureEffects("lightning", 1).chainChance` → 0,31.
  - `natureEffects("none", 3)` → todos 0.
  - `eliteChance(179)` → 0; `(180)` → 0,05; `(300)` → 0,07; `(3000)` → 0,15.
  - `weaponDisplayName("great-sword", 4, "fire")` → "Mandoble legendario de fuego"; `("guard-sword", 2)` → "Espada de guardia templada".
  - `chestSpots`: con `generateDungeon(123, 1)`, la cantidad es `ceil(salas de combate / 2)`; cada punto es caminable y tiene un vecino muro; dos llamadas devuelven lo mismo.
  - `rollOffer` con 200 sorteos sin `natureWeapon` → nunca `affinity`; con `natureWeapon` → aparece alguna vez.
- [ ] **Step 2:** Correr y ver el FAIL.
- [ ] **Step 3:** Implementar.
  - Ajustar lo que deje de compilar en `server` y `client`:
    - `EnemyLoadout` lleva `nature: "none"` en los sorteos de hoy;
    - `Record<WeaponTier, …>` gana su entrada 4 (cliente: `tierColor` y `tierGlow` usan `TIERS[4].glow`);
    - `spawnAt` y el sandbox siguen aceptando 0..3.
  - Sin cambiar comportamiento.
- [ ] **Step 4:** `npm test` en la raíz y `tsc` en los 3 paquetes: PASS.
- [ ] **Step 5:** Commit con `feat(shared): naturalezas, tier legendario, élites, cofres y Afinidad (datos)`.

### Task 2: servidor, armas con naturaleza de punta a punta

**Files:**
- Modify:
  - `packages/server/src/sim/CombatSystem.ts` (`CombatState.weaponNature`);
  - `packages/server/src/rooms/PlayerRegistry.ts` (`FloorWeapon.nature`);
  - `packages/server/src/rooms/RunRoom.ts` (recoger, soltar, enviar `floorWeapons` con `nature`; comando de prueba `weapon` con `nature`);
  - `packages/server/src/rooms/RunState.ts` y `syncState.ts` (`PlayerState.weaponNature`, `EnemyState.weaponNature`);
  - `packages/shared/src/sandbox.ts` (`weapon` acepta `nature`, opcional, `"none"` por defecto).
- Test: `packages/server/test/RunRoom.test.ts`, `packages/server/test/PlayerRegistry.test.ts`, `packages/shared/test/sandbox.test.ts`

**Interfaces:**
- Consumes: `Nature` y `EnemyLoadout.nature` (tarea 1).
- Produces:
  - `CombatState.weaponNature: Nature`, que empieza en `"none"`.
  - Cada ítem del mensaje `floorWeapons` suma `nature`.
  - Recoger un arma intercambia `{ weaponId, tier, nature }`.
  - Un arma soltada por un enemigo lleva la naturaleza de su loadout.
  - `DevCommand.weapon` suma `nature: Nature`.

- [ ] **Step 1: Write failing tests:**
  - Con el comando `weapon {great-sword, 3, ice}`, `PlayerState.weaponNature` llega como `"ice"`.
  - Recoger un arma del suelo con `nature "fire"` deja la anterior en el suelo con su naturaleza.
  - Un enemigo armado con `loadout.nature "lightning"` que suelta su arma → el ítem de `floorWeapons` trae `nature: "lightning"`.
  - `parseDevCommand` acepta `nature` válida, rechaza `"water"` y, sin `nature`, da `"none"`.
- [ ] **Step 2:** Correr y ver el FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `npm test`: PASS.
- [ ] **Step 5:** Commit con `feat(server): armas con naturaleza (recoger, soltar, sincronizar)`.

### Task 3: servidor, efectos de naturaleza en los enemigos

**Files:**
- Modify:
  - `packages/server/src/sim/EnemySystem.ts`: `strike`, estados y `takeStatusDamage`.
  - `packages/server/src/sim/CombatSystem.ts` y `packages/server/src/sim/AbilitySystem.ts`: cambiar `enemies.damage(...)` por `enemies.strike(...)`.
  - `packages/server/src/rooms/RunRoom.ts`: daño de estado, evento `chain`.
  - `RunState.ts` y `syncState.ts`: `EnemyState.burning`, `slowed` y `frozen` (booleanos).
- Test: `packages/server/test/EnemySystem.test.ts`, `packages/server/test/RunRoom.test.ts`

**Interfaces:**
- Consumes: `NATURE` y `natureEffects` (tarea 1), y `CombatState.weaponNature` (tarea 2).
- Produces:
  - `interface StrikeSource { key: string; nature: Nature; affinity: number }`.
  - `EnemySystem.strike(enemyId, amount, src: StrikeSource): StrikeResult[]`:
    - `StrikeResult = EnemyDamageResult & { enemyId: string; amount: number }`.
    - El primero es el golpeado; los siguientes, los encadenados.
    - Aplica la naturaleza al golpeado y no a los encadenados.
    - El rayo sortea con la RNG del sistema. Busca a los vecinos vivos más cercanos (≤ 4 m, sin repetir) y les aplica el 50 % con `damage()`.
    - Con algún encadenado, guarda `{ points }` en una cola que se lee con `takeChains(): { points: [number, number][] }[]`.
  - Estados por enemigo:
    - `burn { left, dps, ownerKey }`;
    - `slow { left, frac }`;
    - `iceHits: number[]`, los tiempos de golpe;
    - `frozen` y `freezeImmune`.
  - El congelamiento funciona como el aturdimiento de hoy (sin moverse ni atacar, y cancela la telegrafía). No afecta a élites ni a `stunImmune`.
  - Ralentizado, `chaseMove` y la retirada usan la velocidad × (1 − `frac`).
  - La quemadura hace daño por tick (`dps · dt`) y se acumula. `takeStatusDamage(): { key: string; result: StrikeResult }[]` devuelve el daño y las muertes por quemadura del tick.
  - En `RunRoom`, `impact()` también procesa ese daño de estado y las cadenas: emite `damage` con `sourceKey`, crea orbes y armas de las muertes, y emite el evento `chain`.
  - Los números de daño de la quemadura se agrupan: un evento por segundo y por enemigo, con el acumulado. Así no hay 30 eventos por segundo.
  - Los callers (combo, habilidades y onda) pasan `{ key, nature: c.weaponNature, affinity: progress.stats.affinity ?? 0 }`. La Afinidad llega por `c.mods`: `natureMult` o el conteo, como haya quedado en la tarea 1.

- [ ] **Step 1: Write failing tests:**
  - **Fuego:** un golpe de 20 → durante 3 s `takeStatusDamage` suma 12 (±0,5). Un segundo golpe de 10 a los 1,5 s renueva a 3 s con dps 4 (el mayor). Si la quemadura mata, el resultado trae `killed`, `xp` y `drop`.
  - **Hielo:**
    - un golpe → el enemigo avanza al 70 % de su velocidad durante 2 s;
    - 3 golpes en 2 s → congelado 0,8 s (no se mueve y cancela la telegrafía);
    - un 4.º golpe en el segundo siguiente no lo vuelve a congelar (inmunidad de 4 s);
    - un élite no se congela.
  - **Rayo:**
    - con RNG sembrada a una tirada < 0,25 y 3 vecinos a 2, 3 y 6 m → encadena solo a los de 2 y 3 m, con el 50 %, sin repetir;
    - si el golpeado muere, la cadena igual sale;
    - sin vecinos, solo el golpeado.
  - **`RunRoom`:**
    - un enemigo muerto por quemadura deja orbes, y el evento `damage` lleva el `sourceKey` del que quemó;
    - un golpe que encadena emite `{ type: "chain" }`;
    - en la pausa de elección, `burn.left` no cambia en 20 ticks.
- [ ] **Step 2:** Correr y ver el FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `npm test`: PASS.
- [ ] **Step 5:** Commit con `feat(server): quemadura, ralentización, congelamiento y cadena del rayo`.

### Task 4: servidor, élites y estados del jugador

**Files:**
- Modify:
  - `packages/server/src/sim/EnemySystem.ts`: élites, alternancia de hechizos, golpes con naturaleza.
  - `packages/server/src/sim/WaveDirector.ts` o `spawnWave`: sorteo de élite.
  - `packages/server/src/sim/CombatSystem.ts`: estados del jugador.
  - `RunRoom.ts`, `RunState.ts` y `syncState.ts`.
  - `packages/shared/src/sandbox.ts`: `spawn` acepta `elite: boolean` y `nature`; comando nuevo `status`.
- Test: `EnemySystem.test.ts`, `CombatSystem.test.ts`, `RunRoom.test.ts`, `shared/test/sandbox.test.ts`

**Interfaces:**
- Consumes: `ELITE` y `eliteChance` (tarea 1), y `strike` y los estados (tarea 3).
- Produces:
  - `Enemy.elite: boolean` y `Enemy.nature: Nature`, este último `"none"` en los no élites.
  - **Al crearse por oleada:** si `rng.next() < eliteChance(floorTime)`, el enemigo es élite con naturaleza `rng.pick(ELEMENTS)`. La vida y el daño se multiplican después del escalado.
    - Si su tipo puede llevar arma (`ARMED_CHANCE` no nulo), va **siempre armado**, con su arma y `loadout.nature = nature`.
    - Es inmune al aturdimiento y al congelamiento.
  - **Hechicero élite:** alterna el tipo de su ataque en cada lanzamiento, entre el propio y el siguiente (mage → pyromancer → stormcaller → mage). Usa el tier y el daño propios.
  - **`EnemyHit.nature?: Nature`:** los golpes, proyectiles y peligros de un élite la llevan.
  - **`CombatSystem`** aplica el estado del élite al jugador al **resolver** el golpe, solo si hubo daño (con Invulnerable no hay daño, así que no hay estado):
    - fuego: `burnLeft = 3`, `burnDps = 4 × damageMult del enemigo`; el daño entra por tick con `applyDue`, y puede matar.
    - hielo: `slowLeft = 2`.
    - rayo: `stunLeft = 0,3`. Aturdido no se mueve, no ataca y no usa habilidades.
  - **`statusSpeedMult(c) = (slowLeft > 0 ? 0.7 : 1) × (stunLeft > 0 ? 0 : 1)`:** entra en `moveSpeedMult(c)` y se sincroniza como `PlayerState.statusSpeedMult`.
  - **`PlayerState`** suma `burnLeft`, `slowLeft` y `stunLeft`.
  - **Botín del élite al morir:**
    - las kills de élite hacen `xp × 4`;
    - con 50 % (RNG de `EnemySystem`), cada jugador conectado recibe un arma: `weaponId` = el de su loadout, o al azar entre `WEAPONS` si es hechicero; tier = `min(4, tier + 1)`; naturaleza = la del élite.
    - El "drop" de `EnemyDamageResult` pasa a llevar `nature`, y `RunRoom.dropWeapon` ya reparte una copia por jugador.
  - **`EnemyState`** suma `elite` y `nature`.
  - **Sandbox:**
    - `spawn { …, elite?: boolean, nature?: Nature }`: si es élite sin naturaleza, se sortea.
    - `status { kind: "burn" | "slow" | "stun" }` aplica ese estado a quien lo pide, con los números de `ELITE`.

- [ ] **Step 1: Write failing tests:**
  - **Élite al crearse:** con `eliteChance` forzada vía `floorTime` = 3000 y RNG sembrada, entre 100 enemigos de oleada hay élites. Cada élite:
    - tiene la vida ×3 del escalado;
    - si es esbirro o bruto, va armado con la naturaleza en el loadout;
    - no se aturde con `stun()`.
  - **Hechicero élite:** un piromante élite alterna zona y rayo en dos lanzamientos seguidos.
  - **Estados en el jugador:**
    - un golpe de élite de hielo deja `slowLeft` 2 y `statusSpeedMult` 0,7;
    - uno de rayo, 0,3 s sin moverse (30 inputs de movimiento no lo mueven en ~9 ticks);
    - uno de fuego quema 12 (±0,5) en 3 s;
    - con `god` no se aplica ningún estado.
  - **Botín:** un élite muerto suelta orbes con su XP × 4. Con la RNG forzada al botín, los dos jugadores reciben su arma de tier+1 con su naturaleza.
  - **Comando `status`:** llega al cliente como `PlayerState.slowLeft > 0`.
- [ ] **Step 2:** Correr y ver el FAIL.
- [ ] **Step 3:** Implementar. El sorteo de élite consume RNG **solo** desde el minuto 3, cuando `eliteChance > 0`, para no mover las secuencias sembradas de los tests de hoy.
- [ ] **Step 4:** `npm test`: PASS.
- [ ] **Step 5:** Commit con `feat(server): élites con naturaleza y estados en el jugador`.

### Task 5: servidor, cofres

**Files:**
- Modify:
  - `RunRoom.ts`: cofres del piso, abrir con E, botín.
  - `RunState.ts` y `syncState.ts`: `ChestState { x, z, open }` en `RunState.chests`, por id `"c1"`, …
  - `packages/shared/src/sandbox.ts`: comando `chest`.
- Test: `RunRoom.test.ts`, `shared/test/sandbox.test.ts`

**Interfaces:**
- Consumes: `chestSpots`, `CHEST_LOOT`, `rollTier` y `ELEMENTS` (tarea 1), y `dropWeapon` (tarea 2).
- Produces:
  - **Al crear la sala:** un cofre cerrado por cada punto de `chestSpots(dungeon)`.
  - **`interact` en la sala** (mismo momento que `tryPickup`): si hay un cofre cerrado a ≤ `PICKUP_RANGE`, se abre (el más cercano) y **no** se recoge un arma en ese input. El botín se sortea con una RNG propia de la sala (sal `0xc4e5`):
    - `weapon`: a cada jugador conectado le cae su propia arma: id al azar entre `WEAPONS`, naturaleza al azar entre `ELEMENTS`, y tier = `rollTier` + 1 con 30 % de probabilidad, con 4 como máximo. Cae junto al cofre, desplazada 1 m hacia el jugador que lo abrió.
    - `orbs`: `orbs.spawn` con 30 XP en la posición del cofre.
    - `heal`: vida al máximo a todos los conectados vivos.
  - Un cofre abierto no se vuelve a abrir. El estado sobrevive a reconectar porque está en `RunState`.
  - **Sandbox:** `chest` crea un cofre cerrado a 3 m delante (o en la casilla libre más cercana con vista), con id nuevo.

- [ ] **Step 1: Write failing tests:**
  - La sala trae `ceil(combate / 2)` cofres cerrados en el estado del cliente.
  - Ana abre uno con `interact` (teletransportada a 1 m):
    - pasa a `open: true`;
    - con la RNG forzada a `weapon`, Ana y Beto reciben cada uno un ítem nuevo en su `floorWeapons`, y Beto no recibe el de Ana;
    - un segundo `interact` no cambia nada;
    - junto a un cofre y un arma, se abre el cofre y el arma no se toma.
  - Con la RNG forzada a `heal`, la vida queda al máximo.
  - El comando `chest` crea un cofre a ~3 m.
- [ ] **Step 2:** Correr y ver el FAIL.
- [ ] **Step 3:** Implementar. Para forzar el sorteo en los tests, separar el sorteo en una función pura testeable, por ejemplo `rollChestLoot(rng)`.
- [ ] **Step 4:** `npm test`: PASS.
- [ ] **Step 5:** Commit con `feat(server): cofres con botín individual`.

### Task 6: cliente, red, HUD y panel

**Files:**
- Modify:
  - `packages/client/src/net/connection.ts`: naturaleza en jugador, enemigo y armas del suelo; élite; estados; `chests`; evento `chain` en `isValidCombatEvent`.
  - `packages/client/src/ui/hud.ts`: nombre del arma con naturaleza; iconos de estado.
  - `packages/client/src/ui/devPanel.ts`: naturaleza en Arma; Élite y naturaleza en Crear; "Cofre delante"; "Aplicarme estado".
  - `packages/client/src/main.ts`: `statusSpeedMult` en la predicción; aturdido → sin ataque ni habilidades predichas.
  - `packages/client/index.html`: estilos de los iconos.
- Test: `packages/client/test/hud.test.ts`, `packages/client/test/devPanel.test.ts` y un test de parseo (`parseChest` y el evento `chain`).

**Interfaces:**
- Produces:
  - `PlayerSnapshot` suma `weaponNature`, `burnLeft`, `slowLeft`, `stunLeft` y `statusSpeedMult`.
  - `EnemySnapshot` suma `weaponNature`, `elite`, `nature`, `burning`, `slowed` y `frozen`.
  - `FloorWeapon` suma `nature`.
  - `WorldSnapshot.chests: Map<string, { x: number; z: number; open: boolean }>`.
  - `formatStatus(s: { burnLeft; slowLeft; stunLeft }): { kind: "burn" | "slow" | "stun"; left: number }[]`, en ese orden y solo los activos.
  - La predicción: `speedMult = moveSpeedMult × statusSpeedMult × bloqueo`.
  - Panel: el selector "Naturaleza" usa las etiquetas `["Sin naturaleza", "Fuego", "Hielo", "Rayo"]`.

- [ ] **Step 1: Write failing tests:**
  - `formatStatus({ burnLeft: 2, slowLeft: 0, stunLeft: 0.2 })` → `[{ kind: "burn", left: 2 }, { kind: "stun", left: 0.2 }]`.
  - El nombre del arma en el HUD → "Mandoble legendario de fuego".
  - El evento `{ type: "chain", points: [[0, 0], [1, 1]] }` es válido; con `points` vacíos, no.
  - Un cofre se parsea; uno con `x` NaN se descarta.
- [ ] **Step 2:** Correr y ver el FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `npm test`, `tsc` y build: PASS.
- [ ] **Step 5:** Commit con `feat(client): naturalezas, élites, estados y cofres en la red, el HUD y el panel`.

### Task 7: cliente, naturaleza en armas y habilidades, y tier legendario

**Files:**
- Create: `packages/client/src/render/natureLooks.ts`
- Modify:
  - `render/tierGlow.ts`: tier 4.
  - `render/characterView.ts`: `setWeapon` con naturaleza.
  - `render/floorWeaponViews.ts`.
  - `render/enemyViews.ts`: armas de enemigos con naturaleza.
  - `render/abilityFx.ts`: color de los efectos según la naturaleza del arma de quien la lanza.
  - `render/playerShotViews.ts`: la onda de corte.
  - `render/casterLooks.ts`: el invocador pasa al color del rayo.
- Test: `packages/client/test/natureLooks.test.ts` y `abilityFx.test.ts`.

**Interfaces:**
- Produces:
  - `NATURE_COLORS: Record<Exclude<Nature, "none">, Color3>`, con los valores del spec.
  - `natureTint(base: Color3, nature: Nature): Color3`: el mismo `base` si es `"none"`; si no, el color de la naturaleza.
  - `AbilityFx.play(id, rank, origin, nature)` (o la firma equivalente que ya tenga, con `nature` al final): los colores fijos de hoy (`FIRE`, `GOLD`, `TRAIL`, …) pasan por `natureTint`. Sin naturaleza, todo se ve **igual que hoy**.
- **Armas con naturaleza:**
  - un brillo emisivo del color, con un material compartido por (arma, tier, naturaleza);
  - un emisor de partículas suave en la hoja: brasas que suben con fuego, copos que caen con hielo, chispas cortas con rayo;
  - se suma al brillo de tier.
  - Tier 4: brillo dorado `TIERS[4].glow` con `GLOW_STRENGTH`, igual que los demás tiers.
- La naturaleza que usa `abilityFx` sale de `PlayerSnapshot.weaponNature` del dueño del evento `ability`, tanto para el propio jugador como para los remotos.
- [ ] **Step 1: Write failing tests:**
  - `natureTint(X, "none")` → X.
  - `natureTint(X, "ice")` → `NATURE_COLORS.ice`.
  - Los colores del spec, exactos.
  - En `abilityFx.test`, el timeline de Torbellino con `"fire"` usa el color del fuego y sin naturaleza el de hoy.
- [ ] **Step 2:** Correr y ver el FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `npm test`, `tsc` y build: PASS.
- [ ] **Step 5:** Commit con `feat(client): armas y habilidades con el color de su naturaleza; tier legendario dorado`.

### Task 8: cliente, élites, estados de enemigos, arcos de cadena y cofres

**Files:**
- Create: `packages/client/src/render/chestViews.ts` y `packages/client/src/render/chainFx.ts`
- Modify:
  - `render/enemyViews.ts`: élite y estados.
  - `ui/minimap.ts`: cofres.
  - `main.ts`: crear, alimentar, renderizar y liberar las vistas nuevas; evento `chain` → `chainFx`.
- Test: `packages/client/test/chestViews.test.ts`, `packages/client/test/chainFx.test.ts` y `minimap.test.ts`.

**Interfaces:**
- Consumes: `NATURE_COLORS` (tarea 7) y los snapshots (tarea 6).
- Produces:
  - **Élite:**
    - escala ×1,2;
    - un aura dorada grande (disco y anillo dorados, alfa ~0,35);
    - un contorno emisivo del color de su naturaleza, que es un tinte del cuerpo como el de los hechiceros, compartido por (tipo, naturaleza);
    - un rótulo con el nombre, `eliteName(kind, nature)` → "Bruto de hielo". Los nombres de los tipos son "Esbirro", "Bruto", "Hechicero arcano", "Piromante" e "Invocador del rayo".
  - **Estados del enemigo:**
    - `burning`: partículas de brasas sobre el cuerpo;
    - `slowed`: un tinte cian suave;
    - `frozen`: un tinte cian fuerte, con la animación detenida (`speedRatio` 0) mientras dura.
  - `chainArcPoints(a: [number, number], b: [number, number], segments: number, jitter: (i: number) => number): Vector3[]`:
    - una línea quebrada entre los dos puntos, a 1 m de altura;
    - `chainFx.play(points, nowMs)` dibuja un arco amarillo eléctrico de 0,15 s;
    - el `jitter` viene de una función determinista del índice, para poder testearla.
  - **`ChestViews`:**
    - un cofre de primitivas: caja con tapa aparte, en madera oscura emisiva tenue con bordes dorados;
    - al pasar a `open`, la tapa rota −110° en 0,4 s, con un destello dorado corto;
    - un cofre abierto queda abierto y más oscuro.
    - `lidAngle(openSinceS): number` es una función pura: 0 → 0; 0,2 → −55°; ≥ 0,4 → −110°.
  - **Minimapa:** cofre cerrado como punto dorado, abierto como gris.
- [ ] **Step 1: Write failing tests:**
  - `lidAngle(0)` → 0; `lidAngle(0.2)` → −55° (en rad); `lidAngle(1)` → −110°.
  - `chainArcPoints([0, 0], [4, 0], 4, () => 0)` → 5 puntos sobre la línea, con y = 1.
  - `eliteName("brute", "ice")` → "Bruto de hielo".
  - El minimapa marca los cofres cerrados y los abiertos con estilos distintos.
- [ ] **Step 2:** Correr y ver el FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `npm test`, `tsc` y build: PASS.
- [ ] **Step 5:** Commit con `feat(client): élites, estados, arcos del rayo y cofres`.
