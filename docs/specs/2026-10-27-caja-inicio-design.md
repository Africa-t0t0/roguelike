# Caja de inicio: la partida empieza al cruzar el sello

Fecha: 2026-10-27 · Pedido del usuario: "que los jugadores inicien adentro de una especie de caja con paredes
transparentes azules, que desaparezca cuando un jugador sale de ahí atravesando esas paredes. El juego recién
debería comenzar ahí".

## Decisiones del usuario
- Se empieza dentro de la sala inicial cerrada por paredes azules translúcidas.
- Las paredes se atraviesan (no bloquean). Cuando **un** jugador sale atravesándolas, desaparecen y **recién ahí
  empieza la partida**.

## Decisiones mías (aprobadas en conversación: "suena bien")
- **Antes de empezar** (`RunState.started = false`): el reloj del piso no corre, no hay oleadas ni llenado de
  salas (no hay enemigos), las armas del suelo no vencen. Los jugadores se mueven, atacan al aire, recogen las
  armas iniciales y quien entra por código aparece ahí. Funciona como sala de espera.
- **Dónde van las paredes**: en las aberturas de la sala inicial hacia los pasillos (un "sello" por abertura), no
  una caja completa. Cada sello cubre el ancho de la abertura y ~3 m de alto, sobre el borde de la sala.
- **Disparo**: en cuanto un jugador conectado y vivo está en una casilla fuera del rectángulo de la sala
  inicial, `started = true` para todos (una sola vez, no vuelve atrás; sobrevive a reconexiones porque está en el
  estado).
- **Aspecto**: plano azul translúcido (≈ (0.3, 0.6, 1), alfa ≈ 0.35, emisivo, sin luz nueva) con un ondulado
  suave que se desplaza (textura generada en código), borde inferior más brillante y unas motas azules que suben.
  Al empezar, los sellos se disuelven en ~0,8 s (se desvanecen y se elevan un poco) con un destello, y se liberan.
- **Aviso**: mientras no empezó, bajo la brújula se lee "Atraviesa el sello para comenzar" y el reloj queda en
  00:00.
- **Sandbox** (`?sandbox=1`): empieza ya abierta (`started = true` al crear), para no estorbar las pruebas.
- `PROTOCOL_VERSION` pasa a 12.

## No-metas
- Elegir clase o "listo" antes de empezar; cuenta regresiva; votaciones.

## Restricciones
- Las de siempre (solo desarrollo local; shared determinista; servidor autoritativo; tests en verde; sin luces
  nuevas; efectos con el reloj de juego). Servidores de prueba nunca en 2567/5173/2568.
