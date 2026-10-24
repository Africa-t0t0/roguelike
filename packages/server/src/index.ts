import { listen } from "colyseus";
import { appConfig } from "./app.config";

const PORT = Number(process.env.PORT ?? 2567);

await listen(appConfig, PORT);
