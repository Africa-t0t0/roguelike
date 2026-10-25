# Plan 4: progresión con cartas, pausa al subir de nivel y habilidades del guerrero

Fecha: 2026-10-25 · Spec general: `2026-10-23-roguelike-coop-design.md` · Anterior: `2026-10-25-presion-botin-design.md`

## Intención

Hoy subir de nivel solo da vida máxima. El usuario quiere que cada nivel sea una **decisión**: el juego se pausa para todo el grupo y cada jugador elige 1 de 3 cartas al azar. Una carta puede ser una mejora de stat (vida, regeneración, ataque…) o una habilidad del guerrero, que se activa con las teclas 1 a 4. Así el personaje se va transformando durante la run, que es la idea de fondo del proyecto: "un personaje que empieza simple y se transforma".

Éxito:
- Tras unos minutos, dos guerreros del mismo grupo juegan distinto (uno con Torbellino y regeneración, otro con Bloqueo y Grito de guerra).
- Elegir carta se siente cómodo: sin presión, porque todo está pausado, y sin teclas raras, porque se elige con el mouse.

## Metas

1. **Pausa al subir de nivel.** Cuando el grupo sube de nivel, el servidor deja de simular el mundo hasta que todos los jugadores conectados eligen. El cliente congela su predicción y las animaciones, y libera el mouse.
2. **Elección de 3 cartas por jugador**, con un límite de **20 s**. A quien no elige se le asigna una carta al azar. Si se suben varios niveles juntos, las elecciones van una tras otra dentro de la misma pausa.
3. **Mejoras de stat** que se acumulan.
4. **Seis habilidades del guerrero**, con rango 1 a 3: cinco activas en las teclas 1 a 4 (como máximo 4 equipadas) y una pasiva.
5. **Regeneración base** pequeña para todos.
6. **Curva de XP** ajustada para subir de nivel cada 1 o 2 minutos, más o menos.
7. **Quitar la esquiva** (tecla C) del juego.
8. **HUD:** barra de habilidades abajo a la derecha (4 casillas con su tecla y enfriamiento), panel de cartas e indicador de quién ya eligió.

## No-metas (esta fase)

- Naturalezas o elementos, cofres y élites: van al Plan 4b.
- Habilidades del hechicero y del cazador.
- Reasignar habilidades a otras teclas, o quitar una habilidad aprendida.
- Una pausa por cualquier otro motivo (menú, Escape…).

## Anti-metas

- Una pausa que se rompa:
  - un enemigo que se mueve o pega durante la pausa;
  - el reloj del piso o los orbes que avanzan;
  - el personaje propio que se desliza por la predicción del cliente.
- Que un jugador desconectado o lento bloquee al grupo más de 20 s por elección.
- Cartas que no hacen nada perceptible.

## Decisiones del usuario

- El nivel sigue siendo **compartido** por el grupo.
- **Al subir de nivel el juego se pausa para todos**, incluidos los enemigos, y cada uno elige su carta.
- **Límite de 20 s** por elección; después, una carta al azar.
- Las cartas mezclan mejoras de stat y habilidades.
- La lista de cartas y habilidades de abajo está aprobada "para empezar".
- **No quiere la esquiva como funcionalidad.**
- Las naturalezas (fuego, hielo, rayo) en enemigos, armas y habilidades, y los cofres y élites, van en el Plan 4b.

## Decisiones mías (revisar)

- **Animaciones:** congeladas durante la pausa (como una foto).
- **Panel de cartas:** centrado y oscuro, con 3 cartas en horizontal. Cada carta muestra título, tipo (Mejora / Habilidad nueva / Habilidad rango N) y un texto corto. Debajo va una cuenta regresiva y el estado del grupo ("Ana ✓ · Bruno eligiendo…").
- **Qué cartas salen:** de las 3, una es de habilidad (una nueva si quedan casillas, o subir el rango de una que ya tienes) y dos son de stat, distintas entre sí. Si no queda ninguna habilidad posible, salen 3 de stat. Las de stat pueden volver a salir en otra elección.
- **Desconectados:** al pausar no se les espera, y su elección queda pendiente. **Al volver**, la elección pendiente se les ofrece **sin pausar a los demás**, con el mouse libre (en ese momento quedan vulnerables). Lo mismo para quien entra a mitad de run: recibe una elección por cada nivel que el grupo ya tenía por encima de 1.
- **Curva de XP:** `xpToNext(nivel) = 60 + 40 × nivel` (antes `10 + 10 × nivel`). Es un punto de partida.
- **Regeneración base:** 0,5 de vida por segundo para todos, siempre (no solo fuera de combate). Muertos no regeneran.
- **Teclas:** 1 a 4 activan la habilidad de esa casilla. Las casillas se llenan en el orden en que se aprenden. La pasiva no ocupa casilla.

### Cartas de stat

| id | Nombre | Efecto por carta |
|---|---|---|
| `vitality` | Vitalidad | +20 de vida máxima y cura 20 |
| `regen` | Regeneración | +1 de vida por segundo |
| `strength` | Fuerza | +10 % de daño (multiplicativo sobre el daño del golpe) |
| `fury` | Furia | +10 % de velocidad de ataque (la duración de los golpes se divide por (1 + suma)) |
| `reach` | Alcance | +15 % de alcance y arco del golpe |
| `agility` | Agilidad | +8 % de velocidad de movimiento (también al correr) |
| `ironskin` | Piel de hierro | −8 % de daño recibido (multiplicativo; mínimo 40 % del daño) |
| `bloodlust` | Sed de sangre | +2 de vida por cada enemigo que mata ese jugador |
| `magnet` | Imán | +50 % de radio de imán de orbes para ese jugador |

### Habilidades del guerrero

Daño base de las habilidades = `strikeDamage(arma, clase, nivel, 1, tier)` × multiplicador × la Fuerza del jugador.

| id | Nombre | Tipo | Rango 1 | Rango 2 | Rango 3 | Enfriamiento | Clip |
|---|---|---|---|---|---|---|---|
| `whirlwind` | Torbellino | activa | 360°, radio 3 m, ×1,2 de daño | ×1,6 | ×1,6 y un segundo giro 0,4 s después | 8 s | `gs_high_spin_attack` |
| `kick` | Patada | activa | cono de 90° a 2,2 m, ×0,5 de daño, empuja 3 m y aturde 1 s | aturde 1,5 s | aturde 2 s y empuja 4 m | 6 s | `ss_kick` |
| `warcry` | Grito de guerra | activa | +25 % de daño **para todo el grupo vivo y conectado** durante 8 s | +35 % | +45 % | 20 s | `ss_power_up` |
| `slam` | Golpe sísmico | activa | salto en el sitio y, 0,5 s después, daño en un radio de 3,5 m ×1,5 | ×2 | ×2 y radio 4,5 m | 10 s | `ss_jump_2` |
| `block` | Bloqueo | activa mantenida | mientras se mantiene: −70 % de daño que llega de frente (±60°), velocidad ×0,5 y sin atacar | −80 % | −90 % | — | `ss_block_idle` |
| `cleave` | Onda de corte | pasiva | el último golpe del combo lanza una onda: proyectil del jugador a 14 m/s, vida 0,5 s, atraviesa, ×0,6 de daño | ×0,9 | ×0,9 y onda más ancha (radio 1,2 m en vez de 0,8) | — | (la del combo) |

- **Aturdido:** el enemigo no se mueve ni ataca, y cancela su telegrafía.
- **Empuje:** usa `moveCircle`, así que no atraviesa muros.
- **Habilidades y combo:** usar una habilidad no se puede con un golpe en curso, y un golpe no se puede durante la animación de una habilidad (salvo el Bloqueo, que se mantiene). Cada habilidad activa tiene una duración de animación fija (Torbellino 0,9 s, Patada 0,6 s, Grito 0,8 s, Golpe sísmico 0,9 s) durante la que el jugador no ataca.
- **Momento del daño:** el de las habilidades se resuelve en el servidor en su momento de impacto (Torbellino a 0,5 de su duración, Patada a 0,4, Golpe sísmico a los 0,5 s), con rebobinado como los golpes normales. El Grito aplica el buff al empezar.

### Detalles resueltos tras la revisión (decisiones mías)

- **Clips:** los cuatro existen ya convertidos en `.superpowers/kingslayer-work/glb/pack/` (`sword_and_shield_kick.glb`, `sword_and_shield_power_up.glb`, `sword_and_shield_block_idle.glb` y `sword_and_shield_jump_2.glb`). Basta con sumarlos a la lista de `scripts/assets/build-mixamo.mjs`.
- **Aturdir y empujar:** todos los enemigos actuales se pueden aturdir y empujar. Todavía no hay jefe ni élites. El Plan 5 decide la inmunidad del jefe; aquí basta con un campo opcional `stunImmune` en `EnemyDef`, que por ahora nadie usa.
- **Elecciones al mismo paso (lockstep):** el grupo resuelve la elección N, y solo cuando todos eligieron o se acabaron los 20 s pasa a la N+1. Por eso basta con un solo `pauseLeft`. Todos los conectados tienen la misma cantidad de elecciones, porque el nivel es compartido. Quien ya eligió ve las cartas atenuadas con "Esperando al grupo".
- **Muertos y desconexiones:** los jugadores muertos también eligen. La pausa empieza al final del tick en que el grupo sube de nivel. Si alguien se desconecta en plena pausa, su elección queda pendiente y deja de bloquear al grupo.
- **Quien vuelve o entra a mitad de run:** también tiene 20 s por elección; después se le asigna una carta al azar. Mientras tanto sigue jugando: se puede mover y atacar, pero no girar la cámara, porque el mouse está libre.
- **Cómo se combina el daño:** daño final = base × (1 + Fuerza) × (1 + Grito). Si hay varios Gritos activos, cuenta solo el **mayor**; no se suman.
- **Bloqueo:** el "frente" se calcula desde la posición de la fuente del daño en el momento del golpe: el enemigo para el cuerpo a cuerpo y el proyectil para los proyectiles. Vale para ambos.
- **Temporizadores en la pausa:** todos (enfriamientos, Grito, aturdido, swing) cuentan en tiempo de simulación, así que se congelan con la pausa. El historial para rebobinar solo registra ticks simulados, y `state.tick` no avanza en la pausa.

## Cómo funciona (lo decidido)

### Pausa y elección
- **Estado sincronizado:**
  - `RunState.paused: boolean` y `RunState.pauseLeft: number` (segundos de la elección en curso).
  - `PlayerState.choosing: boolean` (si tiene una elección abierta).
- **Las cartas son privadas:** el servidor envía a cada jugador el mensaje `levelChoice { cards: CardOffer[], index, total, deadlineS }` y el jugador responde con `chooseCard { cardId }`. Una respuesta inválida, repetida o tardía se ignora.
- **Mientras `paused`, en el servidor:**
  - no avanzan el tick de simulación de jugadores ni de enemigos, proyectiles, orbes, director, combate y reloj del piso;
  - los inputs que llegan se descartan, pero se actualiza `lastSeq` para que la reconciliación del cliente no se rompa al reanudar;
  - la regeneración no corre.
- **Fin de la pausa:** cuando todos los conectados resolvieron todas sus elecciones pendientes de esta pausa.
- **El tiempo es por elección:** `pauseLeft` vuelve a 20 al pasar a la siguiente elección del grupo.
- **Determinismo:** las cartas se sortean con la RNG sembrada de la sala.

### Stats del jugador
- `CombatState` gana `cards: Record<CardId, number>` y `abilities: { id, rank, cooldown }[]`.
- De ahí salen los multiplicadores.
- `PlayerState` sincroniza lo que el cliente necesita:
  - `moveSpeedMult` y `attackSpeedMult`, porque la predicción del movimiento y del combo debe dar lo mismo que el servidor;
  - la lista de habilidades con rango y enfriamiento restante, para el HUD;
  - `buffDamage` y `blocking`, para efectos visuales.
- `stepPlayer` y las funciones de combo compartidas reciben esos multiplicadores, así que la predicción y el servidor coinciden.

### Esquiva fuera
- Se eliminan, en shared, server y client:
  - `PlayerInput.dodge`;
  - los campos `dodge*` de `KinematicState` y `PlayerState`;
  - la lógica de esquiva en `stepPlayer`;
  - la "gracia" de esquiva del combate;
  - la tecla C;
  - el texto de ayuda.
- `PROTOCOL_VERSION` pasa a 6.

### Habilidades (input)
- `PlayerInput` suma `abilities: number`, una máscara de 4 bits de las teclas 1 a 4 **mantenidas**.
- El servidor detecta el flanco de subida para las activas y usa el bit mantenido para el Bloqueo.
- El cliente predice solo la animación (como con el combo); el daño lo decide el servidor.

## Restricciones

- Las de siempre:
  - solo desarrollo local;
  - `shared` determinista y sin `Math.random`;
  - servidor autoritativo;
  - tests en verde en los tres paquetes.
- Reconectar y unirse a mitad de run conservan las cartas, las habilidades, los rangos y los enfriamientos (en el registro del jugador).
- Los clips nuevos (`ss_kick`, `ss_power_up`, `ss_block_idle`, `ss_jump_2`) se agregan al build de assets.

## Para quien construye

- Los números son puntos de partida y viven en constantes de `shared`.
- La forma exacta de los mensajes, el diseño visual fino de las cartas y la barra, y cómo se estructuran los sistemas en el servidor quedan a criterio del plan.
