import { describe, expect, it } from "vitest";
import { createRng } from "@roguelike/shared";
import { createRoomCode } from "../src/rooms/roomCode";

describe("createRoomCode", () => {
  it("genera códigos de 5 caracteres del alfabeto sin ambiguos", () => {
    const rng = createRng(42);
    for (let i = 0; i < 1000; i++) {
      expect(createRoomCode(rng)).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/);
    }
  });
});
