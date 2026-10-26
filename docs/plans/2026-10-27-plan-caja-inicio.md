# Caja de inicio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** La partida empieza cuando un jugador atraviesa los sellos azules de la sala inicial.
**Architecture:** `shared` calcula los sellos (aberturas de la sala inicial); el servidor mantiene `RunState.started` y frena reloj/oleadas/salas hasta que alguien sale; el cliente dibuja los sellos, el aviso y la disolución.
**Tech Stack:** TypeScript, Babylon.js, Colyseus 0.18 (schema 5), vitest.
**Spec:** `docs/specs/2026-10-27-caja-inicio-design.md`

## Global Constraints
- Solo dev local; shared determinista; servidor autoritativo; `npm test` raíz + `tsc` por paquete + build del cliente verdes.
- `PROTOCOL_VERSION = 12` (aserción en `packages/shared/test/cards.test.ts`).
- Cliente: sin luces nuevas; emisivos; reloj de juego (`setPaused`); todo liberado.
- Nunca levantar servidores en 2567/5173/2568.

## Review Focus
1. Un jugador que entra por código **después** de empezar no ve sellos (llega `started = true`).
2. Reconexión tras empezar: sigue empezado; el reloj no se reinicia.
3. Dos jugadores: uno sale, al otro le desaparecen los sellos igual.
4. Antes de empezar, el panel F2 no aplica (la sala sandbox ya empieza abierta) y una sala normal no genera enemigos aunque pase el tiempo real.

### Task 1: shared, sellos de la sala inicial
**Files:** Create `packages/shared/src/start.ts` (exportar desde index); Modify `protocol.ts` (12); Test `packages/shared/test/start.test.ts`.
**Produces:**
- `interface Seal { x0: number; z0: number; x1: number; z1: number }` — segmento en metros sobre el borde de la sala inicial (entre la casilla de dentro y la de fuera), que cubre una abertura contigua.
- `startSeals(d: Dungeon): Seal[]` — recorre el perímetro exterior del rectángulo de `d.rooms[d.startRoomId]` (casillas en x−1, x+w, z−1, z+h junto a cada casilla del borde), agrupa las casillas caminables contiguas de cada lado en un segmento. Determinista.
- `outsideStartRoom(d: Dungeon, x: number, z: number): boolean` — la casilla de (x,z) está fuera del rectángulo de la sala inicial.
- [ ] Tests: con `generateDungeon(123,1)` y otras 2 semillas: hay ≥1 sello; cada sello es horizontal o vertical, de largo múltiplo de `TILE_SIZE` y yace sobre el borde de la sala; la casilla justo fuera de cada tramo es caminable y la de dentro también; `outsideStartRoom` en el centro de la sala → false, en el centro de una casilla fuera de un sello → true.
- [ ] Implementar, `npm test`, commit `feat(shared): sellos de la sala inicial`.

### Task 2: servidor, la partida empieza al cruzar
**Files:** Modify `packages/server/src/rooms/RunState.ts` (`started: t.boolean()`), `RunRoom.ts`; Test `packages/server/test/RunRoom.test.ts`.
**Produces:** `RunState.started`; mientras `false`: `floorTime` no avanza, no corren `director.step` ni `activateRooms`, las armas del suelo no vencen (ya dependen de `floorTime`). Cada tick (fuera de la pausa), si algún conectado vivo cumple `outsideStartRoom`, `started = true` (una vez). Sala creada con `sandbox: true` → `started = true` desde el inicio. Los tests existentes que dependen del reloj/oleadas/salas deben seguir pasando: créalos con un helper que marque la sala como empezada (p. ej. `room["start"]()` o `room.state.started = true` vía método interno) o teletransportando al jugador fuera — elige lo más limpio y documenta.
- [ ] Tests: sala nueva: `started` false, tras 30 ticks `floorTime` 0 y sin enemigos aunque el jugador esté dentro; teletransportar fuera de la sala → `started` true y `floorTime` avanza; volver a entrar no lo revierte; un segundo jugador que entra después recibe `started: true`; sala sandbox empieza con `started` true.
- [ ] Implementar, `npm test`, commit `feat(server): la partida empieza al salir de la sala inicial`.

### Task 3: cliente, sellos, aviso y disolución
**Files:** Create `packages/client/src/render/sealViews.ts`; Modify `net/connection.ts` (`started` en el snapshot del mundo), `ui/compass.ts` o `ui/hud.ts` (aviso), `main.ts`; Test `packages/client/test/sealViews.test.ts`.
**Produces:** `SealViews(scene, seals)` con `setStarted(started, nowMs)`, `render(nowMs)`, `setPaused`, `dispose`; función pura `sealFade(sinceStartS): { alpha: number; lift: number }` (alfa de 0.35 → 0 en 0,8 s, `lift` 0 → 0,6 m, acotado; antes de empezar `{alpha: 0.35, lift: 0}` vía `sinceStartS < 0`). Si el primer snapshot ya llega con `started: true`, no se crean sellos (o se crean ya ocultos, sin destello). Aviso "Atraviesa el sello para comenzar" bajo la brújula mientras `started` sea false.
- [ ] Tests: `sealFade(-1)` → {0.35, 0}; `sealFade(0.4)` → alfa ≈ 0.175, lift ≈ 0.3; `sealFade(2)` → {0, 0.6}; crear/disolver/`dispose` sin mallas, partículas ni materiales sobrantes (NullEngine, como `projectileViews.test.ts`).
- [ ] Implementar, `npm test` + `tsc` + build, commit `feat(client): sellos azules de la sala inicial`.
