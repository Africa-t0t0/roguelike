# Plan 4: Progresión con cartas, pausa al subir de nivel y habilidades del guerrero. Plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDA: usar superpowers:subagent-driven-development (recomendado) o superpowers:executing-plans para implementar este plan tarea por tarea. Los pasos usan checkboxes (`- [ ]`) para seguimiento.

**Objetivo:** Cada subida de nivel pausa el juego para todo el grupo, y cada jugador elige 1 de 3 cartas: mejoras de stat o habilidades del guerrero que se usan con las teclas 1 a 4. Se quita la esquiva.

**Arquitectura:**
- **`shared`:** los datos y la matemática de cartas y habilidades (`cards.ts`) y los multiplicadores que necesitan igual el servidor y la predicción. Son el movimiento y la velocidad de ataque.
- **Servidor:**
  - `LevelUpSystem`: la máquina de pausa y elecciones.
  - `AbilitySystem`: habilidades, aturdido, empuje y la onda de la pasiva.
  - Las mejoras de stat se aplican en `CombatSystem`, `OrbSystem` y la regeneración.
- **Cliente:** panel de cartas con el mouse libre, congelado durante la pausa, barra de habilidades y animaciones de habilidad predichas, como el combo.

**Stack:** el mismo, sin dependencias nuevas.

**Spec:** `docs/specs/2026-10-25-progresion-cartas-design.md`. Antes: `docs/specs/2026-10-25-presion-botin-design.md` y `docs/specs/2026-10-23-roguelike-coop-design.md`.

## Restricciones globales

- **Cartas de stat** (`CardId`), con el efecto de cada carta. Se acumulan sumando:
  - `vitality`: +20 de vida máxima y cura 20.
  - `regen`: +1 de vida por segundo.
  - `strength`: +0.10 de daño.
  - `fury`: +0.10 de velocidad de ataque.
  - `reach`: +0.15 de alcance y arco.
  - `agility`: +0.08 de velocidad de movimiento.
  - `ironskin`: −0.08 de daño recibido. El factor nunca baja de 0.40.
  - `bloodlust`: +2 de vida por enemigo que mata ese jugador.
  - `magnet`: +0.5 de radio de imán.
- **Habilidades** (`AbilityId`), con su enfriamiento (s) y la duración de su animación (s):
  - `whirlwind`: CD 8, anim 0.9. 360°, radio 3. Daño ×[1.2, 1.6, 1.6]; en rango 3, un segundo giro 0.4 s después. Impacto a 0.5 de la animación. Clip `gs_high_spin_attack`.
  - `kick`: CD 6, anim 0.6. Cono de 90° a 2.2 m, daño ×0.5. Empuje [3, 3, 4] m y aturdido [1, 1.5, 2] s. Impacto a 0.4. Clip `ss_kick`.
  - `warcry`: CD 20, anim 0.8. Buff de grupo de +[0.25, 0.35, 0.45] durante 8 s. Clip `ss_power_up`.
  - `slam`: CD 10, anim 0.9. Impacto a los 0.5 s. Radio [3.5, 3.5, 4.5], daño ×[1.5, 2, 2]. Clip `ss_jump_2`.
  - `block`: mantenido, sin CD. Reducción frontal (±60°) de [0.7, 0.8, 0.9]. Velocidad de movimiento ×0.5 y sin atacar. Clip `ss_block_idle`.
  - `cleave` (pasiva, no ocupa casilla): el último golpe del combo lanza una onda a 14 m/s, con vida 0.5 s, que atraviesa. Daño ×[0.6, 0.9, 0.9] y radio [0.8, 0.8, 1.2].
- **Daño de habilidad** = `strikeDamage(arma, clase, nivel, 1, tier) × mult × (1 + strength) × (1 + grito)`. "Grito" es el mayor buff de Grito activo sobre ese jugador. El golpe normal también lleva `(1 + strength) × (1 + grito)`.
- **Oferta de cartas:**
  - 3 cartas: 1 de habilidad (nueva si quedan casillas, o subir de rango una que no esté en 3) y 2 de stat distintas.
  - Si no hay habilidad posible, 3 de stat.
  - Como máximo 4 activas equipadas; la pasiva va aparte.
  - Se sortea con la `Rng` de la sala.
- **Pausa:**
  - `CHOICE_TIME_S = 20` por elección, al mismo paso para todo el grupo.
  - Los muertos también eligen; los desconectados no bloquean.
  - Quien vuelve o entra tarde recibe sus elecciones pendientes sin pausa, con 20 s cada una y una carta al azar al vencer.
- **Regeneración base:** `BASE_REGEN = 0.5` de vida por segundo, más `regen`. Muertos y pausa no regeneran.
- **Curva de XP:** `xpToNext(nivel) = 60 + 40 × nivel`.
- **Esquiva fuera:**
  - sin `PlayerInput.dodge`, sin campos `dodge*` en `KinematicState` ni en `PlayerState`;
  - sin `DODGE_*`, sin la tecla C y sin la gracia de esquiva del combate;
  - `isInvulnerable` desaparece. La invulnerabilidad de reaparición (`invulnFor`) se queda.
- **Input:** `PlayerInput.abilities: number` es una máscara de 4 bits (bit i = tecla i+1 mantenida); `sanitizeInput` la acota a 0..15.
- **Protocolo:** `PROTOCOL_VERSION = 6`. `MSG` suma `levelChoice: "levelChoice"` y `chooseCard: "chooseCard"`.
- **Estado sincronizado:**
  - `RunState.paused: boolean` y `RunState.pauseLeft: number`.
  - `PlayerState` suma:
    - `choosing: boolean`, `moveSpeedMult: number`, `attackSpeedMult: number`, `blocking: boolean`, `buffDamage: number`;
    - `abilities`: array de `AbilitySlotState { id: string, rank: number, cooldown: number }`, en orden de casilla y sin la pasiva;
    - `passiveRank: number`, el rango de `cleave` (0 si no la tiene).
  - `EnemyState` suma `stunned: number`, los segundos que le quedan aturdido.
- **Sin `Math.random`** en `shared` ni en `server/src/sim`. Textos visibles en español. Commits con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Los tres paquetes en verde al final de cada tarea.

## Foco de revisión

1. **Pausa estanca:** con 2 jugadores, uno elige y el otro no; a los 20 s se le asigna una carta al azar y el juego sigue. Si el que no elige se desconecta en plena pausa, el juego sigue enseguida. Tests en la Tarea 3.
2. **Nada se mueve en la pausa:** enemigos, proyectiles, orbes, director, reloj, enfriamientos, buffs y aturdidos quedan quietos. El personaje propio no se desliza en el cliente y no salta al reanudar. Tests en las Tareas 3 y 7.
3. **Varias subidas juntas:** un orbe grande que sube 2 niveles da 2 elecciones seguidas en la misma pausa, cada una con sus 20 s. Test en la Tarea 3.
4. **Predicción con mejoras:** con `agility` y `fury`, el movimiento y el combo predichos coinciden con el servidor, sin correcciones visibles. Con el Bloqueo mantenido, la velocidad predicha es la mitad. Tests en las Tareas 1 y 4.
5. **Reconexión con progreso:** quien se reconecta conserva cartas, habilidades, rangos y enfriamientos, y recibe sus elecciones pendientes. Test en la Tarea 3.

---

## Estructura de archivos

```
packages/shared/src/movement.ts, constants.ts, protocol.ts, weapons.ts, combat.ts   (mod)
packages/shared/src/cards.ts          (nuevo) cartas, habilidades, oferta, multiplicadores
packages/server/src/sim/LevelUpSystem.ts  (nuevo)
packages/server/src/sim/AbilitySystem.ts  (nuevo)
packages/server/src/sim/CombatSystem.ts, EnemySystem.ts, OrbSystem.ts   (mod)
packages/server/src/rooms/*               (mod)
packages/client/src/input/*, net/*, render/animState.ts, render/playerViews.ts, main.ts   (mod)
packages/client/src/ui/cardPanel.ts       (nuevo)
packages/client/src/ui/abilityBar.ts      (nuevo)
scripts/assets/build-mixamo.mjs           (mod) clips ss_kick, ss_power_up, ss_block_idle, ss_jump_2
```

---

### Tarea 1: Quitar la esquiva, input de habilidades y velocidad con multiplicador (shared + adaptaciones)

**Archivos:**
- Modificar: `packages/shared/src/movement.ts`, `constants.ts` y `protocol.ts`; en el servidor, `CombatSystem.ts`, `RunRoom.ts`, `RunState.ts` y `syncState.ts`; en el cliente, `InputState.ts`, `browserInput.ts`, `Predictor.ts`, `LocalCombo.ts`, `animState.ts`, `playerViews.ts`, `connection.ts`, `main.ts` e `index.html`. Más sus tests.

**Interfaces:**
- Produce:
  - `KinematicState` sin campos `dodge*`.
  - `PlayerInput` sin `dodge` y con `abilities: number`.
  - `stepPlayer(s, input, d, dt, mods: MoveMods = NO_MOVE_MODS)` con `interface MoveMods { speedMult: number }` y `NO_MOVE_MODS = { speedMult: 1 }`. La velocidad es `(sprint ? SPRINT_SPEED : PLAYER_SPEED) × speedMult`.
  - `PROTOCOL_VERSION = 6` y `MSG.levelChoice` / `MSG.chooseCard`.
  - `Predictor` acepta `setMoveMods(mods: MoveMods)` y lo usa en cada `applyLocal` y en cada re-simulación.
  - `LocalCombo.tick(attack, blocked: { dead: boolean; locked: boolean }, nowMs, weaponId)`. `locked` reemplaza a `dodging`; la Tarea 6 lo usa para las animaciones de habilidad.

- [ ] **Paso 1: Tests que fallan**
  - `movement.test`: `stepPlayer` con `speedMult 1.5` avanza `PLAYER_SPEED × 1.5 × dt`; con sprint, `SPRINT_SPEED × 1.5 × dt`.
  - `sanitizeInput` acota `abilities` a un entero de 0 a 15 (16 da 15, −1 da 0, "3" da 0) e ignora un `dodge` que venga.
  - `Predictor.test`: con `setMoveMods({ speedMult: 1.2 })` predice igual que `stepPlayer` con esos mods, también después de reconciliar.
- [ ] **Paso 2:** FALLA.
- [ ] **Paso 3:** quitar la esquiva en los tres paquetes (código, tests, la tecla C y el texto de ayuda) y agregar los mods.
- [ ] **Paso 4:** `npm test` PASA y `tsc --noEmit` pasa en los tres paquetes.
- [ ] **Paso 5:** commit `refactor: quitar la esquiva; input de habilidades y velocidad con multiplicador`.

### Tarea 2: Cartas, habilidades y multiplicadores (shared)

**Archivos:**
- Crear: `packages/shared/src/cards.ts` y `packages/shared/test/cards.test.ts`
- Modificar: `combat.ts` (`xpToNext`, `EnemyDef.stunImmune?: boolean`), `weapons.ts` (velocidad de ataque) e `index.ts`

**Interfaces:**
- Produce:
  - `type StatCardId = "vitality" | "regen" | "strength" | "fury" | "reach" | "agility" | "ironskin" | "bloodlust" | "magnet"`.
  - `type AbilityId = "whirlwind" | "kick" | "warcry" | "slam" | "block" | "cleave"`.
  - `STAT_CARDS: Record<StatCardId, { name: string; text: string }>` y `ABILITIES: Record<AbilityId, AbilityDef>`, con todos los números de las Restricciones globales:
    - `AbilityDef = { name; kind: "active" | "held" | "passive"; cooldownS; animS; clip?: string; ranks: AbilityRank[3]; text(rank): string }`;
    - `AbilityRank` lleva los campos que use cada habilidad: `damageMult?`, `radius?`, `secondSpin?`, `knockback?`, `stunS?`, `buff?`, `reduction?`.
  - `type CardOffer = { kind: "stat"; id: StatCardId } | { kind: "ability"; id: AbilityId; rank: 1 | 2 | 3 }`.
  - `interface Progress { stats: Partial<Record<StatCardId, number>>; abilities: { id: AbilityId; rank: number }[] }`. `abilities` va en orden de aprendizaje e incluye la pasiva si la tiene.
  - `rollOffer(rng: Rng, p: Progress): CardOffer[]`.
  - `applyCard(p: Progress, card: CardOffer): void`.
  - `interface PlayerMods { maxHpBonus; regen; damageMult; attackSpeedMult; reachMult; moveSpeedMult; damageTakenMult; lifeOnKill; magnetMult }`.
  - `playerMods(p: Progress): PlayerMods`. Sin buffs ni bloqueo: el Grito y el Bloqueo los aplica el servidor encima.
  - `BASE_REGEN = 0.5`, `CHOICE_TIME_S = 20`, `MAX_ACTIVE_ABILITIES = 4`.
  - `xpToNext(level) = 60 + 40 × level`.
  - `strikeOf(weaponId, step, attackSpeedMult = 1)` divide la duración por `attackSpeedMult`.
  - `tryStartSwing(c, weaponId, attackSpeedMult = 1)` usa esa duración.
  - `cardTitle(card: CardOffer): string` y `cardText(card: CardOffer): string`, en español y listos para la UI.

- [ ] **Paso 1: Tests que fallan:**
  - `playerMods` de `{ strength: 2, fury: 1, ironskin: 10 }` da `damageMult 1.2`, `attackSpeedMult 1.1` y `damageTakenMult 0.4` (el piso).
  - `playerMods({})` da todo neutro: `regen` 0 y multiplicadores 1.
  - `rollOffer`:
    - sobre progreso vacío, 2000 veces: siempre 3 cartas; exactamente 1 de habilidad, de rango 1; las 2 de stat son distintas;
    - con 4 activas y la pasiva en rango 3, la carta de habilidad solo sube activas que no están en 3;
    - con todo al máximo, da 3 de stat.
  - `applyCard` de una habilidad nueva la agrega en rango 1, y una carta de rango la sube.
  - `xpToNext(1) === 100`, `xpToNext(5) === 260`.
  - `strikeOf("kingslayer-sword", 1, 1.25).duration ≈ 0.35 / 1.25`.
  - `cardTitle` / `cardText` no están vacíos para ninguna carta posible.
- [ ] **Paso 2:** FALLA. **Paso 3:** implementar. **Paso 4:** `npm test` PASA (los tests que dependían de la curva vieja se actualizan).
- [ ] **Paso 5:** commit `feat(shared): cartas, habilidades del guerrero y multiplicadores`.

### Tarea 3: Pausa y elecciones (servidor)

**Archivos:**
- Crear: `packages/server/src/sim/LevelUpSystem.ts` y `packages/server/test/LevelUpSystem.test.ts`
- Modificar: `RunRoom.ts`, `RunState.ts`, `syncState.ts`, `PlayerRegistry.ts` (el registro guarda `progress: Progress` y `pendingChoices: number`), `CombatSystem.ts` (`grantXp` devuelve los niveles subidos) y `RunRoom.test.ts`

**Interfaces:**
- Consume: `rollOffer`, `applyCard`, `CHOICE_TIME_S` (Tarea 2) y `MSG.levelChoice` / `MSG.chooseCard` (Tarea 1).
- Produce:
  - `class LevelUpSystem`:
    - `constructor(rng: Rng)`.
    - `onLevelsGained(n: number, connected: PlayerRecord[], all: PlayerRecord[]): void`: suma `n` a `pendingChoices` de **todos** los registros y abre la pausa si hay al menos un conectado.
    - `get paused(): boolean` y `get pauseLeft(): number`.
    - `step(dt: number, connected: PlayerRecord[]): ChoiceEvent[]`. Corre también en la pausa. Cuenta el tiempo, asigna al azar al vencer y abre la siguiente elección o cierra la pausa.
    - `choose(record: PlayerRecord, cardIndex: number): ChoiceEvent[]`: valida la elección y aplica la carta con `applyCard`.
    - `offerSolo(record: PlayerRecord): ChoiceEvent[]`: elección sin pausa para quien vuelve o entra tarde.
    - `type ChoiceEvent = { type: "offer"; key: string; cards: CardOffer[]; index: number; total: number; deadlineS: number } | { type: "applied"; key: string; card: CardOffer }`.
  - `RunRoom`:
    - Envía `offer` como `MSG.levelChoice` solo a ese cliente y escucha `MSG.chooseCard { index }`.
    - **Durante la pausa**, `tick()` solo:
      - vacía las colas de input, actualizando `lastSeq` al último seq;
      - llama a `levelUp.step`;
      - sincroniza `paused`, `pauseLeft` y `choosing`.
    - Fuera de la pausa no cambia nada; además, `levelUp.step` maneja las elecciones sin pausa.
    - `state.tick` no avanza en la pausa.
    - Al unirse tarde, `pendingChoices = level − 1`. Al unirse o reconectarse con elecciones pendientes y sin pausa, `offerSolo`.
  - El efecto de la carta en los stats lo aplica la Tarea 4. Aquí solo se registra en `progress`.

- [ ] **Paso 1: Tests que fallan** (`LevelUpSystem.test.ts`, con registros falsos mínimos):
  - Un nivel con 2 conectados: `paused`, y cada uno recibe un `offer` con `index 1/total 1`. Cuando eligen ambos, `paused` es false.
  - **(Foco 1)** Uno elige y el otro no; tras 20 s de `step` se le asigna una carta al azar (evento `applied`) y la pausa termina.
  - **(Foco 1)** El que no elige sale de `connected` en mitad de la pausa: la pausa termina en el siguiente `step` y su `pendingChoices` sigue en 1.
  - **(Foco 3)** Dos niveles: dos ofertas seguidas (`index` 1 y 2), con 20 s cada una.
  - Una elección con un índice fuera de rango, repetida o sin oferta abierta se ignora.
  - `offerSolo` no pausa y vence igual a los 20 s.
- [ ] **Paso 1b: tests en `RunRoom.test.ts`:**
  - **(Foco 2)** Con XP forzada para subir de nivel:
    - `state.paused` es true;
    - en la pausa, tras 30 ticks de reloj, no cambian `state.tick`, `floorTime`, las posiciones de los enemigos ni las de los orbes;
    - un input con movimiento no mueve al jugador, pero `lastSeq` avanza.
  - Al responder `chooseCard`, el juego sigue.
  - **(Foco 5)** Si se reconecta con una elección pendiente, recibe `levelChoice` sin que `state.paused` se active.
- [ ] **Paso 2:** FALLA. **Paso 3:** implementar. **Paso 4:** `npm test` PASA.
- [ ] **Paso 5:** commit `feat(server): pausa al subir de nivel y elección de cartas`.

### Tarea 4: Efectos de las mejoras de stat (servidor)

**Archivos:**
- Modificar: `CombatSystem.ts`, `OrbSystem.ts`, `RunRoom.ts` y `syncState.ts`, con sus tests

**Interfaces:**
- Consume: `playerMods` (Tarea 2) y `progress` en el registro (Tarea 3).
- Produce:
  - `CombatState` suma `mods: PlayerMods`, recalculado al aplicar una carta. Vida máxima = `playerStats(...).maxHp + mods.maxHpBonus`; `vitality` además cura 20.
  - El daño del golpe se multiplica por `mods.damageMult` (y por el Grito en la Tarea 5).
  - El alcance y el arco se multiplican por `mods.reachMult`.
  - La duración del swing usa `mods.attackSpeedMult`.
  - El daño recibido se multiplica por `mods.damageTakenMult`.
  - Regeneración por tick fuera de la pausa: `(BASE_REGEN + mods.regen) × dt`, hasta la vida máxima y solo si está vivo.
  - Cada kill propio cura `mods.lifeOnKill`.
  - `OrbSystem.step` usa por jugador `ORB_MAGNET_RADIUS × magnetMult`, con `SimPlayer.magnetMult` opcional y 1 por defecto.
  - `stepPlayer` en el servidor recibe `{ speedMult: mods.moveSpeedMult }`.
  - `PlayerState.moveSpeedMult` y `PlayerState.attackSpeedMult` se sincronizan.

- [ ] **Paso 1: Tests que fallan:**
  - Con `strength 2` el golpe hace `round(base × 1.2)`.
  - Con `reach 1` un enemigo a 2.4 m entra en el golpe 1 de la Kingslayer (2.2 × 1.15 = 2.53).
  - Con `fury 2` el siguiente golpe se libera tras `ceil((0.35 / 1.2) / dt)` inputs.
  - Con `ironskin 1` un golpe de 10 hace 9.2 (o el redondeo que use el código; documentarlo).
  - La regeneración sube 0.5 por segundo sin cartas y no pasa de la vida máxima.
  - `bloodlust` cura 2 por kill.
  - Con `magnet 2`, un orbe a 5 m se mueve hacia ese jugador (radio 6 m) y no hacia otro que no tiene la carta.
  - **(Foco 4)** Con `agility` el servidor mueve `PLAYER_SPEED × 1.08 × dt`, y `PlayerState.moveSpeedMult` vale 1.08.
- [ ] **Paso 2:** FALLA. **Paso 3:** implementar. **Paso 4:** PASA.
- [ ] **Paso 5:** commit `feat(server): efectos de las mejoras de stat`.

### Tarea 5: Habilidades del guerrero (servidor)

**Archivos:**
- Crear: `packages/server/src/sim/AbilitySystem.ts` y `packages/server/test/AbilitySystem.test.ts`
- Modificar: `EnemySystem.ts` (aturdido y empuje), `CombatSystem.ts` (Grito, Bloqueo y onda del último golpe), `RunRoom.ts`, `RunState.ts` y `syncState.ts`

**Interfaces:**
- Consume: `ABILITIES` y `Progress` (Tarea 2); los mods (Tarea 4); el rebobinado del combate.
- Produce:
  - `CombatState` suma:
    - `abilityCd: Partial<Record<AbilityId, number>>`;
    - `abilityAnim: { id: AbilityId; left: number; impacts: number[] } | null`, con los tiempos de impacto pendientes;
    - `heldMask: number`, `blocking: boolean` y `buffDamage: number` (el mayor Grito activo), con `buffLeft: number`.
  - `AbilitySystem.onInput(c, k, input, nowTick, enemies, history, party: CombatState[]): AbilityResult`:
    - se llama por input procesado, después del combo;
    - detecta flancos de las teclas con `abilities` y `heldMask`;
    - una tecla sin habilidad o en enfriamiento no hace nada;
    - no arranca con un swing en curso ni con otra animación, y mientras hay animación de habilidad no se puede atacar;
    - devuelve `AbilityResult { started?: AbilityId; hits: ImpactResult["hits"]; kills: ImpactResult["kills"] }`.
  - El Bloqueo mientras se mantiene:
    - `blocking = true`, velocidad ×0.5 (combinada con el mod) y sin atacar;
    - el daño recibido se reduce en `reduction` si la fuente está a ±60° de `facing`.
    - `EnemyHit` lleva la posición de la fuente (`sourceX`, `sourceZ`).
  - El Grito pone `buffDamage = buff` y `buffLeft = 8` en todos los compañeros conectados y vivos. Si ya tienen uno, se queda el mayor.
  - `EnemySystem.stun(id, s)` y `EnemySystem.knockback(id, dirX, dirZ, m)`:
    - el aturdido cancela `telegraph` y bloquea moverse y atacar;
    - `stunImmune` se respeta;
    - el empuje usa `moveCircle`.
  - La onda de `cleave`: al resolver el impacto del último golpe del combo, si `passiveRank > 0`, crea un proyectil del jugador.
    - Sistema nuevo pequeño dentro de `AbilitySystem`, `playerShots`. Atraviesa, golpea cada enemigo una sola vez y desaparece contra un muro.
    - Se sincroniza en `RunState.playerShots: map<{x, z, dirX, dirZ, radius}>`.
  - Los enfriamientos, buffs y aturdidos cuentan por tick simulado, así que no avanzan en la pausa.
  - Sincronizados:
    - `PlayerState.abilities` (`ArraySchema<AbilitySlotState>`), `passiveRank`, `blocking`, `buffDamage`;
    - `EnemyState.stunned`;
    - el evento `MSG.combat { type: "ability"; key; id }` para que los otros clientes reproduzcan la animación.

- [ ] **Paso 1: Tests que fallan** (`AbilitySystem.test.ts` con `EnemySystem` real y un dungeon abierto):
  - Torbellino de rango 1 golpea a 3 enemigos alrededor (a 2.5 m) en el tick de su impacto, con `round(base × 1.2)`, y no golpea a uno a 3.5 m. Queda en enfriamiento 8 s; repetirlo antes no hace nada. En rango 3 golpea dos veces, con 0.4 s entre golpes.
  - Patada: el enemigo de enfrente recibe daño, se aleja unos 3 m sin atravesar un muro cercano, queda `stunned` 1 s y no ataca en ese tiempo; uno a la espalda no se ve afectado.
  - Grito: los dos jugadores del grupo tienen `buffDamage 0.25` durante 8 s, y el golpe del otro jugador hace `round(base × 1.25)`.
  - Golpe sísmico: daño en radio 3.5 a los 0.5 s.
  - Bloqueo mantenido: un golpe enemigo de frente hace 30 %, uno por la espalda hace 100 %, la velocidad es la mitad y `attack` se ignora. Al soltar la tecla vuelve todo.
  - Onda: con `cleave` 1, el 3.er golpe de la Kingslayer crea un proyectil que daña a 2 enemigos alineados a 4 y 5 m, una vez a cada uno.
  - Usar una habilidad durante un swing no hace nada, y atacar durante la animación de una habilidad tampoco.
- [ ] **Paso 2:** FALLA. **Paso 3:** implementar. **Paso 4:** PASA.
- [ ] **Paso 5:** commit `feat(server): habilidades del guerrero`.

### Tarea 6: Cliente: input, animaciones y predicción de habilidades

**Archivos:**
- Modificar: `scripts/assets/build-mixamo.mjs` (agregar `kick`, `power_up`, `block_idle` y `jump_2` a la lista `ss_`, y correr el build), `packages/client/src/input/InputState.ts`, `browserInput.ts`, `net/connection.ts`, `render/animState.ts`, `render/playerViews.ts`, `render/looks.ts` y `main.ts`
- Crear: `packages/client/src/net/LocalAbility.ts`; tests en `animState.test.ts`, `InputState.test.ts` y `LocalAbility.test.ts`

**Interfaces:**
- Consume: Tareas 1, 2, 4 y 5.
- Produce:
  - `InputState` lee `Digit1`..`Digit4` como máscara mantenida en `abilities`.
  - `PlayerSnapshot` suma `abilities: { id, rank, cooldown }[]`, `passiveRank`, `blocking`, `buffDamage`, `moveSpeedMult`, `attackSpeedMult` y `choosing`. `EnemySnapshot` suma `stunned`. `WorldSnapshot` suma `paused`, `pauseLeft` y `playerShots`.
  - El `Predictor` recibe `setMoveMods({ speedMult: moveSpeedMult × (blocking ? 0.5 : 1) })` cuando llegan los datos propios.
  - `LocalCombo.tick` usa `attackSpeedMult` (pasarlo como parámetro).
  - `LocalAbility`, como `LocalCombo`: predice qué animación de habilidad arranca al apretar la tecla (flanco, con enfriamiento conocido por el estado del servidor y el local) y cuánto dura. Expone `heroAbility(nowMs): { id: AbilityId; elapsed: number } | null` y `blocking(held)`.
  - `chooseHeroAnim` gana `ability?: { id; elapsed }` y `blocking: boolean`:
    - la prioridad de la animación de habilidad va justo después de la muerte;
    - `block` en bucle con `ss_block_idle`;
    - el clip se ajusta a `animS`.
  - Los otros jugadores la reproducen con el evento `ability`.
  - Un enemigo con `stunned > 0` reproduce `hit` en bucle lento, o la pose quieta.
- [ ] **Paso 1: Tests que fallan:**
  - La máscara de `InputState` cuando se mantienen 1 y 3 es 0b0101.
  - `chooseHeroAnim` con `ability { id: "whirlwind" }` da `gs_high_spin_attack` ajustado a 0.9 s, y gana al ataque; `blocking` da `ss_block_idle` en bucle.
  - `LocalAbility` no repite mientras dura el enfriamiento.
  - `allClipIds()` incluye los 4 clips nuevos y existen en `public/assets/mixamo/anims/`.
- [ ] **Paso 2:** FALLA. **Paso 3:** implementar. **Paso 4:** `npm test` PASA.
- [ ] **Paso 5:** commit `feat(client): habilidades con teclas 1-4, animaciones y predicción`.

### Tarea 7: Cliente: pausa y panel de cartas

**Archivos:**
- Crear: `packages/client/src/ui/cardPanel.ts` y `packages/client/test/cardPanel.test.ts` (lógica pura del estado del panel)
- Modificar: `net/connection.ts` (`onLevelChoice`, `chooseCard`), `main.ts`, `input/browserInput.ts` (liberar y recapturar el puntero) e `index.html` (estilos, en la misma línea dorada y oscura del HUD)

**Interfaces:**
- Consume: Tareas 3 y 6.
- Produce:
  - `GameConnection.onLevelChoice(cb: (c: { cards: CardOffer[]; index: number; total: number; deadlineS: number }) => void)` y `GameConnection.chooseCard(index: number): void`.
  - `CardPanel`:
    - panel centrado con 3 cartas, cada una con tipo, título (`cardTitle`) y texto (`cardText`);
    - "Elección 1 de 2" y la cuenta regresiva desde `pauseLeft`, o desde `deadlineS` local en la elección sin pausa;
    - estado del grupo con los nombres y ✓ (de `PlayerState.choosing`);
    - clic para elegir; después, "Esperando al grupo…".
  - **Durante `paused`:**
    - el cliente no avanza la predicción ni envía inputs con movimiento (envía inputs vacíos o ninguno, sin romper `seq` y `lastSeq`);
    - congela las animaciones (`scene.animationsEnabled = false` o `speedRatio = 0`) y las vistas interpoladas;
    - libera el puntero.
  - Al reanudar, vuelve a capturar el puntero con el siguiente clic del jugador en el canvas.
  - En la elección sin pausa, el panel se muestra igual, el puntero queda libre y el jugador sigue moviéndose con WASD.
- [ ] **Paso 1: Tests que fallan** (lógica pura de `cardPanel`):
  - Formato del estado del grupo: "Ana ✓ · Bruno eligiendo…".
  - Formato de la cuenta: "0:20" o "20 s" (elegir uno y fijarlo).
  - Elegir dos veces envía una sola elección.
  - **(Foco 2)** Un test del `Predictor` o del bucle: en la pausa, N frames no cambian la posición predicha, y al reanudar no hay salto (la reconciliación no corrige nada).
- [ ] **Paso 2:** FALLA. **Paso 3:** implementar.
- [ ] **Paso 4:** `npm test` PASA. Verificación headless:
  - Vite propio en 5174, Chrome con swiftshader, scripts en el scratchpad.
  - Subir de nivel matando enemigos con `?floorTimeStart=60`.
  - Capturas del panel y de la elección.
  - Comprobar que los enemigos no se mueven durante la pausa.
  - No tocar 5173 ni 2567.
- [ ] **Paso 5:** commit `feat(client): pausa y panel de cartas al subir de nivel`.

### Tarea 8: Cliente: barra de habilidades y efectos

**Archivos:**
- Crear: `packages/client/src/ui/abilityBar.ts` y `packages/client/test/abilityBar.test.ts`
- Modificar: `main.ts`, `index.html`, `render/projectileViews.ts` (o un `playerShotViews.ts` nuevo) y `render/enemyViews.ts`

**Interfaces:**
- Consume: Tareas 5, 6 y 7.
- Produce:
  - `AbilityBar` abajo a la derecha, en el estilo del HUD:
    - 4 casillas con el número de tecla;
    - el ícono es una letra o glifo por habilidad (sin imágenes externas): Torbellino "⟳", Patada "↯", Grito "✶", Golpe "◎", Bloqueo "⛨";
    - puntos de rango y un barrido del enfriamiento;
    - una casilla vacía queda atenuada.
  - La pasiva se muestra como un rombo pequeño al lado, con su rango.
  - El buff del Grito aparece como un brillo dorado alrededor de la tarjeta del personaje, mientras `buffDamage > 0`.
  - El enemigo aturdido muestra un anillo de estrellas o un tono gris.
  - La onda de corte es un arco luminoso que viaja (emisivo, sin luces nuevas).
  - Funciones puras testeables: `formatCooldown(s)` (por ejemplo, "3" o "0.5") y `rankPips(rank)`.
- [ ] **Paso 1: Tests que fallan:** `formatCooldown` y `rankPips`. Con 2 habilidades, la barra muestra 2 casillas llenas y 2 vacías (lógica de modelo de vista).
- [ ] **Paso 2:** FALLA. **Paso 3:** implementar.
- [ ] **Paso 4:** `npm test` PASA. Verificación headless:
  - elegir una habilidad;
  - usarla (tecla 1) y capturar la animación, el enfriamiento en la barra y el efecto;
  - mantener el Bloqueo.
- [ ] **Paso 5:** commit `feat(client): barra de habilidades y efectos visuales`.
