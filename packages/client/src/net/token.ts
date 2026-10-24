export interface TokenCrypto {
  randomUUID?: () => string;
  getRandomValues<T extends ArrayBufferView>(array: T): T;
}

/** `crypto.randomUUID` solo existe en contextos seguros (https/localhost); por http en la LAN hay que caer a getRandomValues. */
export function generateToken(c: TokenCrypto = crypto): string {
  if (typeof c.randomUUID === "function") return c.randomUUID();
  const bytes = c.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
