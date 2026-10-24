import { describe, expect, it } from "vitest";
import { PositionHistory } from "../src/sim/PositionHistory";

describe("PositionHistory", () => {
  it("guarda solo los últimos 10 ticks", () => {
    const h = new PositionHistory();
    for (let t = 0; t < 15; t++) h.record(t, [{ id: "e1", x: t, z: -t }]);
    expect(h.at(0, "e1")).toBeUndefined();
    expect(h.at(4, "e1")).toBeUndefined();
    for (let t = 5; t < 15; t++) expect(h.at(t, "e1")).toEqual({ x: t, z: -t });
  });

  it("devuelve undefined para un id desconocido y redondea el tick", () => {
    const h = new PositionHistory();
    h.record(10, [{ id: "e1", x: 1, z: 2 }]);
    expect(h.at(10, "nope")).toBeUndefined();
    expect(h.at(10.4, "e1")).toEqual({ x: 1, z: 2 });
  });
});
