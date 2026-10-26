import { describe, expect, it } from "vitest";
import { parseHazard } from "../src/net/connection";

const zona = { kind: "zone", x: 1, z: 2, dirX: 0, dirZ: 1, length: 0, size: 3, left: 1.5, total: 2, phase: "warn" } as const;

describe("parseHazard", () => {
  it("acepta una zona válida", () => {
    expect(parseHazard({ ...zona })).toEqual(zona);
  });
  it("descarta un kind desconocido", () => {
    expect(parseHazard({ ...zona, kind: "laser" })).toBeNull();
  });
  it("descarta números no finitos", () => {
    expect(parseHazard({ ...zona, left: NaN })).toBeNull();
  });
  it("descarta una fase desconocida", () => {
    expect(parseHazard({ ...zona, phase: "boom" })).toBeNull();
  });
});
