# Plan 4c: ajustes tras la primera partida larga

Fecha: 2026-10-26 · Antes: `2026-10-25-progresion-cartas-design.md`

## Intención

El usuario jugó 32 minutos y reportó varios problemas:

- **Armas del suelo:** nunca desaparecen y, acostadas, cuesta reconocerlas.
- **Dificultad plana:** los enemigos no escalan, así que al subir de nivel se borran de un golpe. El tope de vivos hace que la presión deje de crecer.
- **Habilidades sin peso visual:** les faltan efectos.
- **Cartas que extrañó:** aprendizaje, reducción de enfriamiento y un tajo hacia adelante.

Éxito: a los 15 o 20 minutos, la partida vuelve a sentirse peligrosa aunque el grupo haya subido varios niveles. Las armas del suelo se reconocen de un vistazo y no se acumulan. Usar una habilidad se ve y se siente.

## Decisiones del usuario

- Las armas del suelo **desaparecen a los 40 s** y se muestran **de pie**.
- Los enemigos escalan **vida y daño con el tiempo en el piso y con el nivel del grupo** (combinado).
- Efectos: un **aro de fuego** en el giro y algo **en el suelo** al caer el salto. Mejores animaciones donde las haya.
- Cartas nuevas: **Aprendizaje**, **reducción de enfriamiento** y **Tajo frontal**, cuyo alcance crece con el rango.

## Decisiones mías (revisar)

### Armas del suelo

- **Vida en el suelo:** `FLOOR_WEAPON_TTL_S = 40` desde que aparecen. Cuenta en tiempo simulado, así que se congela en la pausa.
- **A qué armas aplica:** a todas, incluidas las iniciales de la sala de inicio y el arma que dejas al cambiar.
- **Parpadeo:** las armas parpadean los últimos `FLOOR_WEAPON_BLINK_S = 5`.
- **Cómo se ven:** de pie, con la punta clavada en el suelo, inclinadas unos 10°, flotando y oscilando suave en vez de girar acostadas. Se mantienen el aro y el brillo de tier.

### Escalado de enemigos

Al crearse (en salas y en oleadas), cada enemigo recibe:

- `vida × (1 + 0.12·(nivel − 1)) × (1 + 0.08·minutos)`
- `daño × (1 + 0.06·(nivel − 1)) × (1 + 0.04·minutos)`

Donde `minutos = floorTime / 60` y `nivel` es el nivel del grupo.

La XP que dan no cambia, porque la curva de XP ya sube por nivel.

### Tope de vivos

`45 + 10·(jugadores − 1) + 3·floor(minutos)`, con un máximo de 90.

### Cartas nuevas

- **Aprendizaje** (`learning`): +15 % de XP por orbe que recoge **ese** jugador. La XP sigue siendo del grupo, pero el orbe vale más si lo recoge quien tiene la carta.
- **Celeridad** (`haste`): −10 % de enfriamiento de las habilidades. Multiplicativo, con un mínimo del 50 %.

### Tajo frontal (`thrust`)

- **Tipo:** habilidad activa. Ocupa casilla, igual que las demás.
- **Golpe:** corte en línea recta hacia adelante, con un ancho de 1,2 m.
- **Alcance por rango:** 4 / 6 / 8 m.
- **Daño por rango:** ×1,3 / ×1,6 / ×2,0.
- **Tiempos:** enfriamiento 7 s, animación 0,7 s, impacto a 0,45 de la animación.
- **Clip:** `gs_slide_attack`.
- **Movimiento:** no desplaza al jugador. El clip trae el movimiento de la cadera quitado, como todos.

### Animaciones

- **Golpe sísmico:** pasa a usar `gs_jump_attack`.
- **Patada:** se queda con `ss_kick`.
- **Torbellino:** se queda con `gs_high_spin_attack`.

### Efectos visuales (solo cliente)

Todos son emisivos o partículas, sin luces nuevas, usan el reloj del juego y se congelan en la pausa.

- **Torbellino:** un aro de fuego (anillo emisivo naranja) que se expande hasta el radio de la habilidad durante el giro, más chispas.
- **Golpe sísmico:** al impacto, una onda en el suelo que se expande hasta el radio y se desvanece. Además, grietas (una calcomanía oscura con borde brillante que se apaga en unos 1,5 s), una nube de polvo y un temblor de cámara corto, de unos 0,25 s y suave, solo para quien está a menos de 8 m.
- **Patada:** un destello de impacto en el cono.
- **Grito de guerra:** un pulso dorado que sale del jugador.
- **Tajo frontal:** una estela de corte en línea hasta el alcance.
- **Quién los ve:** los efectos de los demás jugadores se ven igual, con el evento `ability`.
- **Partículas:** usan una textura generada en el código (un gradiente radial), sin descargar imágenes.

## No-metas

- Naturalezas, cofres y élites (Plan 4b).
- Rebalancear la curva de XP.
- Sonido.

## Restricciones

Las de siempre:
- solo desarrollo local;
- `shared` determinista;
- servidor autoritativo;
- tests en verde;
- **sin verificaciones en un navegador headless**: el usuario prueba en el juego.

Además:
- `PROTOCOL_VERSION` pasa a 7.
- Los clips nuevos (`gs_jump_attack` y `gs_slide_attack`) se agregan al build de assets.
