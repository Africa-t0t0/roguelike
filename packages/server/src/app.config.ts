import { existsSync, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import config from "@colyseus/tools";
import { defineRoom } from "colyseus";
import { RunRoom } from "./rooms/RunRoom";

// Relativo a este archivo (no al CWD): packages/server/src -> packages/client/dist.
const CLIENT_DIST = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../client/dist");

// No hay @types/express en el proyecto: tipos mínimos de lo que usamos.
interface Req {
  method: string;
  path: string;
}
interface Res {
  status(code: number): Res;
  send(body: string): void;
  sendFile(path: string, options: { root: string }): void;
}
type Next = () => void;

export const appConfig = config({
  rooms: {
    run: defineRoom(RunRoom),
  },
  initializeExpress: (app) => {
    app.get("/health", (_req: Req, res: Res) => {
      res.status(200).send("ok");
    });

    // Cliente compilado: solo en producción. En desarrollo lo sirve Vite (puerto 5173), y un
    // dist viejo en :2567 mezclaría dos versiones del generador de mazmorras.
    if (process.env.NODE_ENV !== "production") return;
    if (!existsSync(join(CLIENT_DIST, "index.html"))) return;
    app.use((req: Req, res: Res, next: Next) => {
      // Las rutas de Colyseus (/matchmake, etc.) no se tocan.
      if ((req.method !== "GET" && req.method !== "HEAD") || req.path.startsWith("/matchmake")) return next();
      let rel: string;
      try {
        rel = decodeURIComponent(req.path);
      } catch {
        return next();
      }
      const file = resolve(CLIENT_DIST, "." + rel);
      if (file !== CLIENT_DIST && !file.startsWith(CLIENT_DIST + sep)) return next();
      if (existsSync(file) && statSync(file).isFile()) {
        return void res.sendFile(file.slice(CLIENT_DIST.length + 1), { root: CLIENT_DIST });
      }
      // Fallback SPA solo para rutas sin extensión; un asset inexistente es un 404 real.
      if (extname(rel) === "") return void res.sendFile("index.html", { root: CLIENT_DIST });
      next();
    });
  },
});
