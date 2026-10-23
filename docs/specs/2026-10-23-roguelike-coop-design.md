# Roguelike co-op 3D en el navegador: diseño

Fecha: 2026-10-23
Estado: borrador para revisión

Las decisiones marcadas **[decisión de Claude]** no las tomó el usuario. Son defaults razonables que se pueden cambiar sin rehacer el resto.

## 1. Qué es y por qué

Un roguelike de acción en 3D, en tercera persona, que se juega en el navegador y en cooperativo. Cada jugador elige una de tres clases que empiezan casi sin nada: un guerrero con espada, un hechicero con un ataque básico y un cazador con arco. A lo largo de la run van consiguiendo habilidades que cambian su forma de jugar. Los jugadores bajan juntos por mazmorras generadas al azar, y matar al jefe de cada piso los lleva al siguiente.

Lo que le atrae al usuario es ver a un personaje que **empieza simple y se transforma durante la run**: que consiga habilidades nuevas, que haya builds distintas y que dos runs con la misma clase se sientan diferentes. La referencia de loop y progresión es `claude-sandbox/pokesurvivor/`, un roguelike de mazmorras en Canvas 2D. Este proyecto lleva esa idea a 3D y le suma co-op.

**Es un prototipo.** El objetivo es probar qué funciona y qué no. No es un juego terminado.

## 2. Metas, no-metas y anti-metas

**Metas**
- Que 1 a 4 jugadores **[decisión de Claude: máximo 4]** puedan entrar a una misma sala desde el navegador y jugar una run juntos.
- Que cada una de las tres clases se sienta distinta desde el minuto uno y más distinta todavía tras conseguir habilidades.
- Que las mazmorras sean nuevas en cada piso y en cada run.
- Que el código sea fácil de modificar para iterar: agregar una habilidad, un enemigo o ajustar números no debería tocar más de un par de archivos.

**No-metas (para este prototipo)**
- Progresión entre runs (desbloqueos permanentes, moneda meta, cuentas de usuario).
- Balance fino, contenido abundante, historia, música original.
- Móvil o mando. Solo teclado y mouse.
- Matchmaking público. Se entra con un código de sala.
- Hosting en producción o anti-cheat.

**Anti-metas (si pasa esto, el prototipo fracasó aunque "funcione")**
- Que el proyecto se convierta en construir un motor: si algo ya lo resuelven Babylon, Colyseus o un asset, se usa eso.
- Que el multijugador quede para el final y después no encaje. El co-op tiene que estar presente desde temprano en la arquitectura.
- Que las habilidades sean solo "más daño". Cada una debe cambiar cómo juegas: alcance, movilidad, control de zona o sinergia con aliados.

## 3. Restricciones

- **Corre en el navegador** (Chrome/Firefox de escritorio) sin instalar nada.
- **Stack decidido con el usuario:** Babylon.js + TypeScript en el cliente y Colyseus (Node) en el servidor.
- **Assets de terceros, sin arte propio:** el usuario no anima ni modela.
  - Personajes y animaciones: **Mixamo** (gratis; se pueden usar dentro de un juego, pero no se pueden redistribuir los archivos sueltos).
  - Mazmorra y enemigos **[decisión de Claude]:** kits CC0 de **KayKit** (Dungeon Remastered, Skeletons) o **Kenney**, que son modulares y vienen en estilo low-poly consistente. Si el estilo de Mixamo choca demasiado con el de los kits, se puede usar los personajes de KayKit (Adventurers, también CC0 y animados) para los tres héroes.
  - Todos los créditos van en un `CREDITS.md`.
- **El usuario programa pero nunca ha hecho juegos ni usado motores 3D.** El código tiene que ser legible, con estructura convencional y sin magia, porque el usuario lo va a leer y modificar.

## 4. Cómo se juega

### 4.1 Flujo de una sesión
1. Un jugador crea una sala y recibe un código corto. Los demás entran con ese código.
2. Cada jugador elige su clase en el lobby (se puede repetir clase **[decisión de Claude]**). Cuando todos marcan "listo", empieza la run.
3. Todos aparecen en la sala de inicio del piso 1.
4. Exploran, pelean, abren cofres y suben de nivel.
5. El jefe está en la sala más lejana a la de inicio. Al matarlo se abre un portal. Cuando todos los vivos lo cruzan (o tras una cuenta regresiva de 10 s desde que entra el primero **[decisión de Claude]**), se genera el piso siguiente.
6. La run termina en **victoria** al vencer al jefe del piso 3 **[decisión de Claude: 3 pisos para el prototipo]** o en **derrota** si todos los jugadores están caídos a la vez.
7. Pantalla de resumen (piso alcanzado, nivel, habilidades conseguidas, daño hecho) y vuelta al lobby.

### 4.2 Control y cámara [decisión de Claude]
- Cámara en tercera persona detrás del hombro que orbita con el mouse (puntero bloqueado).
- `WASD` para moverse, `Espacio` para rodar/esquivar con invulnerabilidad breve y cooldown.
- Clic izquierdo: ataque básico de la clase.
- `1` `2` `3` `4`: habilidades activas (máximo 4 slots).
- `E`: interactuar (abrir cofres, revivir a un aliado).
- Apuntado: los ataques a distancia van hacia el centro de la pantalla, y los cuerpo a cuerpo hacia donde mira el personaje.

### 4.3 Las tres clases

Al inicio cada clase solo tiene su ataque básico y el esquive.

| Clase | Ataque básico | Identidad |
|---|---|---|
| **Guerrero** | Combo de espada de 3 golpes en arco frontal | Aguanta, está en primera línea y controla a los enemigos cercanos |
| **Hechicero** | Proyectil mágico de velocidad media | Daño en área y control de zona a distancia, pero es frágil |
| **Cazador** | Flecha; mantener el clic carga un tiro más fuerte | Daño a un solo objetivo, alcance largo y movilidad |

### 4.4 Habilidades

- Cada clase tiene su **propio pool de habilidades**. En el prototipo son **6 por clase [decisión de Claude]**, y con 4 slots no se puede tener todo en una run, lo que obliga a elegir.
- **Cómo se consiguen** (decidido con el usuario): abriendo **cofres** o matando **enemigos especiales** (élites, más grandes y con un brillo visible).
- **Cómo se eligen [decisión de Claude]:** al abrir un cofre o matar un élite, el jugador ve **3 habilidades de su pool que aún no tiene** y elige una. Si tiene los 4 slots llenos, puede reemplazar una o descartar la nueva. Este estilo "elige 1 de 3" es lo que produce builds distintas.
- **En co-op [decisión de Claude]:** el botín es individual. Cuando alguien abre un cofre, cada jugador cercano recibe su propia elección. No hay peleas por el loot.
- Una segunda copia de una habilidad que ya tienes la mejora (rango 2 y 3, con más daño o menos cooldown) **[decisión de Claude]**.
- Las habilidades se conservan durante toda la run.
- Se definen como datos (id, clase, cooldown, parámetros) más una función de comportamiento, para que agregar una nueva sea un cambio localizado.

Pool inicial sugerido. Los nombres y detalles los ajusta quien construya:
- **Guerrero:** torbellino (giro con daño en área), embestida (dash que empuja), grito (provoca a enemigos y reduce el daño recibido), salto aplastante (salta a un punto y aturde al caer), escudo (bloquea de frente por un tiempo), estandarte (zona que da daño extra a los aliados).
- **Hechicero:** bola de fuego (explota en área), nova de hielo (congela alrededor), cadena de rayos (rebota entre enemigos), teletransporte corto, muro de fuego (zona persistente), orbe sanador (cura a los aliados en un área).
- **Cazador:** lluvia de flechas (área a distancia), trampa (inmoviliza), salto atrás (se aleja y deja una marca), disparo múltiple (abanico de flechas), marca del cazador (el objetivo recibe más daño de todos), compañero lobo (invoca a un aliado temporal).

### 4.5 Niveles y stats

- Matar enemigos da XP. **La XP es compartida en el grupo [decisión de Claude]**, para que nadie se quede atrás.
- **Subir de nivel solo mejora stats** (decidido con el usuario) y nunca da habilidades.
- La subida es automática, sin elegir **[decisión de Claude]**. Cada clase tiene su propia curva: el guerrero sube más vida, el hechicero más daño de habilidades y el cazador más velocidad de ataque.
- Stats: vida máxima, daño, velocidad de ataque, velocidad de movimiento y reducción de cooldown.

### 4.6 Muerte en co-op [decisión de Claude]
- Al llegar a 0 de vida el jugador queda **caído**. Un aliado puede revivirlo manteniendo `E` cerca por 3 s, y vuelve con el 30 % de vida.
- Si todos están caídos al mismo tiempo, la run termina.
- Si alguien juega solo, al caer termina la run.

### 4.7 Mazmorras
- Cada piso se genera con una **semilla aleatoria** como un conjunto de salas conectadas por pasillos sobre una grilla. La referencia de idea es `ia-game/scripts/world/level_generator.gd`, pero no hay que reutilizar ese código.
- Tipos de sala: inicio, combate normal, cofre, élite y jefe (la más lejana al inicio, por distancia de grafo).
- El tamaño del piso y la dificultad de los enemigos crecen con el número de piso y con la cantidad de jugadores.
- Los enemigos aparecen al entrar a cada sala, y las puertas se cierran hasta limpiarla **[decisión de Claude]**.
- Enemigos del prototipo: 2 o 3 tipos básicos (cuerpo a cuerpo, a distancia, uno rápido), sus variantes élite y **un jefe por piso** con 2 o 3 ataques telegrafiados.

## 5. Arquitectura (decidida en lo grueso)

- **Servidor autoritativo con Colyseus.** El servidor es la fuente de verdad de la mazmorra (manda solo la semilla y el layout), las posiciones, la vida, el daño, la XP, los cofres, los drops y los estados de jefe y run. Los clientes envían inputs y muestran el estado.
- **Colisiones en el servidor** contra la grilla de la mazmorra, con colisión simple de círculos y celdas. No hace falta un motor de física en el servidor **[decisión de Claude]**.
- **Cliente Babylon.js:** renderizado, animaciones, cámara, UI, efectos y sonido. Predice el movimiento del jugador propio e interpola a los demás jugadores y enemigos **[decisión de Claude]**.
- **Código compartido** entre cliente y servidor: tipos, definiciones de clases, habilidades y enemigos, y el generador de mazmorras (determinista por semilla).
- **Un solo repo** con tres paquetes (`client`, `server`, `shared`), Vite para el cliente y npm workspaces **[decisión de Claude]**.
- Para desarrollar se levanta todo en local con un comando. Varias pestañas del navegador sirven como varios jugadores.

## 6. Orden de construcción sugerido [decisión de Claude]

El co-op entra temprano (anti-meta 2):

1. Un personaje con cámara en tercera persona caminando por una mazmorra generada (un jugador, ya pasando por el servidor).
2. Varios jugadores en la misma sala, viéndose moverse.
3. Combate: el guerrero con su ataque básico, un tipo de enemigo, vida, muerte y XP.
4. Las otras dos clases, el lobby y la selección de clase.
5. Cofres, élites y la elección de 1 entre 3 habilidades. Primero 2 habilidades por clase y después completar las 6.
6. El jefe, el portal, el paso al siguiente piso y el fin de la run.
7. Caídos y revivir, escalado por jugadores, pantalla de resumen.

Cada paso termina en algo jugable que el usuario puede probar.

## 7. Lo que queda a criterio de quien construya

- La elección exacta de assets dentro de las fuentes de la sección 3, y cómo unificar sus estilos.
- Los números: vida, daño, cooldowns, curvas de XP, tamaño de los pisos.
- El algoritmo concreto de generación de mazmorras.
- El diseño de la UI (HUD, lobby, elección de habilidades), siempre que sea legible.
- El detalle del netcode (tick rate, cómo se reconcilia la predicción), mientras se sienta fluido en local y en una red doméstica.
- Los nombres y efectos exactos de las habilidades, respetando que cada una cambie cómo se juega.
