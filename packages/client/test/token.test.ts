import { describe, expect, it } from "vitest";
import { generateToken } from "../src/net/token";

describe("generateToken", () => {
  it("usa randomUUID si existe", () => {
    expect(generateToken({ randomUUID: () => "uuid", getRandomValues: (a) => a })).toBe("uuid");
  });

  it("sin randomUUID (http no seguro) cae a getRandomValues: 32 caracteres hex", () => {
    const fake = {
      getRandomValues: <T extends ArrayBufferView>(a: T): T => {
        (a as unknown as Uint8Array).forEach((_, i, arr) => (arr[i] = i * 17));
        return a;
      },
    };
    const token = generateToken(fake);
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    expect(token).toBe("00112233445566778899aabbccddeeff");
  });
});
