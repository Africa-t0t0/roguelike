# Plan 3b: presión por tiempo, orbes de XP y enemigos armados

Fecha: 2026-10-25 · Spec general: `2026-10-23-roguelike-coop-design.md` · Anterior: `2026-10-24-elenco-armas-estilos-design.md`

## Intención

Hoy cada sala de combate se llena una sola vez, al entrar, y después el piso queda tranquilo. El usuario quiere **presión que crece con el tiempo**. Hay un reloj por piso, y mientras más tiempo pasa, más enemigos aparecen. Así quedarse farmeando sale cada vez más caro y el grupo tiene motivos para avanzar. (En el Plan 5 ese motivo será encontrar el tótem del jefe.)

La XP pasa a ser **botín que hay que ir a recoger**, y los enemigos llevan **armas visibles** con tiers que mejoran con el tiempo y la profundidad. A veces las sueltan al morir.

Éxito: a los 5 minutos en un piso se nota claramente más peligro que al minuto 1, el grupo se mueve para recoger orbes, y matar a un enemigo con un arma mejor da ganas de ver si la suelta.

## Metas

1. **Reloj por piso.** El servidor lleva el tiempo en el piso actual (`floorTime`, en segundos), sincronizado a todos. El HUD lo muestra como `mm:ss`. Parte en 0 al empezar el piso; con un solo piso por ahora, eso es al crear la sala.
2. **Director de oleadas.** Además del llenado actual de salas al entrar (se mantiene), un director del servidor hace aparecer grupos de enemigos cada vez más seguido y más grandes según `floorTime`.
3. **Navegación.** Los enemigos que aparecen lejos tienen que llegar hasta los jugadores rodeando paredes.
4. **Orbes de XP.** Al morir, un enemigo deja orbes en el suelo en vez de dar XP directo. Un orbe recogido suma su XP al grupo.
5. **Enemigos armados.** Esbirros y brutos pueden llevar un arma en la mano. El arma cambia su daño y su alcance, y el clip del ataque pasa a ser uno de espada.
6. **Tiers de arma.** Cada arma, de enemigo o de jugador, tiene un tier (1–3) que multiplica su daño y se ve con un brillo de color.
7. **Botín de armas.** Un enemigo armado puede soltar su arma al morir, con su tier, para que la recojan los jugadores con E.

## No-metas (esta fase)

- El tótem, el jefe y el cambio de piso (Plan 5).
- Cofres, élites, reparto de stats y habilidades (Plan 4).
- Modelos de arma nuevos. Los tiers reusan los 3 modelos actuales.
- Hechiceros enemigos con armas. El mago sigue igual.
- Un límite de tiempo que mate al grupo. El reloj solo sube la presión; no hay derrota por tiempo.

## Anti-metas

- Una aparición de enemigos **a la vista o encima** de un jugador. Tiene que sentirse como enemigos que llegan, no como enemigos que brotan.
- Que el servidor o el cliente se arrastren con muchos enemigos. Hay un tope de enemigos vivos, y el costo por tick debe seguir siendo bajo con el tope lleno y 4 jugadores.
- Enemigos atascados contra una pared para siempre.

## Decisiones del usuario

- El reloj es **por piso** y se ve en pantalla. Con el tiempo aumenta el número de enemigos.
- El mapa es finito (ya lo es). El tótem del jefe y la invocación con E van en el Plan 5, y las oleadas siguen durante la pelea con el jefe.
- Los enemigos dejan XP al morir y hay que recogerla.
- Los enemigos tienen armas de distinto tipo que mejoran, y **tienen una probabilidad de soltarlas**.

## Decisiones mías (revisar)

- **Orbes compartidos.** El nivel y la XP ya son del grupo entero (`RunState.level/xp`). Por eso un orbe lo recoge cualquier jugador y suma al grupo, y todos ven los mismos orbes. (Antes le había dicho al usuario que serían individuales. Lo corrijo porque la XP es compartida.)
- **El arma soltada es individual.** Al morir un enemigo que suelta su arma, cada jugador conectado recibe su propia copia en su lista de armas del suelo (`floorWeapons`, el mecanismo actual), en la posición del enemigo. Así en co-op nadie se pelea el botín. Los jugadores desconectados no reciben copia.
- **Probabilidad de soltar:** 10 % para tier 1, 14 % para tier 2 y 18 % para tier 3.
- **Tiers** (nombre como sufijo y multiplicador de daño):
  - Tier 1, "oxidada/o": ×1,0, sin brillo.
  - Tier 2, "templada/o": ×1,3, brillo azul frío.
  - Tier 3, "rúnica/o": ×1,7, brillo violeta.

  El alcance, el arco y la velocidad no cambian con el tier. El arma inicial del jugador (Kingslayer) es tier 1, y las armas del suelo iniciales también.
- **Curva del director** (constantes en `shared`, fáciles de ajustar):
  - Intensidad `I = 1 + floorTime / 60` (+100 % por minuto).
  - Intervalo entre grupos `max(2 s, 10 s / I)`.
  - Tamaño del grupo `1 + floor(floorTime / 90) + (jugadores − 1)`.
  - Mezcla por tiempo: al principio solo esbirros. Desde el minuto 1 aparecen brutos, y desde el 2, magos.
- **Tope de enemigos vivos:** `30 + 10 × (jugadores − 1)`, sumando los del llenado de salas. Con el tope lleno, el director espera.
- **Dónde aparecen:** en casillas caminables a 10–20 casillas del jugador vivo más cercano (distancia de recorrido, no en línea recta), fuera de cualquier sala con un jugador dentro. Si no hay casilla válida, el grupo se salta.
- **Tier de los enemigos:** se sortea por enemigo, con pesos que dependen de `floorTime` y del piso.
  - Hasta el minuto 2: tier 1.
  - Del minuto 2 al 4: 70/25/5.
  - Desde el minuto 4: 40/40/20.

  Cada piso extra corre la tabla un minuto antes.
- **Quién va armado:** el esbirro lleva espada de guardia en el 60 % de los casos (si no, golpea con el puño, como ahora). El bruto lleva mandoble en el 60 %. Un enemigo armado usa el daño y el alcance del arma × su tier, en lugar de los de `ENEMY_DEFS`.

- **Daño de un enemigo armado:** se queda en la escala de los enemigos.
  - Daño: `ENEMY_DEFS.damage × (damage del arma / 12) × multiplicador del tier`. El 12 es el daño de la Kingslayer.
  - Alcance: `max(ENEMY_DEFS.attackRange, 0,75 × alcance del golpe 1 del arma)`.
  - No se usan los stats crudos del jugador.
- **Solo los enemigos armados tienen tier.** Los desarmados y el mago no tienen tier, no sueltan nada y siguen con sus stats de siempre.
- **Banda de aparición:** de 8 a 30 casillas de recorrido. Si no hay casillas en esa banda, se usan las casillas alcanzables más lejanas que estén a 6 casillas o más de todo jugador y fuera de las salas con jugadores. Si ni así hay casillas, el grupo se salta y queda registrado en el log del servidor.
- **Enemigos de oleada:**
  - Nacen en `chase` contra el jugador vivo más cercano, sin límite de persecución.
  - Su `roomId` es `-1`, porque no pertenecen a ninguna sala. El llenado de salas no los toma en cuenta.
- **El tope cuenta solo los vivos.** Los que están en su animación de muerte no cuentan.
- **Orbes en el estado completo.** Se sincronizan en el estado normal y el servidor mueve los imantados; el cliente los interpola como a los enemigos. Solo se mueven los que están cerca de un jugador, así que el tráfico debería quedar bajo. Se mide y, si molesta, se optimiza después.
- **La curva de niveles no cambia por ahora.** Al haber más enemigos se subirá de nivel más rápido. Se ajusta después de jugar, cuando exista el reparto de stats del Plan 4.

## Cómo funciona (lo decidido)

### Reloj
- `RunState.floorTime` (número, segundos) avanza `SIM_DT` por tick del servidor mientras haya al menos un jugador conectado. Con la sala vacía no avanza.
- El HUD lo muestra como `mm:ss` arriba al centro.

### Director
- Es un módulo nuevo del servidor (`sim/WaveDirector.ts`), determinista con la RNG de la sala.
- Cada tick decide si toca un grupo nuevo y le pide al `EnemySystem` que cree los enemigos en las casillas elegidas.
- El llenado de salas al entrar se mantiene tal como está.

### Navegación
- Hay un mapa de flujo (BFS en la grilla de casillas) desde las casillas de los jugadores vivos. Se recalcula cuando un jugador cambia de casilla, o como mucho una vez por tick.
- Un enemigo sin línea de vista directa a su objetivo sigue la dirección del mapa de flujo. Con línea de vista va directo, como ahora.
- El mismo mapa da la "distancia de recorrido" que usa el director.

### Orbes
- Al morir un enemigo, el servidor crea orbes alrededor de su posición. Su XP total es la del enemigo (`ENEMY_DEFS.xp`), repartida en orbes de 1–4 XP.
- Los orbes viven en el estado sincronizado: `orbs` con `{id, x, z, value}`.
- **Imán:** un orbe a menos de 3 m de un jugador vivo se mueve hacia él a 8 m/s. A menos de 0,8 m se recoge y suma al grupo (las subidas de nivel salen como hoy).
- Los orbes no desaparecen solos. Si hay más de 150, los más viejos se fusionan con su vecino más cercano para no crecer sin límite.
- Ya no se da XP directamente al matar.

### Armas con tier
- `WEAPONS` sigue describiendo el modelo base. Un arma concreta es `{ weaponId, tier }`.
- El daño del jugador es `damage del arma × multiplicador del tier`.
- `PlayerState` suma `weaponTier`. Los ítems de `floorWeapons` suman `tier`.
- El HUD muestra el nombre con el sufijo del tier ("Mandoble templado").
- El aviso de recoger del suelo también lo muestra.
- `PROTOCOL_VERSION` pasa a 5.

### Enemigos armados (cliente)
- `EnemyState` suma `weaponId` (vacío si no tiene) y `weaponTier`.
- La vista del enemigo cuelga el arma en `righthand` con el agarre de `WEAPON_LOOKS`. Puede necesitar un ajuste de escala por personaje, porque las manos del bruto son enormes; eso se ajusta en `dev/grip.html`.
- **Animaciones:**
  - Ataque: el primer clip del combo del moveset del arma, ajustado a `telegraphS`.
  - Correr y quieto: siguen siendo los clips de criatura.
- **Brillo del tier:** color emisivo en el material del arma (clonado por tier, no por instancia).

## Restricciones

- Lo mismo que antes: solo desarrollo local, sin despliegue; shared determinista; servidor autoritativo; tests verdes en los tres paquetes.
- El costo por tick con 50 enemigos y 4 jugadores debe quedar holgado a 30 Hz. La separación entre enemigos hoy es O(n²); con el tope está bien, y no hace falta optimizar más.
- Reconectar y unirse a mitad de run siguen funcionando: el arma con tier se conserva en el registro del jugador, y los orbes y el reloj vienen en el estado.

## Para quien construye

- Los valores de mis decisiones son puntos de partida. Si al jugar algo se siente mal, se ajusta en constantes.
- La forma exacta de la grilla de flujo, la estructura del director y los tests quedan a criterio del plan.
- Que un enemigo pierda o recoja armas durante la partida queda fuera de alcance.
