import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, type Rng } from "@roguelike/shared";

/** Código de sala legible: `ROOM_CODE_LENGTH` caracteres de `ROOM_CODE_ALPHABET` (sin 0/O, 1/I/L). */
export function createRoomCode(rng: Rng): string {
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET[rng.int(0, ROOM_CODE_ALPHABET.length - 1)];
  }
  return code;
}
