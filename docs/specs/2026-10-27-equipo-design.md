# Plan 4d: equipo (casco, pechera, guantes, botas)

Fecha: 2026-10-27 · Antes: `2026-10-26-naturalezas-design.md`

> Revisado por el usuario (2026-10-27): 4 ranuras por ahora, sin inventario, resistencias elementales en la
> armadura, resistencia general en las legendarias y efectos únicos por clase en piezas legendarias.

## Intención

Hoy lo único que se encuentra es el arma. El usuario quiere encontrar **mejor equipo** (botas, guantes, armadura…)
que mejore las estadísticas del personaje, y que se vea en el personaje: **el brillo de la rareza debe ir en la
parte del cuerpo que corresponde** ("si encuentra unos guantes o botas, el aura debería afectar solo a esa
parte").

Éxito:

- Encontrar unas botas raras se nota en el juego (corres más) y en el personaje (los pies brillan).
- Un vistazo a un compañero dice qué tan equipado va.
- Gestionar el equipo no interrumpe la acción: se recoge con E igual que un arma.

## Decisiones del usuario

- Equipo con estadísticas: botas, guantes, armadura y similares.
- El aura o brillo de rareza va **solo en la parte del cuerpo** de esa pieza.
- Por ahora no hay personaje modular. Sin cambiar el modelo, la pieza se ve como brillo y partículas sobre esa
  parte del cuerpo.
- **4 ranuras por ahora** (casco, pechera, guantes, botas); se puede ampliar más adelante.
- **Sin inventario** para empezar.
- **Resistencias elementales:** la armadura puede dar "X % de resistencia al fuego" (o al hielo, o al rayo).
  Las **legendarias** dan **resistencia general a todos los elementos**.
- **Efectos únicos por clase** en piezas legendarias, por ejemplo para el caballero: "el Torbellino tiene 2
  cargas" o "los bonos de Grito duran más".
- **Reliquia** como quinta ranura:
  - un objeto con un efecto único;
  - en su mayoría **solo positivos**, como más vida o efectos buenos en general;
  - las que traen un trade-off deben ser **realmente buenas**;
  - **no se regalan**: solo salen en cofres o como botín, y son raras.

## Decisiones mías (revisar)

### Ranuras y qué parte brilla

| Ranura | Huesos donde brilla | Stat principal (sale siempre) |
|---|---|---|
| Casco | cabeza | vida máxima |
| Pechera | torso (columna alta) | reducción de daño |
| Guantes | las dos manos | velocidad de ataque |
| Botas | los dos pies | velocidad de movimiento |

El arma sigue como hoy: rareza en la hoja y naturaleza.

### Rareza

- Es la misma escala que las armas: tier 1 oxidado, 2 templado (azul), 3 rúnico (violeta) y 4 legendario
  (dorado).
- El tier define cuánto vale la stat principal y cuántas stats secundarias trae:

| Tier | Stats secundarias | Multiplicador de valores |
|---|---|---|
| 1 | 0 | ×1 |
| 2 | 1 | ×1,5 |
| 3 | 2 | ×2 |
| 4 | 2 | ×2,5 |

- Además, el tier 4 trae resistencia general y un efecto legendario (ver abajo).

### Valores base (tier 1; se multiplican por el tier)

**Stats principales:**
- Casco: +15 vida máxima.
- Pechera: −5 % de daño recibido.
- Guantes: +6 % de velocidad de ataque.
- Botas: +5 % de velocidad de movimiento.

**Bolsa de secundarias** (sin repetir dentro de la pieza ni repetir la principal):
- +1 de regeneración por segundo;
- +6 % de daño;
- +8 % de alcance;
- +25 % de radio de imán;
- +8 % de XP;
- −5 % de enfriamiento;
- +1 de vida por muerte.

Las piezas se combinan con las cartas: las cartas y el equipo suman sus bonos y comparten los mismos topes de
hoy (−60 % de daño recibido y −50 % de enfriamiento).

### Resistencias elementales

- **Qué cubre:** reduce el daño de ese elemento y la duración de su estado (quemadura, ralentización,
  aturdimiento).
- **Elemento y estado son cosas distintas:** el elemento se usa solo para la resistencia. Los estados
  (quemadura, ralentización, aturdimiento) siguen saliendo solo de los élites, como en el 4b-2.
- **Qué cuenta como elemento:** el ataque de un élite de esa naturaleza, más dos ataques de hechiceros normales,
  para que la resistencia sirva desde el principio: la zona del piromante cuenta como fuego y el rayo del
  invocador como rayo.
- **Afijos secundarios:** "Resistencia al fuego / al hielo / al rayo +8 %" (× el multiplicador del tier) entran
  en la bolsa de secundarias.
- **Legendarias:** toda pieza legendaria trae, además, "Resistencia a todos los elementos +10 %".
- **Tope:** 60 % por elemento, sumando todas las piezas.
- **Visual:** el color de las partículas de la pieza lo da su resistencia más alta. Si no tiene ninguna, usa el
  color de la rareza.

### Efectos legendarios por clase

Cada pieza legendaria (tier 4) trae **un efecto único** sorteado de la bolsa de su ranura para la clase del
jugador. Hoy solo existe el caballero. Bolsa propuesta para el caballero:

- **Casco:**
  - "Grito de guerra dura un 50 % más".
  - "Grito de guerra también cura un 15 % de la vida a los aliados".
- **Pechera:**
  - "Bloqueo devuelve el 30 % del daño bloqueado".
  - "Al bajar del 30 % de vida, te escudas 3 s: −80 % de daño recibido (una vez cada 30 s)".
- **Guantes:**
  - "Torbellino tiene 2 cargas".
  - "Patada aturde el doble de tiempo".
- **Botas:**
  - "Golpe sísmico deja el suelo agrietado 3 s: ralentiza un 40 %".
  - "Tajo frontal te impulsa 3 m hacia adelante".

Más reglas:

- **Habilidad que no tienes:** el efecto se ve en gris en el aviso y no hace nada hasta que la consigas.
- **Visual:** una pieza con efecto único suma un destello dorado periódico en su parte del cuerpo.
- **Clases futuras:** la bolsa depende de la clase, así que el mago y el cazador tendrán la suya.

### Reliquias (quinta ranura)

- **Qué son:** cada reliquia tiene nombre y un efecto fijo, sin tier ni stats sorteadas. Llevas una sola. E sobre
  otra la cambia y deja la tuya en el suelo, igual que el arma.
- **De dónde salen:** solo como botín y con poca probabilidad.
  - **Cofres:** 8 % (se descuenta del arma, que queda en 37 %).
  - **Élites:** 6 % al morir, aparte de su otro botín.
  - Los enemigos normales no las sueltan, y no hay forma de elegirlas al inicio.
  - **Botín individual**, como todo lo demás.
- **Positivas** (la mayoría):

| Reliquia | Efecto |
|---|---|
| Corazón de roble | +40 de vida máxima y +1 de regeneración por segundo |
| Pluma del halcón | +12 % de velocidad de movimiento y +50 % de radio de imán |
| Ojo del erudito | +25 % de XP |
| Amuleto del centinela | −15 % de daño recibido |
| Garra de bestia | +15 % de daño y +10 % de velocidad de ataque |
| Piedra de los tres reyes | +15 % de resistencia a todos los elementos |

- **Con trade-off**, pero muy buenas:

| Reliquia | Efecto |
|---|---|
| Corazón de cristal | +60 % de daño; −25 % de vida máxima |
| Reloj de arena roto | −40 % de enfriamiento; cada habilidad cuesta 4 de vida (sin bajar de 1) |
| Colmillo del vampiro | recuperas el 5 % del daño que haces; sin regeneración pasiva |

- Los trade-offs afectan solo a quien la lleva.
- **Cómo combinan:** las reliquias suman con cartas y equipo, y respetan los topes de hoy (−60 % de daño
  recibido, −50 % de enfriamiento). El Reloj de arena puede pasar el tope de enfriamiento hasta −60 %: es su
  gracia.
- **Visual:**
  - **En el suelo:** una gema pequeña que flota y gira, con un halo blanco cálido y un rayo de luz vertical
    tenue, para que se distinga del equipo de lejos.
  - **En el personaje:** un pequeño halo que orbita el pecho. Es dorado en las positivas y rojo y dorado en las
    de trade-off.
  - **En el HUD:** el quinto icono es la reliquia, y al pasar el mouse muestra su texto.

### Cómo se consigue

- **Cofres:** el sorteo pasa a ser 37 % arma, 30 % pieza de equipo, 8 % reliquia, 15 % orbes y 10 % curación.
- **Élites:** su botín de arma (50 %) se reparte entre arma y pieza de equipo, mitad y mitad.
- **Enemigos normales:** 1,5 % de probabilidad de soltar una pieza de tier 1 o 2 según el reloj.
- **Botín individual**, como las armas: cada jugador recibe su copia.
- En el suelo la pieza aparece como un objeto pequeño con forma de su ranura (yelmo, peto, guante o bota), hecho
  con primitivas, con el brillo y el aro de su rareza. Desaparece a los 40 s, igual que las armas.

### Equipar y comparar

- **E sobre una pieza:** te la equipas. La pieza que llevabas en esa ranura queda en el suelo, como pasa con el
  arma.
- **Aviso al acercarte:** "E Equipar Botas templadas", con una comparación corta como "+7,5 % velocidad (+2,5 %)"
  y sus secundarias.
- **Inventario:** no hay. Solo lo equipado, una pieza por ranura, para no interrumpir la acción con menús.

### HUD

Cinco iconos pequeños de ranura junto al retrato (casco, pechera, guantes, botas y reliquia), con el borde del color de la
rareza. Al pasar el mouse por encima, o al mantener Tab, se ven las stats de cada pieza.

### Brillo por parte del cuerpo (lo visual)

- Va pegado a los huesos del esqueleto del Kingslayer: cabeza, columna alta, manos y pies. Hoy la espada ya va
  pegada al hueso de la mano de la misma forma.
- Por rareza:
  - **Tier 1:** nada.
  - **Tier 2:** motas azules suaves que se desprenden de esa parte.
  - **Tier 3:** motas violetas, más densas, con un halo tenue.
  - **Tier 4:** dorado y más vistoso. Si la pieza tiene una resistencia elemental, las partículas toman el color
    de su resistencia más alta.
- Las partículas siguen la animación: al correr, las de los pies van con los pies.
- **Se ve en todos los jugadores.**
- **Costo:** como mucho 6 emisores por jugador (cabeza, torso, 2 manos y 2 pies). Son baratos, con pocas
  partículas, una textura compartida, el reloj de juego y congelados en la pausa.

### Red y estado

- Cada jugador lleva su equipo y su reliquia en `PlayerState` (por ranura: tier, resistencia principal, efecto
  legendario y el detalle de stats) para que los demás vean el brillo y él vea sus stats.
- El servidor guarda el equipo en el registro del jugador, así que se conserva al reconectar.
- `PROTOCOL_VERSION` pasa a 13 (la caja de inicio ya usó el 12).

### Panel de pruebas (F2)

Sección nueva "Equipo":

- elegir ranura y tier, con los botones "Equipar" y "Soltar delante";
- elegir una reliquia, con "Equipar reliquia".

## No-metas

- Personaje modular o piezas que cambien el modelo (botas o pecheras de verdad). Va en un plan aparte si se
  consigue un modelo modular.
- Inventario con espacio de guardado, venta, tienda, crafteo y sets con bonos.
- Anillos y amuletos (posible ampliación).
