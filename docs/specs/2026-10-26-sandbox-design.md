# Sala de pruebas (sandbox)

Fecha: 2026-10-26 · Solo desarrollo.

## Intención

Probar habilidades, efectos y escalado sin jugar minutos hasta que salga la carta. El usuario prueba en el
juego; esto le ahorra la espera.

## Cómo se usa

- `localhost:5173/?sandbox=1` crea una sala de pruebas (se puede combinar con `floorTimeStart`). El servidor solo
  la acepta fuera de producción (`resolveCreateOptions`).
- `F2` abre y cierra el panel (suelta el puntero). Quien entra por código a una sala sandbox también lo ve
  (`welcome.sandbox`).

## Decisiones

- Los comandos (`MSG.dev`, `DevCommand` en `shared/src/sandbox.ts`) pasan por el servidor autoritativo; el
  manejador solo se registra en salas sandbox y se ignoran en la pausa de elección (salvo los interruptores).
- En el sandbox las oleadas y el llenado de salas empiezan apagados; el interruptor "Oleadas" los enciende para
  todos.
- Invulnerable = `damageTakenMult` 0; Sin enfriamiento = `cooldownMult` 0,01 (el cliente lo recibe sincronizado).
  Ambos sobreviven a nuevas cartas (`refreshMods`).
- "+N niveles (sin cartas)" sube vida y escalado sin ofrecer cartas; "+1 nivel (elegir carta)" usa la pausa normal.
- Las habilidades dadas respetan las 4 casillas; "Quitar todas" vacía cartas y habilidades.
- Los enemigos creados aparecen a ~5 m delante, con línea de vista, con el arma de su tipo y el tier pedido;
  "Matar a todos" no deja orbes ni armas.
- `PROTOCOL_VERSION` pasa a 8.
