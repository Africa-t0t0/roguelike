# Plan 4c: Ajustes tras la primera partida larga. Plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDA: usar superpowers:subagent-driven-development (recomendado) o superpowers:executing-plans para implementar este plan tarea por tarea. Los pasos usan checkboxes (`- [ ]`) para seguimiento.

**Objetivo:**
- Las armas del suelo desaparecen a los 40 s y se ven de pie.
- Los enemigos escalan con el tiempo y con el nivel del grupo, y el tope de vivos crece.
- Se agregan dos cartas (Aprendizaje y Celeridad) y la habilidad Tajo frontal.
- Las habilidades tienen efectos visuales y mejores animaciones.

**Arquitectura:**
- **shared:** números y fórmulas nuevas.
- **servidor:** escalado al crear enemigos, vencimiento de las armas del suelo, las cartas nuevas y el Tajo.
- **cliente:** armas de pie que parpadean, clips nuevos y efectos de habilidad con partículas y mallas emisivas.

**Spec:** `docs/specs/2026-10-26-ajustes-feedback-design.md`. Antes: `docs/specs/2026-10-25-progresion-cartas-design.md`.

## Restricciones globales

- **Escalado de enemigos**, aplicado al crearlos con `minutos = floorTime / 60`:
  - `hpMult = (1 + 0.12·(nivel − 1)) × (1 + 0.08·minutos)`
  - `damageMult = (1 + 0.06·(nivel − 1)) × (1 + 0.04·minutos)`
  - La XP no cambia.
- **Tope de vivos:** `maxLiveEnemies(jugadores, floorTime) = min(90, 45 + 10·(jugadores − 1) + 3·floor(floorTime / 60))`.
- **Armas del suelo:** `FLOOR_WEAPON_TTL_S = 40` y `FLOOR_WEAPON_BLINK_S = 5`.
  - El tiempo es simulado, así que se congela en la pausa.
  - Vale para todas: iniciales, soltadas y la que se deja al cambiar.
  - El mensaje `floorWeapons` suma `ttl` a cada ítem: los segundos que le quedan al momento de enviarlo.
- **Cartas nuevas:**
  - `learning` (Aprendizaje): +0.15 de XP por orbe recogido por ese jugador.
  - `haste` (Celeridad): −0.10 de enfriamiento de habilidades, multiplicativo, con un mínimo de 0.50.
  - `PlayerMods` suma `xpMult` y `cooldownMult`.
- **Tajo frontal (`thrust`):**
  - Habilidad activa, en línea hacia adelante con ancho 1.2 m.
  - Alcance [4, 6, 8] m y daño ×[1.3, 1.6, 2.0].
  - CD 7 s, animación 0.7 s, impacto a 0.45 de la animación.
  - Clip `gs_slide_attack`; ícono de la barra "➶".
- **Golpe sísmico:** el clip pasa a `gs_jump_attack`.
- **Assets:** el build suma `gs_jump_attack` y `gs_slide_attack` (desde `great-sword-pack/great_sword_jump_attack.glb` y `great_sword_slide_attack.glb`).
- **Protocolo:** `PROTOCOL_VERSION = 7`.
- **Generales:**
  - Sin `Math.random` en shared ni en server/sim.
  - Textos en español.
  - Commits con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Tests en verde y `tsc` limpio en los 3 paquetes.
  - **Sin verificaciones con navegador headless.**

## Foco de revisión

1. **Arma del suelo que vence en la pausa:** el tiempo no corre en la pausa, y al reanudar el arma conserva lo que le quedaba. Test en la Tarea 2.
2. **Escalado y enemigos ya vivos:** solo afecta a los que se crean después, nunca cambia a los vivos. La barra de vida del cliente usa el `maxHp` escalado. Test en la Tarea 2.
3. **Celeridad al mínimo:** con 10 cartas, el enfriamiento queda en el 50 %. Test en la Tarea 1.
4. **Tajo contra paredes:** no golpea a un enemigo detrás de un muro, porque comprueba línea de vista desde el jugador. Test en la Tarea 2.
5. **Efectos durante la pausa:** se congelan y no quedan mallas huérfanas al terminar. Test con NullEngine en la Tarea 4.

---

### Tarea 1: Números, cartas y Tajo (shared)

**Archivos:** `packages/shared/src/cards.ts`, `waves.ts`, `combat.ts` (o un archivo nuevo `scaling.ts`), `protocol.ts`, `index.ts`; tests en `cards.test.ts` y `waves.test.ts` (o `scaling.test.ts`).

**Interfaces:**
- Produce:
  - `enemyScale(floorTime: number, partyLevel: number): { hpMult: number; damageMult: number }`.
  - `maxLiveEnemies(players, floorTime)`.
  - `FLOOR_WEAPON_TTL_S` y `FLOOR_WEAPON_BLINK_S`.
  - `StatCardId` suma `"learning"` y `"haste"`.
  - `PlayerMods` suma `xpMult` y `cooldownMult`.
  - `AbilityId` suma `"thrust"`, con su `AbilityRank` (`range`, `damageMult`).
  - Constantes `THRUST_WIDTH = 1.2` y `THRUST_IMPACT_FRAC = 0.45`.
  - `ABILITIES.slam.clip = "gs_jump_attack"` y `ABILITIES.thrust.clip = "gs_slide_attack"`.
  - `PROTOCOL_VERSION = 7`.
- [ ] **Paso 1: tests que fallan:**
  - `enemyScale(0, 1)` da `{1, 1}`; `enemyScale(300, 3)` da `hpMult ≈ 1.24 × 1.4` y `damageMult ≈ 1.12 × 1.2`.
  - `maxLiveEnemies(1, 0) === 45`, `maxLiveEnemies(2, 600) === 85`, `maxLiveEnemies(4, 3600) === 90`.
  - `playerMods({ haste: 10 }).cooldownMult === 0.5` y `playerMods({ learning: 2 }).xpMult ≈ 1.3`.
  - `rollOffer` puede ofrecer `thrust`, `learning` y `haste`.
  - `cardText` del `thrust` en rango 2 menciona 6 m.
- [ ] **Paso 2:** FALLA. **Paso 3:** implementar y actualizar los tests que dependían del tope viejo. **Paso 4:** PASA.
- [ ] **Paso 5:** commit `feat(shared): escalado de enemigos, tope creciente, Aprendizaje, Celeridad y Tajo frontal`.

### Tarea 2: Servidor

**Archivos:** `packages/server/src/sim/EnemySystem.ts`, `WaveDirector.ts`, `AbilitySystem.ts`, `OrbSystem.ts` (o el lugar donde se suma la XP recogida), `rooms/RunRoom.ts` y `PlayerRegistry.ts`, con sus tests.

**Interfaces:**
- Consume: la Tarea 1.
- Produce:
  - `EnemySystem.setPartyLevel(level)`, o una ampliación de `setFloorClock(floorTime, floor, partyLevel)`. Los enemigos creados reciben `maxHp = hp = round(def.hp × hpMult)` y guardan `damageMult` para sus golpes y proyectiles.
  - `WaveDirector` usa `maxLiveEnemies(jugadores, floorTime)`.
  - `FloorWeapon` suma `expiresAt` (en `floorTime`). `RunRoom`, en cada tick simulado, quita las vencidas de cada registro y reenvía la lista a su dueño si cambió. El mensaje incluye `ttl = expiresAt − floorTime`.
  - XP de un orbe: `value × xpMult` del jugador que lo recoge. El total del grupo puede tener decimales; se acumula tal cual y el HUD redondea.
  - Los enfriamientos de habilidad se multiplican por `cooldownMult`.
  - `thrust`: rectángulo desde el jugador en `facing` (largo = alcance, ancho 1.2), con rebobinado. Solo golpea a enemigos con línea de vista desde el jugador (`hasLineOfSight`).
- [ ] **Paso 1: tests que fallan:**
  - Con nivel de grupo 3 y `floorTime` 300, un esbirro creado tiene `maxHp = round(20 × 1.24 × 1.4)` y su golpe hace `round(6 × 1.12 × 1.2)`. Un enemigo ya vivo no cambia.
  - **(Foco 2)** El cliente recibe ese `maxHp` en `EnemyState`.
  - Un arma soltada vence a los 40 s simulados y la lista se reenvía.
  - **(Foco 1)** En la pausa no vence, y al reanudar le queda lo mismo.
  - Con `learning` 1, un orbe de 4 suma 4.6.
  - Con `haste` 2, el Torbellino queda en enfriamiento `8 × 0.8`.
  - Tajo de rango 3: golpea a 2 enemigos alineados a 3 y 7.5 m; no golpea a uno a 1.5 m de costado. **(Foco 4)** No golpea a uno detrás de un muro.
- [ ] **Paso 2:** FALLA. **Paso 3:** implementar. **Paso 4:** PASA.
- [ ] **Paso 5:** commit `feat(server): escalado de enemigos, armas del suelo con vencimiento, cartas nuevas y Tajo frontal`.

### Tarea 3: Cliente: armas de pie, clips nuevos, Tajo y cartas

**Archivos:**
- `scripts/assets/build-mixamo.mjs`: sumar `jump_attack` y `slide_attack` a la lista `gs_`, y correr el build.
- `packages/client/src/render/floorWeaponViews.ts`, `net/connection.ts` (`ttl`), `ui/abilityBar.ts` (ícono "➶"), `render/animState.ts` / `looks.ts` y `main.ts`, con sus tests.

**Interfaces:**
- Armas del suelo:
  - De pie: punta abajo, clavada unos 10 cm en el suelo, inclinada unos 10°.
  - Oscilación vertical suave de ±3 cm a 1 Hz y giro lento sobre su eje vertical.
  - El aro y el brillo de tier se conservan.
  - Parpadeo (visibilidad alterna a 6 Hz) cuando `ttl` local ≤ 5.
  - El `ttl` local baja con el reloj del juego (`PauseClock`), así que se congela en la pausa.
- `parseFloorWeapons` acepta `ttl` (con 40 por defecto si falta).
- [ ] **Paso 1: tests que fallan:**
  - `parseFloorWeapons` lee `ttl`.
  - Una función pura `floorWeaponBlink(ttl, nowS): boolean` es visible con `ttl > 5` y alterna con `ttl ≤ 5`.
  - `allClipIds` incluye `gs_jump_attack` y `gs_slide_attack`, y existen en `public/assets/mixamo/anims/`.
  - `chooseHeroAnim` con `ability { id: "thrust" }` da `gs_slide_attack` ajustado a 0.7 s.
  - El modelo de la barra muestra "➶" para `thrust`.
- [ ] **Paso 2:** FALLA. **Paso 3:** implementar. **Paso 4:** PASA.
- [ ] **Paso 5:** commit `feat(client): armas del suelo de pie con vencimiento, Tajo frontal y clips nuevos`.

### Tarea 4: Cliente: efectos de habilidades

**Archivos:**
- Crear: `packages/client/src/render/abilityFx.ts` y `packages/client/test/abilityFx.test.ts` (con NullEngine).
- Modificar: `main.ts`, `render/playerViews.ts` (o donde se reproduce la habilidad propia y la remota) y `render/ThirdPersonCamera.ts` (temblor).

**Interfaces:**
- `class AbilityFx`:
  - `constructor(scene)`.
  - `play(id: AbilityId, at: { x: number; z: number; facing: number }, rank: number, startMs: number): void`.
  - `update(nowMs: number): void`, con el reloj del juego.
  - `dispose()`.
- Se reproduce para la habilidad propia (predicha, al empezar) y para la de otros (evento `ability`). El momento de impacto de cada efecto sale de las constantes de `cards.ts`.
- **Torbellino:** un aro emisivo naranja-fuego (toro fino) que crece de 0.5 m al radio en la duración del giro y se desvanece, más un `ParticleSystem` de chispas en círculo.
- **Golpe sísmico** (en el impacto):
  - una onda (un disco anular emisivo) que crece hasta el radio en 0.4 s y se desvanece;
  - una calcomanía de grietas (un plano en el suelo con una textura generada: líneas oscuras con borde naranja) que se apaga en 1.5 s;
  - polvo (un `ParticleSystem` marrón);
  - `camera.shake(0.25 s, intensidad 0.08)` si el jugador propio está a menos de 8 m.
- **Patada:** un destello blanco cálido de 0.15 s en el cono.
- **Grito:** un anillo dorado que crece hasta 4 m en 0.5 s.
- **Tajo frontal:** una estela (un plano alargado emisivo) del largo del alcance, que se desvanece en 0.3 s.
- **Restricciones:**
  - Sin luces nuevas.
  - Texturas de partículas generadas con `DynamicTexture` (un gradiente radial), creadas una sola vez y compartidas.
  - Mallas y sistemas de partículas en un pool, o liberados al terminar.
  - En la pausa, `update` no avanza (el reloj está congelado) y los sistemas de partículas se detienen (`ps.updateSpeed` 0 o `stop`/`start`).
- [ ] **Paso 1: tests que fallan** (NullEngine):
  - `play("whirlwind", …)` crea sus mallas.
  - Tras `update(start + duración + 100)` no queda ninguna malla del efecto en la escena.
  - **(Foco 5)** Con el tiempo congelado, el radio del aro no cambia.
  - `dispose()` no deja mallas ni texturas.
- [ ] **Paso 2:** FALLA. **Paso 3:** implementar. **Paso 4:** PASA.
- [ ] **Paso 5:** commit `feat(client): efectos visuales de las habilidades`.
