# Plan 4b-1: tres hechiceros con un ataque cada uno

Fecha: 2026-10-26 · Antes: `2026-10-26-ajustes-feedback-design.md` · Sandbox: `2026-10-26-sandbox-design.md`

## Intención

Hoy el único hechicero lanza una esfera verde plana. El usuario quiere hechizos más vistosos y más variedad. Lo
acordado:

- **Cada tipo de hechicero tiene un solo ataque**, reconocible de un vistazo.
- **El tiempo trae tipos nuevos**, en vez de que un mismo mago aprenda más ataques.
- **Cada tipo mejora con el tier**, como las armas, sin cambiar de ataque.
- **Los ataques combinados quedan para élites y jefe** (4b-2 y Plan 5).

Éxito: en una partida de 8 minutos se distinguen los tres tipos por su color antes de que ataquen. Cada ataque se
ve venir con tiempo para esquivarlo caminando, y un tier 3 se nota más peligroso que un tier 1.

## Decisiones del usuario

- Un tipo de hechicero = un ataque: **orbe**, **zona en el suelo** y **rayo en línea**.
- Los tipos aparecen con el tiempo y mejoran por tier.
- Los hechizos se ven mejor: carga en la mano, estela e impacto.
- Se distinguen sin modelos nuevos: tinte, aura y color del hechizo.
- El panel F2 se amplía para probar todo esto.

## Decisiones mías (revisar)

### Los tres tipos

Todos usan el modelo del mago actual. Cambian el tinte del cuerpo, un aura bajo los pies y el color del hechizo.
Mantienen la IA del mago de hoy: se plantan a distancia con línea de vista y retroceden si te acercas. Los nuevos
dan la misma XP que el mago (8).

- **Hechicero arcano** (`mage`, el actual).
  - Color: verde esmeralda (el de hoy, ahora con brillo).
  - Ataque: lanza un orbe en línea recta. Daño 10; distancia preferida de 6 a 10 m; preparación 0,7 s.
  - Tier 1: 1 orbe a 9 m/s.
  - Tier 2: 1 orbe a 12 m/s.
  - Tier 3: 3 orbes en abanico (±15°) a 12 m/s.
- **Piromante** (`pyromancer`).
  - Color: naranja fuego.
  - Ataque: al empezar a prepararlo marca un círculo en el suelo donde está su objetivo en ese momento. El
    círculo se va llenando y explota 1,2 s después de aparecer, dañando a quien esté dentro.
  - Daño 14; distancia preferida de 7 a 12 m; enfriamiento 3 s; vida 30.
  - Tier 1: un círculo de 2,5 m.
  - Tier 2: un círculo de 3,2 m.
  - Tier 3: tres círculos de 2,5 m (en el objetivo y a 3 m a cada lado, perpendiculares a la línea mago-objetivo).
- **Invocador del rayo** (`stormcaller`).
  - Color: celeste eléctrico.
  - Ataque: una línea de aviso fina sale del mago hacia el objetivo y lo sigue durante el 60 % de la preparación.
    Luego queda fija, y al terminar la preparación dispara un rayo instantáneo de 14 m que se corta en el primer
    muro. Daña a quien esté sobre la línea.
  - Daño 12; distancia preferida de 8 a 13 m; enfriamiento 3,5 s; vida 26.
  - Tier 1: preparación 1,1 s, ancho 0,8 m.
  - Tier 2: preparación 0,9 s, ancho 0,8 m.
  - Tier 3: preparación 0,9 s, ancho 1,3 m.

### Tier de los hechiceros

- Hoy los magos no tienen tier. Pasan a sortearlo con la misma tabla que las armas de los enemigos (`rollTier`).
- No llevan arma, así que no sueltan nada.
- Su tier se sincroniza al cliente: un brillo de tier, el mismo azul o violeta de las armas, en el aura.

### Cuándo aparecen

- Oleadas:
  - Desde el minuto 2: arcanos (como hoy).
  - Desde el minuto 4: también piromantes.
  - Desde el minuto 6: también invocadores.
  - Dentro de la mezcla de oleada, cada tipo de hechicero disponible tiene el mismo peso que los demás.
- Llenado de salas: el hueco del mago de hoy toma un hechicero al azar entre los disponibles a esa hora del reloj.
  Antes del minuto 2, ese hueco sigue siendo un arcano, como hoy.

### Daño, Bloqueo y escalado

- El daño de las zonas y los rayos escala como el resto (`damageMult` del enemigo al crearse).
- El Bloqueo cuenta como "desde el frente" según el centro del círculo (zona) o la posición del mago (rayo).
- Con "Invulnerable" del panel F2 no dañan.

### Estado nuevo sincronizado

- Hay un mapa `hazards` en `RunState` con las zonas y los rayos activos, porque los avisos los tienen que ver todos
  los jugadores.
- Cada entrada lleva:
  - `kind`: `"zone"` o `"beam"`;
  - la posición;
  - la dirección y el largo (rayo);
  - el radio o el ancho;
  - el tiempo restante y el total;
  - `phase`: `"warn"` o `"fire"`.
- El rayo se queda unos 0,15 s en `fire` para que se vea, y luego desaparece.
- `EnemyState` suma el tier de los hechiceros. Cómo se llama el campo lo decide el plan.
- `PROTOCOL_VERSION` pasa a 9.

### Efectos visuales (solo cliente)

Siguen las reglas de siempre: solo emisivos y partículas, sin luces nuevas, con el reloj del juego y congelados
en la pausa.

- **Carga:** durante la preparación, una esfera de luz del color del tipo crece en la mano del mago.
- **Orbe:** un núcleo claro con un halo del color del tipo, una estela de partículas y un pulso suave. Al
  desaparecer (pared o jugador) deja un pequeño estallido.
- **Zona:** un borde de círculo y un relleno que crece hasta la explosión, en naranja; el anillo rojo de las
  telegrafías cuerpo a cuerpo no se reusa. Al explotar, un estallido de partículas y una marca chamuscada que se
  apaga en unos 1,5 s.
- **Rayo:** primero una línea fina celeste que parpadea y se intensifica al fijarse. Después un haz grueso y
  brillante que se desvanece, con chispas en el punto final.
- **Tinte:** un tinte emisivo suave en el cuerpo, con un material clonado por tipo y no por instancia, y un aura
  tenue bajo los pies.

### Panel de pruebas (F2)

- "Crear delante" suma Piromante e Invocador. Para los hechiceros, el selector de tier vale como su tier;
  "Desarmado" cuenta como tier 1.
- Interruptor nuevo, **"Enemigos quietos"**: los enemigos no se mueven ni atacan. Sirve para mirar tintes y
  auras.
- Botón nuevo, **"Hechizo ya"**: hace que todos los hechiceros vivos empiecen a preparar su ataque contra el
  jugador más cercano. Sirve para ver cargas, zonas y rayos sin esperar el enfriamiento.

## No-metas

- Naturalezas en las armas y habilidades del jugador, cofres y élites (4b-2).
- Modelos nuevos de hechicero, y sonido.
- Que un hechicero use más de un ataque.
- Efectos de estado (quemadura, ralentizar).

## Restricciones

Las de siempre:

- solo desarrollo local;
- `shared` determinista;
- servidor autoritativo;
- tests en verde.

Sobre las pruebas visuales: el usuario autorizó que pruebe en el sandbox (`?sandbox=1`) con un navegador
headless. Las hago contra sus servidores, sin reiniciarlos, y pocas: solo para confirmar lo visual al final.
