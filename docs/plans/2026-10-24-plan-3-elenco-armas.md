# Plan 3: Elenco de Mixamo, armas y estilos de combate. Plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDA: usar superpowers:subagent-driven-development (recomendado) o superpowers:executing-plans para implementar este plan tarea por tarea. Los pasos usan checkboxes (`- [ ]`) para seguimiento.

**Objetivo:** El jugador es el Kingslayer y los enemigos son personajes de Mixamo, todos animados por estilos de combate compartidos. El jugador pelea con armas que tienen estadísticas propias, cuyo daño llega en el momento del impacto, y puede cambiarlas en la sala de inicio.

**Arquitectura:**
- Los **datos** de armas y estilos (`WEAPONS`, `MOVESETS`) viven en `shared`. El servidor usa sus números y el cliente sus nombres de clip.
- El **combo** guarda además un "impacto pendiente" que se resuelve cuando el progreso del swing llega a `impactAt`, por input procesado, igual en el servidor y en el cliente.
- El **cliente** reemplaza los modelos KayKit por personajes de Mixamo. Las animaciones son archivos aparte que se asocian a los huesos por nombre normalizado, y las armas se cuelgan del hueso `RightHand`.

**Stack:** El del Plan 2, sin dependencias nuevas en tiempo de ejecución. Para preparar los assets (solo en el script de build): `fbx2gltf` y `@gltf-transform/*`, que ya se usaron en `.superpowers/kingslayer-work/`.

**Spec:** `docs/specs/2026-10-24-elenco-armas-estilos-design.md`. El spec general es `docs/specs/2026-10-23-roguelike-coop-design.md`.

## Restricciones globales

- **Números de armas y estilos** (todos en `packages/shared/src/weapons.ts`, una sola fuente):
  - `one-hand-sword`:
    - combo `[{clip "ss_slash", duration 0.35, damageMult 1, range 2.2, arcDeg 120, impactAt 0.45}, {clip "ss_slash_3", 0.35, 1, 2.2, 120, 0.45}, {clip "ss_attack_4", 0.5, 1.5, 2.6, 160, 0.5}]`, `comboResetS 0.6`.
    - locomoción `{idle "ss_idle", run "ss_run", sprint "ss_run_2", jump "ss_jump", hit "ss_impact", death "ss_death"}`.
  - `great-sword`:
    - combo `[{clip "gs_slash", 0.7, 1, 3.0, 160, 0.55}, {clip "gs_high_spin_attack", 0.9, 1.6, 3.2, 220, 0.6}]`, `comboResetS 0.8`.
    - locomoción `{idle "gs_idle", run "gs_run", sprint "gs_run_2", jump "gs_jump", hit "gs_impact", death "gs_death"}`.
  - Armas:
    - `kingslayer-sword`: "Espada del Kingslayer", estilo `one-hand-sword`, `damage 12`, `rangeMult 1`, `arcMult 1`, `speedMult 1`.
    - `guard-sword`: "Espada de guardia", estilo `one-hand-sword`, `10`, `0.9`, `1`, `1.15`.
    - `great-sword`: "Mandoble", estilo `great-sword`, `18`, `1`, `1`, `1`.
  - `STARTING_WEAPON = "kingslayer-sword"`.
- **Fórmulas** (spec §4.1):
  - daño = `round((weapon.damage + damagePerLevel × (nivel − 1)) × golpe.damageMult)`.
  - alcance = `golpe.range × rangeMult`.
  - arco = `golpe.arcDeg × arcMult`.
  - duración = `golpe.duration / speedMult`.
  - el impacto ocurre cuando han pasado `impactAt × duración` segundos de swing.
- **Clase:** `warrior` conserva `baseHp 120`, `hpPerLevel 12` y `damagePerLevel 2`. Su `baseDamage` y su `combo` salen de `CLASS_DEFS`; ahora son del arma y del estilo.
- **Enemigos:** los radios de `ENEMY_DEFS` pasan a `brute 0.6`, `minion 0.4` y `mage 0.5`. El resto de sus números no cambia.
- **Alturas en el cliente:** jugador 1,8 m, bruto 2,4 m, esbirro 1,7 m y mago 2,2 m.
- **Cambio de arma:**
  - Distancia para tomar un arma: `PICKUP_RANGE = 1.5` m.
  - Tecla `E` (`KeyE`).
  - Las armas del suelo son **individuales** (por jugador) y se envían solo a su dueño.
  - No se puede cambiar de arma con un swing en curso.
- **Protocolo:** `PROTOCOL_VERSION = 4`. `PlayerInput` suma `interact: boolean`. `PlayerState` suma `weaponId: string`. `MSG` suma `floorWeapons: "floorWeapons"`.
- **Licencias:** en `public/assets/` se commitean solo los GLB que usa el juego, nunca los FBX ni los packs completos de Mixamo. `CREDITS.md` incluye a Pigcraft (Kingslayer, CC BY 4.0), Mixamo (personajes y animaciones) y Quaternius (CC0, armas).
- Sin `Math.random` en `shared` ni en `server/src/sim`. Textos visibles en español. Commits con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Foco de revisión

1. **Golpe cancelado:** morir, o empezar una esquiva, entre el clic y el impacto no hace daño ni emite `damage`, aunque sí se emitió `swing`. Test en la Tarea 3.
2. **El mismo arma rápida y lenta:** con `speedMult 1.15` el impacto llega antes y el siguiente golpe se libera antes, contando los inputs procesados. Si el servidor procesa varios inputs juntos en un tick, el impacto no se pierde ni se aplica dos veces. Test en la Tarea 3.
3. **Cambio de arma a mitad del swing** (E mientras `swingTimer > 0`): se ignora y no deja el combo en un estado imposible. Test en la Tarea 4.
4. **Reconexión o toma de control:** el arma equipada y las armas del suelo de ese jugador se conservan, y al volver se le reenvían. Test en la Tarea 4.
5. **Una animación sin uno de los huesos** (por ejemplo, un personaje sin `HeadTop_End`): se ignora ese hueso y la animación igual se reproduce, sin errores. Test en la Tarea 5.

---

## Estructura de archivos

```
scripts/assets/build-mixamo.mjs        arma public/assets/mixamo/ desde .superpowers/kingslayer-work/ (Tarea 1)
packages/shared/src/weapons.ts         Moveset, Weapon, MOVESETS, WEAPONS, fórmulas, combo con impacto (Tarea 2)
packages/shared/src/combat.ts          clase sin combo; ENEMY_DEFS con radios nuevos (Tarea 2)
packages/server/src/sim/CombatSystem.ts  swing → impacto pendiente → resolución (Tarea 3)
packages/server/src/rooms/{RunRoom,RunState,PlayerRegistry,syncState}.ts  weaponId, armas del suelo, E (Tarea 4)
packages/client/public/assets/mixamo/  characters/, anims/, weapons/ (Tarea 1)
packages/client/src/render/assets.ts   catálogo nuevo de modelos (Tarea 5)
packages/client/src/render/animLibrary.ts  carga de clips y asociación por hueso (Tarea 5)
packages/client/src/render/looks.ts    WEAPON_LOOKS (modelo + agarre) y ENEMY_LOOKS (modelo, altura, clips) (Tarea 5)
packages/client/src/render/characterView.ts  personaje Mixamo + arma en RightHand (Tarea 5)
packages/client/src/render/animState.ts  elige clips desde el estilo del arma o desde ENEMY_LOOKS (Tarea 6)
packages/client/src/render/floorWeaponViews.ts  armas en el suelo (Tarea 7)
packages/client/src/net/LocalCombo.ts  combo por arma con impacto (Tarea 7)
```

---

### Tarea 1: Assets de Mixamo y armas en el repo

**Archivos:**
- Crear: `scripts/assets/build-mixamo.mjs`, `packages/client/public/assets/mixamo/**`
- Modificar: `CREDITS.md`, `README.md` (sección "Assets": cómo regenerar)

**Interfaces:**
- Produce estos archivos, servidos en `/assets/mixamo/...`:
  - `characters/{kingslayer,brute,minion,mage}.glb`: copias de `glb/kingslayer-rig.glb`, `glb/bruto-1k.glb`, `glb/esbirro-1k.glb` y `glb/mago-1k.glb`.
  - `anims/<clipId>.glb`: un clip por archivo, con este mapeo desde `.superpowers/kingslayer-work/glb/`:
    - `ss_*`: `pack/sword_and_shield_<x>.glb` (idle, run, run_2, jump, impact, death, slash, slash_3, attack_4).
    - `gs_*`: `great-sword-pack/great_sword_<x>.glb` (idle, run, run_2, jump, impact, impact_2, impact_4, slash, high_spin_attack); `gs_death` sale de `two_handed_sword_death.glb`.
    - `cr_*`: `creature-pack/mutant_<x>.glb` (idle, idle_2, run, walking, swiping, punch, dying).
    - `mg_*`: `magic-spell-pack/` (`standing_idle` → `mg_idle`, `standing_1h_magic_attack_01` → `mg_attack`).
  - `weapons/kingslayer-sword.glb`: la hoja, la guarda y el pomo unidos en una malla, con el origen en el centro de la empuñadura y la hoja apuntando a +Y local.
  - `weapons/guard-sword.glb` y `weapons/great-sword.glb`: de Quaternius *Medieval Weapons* (CC0), `Sword.glb` y `Claymore.glb`, descargados de `https://raw.githubusercontent.com/trebeljahr/quaternius-showcase/HEAD/public/glb/medieval_weapons_pack/`. Origen en la empuñadura y hoja hacia +Y.

- [ ] **Paso 1:** Escribir `scripts/assets/build-mixamo.mjs` (Node ≥ 24).
  - Lee la carpeta de trabajo (argumento `--work`, por defecto `.superpowers/kingslayer-work`), copia y renombra según el mapeo y escribe en `packages/client/public/assets/mixamo/`.
  - Para la espada del Kingslayer: une las tres piezas con `@gltf-transform/functions` (`join`), recentra el origen en el centro de la caja de la guarda y la orienta.
  - Para las armas de Quaternius: las descarga, recentra y orienta igual.
  - Falla con código ≠ 0 si falta algún archivo de origen.
  - Las dependencias de build (`@gltf-transform/core`, `functions` y `extensions`, versiones `4.x` publicadas hace ≥ 2 semanas) van como `devDependencies` de la raíz.
- [ ] **Paso 2:** `node scripts/assets/build-mixamo.mjs`, y `ls -R packages/client/public/assets/mixamo` muestra 4 personajes, 3 armas y todos los clips del mapeo. Cada clip pesa menos de 300 KB.
- [ ] **Paso 3:** Agregar a `CREDITS.md`:
  - "Kingslayer Assassin — Pigcraft — CC BY 4.0 — <url de Sketchfab>", con la nota de que se modificó: reducido a 20k triángulos y sin espada.
  - Mixamo, de Adobe: personajes Warrok W Kurniawan, Ch25 y Maw J Laygo, y las animaciones.
  - Quaternius *Medieval Weapons*, CC0.
- [ ] **Paso 4:** `npm run build -w @roguelike/client` → los assets aparecen en `dist/assets/mixamo`.
- [ ] **Paso 5: Commit** `chore: assets de Mixamo (Kingslayer, enemigos, clips) y armas`.

### Tarea 2: Armas, estilos y combo con impacto (shared)

**Archivos:**
- Crear: `packages/shared/src/weapons.ts`, `packages/shared/test/weapons.test.ts`
- Modificar: `packages/shared/src/{combat.ts,movement.ts,protocol.ts,index.ts}`, `packages/shared/test/{combat,movement}.test.ts`

**Interfaces:**
- Produce:
  ```ts
  type MovesetId = "one-hand-sword" | "great-sword";
  type WeaponId = "kingslayer-sword" | "guard-sword" | "great-sword";
  interface Strike { clip: string; duration: number; damageMult: number; range: number; arcDeg: number; impactAt: number }
  interface Moveset { id: MovesetId; locomotion: { idle: string; run: string; sprint: string; jump: string; hit: string; death: string }; combo: readonly Strike[]; comboResetS: number }
  interface Weapon { id: WeaponId; name: string; movesetId: MovesetId; damage: number; rangeMult: number; arcMult: number; speedMult: number }
  const MOVESETS: Record<MovesetId, Moveset>; const WEAPONS: Record<WeaponId, Weapon>; const STARTING_WEAPON: WeaponId;
  isWeaponId(v: unknown): v is WeaponId
  strikeOf(weaponId: WeaponId, step: number): { duration: number; range: number; arcDeg: number; damageMult: number; impactAt: number; clip: string } // ya escalado por el arma
  strikeDamage(weaponId: WeaponId, cls: ClassId, level: number, step: number): number
  // Combo (reemplaza advanceCombo/tryStartSwing de combat.ts):
  interface ComboTimers { comboStep: number; swingTimer: number; comboTimer: number; impactTimer: number; impactPending: boolean }
  newComboTimers(): ComboTimers
  advanceCombo(c: ComboTimers, dt: number): boolean       // true si en este avance se cumplió el impacto pendiente (una sola vez)
  tryStartSwing(c: ComboTimers, weaponId: WeaponId): number // paso 1..n o 0; deja impactPending=true e impactTimer=impactAt×duración
  cancelImpact(c: ComboTimers): void                       // impactPending=false (el swing y el combo siguen)
  ```
  - `playerStats(cls, level)` pasa a devolver solo `{ maxHp }`.
  - `PlayerInput` suma `interact` (en `sanitizeInput`, true solo si `=== true`).
  - `MSG.floorWeapons` y `PROTOCOL_VERSION = 4`.

Reglas:
- `advanceCombo` usa la misma tolerancia `COMBO_EPS` que hoy, también para `impactTimer`. El impacto se cumple en el avance en que `impactTimer` llega a 0 con `impactPending`; ese avance devuelve `true` y deja `impactPending = false`.
- Si `impactAt × duración` es menor o igual que un `dt`, el impacto ocurre en el primer avance después de empezar el swing, nunca en el mismo input que lo empieza. Esa es la regla de orden: el servidor y el cliente llaman primero `advanceCombo` y después `tryStartSwing`.

- [ ] **Paso 1: Tests que fallan:**
  - `strikeOf("guard-sword", 1)`: `duration ≈ 0.35/1.15`, `range ≈ 1.98`, `arcDeg 120`, `impactAt 0.45`. `strikeOf("great-sword", 2)`: `duration 0.9`, `range 3.2`, `arcDeg 220`.
  - `strikeDamage("kingslayer-sword", "warrior", 1, 3) === 18` y `strikeDamage("great-sword", "warrior", 3, 2) === round((18 + 4) × 1.6) === 35`.
  - **Impacto:** tras `tryStartSwing(c, "great-sword")`, `advanceCombo(c, SIM_DT)` devuelve `true` exactamente una vez, en el avance número `ceil(0.55 × 0.7 / SIM_DT)` (= 12), y `false` en todos los demás hasta el fin del swing.
  - Con `"guard-sword"`, el siguiente golpe se libera tras `ceil((0.35/1.15)/SIM_DT)` avances (= 10), no antes.
  - `cancelImpact` antes del impacto hace que ningún avance devuelva `true`, y el combo sigue (el siguiente `tryStartSwing` da el paso 2).
  - El combo del mandoble tiene 2 pasos: tras el paso 2, dentro de `comboResetS`, vuelve al paso 1.
  - `playerStats("warrior", 3)` → `{ maxHp: 144 }`.
  - `ENEMY_DEFS.brute.radius === 0.6`, `minion 0.4`, `mage 0.5`.
  - `sanitizeInput({seq: 1, interact: "y"}).interact === false`.
- [ ] **Paso 2:** Correr → FALLA.
- [ ] **Paso 3:** Implementar `weapons.ts`, sacar el combo de `combat.ts` y actualizar los literales (`interact: false`, `ComboTimers` nuevos) en todo el repo para que `npm run typecheck` pase. El servidor y el cliente se adaptan del todo en las Tareas 3 y 7; aquí, lo mínimo para compilar.
- [ ] **Paso 4:** `npm test -w @roguelike/shared` y `npm run typecheck` → PASAN. Los tests del servidor y el cliente que dependan del combo viejo pueden fallar hasta las Tareas 3 y 7: anotar cuáles en el informe.
- [ ] **Paso 5: Commit** `feat(shared): armas, estilos de combate y combo con impacto`.

### Tarea 3: Combate por arma con daño al impacto (servidor, puro)

**Archivos:**
- Modificar: `packages/server/src/sim/CombatSystem.ts`, `packages/server/test/CombatSystem.test.ts`

**Interfaces:**
- Consume: Tarea 2.
- Produce:
  - `CombatState` suma `weaponId: WeaponId` y `swingFacing: number`, y usa los `ComboTimers` nuevos.
  - `newCombatState(cls, level, weaponId = STARTING_WEAPON)`.
  - `AttackResult` pasa a `{ swung: boolean; step: number }`: `attack()` solo empieza el swing y guarda `swingFacing = input.facing`.
  - `onInputProcessed(c, k, input, nowTick, enemies, history)` devuelve `{ damage: number; died: boolean; impact: ImpactResult | null }`, con `ImpactResult = { step: number; hits: { enemyId: string; amount: number; killed: boolean; x: number; z: number }[]; xpGained: number }`.

Reglas:
- **Orden por input:** `advanceCombo`. Si devuelve `true` y el jugador no está muerto, se resuelve el impacto:
  - Tick de rebobinado: `t = clamp(round(input.viewTick), nowTick − REWIND_MAX_TICKS, nowTick)`.
  - Origen: `{k.x, k.z, swingFacing}`.
  - Alcance, arco y daño: `strikeOf` y `strikeDamage` con el `weaponId` del estado y el nivel del grupo.
  - Después siguen los golpes enemigos pendientes, como hoy.
- **Cancelación:** si el input deja al jugador esquivando (`isInvulnerable(k)`) con un impacto pendiente, se llama `cancelImpact` antes de avanzar. Morir también cancela, en `step()`, cuando el jugador muere.
- **La regla de ráfaga del Plan 2 se mantiene:** nunca más de un swing en curso y nunca más de un impacto por swing.

- [ ] **Paso 1: Tests que fallan** (adaptar los existentes del combo y del rebobinado a "el daño llega en el impacto"):
  - **Impacto con espada:** `attack` en el tick 100 no daña. Tras `ceil(0.45 × 0.35 / SIM_DT)` (= 5) inputs procesados, `onInputProcessed` devuelve `impact` con el golpe al enemigo del arco, por 12 de daño.
  - **Rebobinado al impacto:** el enemigo estaba en el arco en el tick que dice el `viewTick` del input del impacto y fuera en el actual → golpea. Se mantiene la prueba de que sin el tope de rebobinado el resultado cambiaría (el fallback a la posición actual sí golpearía).
  - **Dirección fijada:** si el jugador gira (`input.facing` distinto) entre el clic y el impacto, el arco usa la dirección del clic.
  - **Foco 1:** si empieza una esquiva antes del impacto, no hay `impact`; si muere antes, tampoco.
  - **Foco 2:** con `guard-sword`, el impacto llega en el input `ceil(0.45 × (0.35/1.15) / SIM_DT)` (= 5). Procesando 3 inputs por tick, el impacto ocurre una sola vez.
  - **Mandoble:** el paso 2 a nivel 3 hace 35 de daño, y un enemigo a 3,1 m dentro de 220° recibe el golpe.
- [ ] **Paso 2:** Correr → FALLA. **Paso 3:** Implementar. **Paso 4:** `npm test -w @roguelike/server -- CombatSystem` → PASA.
- [ ] **Paso 5: Commit** `feat(server): combate por arma con daño en el impacto`.

### Tarea 4: Arma equipada y armas del suelo en la sala (servidor)

**Archivos:**
- Modificar: `packages/server/src/rooms/{RunRoom.ts,RunState.ts,PlayerRegistry.ts,syncState.ts}`, `packages/server/test/{RunRoom,PlayerRegistry}.test.ts`

**Interfaces:**
- Consume: Tareas 2 y 3.
- Produce:
  - `PlayerState.weaponId` (string).
  - `PlayerRecord.floorWeapons: { weaponId: WeaponId; x: number; z: number }[]`.
  - El mensaje `MSG.floorWeapons` con `{ items: { weaponId, x, z }[] }`, que se envía **solo** al cliente dueño al unirse, al reconectar o tomar el control, y cada vez que cambia.
  - El evento `swing` se emite al empezar el swing; los `damage` contra enemigos, más `grantXp` y `levelUp`, se emiten en el impacto.

Reglas:
- **Armas del suelo:**
  - Al crear un `PlayerRecord`, sus armas del suelo son todas las de `WEAPONS` menos la equipada.
  - Se ubican en centros de casillas caminables de la sala `start`, en orden fijo de `roomSpawnPoints`, saltando los puntos de aparición de jugadores.
  - La reconexión y la toma de control las conservan.
- **Tomar un arma:**
  - Un input con `interact` (procesado, de un jugador vivo y sin swing en curso) busca el arma del suelo propia más cercana a ≤ `PICKUP_RANGE`.
  - Si la hay, intercambia: el arma equipada pasa al suelo en la posición del arma tomada, y se equipa la tomada.
  - El cambio reinicia el combo (`newComboTimers()`) y envía `floorWeapons` al dueño.

- [ ] **Paso 1: Tests que fallan** (integración con `@colyseus/testing`):
  - Un jugador nuevo tiene `weaponId === "kingslayer-sword"` y recibe `floorWeapons` con 2 armas dentro de la sala de inicio.
  - Si se teletransporta junto a la del mandoble y envía `interact: true`, pasa a `weaponId "great-sword"` y su `floorWeapons` contiene la espada del Kingslayer en esa posición.
  - Con `interact` a más de 1,5 m, nada cambia.
  - **Foco 3:** `interact` con `swingTimer > 0` no cambia nada.
  - **Foco 4:** tras un cambio, salir y volver a entrar (y lo mismo con una toma de control) conserva el `weaponId`, y vuelve a llegar `floorWeapons` con las mismas posiciones.
  - Las armas del suelo de un jugador no le llegan a otro jugador.
  - El daño contra un enemigo llega en el impacto, no en el tick del clic: el evento `damage` llega después del `swing`, separado al menos por `impactAt × duración`.
- [ ] **Paso 2:** Correr → FALLA. **Paso 3:** Implementar. **Paso 4:** `npm test -w @roguelike/server` y `npm run typecheck` → PASAN.
- [ ] **Paso 5: Commit** `feat(server): arma equipada, armas del suelo y daño al impacto en la sala`.

### Tarea 5: Personajes de Mixamo, biblioteca de clips y arma en la mano (cliente)

**Archivos:**
- Crear: `packages/client/src/render/{animLibrary.ts,looks.ts}`, `packages/client/test/{animLibrary,looks}.test.ts`
- Modificar: `packages/client/src/render/{assets.ts,characterView.ts}`

**Interfaces:**
- Produce:
  ```ts
  // assets.ts
  type AssetId = "kingslayer" | "brute" | "minion" | "mage" | "kingslayer-sword" | "guard-sword" | "great-sword" | "wall" | "floor" | "pillar";
  // animLibrary.ts
  boneKey(name: string): string        // quita /^mixamorig\d*:/i y pasa a minúsculas
  class AnimLibrary { constructor(scene: Scene); load(clipIds: readonly string[]): Promise<void>; bind(clipId: string, nodes: ReadonlyMap<string, TransformNode>, name: string): AnimationGroup | null; length(clipId: string): number }
  // looks.ts
  const WEAPON_LOOKS: Record<WeaponId, { asset: AssetId; grip: { position: [number, number, number]; rotation: [number, number, number]; scale: number } }>
  interface EnemyLook { asset: AssetId; height: number; clips: { idle: string; run: string; attack: string; hit: string; death: string }; runSpeed?: number }
  const ENEMY_LOOKS: Record<EnemyKind, EnemyLook>
  const PLAYER_LOOK: { asset: AssetId; height: number }
  allClipIds(): string[]               // todos los clips de MOVESETS y ENEMY_LOOKS, sin repetir
  // characterView.ts
  class CharacterView { constructor(scene, assets, anims: AnimLibrary, look: { asset: AssetId; height: number }); setWeapon(weaponId: WeaponId | null): void; setPose(x, y, z, facing): void; play(choice: AnimChoice): void; dispose(): void }
  ```

Reglas:
- **`AnimLibrary.bind`:** crea un `AnimationGroup` nuevo con una animación dirigida por cada animación del clip cuyo hueso, por `boneKey`, exista en `nodes`, e ignora las demás. Si ninguna calza, devuelve `null`. Normaliza al rango original del clip.
- **`CharacterView`:**
  - Instancia el personaje con `instantiateModelsToScene` (esqueleto propio por instancia) y lo escala a `look.height`.
  - Crea los grupos de cada clip la primera vez que se reproducen y conserva el cruce de 0,15 s del Plan 2.
  - `setWeapon` cuelga el modelo del arma del nodo cuyo `boneKey` sea `"righthand"`, con el agarre de `WEAPON_LOOKS`; con `null` lo quita.
- **`ENEMY_LOOKS`** (clips de la Tarea 1):
  - brute: `brute`, 2,4 m, `cr_idle`, `cr_run`, `cr_swiping`, `gs_impact`, `cr_dying`.
  - minion: `minion`, 1,7 m, `cr_idle_2`, `cr_run`, `cr_punch`, `gs_impact_4`, `cr_dying`.
  - mage: `mage`, 2,2 m, `mg_idle`, `cr_walking`, `mg_attack`, `gs_impact_2`, `gs_death`.
- **El agarre de cada arma se ajusta a ojo.** Se usa una página de desarrollo `packages/client/dev/grip.html` (no entra al build de producción) que muestra al Kingslayer con cada arma en su pose de quieto y de ataque, con controles para mover y girar el arma e imprimir los valores. Los valores finales quedan en `WEAPON_LOOKS`.

- [ ] **Paso 1: Tests que fallan:**
  - `boneKey("mixamorig:RightHand") === "righthand"` y `boneKey("mixamorig1:Hips") === "hips"`.
  - **Foco 5:** `AnimLibrary.bind` con un clip falso (creado en el test con `NullEngine` y nodos `mixamorig:Hips`, `mixamorig:Spine` y `mixamorig:HeadTop_End`) contra nodos `mixamorig1:Hips` y `mixamorig1:Spine` devuelve un grupo con 2 animaciones, sin error. Contra nodos sin coincidencias devuelve `null`.
  - `allClipIds()` contiene cada clip de `MOVESETS` y `ENEMY_LOOKS`, sin repetidos.
  - `WEAPON_LOOKS` tiene una entrada por cada `WeaponId`.
- [ ] **Paso 2:** Correr → FALLA. **Paso 3:** Implementar, incluida la página de agarre, y ajustar los agarres mirándola con Chrome headless (capturas en el scratchpad).
- [ ] **Paso 4:** `npm test -w @roguelike/client -- animLibrary looks` → PASA, y `npm run typecheck` → PASA.
- [ ] **Paso 5: Commit** `feat(client): personajes de Mixamo, biblioteca de clips y armas en la mano`.

### Tarea 6: Animación por estilo de arma y por enemigo (cliente)

**Archivos:**
- Modificar: `packages/client/src/render/{animState.ts,playerViews.ts,enemyViews.ts}`, `packages/client/test/animState.test.ts`

**Interfaces:**
- Consume: Tareas 2 y 5.
- Produce:
  - `HeroAnimInput` suma `weaponId: WeaponId`.
  - `chooseHeroAnim(a, clipLengths)` toma la locomoción y el combo de `MOVESETS[WEAPONS[a.weaponId].movesetId]`:
    - El ataque usa `combo[comboStep−1].clip`, ajustado a `strikeOf(weaponId, step).duration`.
    - Al esquivar suena `locomotion.run` a ×2.
    - Correr rápido (más de 6 m/s) usa `locomotion.sprint`; si no, `locomotion.run`.
    - Se mantiene el orden de prioridades del Plan 2.
  - `chooseEnemyAnim(e, clipLengths)` usa `ENEMY_LOOKS[e.kind].clips`. La telegrafía ajusta `clips.attack` a `ENEMY_DEFS[kind].telegraphS`, y `runSpeed` multiplica la velocidad de `run`.
  - `PlayerViews` usa `CharacterView` con `PLAYER_LOOK` y `setWeapon(snapshot.weaponId)`, y lo cambia cuando cambia el `weaponId`.
  - `EnemyViews` usa `ENEMY_LOOKS`. La barra de vida se ubica a `height + 0.25` m, según el modelo.

- [ ] **Paso 1: Tests que fallan:**
  - Con `weaponId "great-sword"`, paso 2 y `swingTimer > 0`, el clip es `gs_high_spin_attack`, con `speed = largoDelClip / 0.9`.
  - Con `"guard-sword"`, paso 1, la duración usada es 0,35/1,15.
  - Esquivando, suena el `run` del estilo a ×2.
  - A más de 6 m/s, `ss_run_2` con la espada y `gs_run_2` con el mandoble.
  - Para el enemigo `mage`, la telegrafía usa `mg_attack` con `speed = largo / 0.7`; muerto, usa `gs_death` sin bucle.
  - Se mantienen las pruebas de prioridad del Plan 2: muerto gana a todo, esquivar gana al ataque y un swing en el aire muestra el ataque.
- [ ] **Paso 2:** Correr → FALLA. **Paso 3:** Implementar. **Paso 4:** `npm test -w @roguelike/client` → PASA.
- [ ] **Paso 5: Commit** `feat(client): animaciones por estilo de arma y por tipo de enemigo`.

### Tarea 7: Combo local por arma, armas del suelo y tecla E (cliente)

**Archivos:**
- Crear: `packages/client/src/render/floorWeaponViews.ts`
- Modificar: `packages/client/src/net/{LocalCombo.ts,connection.ts}`, `packages/client/src/input/InputState.ts`, `packages/client/src/main.ts`, `packages/client/src/ui/hud.ts`, `packages/client/index.html`, `packages/client/test/{LocalCombo,InputState,hud}.test.ts`, `README.md`

**Interfaces:**
- Consume: Tareas 2, 4, 5 y 6.
- Produce:
  - `LocalCombo.tick(attack, blocked, nowMs, weaponId)` usa `advanceCombo` y `tryStartSwing` de `shared` con el arma dada. Cambiar de `weaponId` reinicia su combo.
  - `InputState`: `KeyE` → `interact: true` una vez por pulsación.
  - `GameConnection.onFloorWeapons(cb: (items: { weaponId: WeaponId; x: number; z: number }[]) => void)`.
  - `PlayerSnapshot` suma `weaponId`.
  - `FloorWeaponViews`: cada arma del suelo aparece tendida y girando lentamente, con un brillo suave. Cerca de una (a ≤ 1,5 m) se muestra el texto "E: tomar <nombre>".
  - El HUD muestra el nombre del arma equipada, por ejemplo "Espada del Kingslayer".
- **Texto de ayuda:** "Clic para mirar · WASD moverse · Shift correr · Espacio saltar · C esquivar · Clic izq. atacar · E tomar arma".

- [ ] **Paso 1: Tests que fallan:**
  - `LocalCombo` con `"great-sword"`: un clic arranca el paso 1 y el siguiente golpe se libera tras `ceil(0.7/SIM_DT)` ticks. Al cambiar a `"kingslayer-sword"`, vuelve al paso 1.
  - `InputState`: `KeyE` produce `interact` una sola vez por pulsación, y `blur` lo suelta.
  - `formatWeapon("great-sword") === "Mandoble"`, en `hud.ts`.
- [ ] **Paso 2:** Correr → FALLA. **Paso 3:** Implementar, incluido el cableado en `main.ts`. **Paso 4:** `npm test`, `npm run typecheck` y el build → PASAN.
- [ ] **Paso 5: Commit** `feat(client): combo local por arma, armas del suelo y tecla E`.

### Tarea 8: Quitar KayKit de los personajes y verificación integral

**Archivos:**
- Eliminar: `packages/client/public/assets/kaykit/characters/` y `.../skeletons/`. La mazmorra se queda.
- Modificar: `scripts/fetch-kaykit.mjs` (solo la mazmorra), `CREDITS.md`, `packages/client/src/render/assets.ts` (sin `AssetId` de KayKit, salvo la mazmorra)

- [ ] **Paso 1:** Quitar las referencias y los archivos. Al buscar `Knight|Skeleton_|handslot` en `packages/client/src` no queda nada.
- [ ] **Paso 2:** `npm test`, `npm run typecheck` y el build → PASAN.
- [ ] **Paso 3: Verificación headless** con `npm run dev` del usuario o uno propio, en `http://localhost:5173`, con capturas en el scratchpad:
  1. El Kingslayer con la Espada del Kingslayer en la mano, quieto y corriendo.
  2. Un ataque: la animación arranca al clic, y el número de daño sobre el enemigo aparece en el impacto, no en el clic.
  3. Tomar el mandoble en la sala de inicio con E: cambian el modelo en la mano, la pose de quieto y la de correr, y el HUD muestra "Mandoble".
  4. Entrar a una sala de combate: aparecen el bruto, el esbirro y el mago con su tamaño, sus animaciones, la barra de vida sobre la cabeza y el aro de telegrafía.
  5. Sin errores en la consola.
- [ ] **Paso 4: Commit** `chore: quitar personajes KayKit; verificación del elenco Mixamo`.

---

## Decisiones del plan (de Claude) que conviene revisar
- Una animación por archivo (`anims/<clipId>.glb`) en vez de un archivo por estilo: así se carga solo lo que se usa y es fácil cambiar un clip por otro.
- Los clips concretos (`ss_slash_3`, `gs_high_spin_attack`, `cr_punch`, etc.) son una primera elección. Si alguno se ve mal en movimiento, quien construya lo cambia por otro del mismo pack, avisando en su informe.
- Las armas de Quaternius (Sword y Claymore) como "Espada de guardia" y "Mandoble". Si no combinan con la fantasía oscura, se buscan otras CC0 en el Plan 3b.
- La página de agarre (`dev/grip.html`) queda en el repo para ajustar armas futuras.
