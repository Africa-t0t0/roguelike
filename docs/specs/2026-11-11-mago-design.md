# Mago jugable, bastones y enemigos de apoyo — diseño

Fecha: 2026-11-11. Rama de partida: `spike/camara-diablo`.

## Intención

Hoy todos los jugadores son el mismo caballero cuerpo a cuerpo. Queremos una segunda forma de jugar: un **Mago** que pelea a distancia, con su propia arma (bastón), sus propios hechizos y su propio equipo. De paso, los enemigos ganan dos comportamientos de apoyo (un buff en área y un curandero) para que las peleas pidan elegir a quién matar primero.

Éxito: dos amigos entran a la misma sala, uno elige Caballero y otro Mago, y la partida se siente distinta para cada uno desde el primer golpe.

## Marcas de autoría

- **[U]** = lo decidió el usuario.
- **[C]** = decisión mía (Claude); el usuario no la ha confirmado explícitamente y puede cambiarla.
- Todos los **números** son valores iniciales [C] para ajustar en la sala de pruebas, salvo los marcados [U].

## Objetivos

1. Elegir rol (Caballero o Mago) en la pantalla inicial. [U]
2. Ataque básico del mago: proyectil hacia donde apunta. [U]
3. Bastón como arma nueva; su naturaleza decide el proyectil. [U]
4. Ocho hechizos propios del mago, con 3 niveles cada uno. [U]
5. Equipo para magos: mismas ranuras, piezas de tela, legendarias propias. [U]
6. Enemigos: buff en área del hechicero arcano y un enemigo curandero. [U]

## Fuera de alcance

- Maná u otro recurso: el mago solo usa enfriamientos, como el caballero. [C, aceptado]
- Modelo o esqueleto nuevo: se usa `mage.glb`, el del hechicero enemigo. [U]
- Animaciones nuevas de carrera, salto, golpe recibido y muerte: se reutilizan las del caballero. [C, aceptado]
- Más de un tipo de bastón. [C]
- Cambiar de rol a mitad de partida. [C]
- Más habilidades enemigas que las dos descritas. [U: "por ahora básicas"]

## Lo que haría de esto un fracaso

- Que el mago sea un caballero con otro color: su básico debe ser a distancia desde el primer segundo.
- Que un jugador reciba botín que no puede usar.
- Que los hechizos se vean "baratos": el usuario ya rechazó efectos pobres; la referencia de estilo es WoW / LoL. Cada hechizo usa el sistema de capas de `abilityFx.ts` (aviso, estallido, marca en el suelo, partículas).
- Que añadir el mago rompa o cambie cómo se siente el caballero.

## Estado actual relevante

- `shared/src/combat.ts`: `ClassId = "warrior"`, `CLASS_DEFS`. El servidor crea siempre `newCombatState("warrior", …)` (`RunRoom.ts`, `PlayerRegistry.ts`).
- `shared/src/weapons.ts`: `WEAPONS`, `MOVESETS` (combo cuerpo a cuerpo), tiers 1–4, naturaleza (`none | fire | ice | lightning`).
- `shared/src/cards.ts`: `ABILITIES` (11, todas del caballero), 3 rangos, `MAX_ACTIVE_ABILITIES = 4`; cartas de estadísticas.
- `shared/src/gear.ts`: 5 ranuras, `LEGENDARY_POOL` ya indexado por `ClassId`, `rollGear(…, cls)`.
- `shared/src/natures.ts`: quemadura, ralentización/congelación y cadena ya implementadas sobre enemigos (`EnemySystem`: `frozen`, `freezeImmune`, `slow`, `burn`).
- `server/src/sim/AbilitySystem.ts`: proyectiles de jugador (`kind`), zonas (`kind`), `hook`, etc.
- Cliente: `looks.ts` (`MAGE_LOOK` con `mg_idle`, `mg_attack`), `abilityFx.ts`, `playerShotViews.ts`, `gearLooks.ts` (el equipo se ve como tinte y brillo sobre el cuerpo, no como mallas), lobby en `index.html` (`#name`, `#create`, `#join`).
- Clips de magia ya convertidos pero sin importar al juego: `.superpowers/kingslayer-work/glb/magic-spell-pack/` (1h_attack ×3, 2h_attack ×5, 2h_area_attack ×2, 1h/2h cast_spell, idle).

## Diseño

### 1. Elección de rol

- En la pantalla inicial, junto al nombre, dos tarjetas grandes: **Caballero** y **Mago**, con una línea de descripción cada una. Caballero viene seleccionado. [U la elección; C la forma]
- La elección se recuerda en el navegador (como el nombre, si este ya se recuerda). [C]
- Viaja al servidor al crear o unirse; el servidor la valida y crea el estado de combate con esa clase. Valor inválido o ausente → caballero. [C]
- La clase es visible para los demás: cada jugador se dibuja con el cuerpo de su clase. [C]
- En la sala de pruebas (`?sandbox=1`) el panel F2 permite cambiar de clase al vuelo para probar. [C]

### 2. La clase Mago

- `ClassId` pasa a `"warrior" | "mage"`.
- Vida: 80 base, +8 por nivel (caballero: 120 / +12). Daño por nivel igual que el caballero (+2). [C]
- Misma velocidad de movimiento, salto y esprint que el caballero. [C]
- Cuerpo: `mage.glb`. Reposo: `mg_idle`. Correr, pasos laterales, salto, golpe recibido y muerte: los clips `ss_*` del caballero. [U el modelo; C el resto]
- Arma inicial: bastón de calidad 1 sin naturaleza. [C]

### 3. Bastón y ataque básico

- Arma nueva `staff` ("Bastón", masculino), con su propio moveset `staff`. Usa las mismas calidades (1–4) y naturalezas que las espadas, y los mismos nombres ("Bastón rúnico de fuego"). [U]
- No hay modelo de bastón: se construye uno sencillo por código (vara con un orbe luminoso en la punta, del color de la naturaleza) y se sujeta a la mano derecha. [C]
- **Ataque básico** [U: proyectil; C: detalles]:
  - Mantener el botón de ataque dispara de forma continua hacia el punto apuntado (cursor, stick derecho o mando), igual que hoy se encadenan los tajos.
  - Ciclo de 3 gestos (los tres `1h_magic_attack`), cada uno suelta un proyectil; el tercero pega un 50 % más, como el tercer tajo del caballero.
  - Cadencia: ~0,45 s por disparo. Daño base del bastón: 10.
  - Proyectil: 18 m/s, alcance 14 m, radio 0,4 m; se detiene en el primer enemigo o pared.
  - Mientras dispara, el mago se mueve con las mismas reglas que el caballero mientras ataca.
  - Naturaleza del bastón → aspecto y efecto del proyectil: ninguna = orbe arcano violeta sin efecto; fuego = bola de fuego que quema; hielo = fragmento que ralentiza y congela al tercer impacto; rayo = chispa que puede encadenar. Los efectos son los que ya existen en `natures.ts`. [U]
  - El cliente predice el disparo (animación y proyectil visual inmediatos); el daño lo decide el servidor, como con Lanzar la espada.
- Cartas de estadísticas: son las mismas para ambas clases. Para el mago, "alcance" alarga el recorrido del proyectil y "furia"/velocidad de ataque acorta la cadencia. [C]
- El daño de los hechizos escala con el daño del bastón (porcentaje del golpe básico), igual que las habilidades del caballero escalan con el arma. [C]

### 4. Hechizos

- Las cartas de habilidad dependen de la clase: al caballero solo le salen las suyas y al mago las ocho de abajo. [C]
- 3 niveles por hechizo; sube cuando vuelve a salir su carta. Hasta 4 activos a la vez. Igual que hoy. [U]
- "Bloqueo" (habilidad mantenida) es solo del caballero. [C]
- Los hechizos tienen aspecto y elemento fijos; el bastón no los cambia. [C, aceptado]
- Los que apuntan a un punto usan el cursor / stick, con el mismo mecanismo de distancia de puntería (`aimDist`) del Salto. Alcance máximo de colocación: 12 m. [C]

| Id | Nombre | Enfr. (N1/N2/N3) | Nivel 1 | Nivel 2 | Nivel 3 |
|---|---|---|---|---|---|
| `frost` | Escarcha | 16 / 14 / 12 s | Zona de hielo de 3 m en el punto apuntado, dura 4 s; quien entra queda congelado 1,5 s (una vez por enemigo y zona) | Radio 4 m, menos enfriamiento | Radio 4,5 m; al descongelarse quedan ralentizados 5 s |
| `nova` | Nova | 10 / 8 / 8 s | Explosión de 3,5 m alrededor del mago, 150 % de daño, tras 0,4 s de carga | Radio 4,5 m, menos enfriamiento | Carga de 1,2 s (el mago puede moverse despacio), radio 5,5 m, 450 % de daño |
| `beam` | Rayo arcano | 7 / 7 / 6 s | Haz instantáneo en la dirección apuntada, alcance 14 m; golpea al primer enemigo, 180 % | Rebota a 2 enemigos más (hasta 6 m entre saltos, 70 % por rebote) | Rebota a 4; cada golpeado queda marcado 4 s: si recibe otro hechizo, la marca explota (100 % en 2 m) y se consume |
| `mine` | Mina arcana | 12 / 10 / 8 s | Mina en el punto apuntado; dura 60 s; al pisarla un enemigo explota (200 % en 2,5 m) | Dura 90 s, menos enfriamiento | Dura 120 s; coloca una línea de 5 minas perpendicular a la dirección apuntada, separadas 2 m |
| `gust` | Remolino | 11 / 9 / 8 s | Remolino de 1,2 m de radio que avanza 12 m en línea recta; 80 % de daño y empuja 4 m a quien toca; atraviesa enemigos | Radio 1,8 m, menos enfriamiento | Salen 8 remolinos en todas las direcciones |
| `orb` | Esfera | 14 / 14 / 12 s | Esfera lenta (5 m/s, 14 m) que no explota; cada 0,5 s hace 50 % de daño a quien esté a 2,5 m | 70 % por pulso | Deja un rastro en el suelo que daña (3 s) y atrae hacia sí a los enemigos a 5 m |
| `heal` | Sanación | 20 / 19 / 17 s | Cura al instante un 30 % de la vida máxima a todos los aliados vivos (incluido el mago), sin importar la distancia | 50 % | Vida completa |
| `meteors` | Meteoros | 22 / 20 / 18 s | Zona de 4 m en el punto apuntado; caen 5 meteoritos en 3 s en puntos al azar de la zona (120 % en 1,8 m cada uno) | 8 meteoritos, radio 5 m | 8 meteoritos y, al final, uno gigante con aviso propio: 500 % en toda la zona |

Notas:

- Reglas de mejora dictadas por el usuario [U]: Escarcha, Nova, Mina y Remolino crecen y bajan enfriamiento; Rayo empieza con un solo blanco y luego rebota; Sanación parte en 20 s y baja 1 s por nivel; los efectos de nivel 3 son los de la tabla. Los números concretos son [C].
- Sanación N3: el usuario dijo "reduce los cooldowns en 2 segundos"; se interpretó como que su propio enfriamiento baja 2 s (17 s). [C, aceptado]
- Marca del Rayo: "otro hechizo" = cualquier habilidad de cualquier mago, no el ataque básico. El propio rebote que la aplica no la detona. [C]
- Congelación de Escarcha: usa el estado `frozen` existente y respeta la inmunidad posterior (`freezeImmune`); los enemigos inmunes al aturdimiento solo quedan ralentizados. [C]
- Efectos de naturaleza: los hechizos **no** aplican quemadura, ralentización ni cadena del bastón, ni tienen efecto elemental propio más allá de lo que dice la tabla (Escarcha congela; el resto solo daña o empuja). Su elemento es solo visual. La naturaleza del bastón y la carta Afinidad afectan únicamente al ataque básico. Esto evita que Esfera o Meteoros congelen o encadenen sin parar. [C]
- Nova: la carga es siempre fija, no "mantener y soltar". En N1 y N2 (0,4 s) el mago se mueve libremente; en N3 (1,2 s) se mueve al 50 %, como al bloquear, y la carga no se puede cancelar. N3 cambia rapidez por daño a propósito. [U: "que se demore más en cargar pero que haga daño masivo"; C: el movimiento]
- Esfera N2: el usuario no definió la mejora; se puso más daño. [C]
- Gestos: ataques dirigidos (Rayo, Remolino, Esfera) → clips `2h_magic_attack`; Nova y Meteoros → `2h_magic_area_attack`; Escarcha, Mina y Sanación → `cast_spell`. [C]
- Cada hechizo necesita glifo en la barra, sonido (los genéricos `cast` / `boom` valen de inicio) y entrada en el panel de la sala de pruebas.

### 5. Botín y equipo

- El botín ya es individual: cada jugador recibe su propia copia de cada caída y nadie ve la de los demás (`RunRoom.dropItem` / `giveFloorItem`), y la armadura ya se genera con la clase de quien la recibe. Se mantiene así.
- **Armas**: la copia de cada jugador se genera para su clase: de la misma caída, el caballero ve una espada y el mago un bastón, con la misma calidad y naturaleza. Nada se muestra atenuado ni bloqueado. El botín del caballero no cambia. [U: cada uno solo ve caer lo de su clase]
- **Armadura**: mismas 5 ranuras y mismas estadísticas; cada copia sale para la clase de quien la recibe, como hoy. [U]
- Nombres de tela para el mago: Capucha, Túnica, Guantes de seda, Fajín, Sandalias. [C]
- Aspecto: el sistema actual tiñe zonas del cuerpo; para el mago se usan los mismos tintes sobre `mage.glb` con una paleta de tela (más mate, sin brillo metálico). [C]
- Reliquias: compartidas, sin cambios. [C]
- **Legendarias del mago** (propuesta [C] para que el usuario la revise; dos por ranura, como el caballero):

| Ranura | Legendaria | Efecto |
|---|---|---|
| Casco | `healShield` | Sanación además da un escudo del 15 % de la vida durante 5 s |
| Casco | `beamPierce` | Rayo arcano atraviesa al primer enemigo antes de rebotar |
| Pecho | `novaGuard` | Durante la carga de Nova recibes un 50 % menos de daño |
| Pecho | `frostArmor` | Quien te golpea cuerpo a cuerpo queda ralentizado 2 s |
| Guantes | `tripleShot` | Cada tercer ataque básico dispara 3 proyectiles en abanico |
| Guantes | `mineCharges` | Mina arcana guarda 2 cargas |
| Cinturón | `orbTwin` | Esfera lanza una segunda esfera en dirección opuesta |
| Cinturón | `meteorBurn` | Los meteoritos dejan fuego en el suelo 3 s |
| Botas | `gustDash` | Remolino te impulsa 4 m hacia atrás al lanzarlo |
| Botas | `frostTrail` | Al esprintar dejas un rastro de hielo que ralentiza |

### 6. Enemigos de apoyo

**Buff del hechicero arcano** [U]

- Solo el tipo `mage` (el verde), no el piromante ni el invocador del rayo. [C]
- Cada ~14 s, si tiene al menos un aliado a 7 m, en vez de disparar hace un gesto de 1 s (manos arriba, aviso circular en el suelo) y aplica a los enemigos en ese radio: +30 % de daño y +25 % de velocidad durante 6 s. No se acumula; se refresca.
- Los enemigos buffeados llevan un aura visible mientras dura.
- Matar o aturdir al hechicero durante el gesto cancela el buff.

**Curandero** [U]

- Tipo de enemigo nuevo `healer` ("Curandero"). Modelo del hechicero con otro color (verde claro / dorado). [C]
- Se mantiene a distancia como los demás hechiceros. No ataca. [C]
- Cada 5 s, tras un gesto de 0,8 s, cura un 25 % de la vida máxima al aliado más herido a 9 m. No se cura a sí mismo ni a otros curanderos. Se ve un haz verde entre ambos. [C]
- Vida baja (como un hechicero). Aparece a partir del minuto 3 de cada piso, como mucho 2 vivos a la vez. [C]
- Disponible en el panel de la sala de pruebas.

## Etapas

Cada etapa termina jugable y probada; cada una tiene su propio plan.

1. **Rol, bastón y ataque básico**: elección en el lobby, clase en servidor y red, cuerpo del mago, bastón, proyectil con naturalezas, botín de armas por clase, cartas por clase (el mago aún sin hechizos: solo cartas de estadísticas).
2. **Los ocho hechizos**: lógica en servidor, predicción donde aplique, efectos, glifos, sonido.
3. **Equipo de tela y legendarias**.
4. **Enemigos de apoyo**: buff y curandero.

## Restricciones

- Servidor autoritativo; el cliente solo predice lo propio. Mismas convenciones de predicción y reconciliación que las habilidades actuales.
- Tests con vitest en `shared`, `server` y `client`; `npm run typecheck` y `npm test` limpios al cerrar cada etapa.
- Código, comentarios y textos de interfaz en español, como el resto.
- Debe funcionar con teclado+ratón, mando y sticks táctiles: todo hechizo apuntado usa la puntería ya unificada.
- El caballero no cambia de comportamiento ni de números.

## A cargo de quien construye

- Estructura interna (cómo se generaliza `Moveset` para un arma a distancia, cómo se indexan las habilidades por clase, forma de los mensajes de red).
- Qué clip concreto del paquete de magia va con cada gesto, y sus tiempos de impacto.
- Diseño visual exacto de cada efecto, dentro del estilo ya establecido en `abilityFx.ts`.
- Ajuste fino de números en la sala de pruebas.

## Estado de la implementación (2026-11-11)

Las cuatro etapas están implementadas en la rama `spike/camara-diablo`. Diferencias con lo escrito arriba:

- **Proyectil del bastón sin predicción visual**: la animación y el destello del bastón arrancan al hacer clic, pero el proyectil se dibuja cuando llega del servidor (con el retardo de interpolación), no antes.
- **Paleta de tela**: no se hizo. El tinte del equipo sigue siendo el color de la rareza, igual que en el caballero; lo que distingue al mago es una capa azul violácea sobre el cuerpo y los nombres de tela (con "raída" en vez de "oxidada" en la calidad 1, y "Bastón astillado").
- **`beamPierce`**: el haz atraviesa a todos los enemigos de la línea (no solo al primero) y rebota desde el último.
- **`frostArmor`**: "de cerca" son 3 m; los proyectiles lanzados desde más lejos no ralentizan a quien los lanzó.
- **Escudo de `healShield`**: funciona, pero no se ve en la barra de vida.
- **Curandero**: en vez de aparecer por su cuenta, desde el minuto 3 sustituye a veces (25 %) a un hechicero de la oleada, con el tope de 2 vivos.
- **Refuerzo enemigo**: también alcanza al propio hechicero que lo lanza.
- **Retrato del HUD**: sigue siendo el del caballero también para el mago.

## Cambios pedidos tras probarlo (2026-11-11)

- **Los hechizos llevan la naturaleza del bastón** (revierte la decisión [C] de arriba): con un bastón de fuego queman, con uno de hielo ralentizan y congelan, con uno de rayo encadenan, y se dibujan de ese color. La Escarcha sigue siendo siempre hielo y la Sanación, verde. La carta Afinidad también cuenta para ellos.
- **Esfera, rango 3**: salen ocho en todas las direcciones (cada una con rastro y atracción).
- **Puntería**: el golpe y el proyectil salen hacia donde se apunta en su impacto, no al hacer clic; y la puntería ya no se queda clavada con el botón apretado.
- **Teclas de habilidad en espera**: apretada a destiempo, la habilidad sale en cuanto se pueda (hasta 0,6 s).
- **Nivel**: `xpToNext` pasa de 60 + 40·nivel a 40 + 25·nivel.
- **Alcance**: ni carta ni secundaria de equipo para el mago.
- **Orbes de XP**: en un sitio ya lleno, la XP nueva se suma a los orbes que hay; el tamaño del orbe crece con la raíz del valor y tiene tope.

## Pendientes cerrados (2026-11-12)

- **Proyectil del bastón predicho**: sale al instante en la pantalla de quien dispara (desde donde se le ve y hacia donde apunta) y se acaba contra el primer enemigo dibujado o un muro; las copias del servidor de sus propios proyectiles no se dibujan. Los de los demás jugadores siguen llegando del servidor.
- **Equipo de tela**: sobre el cuerpo del mago la rareza tiñe con paleta de tela (índigo, ciruela, carmesí) y acabado mate; iconos propios en el HUD (capucha, túnica, guantes de seda, fajín, sandalias) y las piezas del mago en el suelo son de paño.
- **Escudo de `healShield`**: franja plateada al final de la barra de vida mientras dura.
- **Retrato del mago** en el HUD (su modelo de frente, 256 × 256 como el del caballero).
