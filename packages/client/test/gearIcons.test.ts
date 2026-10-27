import { describe, expect, it } from "vitest";
import { gearIconSvg, gearTileBackground, tierGlowRgb } from "../src/ui/gearIcons";

describe("gearIcons", () => {
  it("cada ranura y la reliquia tienen un SVG propio y bien formado", () => {
    const slots = ["helmet", "chest", "gloves", "belt", "boots", "relic"] as const;
    const all = slots.map(gearIconSvg);
    for (const s of all) {
      expect(s.startsWith("<svg")).toBe(true);
      expect(s.endsWith("</svg>")).toBe(true);
      expect(s).not.toContain("<image");
      expect(s).not.toContain("http://www.w3.org/1999/xlink");
    }
    expect(new Set(all).size).toBe(6);
  });

  it("los ids de degradado no se repiten entre iconos", () => {
    const ids = (["helmet", "chest", "gloves", "belt", "boots", "relic"] as const).flatMap((s) => [...gearIconSvg(s).matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("el fondo depende del tier: azul, violeta, dorado y marrón", () => {
    expect(tierGlowRgb(2)[2]).toBeGreaterThan(tierGlowRgb(2)[0]);
    expect(tierGlowRgb(3)[2]).toBeGreaterThan(tierGlowRgb(3)[1]);
    expect(tierGlowRgb(4)[0]).toBeGreaterThan(tierGlowRgb(4)[2]);
    expect(tierGlowRgb(1)).toEqual([120, 92, 62]);
    expect(gearTileBackground(2)).not.toBe(gearTileBackground(3));
    expect(gearTileBackground(null)).toContain("#0e0c09");
    expect(gearTileBackground("relic")).toContain("radial-gradient");
  });
});
