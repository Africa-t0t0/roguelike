import { describe, expect, it } from "vitest";
import { generateDungeon, tileCenter, type KinematicState } from "@roguelike/shared";
import { sandboxSpawnSpots } from "../src/rooms/sandbox";

describe("sandboxSpawnSpots", () => {
  it("con minDistM ningún punto queda más cerca del jugador, mire a donde mire", () => {
    const d = generateDungeon(7, 1);
    const room = d.rooms.find((r) => r.id === d.startRoomId)!;
    const c = tileCenter(room.x + Math.floor(room.w / 2), room.z + Math.floor(room.h / 2));
    for (let i = 0; i < 8; i++) {
      const k = { x: c.x, z: c.z, facing: (i * Math.PI) / 4 } as KinematicState;
      const [spot] = sandboxSpawnSpots(d, k, 1, 4, 2.5);
      expect(spot).toBeDefined();
      expect(Math.hypot(spot!.x - k.x, spot!.z - k.z)).toBeGreaterThanOrEqual(2.5);
    }
  });
});
