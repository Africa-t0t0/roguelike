# Plan 4b-2: naturalezas, élites y cofres

Fecha: 2026-10-26 · Antes: `2026-10-26-hechiceros-design.md` · Sandbox: `2026-10-26-sandbox-design.md`

> Revisado por el usuario (2026-10-26): respondió las 3 preguntas abiertas; sus respuestas están en
> "Decisiones del usuario".

## Intención

Hoy, al mejorar un arma, solo sube un número (el tier). El usuario quiere **naturalezas**: fuego, hielo y rayo,
en las armas, las habilidades y los enemigos, y que algunas armas no tengan ninguna. Además quiere **cofres** y
**élites**. Los élites son también donde viven los ataques combinados, como se acordó en el 4b-1.

Éxito:

- Al encontrar un arma de fuego dan ganas de probarla, porque se juega distinto: quema, no solo pega más.
- Un élite se reconoce de lejos, da miedo y deja algo que vale la pena.
- Abrir un cofre es una pequeña recompensa por explorar, no una obligación.

## Decisiones del usuario

- Tres naturalezas: **fuego**, **hielo** y **rayo**. Algunas armas **no tienen naturaleza**.
- Las naturalezas están en las armas, las habilidades y los enemigos.
- Hay **cofres** y **élites**.
- Los ataques combinados de hechicero son para **élites** (y el jefe, en el Plan 5).
- **Las habilidades heredan la naturaleza del arma equipada.** El color de sus efectos va acorde a esa
  naturaleza, y el color del arma también.
- **El botín de los cofres es individual.**
- **Los enemigos normales llevan armas normales; los enemigos de un elemento llevan armas de su elemento** (y
  eso es lo que sueltan).

## Decisiones mías (revisar)

### Qué hace cada naturaleza (golpes del jugador)

- **Fuego:** quema 3 s. Cada segundo hace el 20 % del daño del golpe que la puso, así que en total suma un 60 %
  extra. No se apila: un golpe nuevo renueva la quemadura y se queda con el daño mayor.
- **Hielo:** ralentiza al enemigo un 30 % durante 2 s. Con 3 golpes de hielo en menos de 3 s, el enemigo queda
  **congelado** 0,8 s (no se mueve ni ataca). Después tiene 4 s en que no se puede volver a congelar.
- **Rayo:** cada golpe tiene un 25 % de probabilidad de **encadenar** a hasta 2 enemigos a 4 m o menos del
  golpeado, con el 50 % del daño. La cadena no vuelve a encadenar.
- El sorteo del rayo usa la RNG de la sala, como todo lo determinista del servidor.

### Armas con naturaleza

- Un arma concreta pasa a ser `{ weaponId, tier, nature }`, con `nature` = `none`, `fire`, `ice` o `lightning`.
- Nombre: "Mandoble templado **de fuego**", "… **de hielo**", "… **del rayo**". Sin naturaleza, el nombre no
  cambia.
- El arma inicial y las armas del suelo de la sala de inicio no tienen naturaleza.
- Las armas que sueltan los enemigos normales tampoco: van con armas normales. Un enemigo de un elemento (hoy, los
  élites) lleva un arma de su elemento y es la que suelta. Los cofres también dan armas con naturaleza.
- Visual: un brillo del color de la naturaleza en la hoja (naranja, celeste o blanco azulado), con partículas
  suaves: chispas de fuego, escarcha o pequeños arcos. Se suma al brillo de tier.

### Colores de las naturalezas

- Fuego: naranja `(1, 0.45, 0.1)`. Hielo: cian pálido `(0.55, 0.95, 1)`. Rayo: amarillo eléctrico `(1, 0.92, 0.4)`.
- Los usan, de forma consistente: el brillo y las partículas del arma, los efectos de las habilidades, los
  estados sobre los enemigos, el contorno de los élites y los iconos de estado del HUD.
- El invocador del rayo (4b-1) pasa a usar el color del rayo (antes celeste), para que hielo y rayo no se
  confundan.

### Tier 4: legendaria (decisión del usuario: "vale, continúa")

- `TIERS[4]`: sufijo "legendaria/o", daño ×2,2, brillo dorado `(1, 0.78, 0.25)`.
- Ningún enemigo lleva tier 4 ni lo sortea la tabla de tiers. Solo sale del botín de élites (tier del élite +1) y
  de cofres (+1 con 30 % de probabilidad), con 3 → 4 como máximo.
- Los hechiceros siguen con tiers 1–3: sus tablas usan un tipo propio `CasterTier = 1 | 2 | 3`.

### Cadena del rayo (visual)

- Cada encadenado manda un evento de combate `{ type: "chain", points: [x, z][] }`: el golpeado y los
  saltos. El cliente dibuja un arco eléctrico breve (~0,15 s) entre los puntos.

### Habilidades con naturaleza

- **Las habilidades toman la naturaleza del arma equipada.** No hay cartas nuevas: un Torbellino con un arma de
  fuego quema, y un Golpe sísmico con un arma de hielo ralentiza a todos los que alcanza.
- El Grito de guerra y el Bloqueo no golpean, así que no aplican naturaleza.
- La Onda de corte (pasiva) sí aplica la naturaleza del arma.
- Visual: los efectos de las habilidades se tiñen del color de la naturaleza. Por ejemplo, el aro del Torbellino
  es naranja con fuego, celeste con hielo y blanco azulado con rayo.
- Carta nueva **"Afinidad"**: +25 % a los efectos de naturaleza (más daño de quemadura, ralentización más
  fuerte y 6 puntos más de probabilidad de cadena). Solo aparece en las ofertas si el jugador lleva un arma con
  naturaleza.

### Élites

- **Aparición:** desde el minuto 3, cada enemigo de oleada tiene una probabilidad de ser élite:
  `min(15 %, 5 % + 1 % por minuto pasado el 3)`. En las salas no hay élites.
- **Tipos:** cualquier tipo de enemigo puede ser élite. Cada élite tiene una naturaleza al azar.
- **Fuerza:** vida ×3, daño ×1,5, tamaño ×1,2, y no se aturde (la Patada no lo para).
- **Aspecto:** un aura dorada grande, un contorno del color de su naturaleza y su nombre sobre la cabeza, por
  ejemplo "Bruto de hielo".
- **Ataque:** su golpe o hechizo aplica su naturaleza al jugador:
  - fuego: quemadura de 3 s;
  - hielo: ralentiza un 30 % durante 2 s;
  - rayo: aturde 0,3 s.

  El jugador no se congela nunca, para que no sea frustrante.
- **Hechiceros élite:** alternan su ataque propio con uno de los otros dos tipos (el ataque combinado). Por
  ejemplo, un piromante élite intercala un rayo.
- **Botín:**
  - siempre una lluvia de orbes con 4 veces su XP;
  - en el 50 % de los casos, un arma de su naturaleza, como copia individual para cada jugador conectado (igual
    que las armas soltadas de hoy). Su tier es el del élite +1, con 3 como máximo.

### Cofres

- **Dónde:** al generar el piso (determinista con la semilla) se pone 1 cofre por cada 2 salas de combate,
  apoyado contra una pared de la sala.
- **Abrir:** con E a 1,5 m, como recoger un arma. Lo abre quien llega primero.
- **Contenido**, que se sortea al abrirlo:
  - 60 %: un arma con naturaleza para cada jugador conectado, como copia individual (cada uno la ve y la recoge
    para sí). El tier sale de la tabla de tiers según el reloj, con +1 de probabilidad.
  - 25 %: una lluvia de orbes de 30 XP.
  - 15 %: curación completa para todo el grupo.
- **Visual:** cofre con la tapa animada al abrirse y un destello. Un cofre abierto queda abierto y oscuro.
  También aparece en el minimapa.
- **Modelo:** si no hay un modelo de cofre a mano, se usa uno simple hecho con primitivas (una caja con la tapa
  aparte), con el mismo estilo que el resto.

### Estados en el jugador

- El HUD muestra un icono pequeño junto a la vida cuando el jugador está quemándose, ralentizado o aturdido, con
  el tiempo que le queda.
- La quemadura del jugador hace 4 de daño por segundo durante 3 s, escalado como el resto del daño enemigo.
- La ralentización y el aturdimiento se predicen en el cliente igual que hoy se predice el Bloqueo (que frena),
  para que el movimiento no salte.

### Aura por parte del cuerpo (fuera de este plan)

- El usuario quiere que, al encontrar equipo (guantes, botas, …), brille solo esa parte del cuerpo. Va en el
  plan de equipo, después de este. En este plan el arma muestra su rareza y naturaleza en la hoja.

### Panel de pruebas (F2)

- "Arma": un selector de naturaleza junto al de tier.
- "Crear delante": un interruptor **"Élite"** y un selector de naturaleza.
- Botón nuevo **"Cofre delante"**: crea un cofre cerrado a 3 m.
- Botón nuevo **"Aplicarme estado"** (quemadura, ralentiza o aturde), para ver el HUD y la predicción.

### Protocolo

- `PROTOCOL_VERSION` pasa a 10.
- Las armas del suelo y del jugador suman `nature`.
- `EnemyState` suma `elite`, `nature` y sus estados (quemándose, ralentizado, congelado).
- `PlayerState` suma sus estados.
- `RunState` suma los cofres (posición y si están abiertos).

## No-metas

- Combinar naturalezas (fuego + hielo = …), resistencias o debilidades.
- Que los hechiceros normales apliquen estados. Sus ataques del 4b-1 siguen igual; solo los élites aplican
  naturaleza.
- Cofres con trampas o mímicos, llaves, tiendas.
- Jefe y tótem (Plan 5). Sonido.

## Restricciones

Las de siempre:

- solo desarrollo local;
- `shared` determinista;
- servidor autoritativo;
- tests en verde;
- sin luces nuevas;
- efectos con el reloj de juego.

También:

- Las pruebas visuales se hacen con capturas cortas en el sandbox, con servidores de prueba que **no usen el
  puerto 2568**, porque es el de los tests de `RunRoom`.
