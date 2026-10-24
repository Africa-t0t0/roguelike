import config from "@colyseus/tools";
import { defineRoom } from "colyseus";
import { RunRoom } from "./rooms/RunRoom";

export const appConfig = config({
  rooms: {
    run: defineRoom(RunRoom),
  },
});
