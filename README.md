# Roguelike co-op

Prototipo de roguelike cooperativo en 3D para el navegador (Babylon.js + Colyseus). Hasta 4 jugadores
recorren la misma mazmorra; el servidor es autoritativo y el cliente predice su propio movimiento.

## Estructura

- `packages/shared`: constantes, RNG con semilla, generador de mazmorras, movimiento y protocolo. Lo usan
  cliente y servidor.
- `packages/server`: sala `run` de Colyseus (puerto 2567).
- `packages/client`: cliente web con Vite (puerto 5173).

## Instalar

Requiere Node 24 o más nuevo.

```sh
npm install
```

## Jugar en desarrollo

```sh
npm run dev
```

Levanta el servidor (`ws://localhost:2567`) y el cliente. Abre <http://localhost:5173>, escribe tu nombre y
pulsa **Crear sala**. El código de la sala aparece arriba a la derecha: compártelo para que otros entren
con **Unirse**.

Controles: haz clic en el juego para mirar con el mouse (Esc suelta el puntero), WASD para caminar y
Espacio para esquivar.

## Probar con varias pestañas

- Cada pestaña del mismo navegador comparte el token guardado en `localStorage`. Si entras con el **mismo
  nombre** en otra pestaña, esa pestaña toma el control del personaje y la anterior vuelve al lobby con
  "Abriste el juego en otra pestaña". Recargar (F5) y volver a entrar con tu nombre recupera tu personaje.
- Para tener dos jugadores en el mismo navegador usa **nombres distintos** (por ejemplo "Ana" en una pestaña
  y "Beto" en otra). Para simular otra computadora, usa una ventana privada o un perfil distinto: ahí el
  token es otro, así que un nombre ya usado en la sala aparece como "en uso".

## Simular una mala conexión

Agrega parámetros a la URL del cliente:

| Parámetro | Qué hace | Ejemplo |
| --- | --- | --- |
| `lag` | Latencia de ida y vuelta en ms (la mitad en cada dirección) | `?lag=150` |
| `jitter` | Variación aleatoria de la latencia, en ms | `?lag=150&jitter=30` |
| `loss` | Fracción de inputs enviados que se pierden (máximo 0,5) | `?loss=0.05` |

Por ejemplo: <http://localhost:5173/?lag=150&jitter=30>. Tu propio movimiento debe seguir siendo inmediato;
el de los demás se ve fluido, con un poco de atraso.

## Tests y verificación

```sh
npm test          # tests de todos los paquetes (Vitest)
npm run typecheck # TypeScript en todos los paquetes
npm run build     # compila el cliente en packages/client/dist
```

## Jugar desde el build de producción

```sh
npm run build && npm start   # sirve el cliente y el WebSocket en http://localhost:2567
```

## Desplegar (Fly.io)

El servidor entrega el cliente compilado y el WebSocket desde el mismo origen, así que basta una sola app.
Necesitas una cuenta en Fly.io (con método de pago) y `flyctl` instalado (<https://fly.io/docs/flyctl/install/>).

```sh
fly auth login
fly launch --no-deploy --copy-config   # usa el fly.toml del repo
fly deploy --ha=false
fly scale count 1
```

- `--ha=false` evita que el primer despliegue cree dos máquinas.
- Si `roguelike-coop` ya está tomado, `fly launch` te pedirá otro nombre: elige uno único (también puedes
  cambiar `app` en `fly.toml`).
- **Debe haber exactamente una máquina.** Las runs viven en la memoria del proceso: con dos máquinas, los
  jugadores de una misma sala podrían caer en servidores distintos, y si la máquina se apaga se pierde la
  run. Por eso `fly.toml` fija `min_machines_running = 1` y `auto_stop_machines = "off"`; `fly scale count 1`
  lo asegura.
- La región `scl` (Santiago) es un supuesto; cámbiala en `fly.toml` (`primary_region`) si hay otra más cercana.
- El chequeo de salud es `GET /health`. La URL pública queda en `https://<app>.fly.dev`.
- Para verificar: entra con tu computadora y con otra persona (o un celular con datos móviles, fuera de tu
  Wi-Fi) a la misma sala y comprueben que se ven moverse.
