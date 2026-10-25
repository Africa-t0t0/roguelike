import { describe, expect, it } from "vitest";
import { parseLevelChoice } from "../src/net/connection";

describe("parseLevelChoice", () => {
  const ok = {
    offerId: 7,
    cards: [
      { kind: "ability", id: "kick", rank: 2 },
      { kind: "stat", id: "regen" },
      { kind: "stat", id: "magnet" },
    ],
    index: 1,
    total: 2,
    deadlineS: 20,
  };

  it("acepta el mensaje del servidor", () => {
    expect(parseLevelChoice(ok)).toEqual(ok);
  });

  it("descarta lo que no encaja", () => {
    expect(parseLevelChoice(null)).toBeUndefined();
    expect(parseLevelChoice({ ...ok, offerId: "7" })).toBeUndefined();
    expect(parseLevelChoice({ ...ok, cards: [] })).toBeUndefined();
    expect(parseLevelChoice({ ...ok, cards: [{ kind: "stat", id: "nope" }] })).toBeUndefined();
    expect(parseLevelChoice({ ...ok, cards: [{ kind: "ability", id: "kick", rank: 4 }] })).toBeUndefined();
    expect(parseLevelChoice({ ...ok, deadlineS: Number.NaN })).toBeUndefined();
  });
});
