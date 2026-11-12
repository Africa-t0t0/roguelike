# Habilidades del caballero — rediseño

Fecha: 2026-11-12. Pedido por el usuario tras pulir las del mago: las del caballero habían quedado atrás. Lo marcado **[U]** lo decidió el usuario; **[C]** son números o detalles míos, para ajustar jugando.

## Qué se va

- **Patada**, **Frenesí** y **Bloqueo** desaparecen [U]. El Bloqueo no queda como acción básica [U].
- Legendarias que dependían de ellas o del impulso del Tajo, reemplazadas [C]:
  - `blockReflect` → `bannerGuard`: dentro del Estandarte propio el grupo recibe un 20 % menos de daño.
  - `kickStun` → `hookStun`: el Gancho aturde 1 s más.
  - `blockFree` → `throwCharges`: Lanzar la espada tiene 2 cargas.
  - `thrustDash` → `thrustScar`: el rastro del Tajo dura el doble y daña un 50 % más.
- **Pendiente**: un reemplazo para el Frenesí. Mientras tanto el caballero tiene 7 activas y la pasiva.

## Las que se quedan

| Habilidad | Niveles 1 y 2 | Nivel 3 |
|---|---|---|
| Torbellino | 120 % → 160 % de daño; enfriamiento 8 → 7 s [U, números C] | Gira 4 s: golpe cada 0,4 s (70 %, radio 3,2 m), aparta 0,4 m por golpe; el caballero se mueve al 60 % [U, números C] |
| Grito de guerra | Aliados a 10 m [U, radio C]: +20 % 8 s; luego +25 % 10 s y 20 → 17 s [U, % C] | +30 % de daño y +20 % de velocidad de ataque, 12 s [U] |
| Golpe sísmico | Salta al punto apuntado, invulnerable toda la animación, aturde 1 s [U]; 150 % → 180 %, 10 → 8,5 s [C] | Aterriza y canaliza: golpe a 1,1 s, 400 %, radio 4,5 m, aturde 1,5 s [U, números C] |
| Tajo frontal | Embestida de 10 m que atraviesa (ancho 1,4 m) y deja un rastro que daña 3 s (30 % cada 0,5 s) [U, números C]; 150 % → 180 %, 8 → 7 s | 3 cargas [U] |
| Lanzar la espada | 100 % → 130 %, 8 → 10 m, 6 → 5 s [U, números C] | 8 espadas en todas las direcciones; marcan 5 s; cualquier golpe del caballero (básico o habilidad) hace estallar la marca: 300 % al marcado y 100 % a 2,5 m [U, números C]. Las propias espadas, a la ida o a la vuelta, no la hacen estallar [C] |
| Gancho de cadena | Atrae 5 → 10 enemigos (12 m), aturde 1 s, 14 → 12 s [U, números C] | Todos a 20 m, aturde 2 s, el caballero queda invulnerable 2 s [U] |
| Estandarte | Cura 3 → 4 % por s y +15 → +20 % de daño, radio 4 → 5 m, 22 → 20 s [U, números C] | Cura 5 %/s, +50 % de daño, radio 6 m, y los ataques del grupo dentro llevan fuego, hielo y rayo a la vez (también los del mago) [U, números C] |
| Onda de corte | Sin cambios (pasiva) [U] | — |

## Notas de implementación

- La embestida del Tajo se predice en el cliente como el salto del Golpe sísmico (mismos pasos que el servidor).
- "Invulnerable" usa el mismo estado que la invulnerabilidad al reaparecer: los golpes que llegan mientras dura se descartan.
- Con las tres naturalezas, cada efecto es el de la suya (quema, ralentiza y congela, encadena), con la Afinidad de quien golpea.
