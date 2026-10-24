# Elenco de Mixamo, armas y estilos de combate: diseño

Fecha: 2026-10-24
Estado: borrador para revisión
Se apoya en: `docs/specs/2026-10-23-roguelike-coop-design.md` (el spec general) y en el estado del juego al terminar el Plan 2 (rama `plan-2-combate`).

Las decisiones marcadas **[decisión de Claude]** no las tomó el usuario. Son valores razonables que se pueden cambiar sin rehacer el resto.

## 1. Qué es y por qué

Después de jugar el Plan 2, el usuario quiere otra estética. Eligió la **fantasía oscura** (antorcha, niebla, luz fría de contorno) y un elenco con proporciones realistas en lugar del chibi de KayKit:

- **Jugador:** el *Kingslayer Assassin* de Sketchfab (autor Pigcraft, CC BY 4.0).
  - Ya está reducido a 20 mil triángulos y sin la espada, la guarda ni el pomo; el usuario aprobó cómo quedó la mano.
  - Ya tiene el esqueleto de Mixamo.
- **Enemigos:** personajes de Mixamo con sus propios packs de animación.
  - **Bruto:** *Warrok W Kurniawan*.
  - **Esbirro:** *Ch25*, un mutante.
  - **Mago:** *Maw J Laygo*.

Además, el usuario decidió que **las armas son objetos independientes**:
- Cualquier personaje puede usar cualquier arma.
- Cada arma tiene sus propias estadísticas (daño, alcance, velocidad).
- **Las armas se agrupan en estilos de combate** (movesets) por tipo de arma. El estilo define cómo se pelea: el combo, sus animaciones, la pose de quieto y la forma de correr.

## 2. Metas, no-metas y anti-metas

**Metas**
- El Kingslayer reemplaza al caballero chibi como personaje del jugador, animado y con un arma en la mano.
- Los tres enemigos de Mixamo reemplazan a los esqueletos KayKit y conservan su comportamiento actual (bruto, esbirro y mago).
- Hay un sistema de **armas + estilos de combate**, compartido por el servidor (combate) y el cliente (animación y modelo):
  - Arrancan **dos estilos**: espada a una mano y mandoble.
  - Arrancan **al menos tres armas**.
- Cada arma afecta el combate: daño, alcance, arco y velocidad de ataque.
- Agregar un estilo o un arma nueva es sumar datos y archivos, no reescribir código.

**No-metas (en este trabajo)**
- **Enemigos con armas.** El usuario sí lo quiere: tipos de arma por enemigo y armas mejores en pisos más profundos. Pero queda para el plan siguiente (Plan 3b), construido sobre este sistema ya probado. Aquí el modelo de datos ya debe permitirlo: arma y estilo no asumen que quien los usa es un jugador (§4.4).
- El jefe, que va en el Plan 5 junto con el portal y los pisos 2 y 3. Se armará como un enemigo con su propio estilo de combate.
- Cofres, élites o botín con armas, que siguen en el Plan 4. Aquí solo hace falta una forma de cambiar de arma para probar (§6).
- Animación propia para la esquiva: la mecánica con C se mantiene sin animación nueva (§5.4).
- Clases nuevas (hechicero o cazador para el jugador) o armas a distancia para el jugador.
- Cambiar la mazmorra: muros, suelos y pilares de KayKit se quedan.

**Anti-metas**
- Que cada arma necesite su propio código o sus propias animaciones duplicadas.
- Que el servidor y el cliente tengan números distintos para el mismo golpe. Las duraciones, el daño y el alcance viven en un solo lugar (`shared`).
- Que el cambio de modelos rompa el combate o la red del Plan 2: los tests existentes deben seguir pasando.

## 3. Assets disponibles

Todo lo que viene de Mixamo comparte el **mismo esqueleto**: los huesos se llaman `mixamorig:<Hueso>` y en algunos personajes `mixamorig1:<Hueso>`. Por eso **cualquier animación funciona en cualquier personaje** si se asocia por el nombre del hueso sin el prefijo; ya está probado en el visor.

- **Archivos de origen (FBX):** están en `~/Downloads`; son los packs que bajó el usuario.
- **Convertidos a GLB:** están en `roguelike-coop/.superpowers/kingslayer-work/` (ignorado por git). Se convirtieron con `FBX2glTF`, un paquete npm que trae un binario x86_64 y en Apple Silicon corre con Rosetta. En esa carpeta también están los scripts de procesamiento.

**Personajes** (todos con esqueleto de Mixamo):

| Rol | Archivo convertido | Triángulos | Peso | Notas |
|---|---|---|---|---|
| Jugador | `glb/kingslayer-rig.glb` | 19.504 | 3,4 MB | Material PBR completo (color, normal, metal/rugosidad) |
| Bruto | `glb/bruto-1k.glb` (Warrok) | ~12.600 | 4,3 MB | Texturas reducidas a 1024 px |
| Esbirro | `glb/esbirro-1k.glb` (Ch25) | ~44.300 | 7,3 MB | Texturas a 1024; quien construya puede reducir la malla a ~20 mil si hace falta rendimiento |
| Mago | `glb/mago-1k.glb` (Maw J Laygo) | ~13.900 | 4,5 MB | Trae textura de brillo (fuego en la mano) |

**Packs de animación** (todos "en el lugar", sin desplazamiento propio):
- `glb/pack/` y `glb/sueltas/`: espada y escudo, ~66 clips.
- `glb/great-sword-pack/`: mandoble, 51 clips.
- `glb/magic-spell-pack/`: hechizos, 13 clips. Solo trae quieto y lanzamientos.
- `glb/creature-npc-pack/` y `glb/creature-pack/`: criatura (zarpazo, puñetazo, ataque en salto, correr, caminar, morir, rugir, quieto).

**Armas:**
- **Espada del Kingslayer:** se rearma uniendo `kingslayer-hoja.glb`, `kingslayer-guarda.glb` y `kingslayer-pomo.glb`, las piezas que se recortaron del modelo original. Están en coordenadas del modelo original.
- **Mandoble y otras:** del pack *Medieval Weapons* de Quaternius (CC0), por ejemplo `Claymore` o `Sword_Big`. Se descargan del mismo repositorio de referencia usado en el brainstorming (`trebeljahr/quaternius-showcase`); quien construya confirma la licencia CC0 en quaternius.com.

**Licencias y créditos:**
- Kingslayer: CC BY 4.0, crédito a Pigcraft.
- Mixamo: se pueden usar dentro del juego, pero no redistribuir sueltos. Por eso en el repo solo se commitean los GLB que usa el juego, no los FBX ni los packs completos.
- Quaternius: CC0.
- Todo va en `CREDITS.md`.

## 4. Armas y estilos de combate (decidido con el usuario, detalles de Claude)

### 4.1 Modelo de datos (en `shared`)

- **Estilo de combate** (`Moveset`):
  - `id`.
  - **Clips de locomoción:** quieto, correr, correr rápido, saltar, recibir golpe, morir.
  - **Combo:** una lista de golpes. Cada golpe tiene clip, duración base, multiplicador de daño, alcance base y arco.
  - `comboResetS`: el tiempo tras el último golpe en que el combo vuelve al primero.
  - Los nombres de clip se refieren a archivos de animación del cliente. El servidor solo usa los números.
- **Arma** (`Weapon`):
  - `id`, nombre visible y estilo (`movesetId`).
  - **Estadísticas:** `damage` (daño base del golpe), `rangeMult`, `arcMult` y `speedMult`. La duración de un golpe es `duración base / speedMult`.
  - **Modelo y agarre:** posición, rotación y escala relativas al hueso de la mano derecha. Solo las usa el cliente.
- **Daño de un golpe [decisión de Claude]:** `round((weapon.damage + nivelBonus) × golpe.damageMult)`, donde `nivelBonus = damagePerLevel × (nivel − 1)`, con el `damagePerLevel` de la clase.
  - Alcance = `golpe.range × rangeMult`.
  - Arco = `golpe.arcDeg × arcMult`.
  - La vida por nivel sigue siendo de la clase.
- **El arma equipada es estado del jugador** en el servidor (`weaponId` en el schema). Todos los clientes la ven. Si el jugador cambia de arma, el combo se reinicia.

### 4.2 Estilos y armas iniciales [números: decisión de Claude, se ajustan jugando]

**Espada a una mano** (`one-hand-sword`)
- Locomoción del pack de espada y escudo.
- Combo de 3 golpes con las duraciones actuales: 0,35 / 0,35 / 0,5 s, multiplicadores ×1 / ×1 / ×1,5, alcance 2,2 / 2,2 / 2,6 m y arco 120° / 120° / 160°. Reinicio a 0,6 s.
- Clips propuestos: `slash`, `slash_3` y `attack_4` del pack. Quien construya puede cambiarlos tras verlos en el visor, siempre que se vean como tres golpes distintos.

**Mandoble** (`great-sword`)
- Locomoción del Great Sword Pack: `great_sword_idle`, `great_sword_run` y `great_sword_run_2` para correr rápido.
- Combo de **2 golpes**, lentos y amplios: 0,7 / 0,9 s, multiplicadores ×1 / ×1,6, alcance 3,0 / 3,2 m y arco 160° / 220°. Reinicio a 0,8 s.
- Clips propuestos: `great_sword_slash` y `great_sword_high_spin_attack`.

**Armas iniciales:**

| Arma | Estilo | Daño | Alcance | Arco | Velocidad | Modelo |
|---|---|---|---|---|---|---|
| Espada del Kingslayer | Una mano | 12 | ×1 | ×1 | ×1 | La hoja original rearmada |
| Espada de guardia | Una mano | 10 | ×0,9 | ×1 | ×1,15 | Una espada de Quaternius |
| Mandoble | Mandoble | 18 | ×1 | ×1 | ×1 | Claymore o Sword_Big de Quaternius |

El jugador empieza con la **Espada del Kingslayer**.

### 4.3 El daño llega en el momento del impacto (decidido con el usuario)

Hoy el daño se aplica en el mismo tick en que empieza el swing. Con el mandoble eso se ve mal: la espada todavía no se movió y el enemigo ya recibió el golpe. Desde este plan, **cada golpe pega en un momento de su animación**:

- Cada golpe del combo tiene `impactAt`, una fracción de su duración. Valores iniciales [decisión de Claude]: espada a una mano 0,45 / 0,45 / 0,5 y mandoble 0,55 / 0,6.
- **Cuándo se resuelve:** cuando el progreso del swing llega a `impactAt`. El progreso avanza por input procesado, igual que los timers del combo desde el Plan 2, así que servidor y cliente coinciden en el ritmo.
- **Contra qué posiciones:** las del `viewTick` del input procesado en ese instante. Es decir, lo que el jugador veía cuando la hoja llegó, con el mismo tope de rebobinado (`REWIND_MAX_TICKS`).
- **Desde dónde:** la posición del jugador en ese instante, con la dirección fijada al empezar el swing [decisión de Claude]. El golpe sale hacia donde apuntabas al hacer clic.
- **Qué lo cancela:** morir o empezar una esquiva antes del impacto cancela el golpe sin daño [decisión de Claude]. No se puede cambiar de arma a mitad de un swing: E se ignora mientras hay un swing en curso.
- **En el cliente:** la animación del golpe propio sigue arrancando al instante del clic. Los números de daño propios aparecen cuando llega el evento del servidor, que ahora corresponde al impacto.
- Los golpes de los enemigos no cambian: ya pegan al final de su telegrafía.

### 4.4 Preparado para enemigos con armas (lo que viene)
- `Weapon` y `Moveset` no saben si quien los usa es un jugador o un enemigo.
- La lógica que resuelve un golpe (combo, impacto, arco, alcance, daño) recibe al atacante y su arma como datos, sin depender del `PlayerRecord`.
- En el Plan 3b un enemigo podrá tener `weaponId` y usar esa misma lógica. Este plan **no** cambia la IA ni los números de los enemigos.

### 4.5 Cómo se cuelga el arma
- El arma se cuelga del hueso de la mano derecha (`RightHand`, sin prefijo) del personaje que la lleva.
- El agarre de cada arma (posición, rotación y escala) se ajusta una vez, a ojo, en una herramienta de vista previa. Sirve el visor del brainstorming o una página de desarrollo nueva.
- Con el mandoble, la pose de dos manos la da la animación; la mano izquierda no se ata al arma.

## 5. Personajes

### 5.1 Jugador
- Usa el modelo del Kingslayer y las animaciones del estilo de su arma equipada.
- Mide **1,8 m** [decisión de Claude]. La colisión (`PLAYER_RADIUS`) y la cámara no cambian.

### 5.2 Enemigos (mismo comportamiento del Plan 2, nueva apariencia) [tamaños y clips: decisión de Claude]

| Enemigo | Modelo | Altura | Quieto / correr | Ataque (telegrafía) | Recibir golpe | Morir |
|---|---|---|---|---|---|---|
| Bruto | Warrok | 2,4 m | `mutant_idle` / `mutant_run` | `mutant_swiping` | prestado: `great_sword_impact` | `mutant_dying` |
| Esbirro | Ch25 | 1,7 m | `mutant_idle_2` / `mutant_run` (más rápido) | `mutant_punch` | prestado: `great_sword_impact_4` | `mutant_dying` |
| Mago | Maw J Laygo | 2,2 m | `standing_idle` / prestado: `mutant_walking` | `standing_1h_magic_attack_01` | prestado: `great_sword_impact_2` | prestado: `two_handed_sword_death` |

- Los ataques de los enemigos son estilos de "arma natural": no llevan modelo de arma. La duración de la telegrafía sigue saliendo de `ENEMY_DEFS`; la animación se acelera o frena para calzar, como hoy.
- Los radios de colisión se ajustan al tamaño: bruto 0,6 m, esbirro 0,4 m, mago 0,5 m [decisión de Claude].
- El aro rojo de telegrafía, las barras de vida y los proyectiles del mago se mantienen. La barra de vida se ubica según la altura real de cada modelo.
- Si alguna animación prestada se ve mal, quien construya elige otra del mismo esqueleto.

### 5.3 Asociar animaciones por hueso
Las animaciones se cargan aparte y se asocian a los huesos del personaje por el nombre normalizado (sin `mixamorig\d*:` y en minúsculas). Los huesos que no existan en el personaje se ignoran. Así un mismo archivo de animación sirve para todos.

### 5.4 Esquiva
La mecánica (tecla C, invulnerabilidad y enfriamiento) no cambia. Mientras dura, se reproduce el clip de correr del estilo actual al doble de velocidad [decisión de Claude]. Su animación propia queda para más adelante.

## 6. Cambiar de arma mientras no haya cofres [decisión de Claude]

- En la **sala de inicio** aparecen en el suelo las armas que el jugador no tiene equipadas, como objetos visibles. Por ahora el servidor solo construye el piso 1, así que es su sala de inicio.
- **Las armas del suelo son individuales:** cada jugador ve y cambia solo las suyas. Así lo dice el spec general (§4.4: el botín es individual y nadie pelea por él), y no hay carreras entre dos jugadores que pulsan E sobre la misma.
- Con **E** cerca de una (a ≤ 1,5 m), el jugador la toma y deja la suya en ese lugar.
- El servidor valida la distancia y el cambio. Todos ven el arma nueva en la mano del jugador; las armas del suelo de un jugador solo las ve él.
- El arma equipada se guarda en el registro de combate del jugador, así que sobrevive a la reaparición y a la reconexión.

Esto deja hecho el mecanismo de "arma en el suelo" que el Plan 4 va a reutilizar para el botín.

## 7. Lo que se elimina
- Del cliente: el modelo del caballero chibi y los esqueletos KayKit, con sus armas.
- Los assets de la mazmorra KayKit se quedan.
- En `CREDITS.md`, KayKit queda solo por la mazmorra.

## 8. Lo que queda a criterio de quien construya
- Los clips exactos de cada estilo y de cada enemigo, dentro de lo propuesto, una vez vistos en movimiento.
- El agarre de cada arma.
- Cómo empaquetar las animaciones. Puede ser un GLB por clip, como en el brainstorming, o un GLB por estilo con varios grupos de animación.
- Si reducir la malla del esbirro.
- Cómo se organiza el código, mientras los números del combate vivan solo en `shared` y los tests del Plan 2 sigan pasando, ajustados a la nueva fuente de los números.
