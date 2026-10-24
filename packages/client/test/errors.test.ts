import { describe, expect, it } from "vitest";
import { ErrorCode, MatchMakeError } from "@colyseus/sdk";
import { JOIN_ERROR_STATUS } from "@roguelike/shared";
import { joinErrorMessage } from "../src/ui/errors";

describe("joinErrorMessage", () => {
  it("nombre en uso (4102)", () => {
    const err = new MatchMakeError("name-taken", JOIN_ERROR_STATUS["name-taken"]);
    expect(joinErrorMessage(err)).toBe("Ese nombre ya está en uso en esta sala");
  });

  it("sala llena (4103)", () => {
    const err = new MatchMakeError("room-full", JOIN_ERROR_STATUS["room-full"]);
    expect(joinErrorMessage(err)).toBe("La sala está llena (máximo 4)");
  });

  it("nombre inválido (4101)", () => {
    const err = new MatchMakeError("invalid-name", JOIN_ERROR_STATUS["invalid-name"]);
    expect(joinErrorMessage(err)).toBe("Nombre inválido: usa de 1 a 16 letras, números, espacios, _ o -");
  });

  it("sala inexistente (MatchMakeError de la SDK)", () => {
    const err = new MatchMakeError('room "ZZZZZ" not found', ErrorCode.MATCHMAKE_INVALID_ROOM_ID);
    expect(joinErrorMessage(err)).toBe("No existe una sala con ese código");
  });

  it("cualquier otro error", () => {
    const generic = "No se pudo conectar. Revisa tu conexión e inténtalo de nuevo";
    expect(joinErrorMessage(new TypeError("Failed to fetch"))).toBe(generic);
    expect(joinErrorMessage(new MatchMakeError("boom", 500))).toBe(generic);
    expect(joinErrorMessage(undefined)).toBe(generic);
    expect(joinErrorMessage("texto")).toBe(generic);
  });
});
