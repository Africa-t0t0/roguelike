# Plan 4d: equipo y reliquias

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Los jugadores encuentran piezas de equipo y reliquias que mejoran sus stats y se ven en la parte del cuerpo que corresponde:

- 4 ranuras con rareza;
- resistencias elementales;
- efectos legendarios del caballero;
- una reliquia.

**Architecture:**
- **shared** define los datos y funciones puras:
  - piezas, su sorteo y las reliquias;
  - cómo se combinan con las cartas (`combinedMods`);
  - las resistencias.
- **El servidor**:
  - guarda el equipo en el registro del jugador;
  - generaliza las armas del suelo a "objetos del suelo";
  - reparte el botín;
  - aplica las resistencias, los efectos legendarios y los de las reliquias.
- **El cliente**:
  - muestra los 5 iconos del HUD, el aviso con comparación y los objetos del suelo;
  - muestra las partículas pegadas a los huesos de la parte del cuerpo de cada pieza.

**Tech Stack:** TypeScript, Babylon.js, Colyseus 0.18 (schema 5 `t.*`), vitest.

**Spec:** `docs/specs/2026-10-27-equipo-design.md`. Antes: `docs/specs/2026-10-26-naturalezas-design.md`.

## Global Constraints

- Solo desarrollo local.
- `shared` es determinista: usa `Rng`, nunca `Math.random`.
- El servidor es autoritativo.
- Tests verdes:
  - `npm test` en la raíz;
  - `npx tsc --noEmit -p .` en cada paquete tocado;
  - si toca el cliente, `npm run build -w @roguelike/client`.
- `PROTOCOL_VERSION = 13`, con su aserción en `packages/shared/test/cards.test.ts`.
- Reglas del cliente:
  - sin luces nuevas;
  - solo emisivos y partículas;
  - reloj de juego, con `setPaused` en la pausa;
  - materiales y texturas compartidos;
  - liberar todo al quitar la vista y en `dispose()`.
- Nunca levantar servidores en 2567, 5173 ni 2568.
- Comentarios y textos en español, con el estilo del código vecino.
- **Valores exactos del spec:**
  - **Multiplicadores por tier:** ×1; ×1,5; ×2; ×2,5. Secundarias por tier: 0, 1, 2, 2.
  - **Stat principal (tier 1):**
    - casco: +15 de vida máxima;
    - pechera: −5 % de daño recibido;
    - guantes: +6 % de velocidad de ataque;
    - botas: +5 % de velocidad de movimiento.
  - **Bolsa de secundarias (valor de tier 1):**
    - regeneración +1/s;
    - daño +6 %;
    - alcance +8 %;
    - imán +25 %;
    - XP +8 %;
    - enfriamiento −5 %;
    - vida por muerte +1;
    - resistencia al fuego, al hielo o al rayo +8 %.

    No se repiten dentro de una pieza ni repiten su stat principal.
  - **Legendaria:** además, resistencia a todos los elementos +10 % y un efecto de la bolsa de su ranura.
  - **Tope de resistencia:** 60 % por elemento.
  - **Topes compartidos con las cartas:** daño recibido −60 %; enfriamiento −50 %. El Reloj de arena roto lleva el tope de enfriamiento a −60 %.
  - **Efectos legendarios del caballero:**
    - casco: `warcryLong` (Grito dura +50 %), `warcryHeal` (Grito cura 15 % de la vida máxima a los aliados);
    - pechera: `blockReflect` (Bloqueo devuelve 30 % del daño bloqueado al atacante), `lastStand` (al bajar de 30 % de vida, −80 % de daño recibido durante 3 s, una vez cada 30 s);
    - guantes: `whirlCharges` (Torbellino con 2 cargas), `kickStun` (Patada aturde el doble);
    - botas: `slamCracks` (Golpe sísmico deja grietas 3 s que ralentizan 40 %), `thrustDash` (Tajo frontal te impulsa 3 m hacia adelante).
  - **Reliquias positivas:**

    | Id | Nombre | Efecto |
    |---|---|---|
    | `oakHeart` | Corazón de roble | +40 de vida, +1 de regeneración |
    | `hawkFeather` | Pluma del halcón | +12 % de movimiento, +50 % de imán |
    | `scholarEye` | Ojo del erudito | +25 % de XP |
    | `sentinelAmulet` | Amuleto del centinela | −15 % de daño recibido |
    | `beastClaw` | Garra de bestia | +15 % de daño, +10 % de velocidad de ataque |
    | `threeKingsStone` | Piedra de los tres reyes | +15 % de resistencia a todo |

  - **Reliquias con trade-off:**

    | Id | Nombre | Efecto |
    |---|---|---|
    | `glassHeart` | Corazón de cristal | +60 % de daño, −25 % de vida máxima |
    | `brokenHourglass` | Reloj de arena roto | −40 % de enfriamiento; cada habilidad cuesta 4 de vida, sin bajar de 1 |
    | `vampireFang` | Colmillo del vampiro | recuperas el 5 % del daño que haces; sin regeneración pasiva |

  - **Botín:**
    - cofre: 37 % arma, 30 % equipo, 8 % reliquia, 15 % orbes, 10 % curación;
    - élite: su 50 % de arma pasa a ser mitad arma y mitad equipo; además, 6 % de reliquia;
    - enemigo normal: 1,5 % de soltar una pieza de tier 1 o 2, según `rollTier` acotado a 2.

    Todo el botín es individual. Equipo y reliquias vencen a los 40 s, como las armas.
  - **Elemento para la resistencia:**
    - el ataque de un élite usa la naturaleza del élite;
    - la zona del piromante cuenta como fuego;
    - el rayo del invocador cuenta como rayo.

    Los estados siguen saliendo solo de los élites.

## Review Focus

1. **Equipar una pieza con E junto a un arma o un cofre.** Se mantiene la prioridad de hoy: primero el cofre y después el objeto del suelo más cercano. El objeto que se deja cae en el suelo con su tipo correcto. Test en la tarea 2.
2. **Reconectar o tomar el control conserva equipo, reliquia y mods,** sin que la vida máxima se duplique ni se pierda. Test en la tarea 2.
3. **Cambiar el Corazón de cristal por otra reliquia.** La vida máxima se recalcula y la vida actual no supera la nueva máxima. Test en la tarea 3.
4. **Torbellino con 2 cargas.** El cliente predice las cargas igual que el servidor: dos usos seguidos funcionan, el tercero no. Al recargar vuelve 1 carga por enfriamiento. Tests en las tareas 3 y 4.
5. **Pausa de elección con un `lastStand` activo, grietas o cargas recargando.** Nada avanza durante la pausa. Test en la tarea 3.

---

### Task 1: shared, datos del equipo, reliquias y mods combinados

**Files:**
- Create: `packages/shared/src/gear.ts` (exportarlo desde `index.ts`)
- Modify:
  - `packages/shared/src/cards.ts`: `PlayerMods` suma `resist: { fire: number; ice: number; lightning: number }`; `playerMods` devuelve 0 en las tres.
  - `packages/shared/src/protocol.ts`: versión 13.
  - `packages/shared/src/sandbox.ts`: comandos `gear` y `relic`.
- Test: `packages/shared/test/gear.test.ts` y `sandbox.test.ts`

**Produces:**
- `type GearSlot = "helmet" | "chest" | "gloves" | "boots"` y `GEAR_SLOTS`.
- `type GearStat = "maxHp" | "damageTaken" | "attackSpeed" | "moveSpeed" | "regen" | "damage" | "reach" | "magnet" | "xp" | "cooldown" | "lifeOnKill" | "resFire" | "resIce" | "resLightning"`.
- `GEAR_MAIN: Record<GearSlot, GearStat>`.
- `GEAR_BASE: Record<GearStat, number>`, con los valores de tier 1:
  - maxHp 15, damageTaken 0.05, attackSpeed 0.06, moveSpeed 0.05;
  - regen 1, damage 0.06, reach 0.08, magnet 0.25, xp 0.08, cooldown 0.05, lifeOnKill 1;
  - resFire, resIce y resLightning 0.08.
- `GEAR_TIER_MULT = {1: 1, 2: 1.5, 3: 2, 4: 2.5}` y `GEAR_SECONDARIES = {1: 0, 2: 1, 3: 2, 4: 2}`.
- `type LegendaryId = "warcryLong" | "warcryHeal" | "blockReflect" | "lastStand" | "whirlCharges" | "kickStun" | "slamCracks" | "thrustDash"`.
- `LEGENDARY_POOL: Record<ClassId, Record<GearSlot, LegendaryId[]>>`, con el caballero (`warrior`) según el spec.
- `LEGENDARY_TEXT: Record<LegendaryId, string>`.
- `LEGENDARY_ABILITY: Record<LegendaryId, AbilityId>`: qué habilidad necesita cada efecto, para mostrarlo en gris si falta.
- `interface GearItem { slot: GearSlot; tier: WeaponTier; stats: { stat: GearStat; value: number }[]; legendary: LegendaryId | null }`:
  - `stats[0]` es la principal;
  - las legendarias suman, como entrada aparte, las tres resistencias +0,10 bajo la clave `allRes` (o como tres entradas; documentarlo).
- `rollGear(rng: Rng, slot: GearSlot, tier: WeaponTier, cls: ClassId): GearItem`:
  - las secundarias se sortean sin repetir;
  - los valores son base × multiplicador del tier;
  - la legendaria toma su efecto de `LEGENDARY_POOL`.
- `gearName(item): string`, por ejemplo "Botas templadas", "Pechera rúnica" o "Yelmo legendario". Los nombres base son Yelmo, Pechera, Guanteletes y Botas, con concordancia de género.
- `gearStatText(stat, value): string`, por ejemplo "+7,5 % velocidad de movimiento" o "+12 resistencia al fuego %"; definir un formato y usarlo de forma consistente.
- `type RelicId`, con los 9 ids del spec, y `RELICS: Record<RelicId, { name: string; text: string; tradeoff: boolean }>`.
- `combinedMods(p: Progress, gear: Partial<Record<GearSlot, GearItem>>, relic: RelicId | null): PlayerMods & { vampire: number; abilityHpCost: number; noRegen: boolean; legendaries: LegendaryId[] }`:
  - suma cartas, equipo y reliquia;
  - aplica los topes: daño recibido ≥ 0,4; enfriamiento ≥ 0,5, o ≥ 0,4 con `brokenHourglass`; resistencia ≤ 0,6 por elemento;
  - el Corazón de cristal multiplica la vida máxima final por 0,75. Para eso suma `maxHpMult` a `PlayerMods`, o lo aplica quien calcula la vida; documentarlo.
- `rollGearTier(rng, floorTime, floor, cap?: WeaponTier)`: es `rollTier` acotado.
- Sandbox:
  - `{ cmd: "gear", slot: GearSlot, tier: 1|2|3|4, action: "equip" | "drop" }`;
  - `{ cmd: "relic", id: RelicId }`.

- [ ] **Step 1: Write failing tests.**
  - **`rollGear`:**
    - unas botas tier 1 tienen 1 stat (`moveSpeed` 0,05) y `legendary` null;
    - tier 3: 3 stats sin repetir y la principal con valor 0,10;
    - tier 4: incluye resistencias +0,10 a los tres elementos y un `legendary` de la bolsa de botas;
    - es determinista con la misma semilla.
  - **`combinedMods`:**
    - con la pechera tier 4 (−12,5 %) y 10 cartas de Piel de hierro → `damageTakenMult` 0,4 (tope);
    - con `brokenHourglass` el piso del enfriamiento es 0,4;
    - con `glassHeart`, `damageMult` es 1,6 y la vida máxima se multiplica por 0,75;
    - la resistencia se acota a 0,6;
    - sin equipo ni reliquia, el resultado es igual a `playerMods(p)` en sus campos comunes.
  - **Nombres:** "Botas templadas" y "Pechera rúnica".
  - **`parseDevCommand`:** acepta `gear` y `relic` válidos y rechaza una ranura o id desconocidos.
- [ ] **Step 2:** Correr los tests y ver el FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Correr `npm test` y `tsc` en los 3 paquetes: PASS.
- [ ] **Step 5:** Commit: `feat(shared): equipo, reliquias y mods combinados (datos)`.

### Task 2: servidor, objetos del suelo, equipar y botín

**Files:**
- Modify:
  - `packages/server/src/rooms/PlayerRegistry.ts`: `PlayerRecord.gear` y `relic`; `FloorWeapon` → `FloorItem`.
  - `packages/server/src/rooms/RunRoom.ts`:
    - recoger o equipar;
    - botín de cofres, élites y normales;
    - `refreshMods` usa `combinedMods`;
    - comandos `gear` y `relic`.
  - `packages/server/src/rooms/RunState.ts` y `syncState.ts`: equipo y reliquia en `PlayerState`.
  - `packages/server/src/sim/EnemySystem.ts`: botín de equipo y reliquia en `EnemyDamageResult`.
- Test: `RunRoom.test.ts`, `EnemySystem.test.ts` y `PlayerRegistry.test.ts`

**Produces:**
- `type FloorItem = (({ kind: "weapon"; weaponId; tier; nature }) | ({ kind: "gear"; item: GearItem }) | ({ kind: "relic"; id: RelicId })) & { x; z; expiresAt }`:
  - el mensaje `floorWeapons` conserva su nombre, pero cada ítem lleva `kind` y sus campos;
  - un arma conserva el formato de hoy, más `kind: "weapon"`.
- **E (`tryPickup`):** toma el objeto más cercano a ≤ `PICKUP_RANGE`.
  - Arma: como hoy.
  - Equipo: lo equipa en su ranura; si había una pieza, queda en el suelo con vencimiento nuevo.
  - Reliquia: igual, en su ranura.
  - Después llama a `refreshMods`.
- **`refreshMods`:** `combinedMods(progress, gear, relic)`, más los interruptores del sandbox encima. La vida máxima se recalcula y la vida actual se acota a la nueva máxima.
- **`PlayerState`:**
  - `gear: t.map(GearState)`, por ranura: `{ slot, tier, legendary, glow, data }`. `glow` es la resistencia más alta (`"fire"`, `"ice"`, `"lightning"` o `"none"`) y `data` es el `GearItem` en JSON.
  - `relic: t.string()`, con `""` si no tiene.
- **Botín (RNG de cada sistema, siempre individual):**
  - **Cofre:** `rollChestLoot` usa la tabla nueva. Las ramas `gear` y `relic` dan a cada jugador conectado su propia pieza (ranura al azar, tier como el de las armas del cofre) o su propia reliquia (al azar).
  - **Élite:** el drop actual se reparte 50/50 entre arma y pieza. Además, 6 % de reliquia.
  - **Normal:** 1,5 % de una pieza de tier `rollGearTier(…, 2)`.
- **Sandbox:**
  - `gear equip` equipa una pieza nueva sorteada de esa ranura y tier;
  - `gear drop` la deja en el suelo a 2,5 m;
  - `relic` equipa la reliquia.

- [ ] **Step 1: Write failing tests.**
  - Con el sandbox `gear {boots, 3, equip}`:
    - `PlayerState.gear.get("boots").tier` llega con 3;
    - `moveSpeedMult` sube;
    - después de reconectar, se conserva.
  - Recoger unas botas del suelo deja las anteriores en el suelo con `kind: "gear"`.
  - Si hay un arma y una pieza a la misma distancia, se toma la más cercana (y a igual distancia, la primera de la lista); documentarlo.
  - Con el cofre forzado a `gear`, Ana y Beto reciben cada uno su pieza.
  - Con el cofre forzado a `relic`, cada uno recibe la suya.
  - El enemigo normal tiene 1,5 % de soltar equipo: forzar la RNG.
  - Con el élite forzado a reliquia, la suelta.
  - Equipar `glassHeart` con la vida llena: la vida máxima pasa a ×0,75 y la vida actual se acota.
- [ ] **Step 2:** Correr los tests y ver el FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Correr `npm test`: PASS.
- [ ] **Step 5:** Commit: `feat(server): equipo y reliquias (equipar, botín, sincronizar)`.

### Task 3: servidor, resistencias, efectos legendarios y efectos de reliquia

**Files:**
- Modify:
  - `packages/server/src/sim/EnemySystem.ts`: `EnemyHit.element`.
  - `packages/server/src/sim/CombatSystem.ts`: resistencias, `lastStand`, `blockReflect`, vampiro, sin regeneración.
  - `packages/server/src/sim/AbilitySystem.ts`: cargas, Grito, Patada, grietas, impulso y costo de vida.
  - `RunRoom.ts`.
  - `RunState.ts` y `syncState.ts`: `AbilitySlotState.charges`.
- Test: `CombatSystem.test.ts`, `AbilitySystem.test.ts`, `EnemySystem.test.ts` y `RunRoom.test.ts`

**Produces:**
- **`EnemyHit.element?: "fire" | "ice" | "lightning"`:**
  - la de los élites es su naturaleza;
  - las zonas del piromante dan `"fire"` y los rayos del invocador `"lightning"`, aunque no sean élites.
- **Resistencia en `applyDue`:**
  - el daño de un golpe con `element` se multiplica por `1 − resist[element]`;
  - la duración del estado aplicado, también;
  - la quemadura por tick del jugador usa la resistencia al fuego.
- **`lastStand`:**
  - cuando la vida baja de 30 % y no está en enfriamiento, se activan `lastStandLeft = 3` y `lastStandCd = 30`;
  - mientras dura, el daño recibido se multiplica por 0,2;
  - ambos tiempos avanzan por tick, sin correr en la pausa.
- **`blockReflect`:** si un golpe bloqueado venía de un enemigo vivo (`sourceId`), ese enemigo recibe el 30 % del daño que se evitó, como daño del jugador con su clave: sale número de daño y, si muere, orbes.
- **`vampireFang`:** cura el 5 % del daño que hace el jugador (golpes, habilidades, cadena y quemadura propias). Además, `noRegen` anula la regeneración base y la de las cartas.
- **`brokenHourglass`:** al empezar una habilidad, `hp = max(1, hp − 4)`.
- **Habilidades:**
  - **`whirlCharges`:** el Torbellino tiene 2 cargas. Cada lanzamiento gasta 1. El enfriamiento recarga 1 carga por ciclo y sigue corriendo mientras falten cargas. `AbilitySlotState.charges` se sincroniza (1 si la habilidad no tiene cargas).
  - **`kickStun`:** la duración del aturdimiento de la Patada se duplica.
  - **`warcryLong`:** la duración del bono ×1,5.
  - **`warcryHeal`:** cura el 15 % de la vida máxima a cada aliado alcanzado por el Grito y a uno mismo.
  - **`slamCracks`:** en el impacto del Golpe sísmico se crea una zona del jugador, con el radio del rango, que dura 3 s. Los enemigos dentro reciben cada tick una ralentización de 0,4 que se renueva. Se sincroniza como `RunState.playerZones` con `{ x, z, radius, left, total }` para el visual, o se reusa `hazards` con `kind: "cracks"`; elegir una opción y documentarla.
  - **`thrustDash`:** en el impacto del Tajo frontal, el jugador avanza 3 m en su dirección con `moveCircle`, contra los muros. La predicción del cliente se corrige sola con la reconciliación de siempre: no predecir el impulso.
- Una legendaria cuya habilidad el jugador no tiene no hace nada.

- [ ] **Step 1: Write failing tests (uno por efecto).**
  - Resistencia al fuego 0,5 contra una zona de piromante de 14 → 7 de daño.
  - Élite de hielo con resistencia al hielo 0,5 → ralentización de 1 s.
  - `lastStand`: un golpe que deja al jugador en 25 % activa la reducción. El siguiente golpe hace ×0,2. A los 3 s termina. No se reactiva antes de 30 s.
  - `blockReflect`: bloqueando un golpe frontal de 20 con Bloqueo rango 1, el enemigo pierde 30 % de lo evitado.
  - `whirlCharges`: dos Torbellinos seguidos (después de terminar la animación) funcionan y el tercero no. Tras un enfriamiento hay 1 carga de vuelta.
  - `kickStun`: el aturdimiento de la Patada se duplica.
  - `warcryLong`: el bono dura ×1,5.
  - `warcryHeal`: el aliado se cura 15 %.
  - `slamCracks`: un enemigo dentro avanza al 60 % durante 3 s.
  - `thrustDash`: el jugador avanza 3 m y se detiene en un muro.
  - Vampiro: un golpe de 20 cura 1.
  - Reloj de arena: lanzar una habilidad con 3 de vida deja 1.
  - Pausa: con `lastStandLeft` > 0, 20 ticks en pausa no lo cambian.
- [ ] **Step 2:** Correr los tests y ver el FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Correr `npm test`: PASS.
- [ ] **Step 5:** Commit: `feat(server): resistencias, efectos legendarios y reliquias`.

### Task 4: cliente, red, HUD, aviso, panel y cargas

**Files:**
- Modify:
  - `packages/client/src/net/connection.ts`: ítems del suelo con `kind`; `gear` y `relic` del jugador; `charges`; zonas de grietas.
  - `packages/client/src/ui/hud.ts`: 5 iconos con tooltip.
  - `render/floorWeaponViews.ts`: el aviso de E cubre los 3 tipos, con comparación.
  - `ui/devPanel.ts`: sección "Equipo".
  - `net/LocalAbility.ts`: cargas.
  - `ui/abilityBar.ts`: muestra las cargas.
  - `index.html`: estilos.
- Test: `hud.test.ts`, `LocalAbility.test.ts`, `devPanel.test.ts` y el test de parseo.

**Produces:**
- **`parseFloorItem(raw)`:** descarta lo inválido. Un ítem sin `kind` cuenta como `"weapon"`, por compatibilidad.
- **`PlayerSnapshot`:** suma `gear: Partial<Record<GearSlot, { tier; legendary; glow; item: GearItem }>>` y `relic: RelicId | null`. El JSON se parsea con validación.
- **`gearCompare(current: GearItem | undefined, next: GearItem): string[]`:** una línea por stat de `next`, con la diferencia contra `current` en la misma stat. Ejemplo: "+7,5 % velocidad de movimiento (+2,5 %)".
- **Aviso:**
  - equipo: "E Equipar Botas templadas" más esas líneas;
  - legendario: su texto, en gris si falta la habilidad (`LEGENDARY_ABILITY`);
  - reliquia: "E Tomar Corazón de roble" más su texto.
- **HUD:**
  - 5 iconos (casco, pechera, guantes, botas, reliquia) junto al retrato, con el borde del color del tier (`tierColor`);
  - los vacíos se ven tenues;
  - al pasar el mouse o con Tab mantenido aparece un tooltip con nombre, stats y efecto.
- **`LocalAbility`:**
  - sabe las cargas de cada casilla (`charges` del servidor y máximo 2 con `whirlCharges`);
  - predice igual que el servidor: gasta una carga; puede lanzarse si quedan cargas y no hay animación en curso; recarga con el enfriamiento.
  - La barra de habilidades muestra el número de cargas si el máximo es mayor que 1.
- **Panel:** sección "Equipo" con:
  - ranura (Yelmo, Pechera, Guanteletes, Botas);
  - tier (1 a 4);
  - los botones "Equipar" y "Soltar delante";
  - un selector de reliquia con el botón "Equipar reliquia".

- [ ] **Step 1: Write failing tests.**
  - `gearCompare`: sin pieza actual, de botas tier 2 → "+7,5 % velocidad de movimiento".
  - `gearCompare`: de tier 1 a tier 2 → "(+2,5 %)".
  - El parseo de un ítem `relic` funciona; uno con `kind` desconocido → `null`.
  - `LocalAbility` con 2 cargas: dos Torbellinos seguidos (esperando la animación) arrancan y el tercero no. Tras el enfriamiento, uno más.
  - El tooltip de una legendaria sin la habilidad lleva la marca de inactiva (la clase CSS o el texto que definas).
- [ ] **Step 2:** Correr los tests y ver el FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Correr `npm test`, `tsc` y el build: PASS.
- [ ] **Step 5:** Commit: `feat(client): equipo y reliquias en la red, el HUD, el aviso, el panel y las cargas`.

### Task 5: cliente, visuales del equipo y las reliquias

**Files:**
- Create:
  - `packages/client/src/render/gearLooks.ts`: partículas por parte del cuerpo y halo de la reliquia.
  - `packages/client/src/render/floorItemViews.ts`: piezas y reliquias en el suelo; o ampliar `floorWeaponViews.ts`, lo que quede más limpio.
- Modify:
  - `render/characterView.ts`: acceso a los huesos (head, spine2 o el torso alto, lefthand, righthand, leftfoot, rightfoot).
  - `render/playerViews.ts`.
  - `render/abilityFx.ts` o `hazardViews.ts`: grietas que ralentizan, visibles 3 s.
  - `main.ts`.
- Test: `packages/client/test/gearLooks.test.ts`

**Produces:**
- **`gearGlow(tier, glow): { color: Color3; rate: number; size: number; halo: boolean } | null`:**
  - tier 1 → `null`;
  - tier 2 → azul, emisión baja;
  - tier 3 → violeta, más densa, con halo;
  - tier 4 → dorado, más vistoso;
  - si `glow` ≠ `"none"`, el color es el del elemento (`NATURE_COLORS`).
- **Emisores por ranura, pegados a los huesos:**
  - casco: cabeza;
  - pechera: torso;
  - guantes: las dos manos;
  - botas: los dos pies.

  Como mucho 6 por jugador. Comparten la textura de `fxTextures`, se congelan en la pausa y se liberan al cambiar la pieza, al quitar el jugador y en `dispose`.
- **Legendaria:** un destello dorado periódico (cada ~1,5 s, con el reloj de juego) en su parte del cuerpo.
- **Reliquia en el personaje:** un pequeño halo o gema que orbita el pecho; dorado si es positiva, rojo y dorado si es de trade-off.
- **Objetos del suelo:**
  - equipo: forma simple con primitivas según la ranura (casco: semiesfera con cresta; pechera: caja con hombros; guantes: dos piezas pequeñas; botas: dos piezas en L), con el aro y el brillo del tier y el parpadeo de vencimiento de hoy;
  - reliquia: una gema (octaedro) que flota y gira, con un halo blanco cálido y un rayo vertical tenue.
- **Grietas de `slamCracks`:** la calcomanía de grietas dura 3 s y se desvanece al final.
- [ ] **Step 1: Write failing tests.**
  - `gearGlow(1, "none")` → `null`.
  - `gearGlow(4, "fire").color` → `NATURE_COLORS.fire`.
  - `gearGlow(3, "none").halo` → `true`.
  - Crear y liberar los emisores de un jugador con 4 piezas y una reliquia en NullEngine: no quedan mallas, partículas ni materiales sobrantes.
- [ ] **Step 2:** Correr los tests y ver el FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Correr `npm test`, `tsc` y el build: PASS.
- [ ] **Step 5:** Commit: `feat(client): brillo del equipo por parte del cuerpo, reliquias y objetos del suelo`.
