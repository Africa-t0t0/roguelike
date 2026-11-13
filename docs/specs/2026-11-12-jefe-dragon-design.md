# Jefe: el dragón, el tótem y los pisos infinitos

Fecha: 2026-11-12. Marcas: **[U]** lo decidió el usuario, **[C]** lo decidió Claude (ajustable jugando).

## Intención

El primer jefe del juego. Hasta ahora un piso no terminaba nunca: el reloj subía la presión, pero no había una meta. Con esto el piso tiene un final: encontrar el tótem, invocar al jefe, matarlo y bajar.

## El ciclo de un piso

1. La sala del jefe es la más lejana a la de inicio (ya existía en el generador). En su centro hay un **tótem** **[U]**.
2. Un jugador junto al tótem lo activa con la tecla de interactuar (E, la misma de los cofres; en táctil, su botón) **[U: «hacer clic en el tótem»; C: con la tecla de interactuar, como los cofres]**. Aparece el **dragón** **[U]**.
3. Las oleadas siguen durante la pelea (como decía el diseño de presión). Al morir el dragón dejan de salir enemigos
   en ese piso (ni oleadas ni salas nuevas) **[U]**.
4. Al morir el dragón, el tótem se vuelve un portal y en el suelo quedan un cofre y orbes de XP **[C: recompensa provisional hasta que exista la fusión]**.
5. Un jugador interactúa con el tótem abierto y **todo el grupo** baja al piso siguiente **[U: clic en el tótem; C: basta con uno]**.
6. El piso nuevo es otra mazmorra generada (más grande, más salas, enemigos más duros). Se conserva todo: nivel, cartas, habilidades, equipo, armas y reliquia. El reloj **no** vuelve a 0: sigue subiendo la dificultad **[U]**; el primer grupo de oleada del piso nuevo sale con el respiro de siempre. Los cofres son nuevos y las armas del suelo del piso anterior se pierden.
7. Los pisos no terminan nunca **[U]**; la partida acaba cuando cae todo el grupo (como hasta ahora).

La sala del jefe crece hasta al menos 11 × 11 casillas (22 m) para que el dragón tenga espacio **[C]**, salvo que al crecer pise la sala de inicio.

## El dragón

Modelo: «Low Poly Dragon» de bocdagla (itch.io, CC-BY: se le da crédito en CREDITS.md) **[C, el usuario delegó la elección]**. Trae Idle, Walk, Attack, AttackPose, GroundToFly y Flying; no trae muerte ni golpe recibido, así que al morir se desploma y se hunde, y al recibir un golpe destella.

- Unas 3 veces el tamaño del bruto, barra de vida propia arriba de la pantalla con su nombre **[C]**.
- Inmune a aturdir, congelar, empujar y atraer **[C]**; las ralentizaciones sí le afectan.
- Vida escalada por jugadores, piso y nivel del grupo; cada piso usa otra paleta del modelo **[C]**.
- Cada piso más lo vuelve mucho más temido **[U]** (`dragonFloorScale`, números **[C]**): vida ×1,6 y daño ×1,3 por
  piso (compuesto), ritmo +15 % por piso hasta ×1,8 (avisos, esperas, paso y animaciones más rápidos) y armadura
  +10 % por piso hasta 60 % (ignora esa parte del daño recibido).
- Pendiente **[U]**: dragones de elementos (hielo que ralentiza con sus golpes, etc.).

### Ataques (todos avisan en el suelo antes de golpear)

| Ataque | Cuándo | Qué hace |
|---|---|---|
| Zarpazo **[U]** | alguien a ≤ 4 m delante | arco de 120° y 4,5 m; aviso 0,55 s; daño medio |
| Lanzallamas **[U]** | objetivo a ≤ 10 m | cono de 60° y 10 m; aviso 0,6 s, quema 2 s a pulsos; deja quemadura |
| Pasada en llamas **[U]** | objetivo lejos, o cada tercer ataque especial | despega, cruza la sala en línea recta hacia el objetivo y deja una franja de fuego 6 s; mientras vuela no recibe daño |
| Pisotón **[C]** | dos o más jugadores a ≤ 3,5 m | anillo de 4,5 m; aviso 0,7 s; daña y aparta 3 m |

### Furia **[C]**

Con menos de la mitad de vida: avisos y esperas un 25 % más cortos, la pasada deja dos franjas paralelas y el dragón brilla al rojo.

## Fusión de habilidades (la recompensa del jefe)

- Matar al dragón da a cada jugador una fusión para gastar **[U]**.
- Hay **una sola fusión por jugador, que crece [U]**: con el primer jefe se unen dos habilidades activas; con cada
  jefe siguiente se elige una más y se suma a esa misma fusión. Cualquier habilidad activa puede entrar **[U]**.
- Todas las de la fusión salen a la vez con una sola tecla **[U, propuesta de C]**.
- Cada habilidad que entra libera una casilla: la fusión entera ocupa una sola de las 4 **[C, aprobado]**.
- La fusión pega un 25 % más (y el Estandarte fusionado da un 25 % más de bono) y todas usan el enfriamiento de la
  más lenta **[C, aprobado]**.
- Pone la animación la que mueve o canaliza (Tajo, Golpe sísmico, Remolino, Torbellino, Nova…); las demás corren a
  la vez, con sus impactos a su tiempo y donde esté el jugador. Las que saltan o embisten sin llevar la animación
  golpean donde las lleve la otra **[C]**.
- Se elige en un panel que se abre solo al ganar la fusión y con la tecla F («Fusionar» la primera vez, «Sumar a la
  fusión» después); «Más tarde» deja un aviso **[C]**. No se deshace **[C]**. En el panel de pruebas: «Dar fusión».

## Fuera de alcance

- Efectos especiales a mano para mezclas concretas: más adelante, sobre la regla general.
- Otros jefes: por ahora el dragón en todos los pisos, cada vez más duro.

## Panel de pruebas

«Jefe»: invoca al dragón junto al jugador. «Piso siguiente»: baja de piso sin pelear.
