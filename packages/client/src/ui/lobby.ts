import { isClassId, type ClassId } from "@roguelike/shared";

const NAME_KEY = "roguelike.name";
const CODE_KEY = "roguelike.room";
const CLASS_KEY = "roguelike.class";

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`falta #${id} en index.html`);
  return found as T;
}

export interface LobbyHandlers {
  onCreate(name: string, cls: ClassId): void;
  onJoin(name: string, code: string, cls: ClassId): void;
}

/** Lobby, código de sala en el juego y aviso de desconexión. Solo DOM; la lógica vive en main.ts. */
export class Lobby {
  private readonly lobby = el<HTMLFormElement>("lobby");
  private readonly name = el<HTMLInputElement>("name");
  private readonly code = el<HTMLInputElement>("code");
  private readonly error = el<HTMLParagraphElement>("lobby-error");
  private readonly createBtn = el<HTMLButtonElement>("create");
  private readonly joinBtn = el<HTMLButtonElement>("join");
  private readonly hud = el<HTMLDivElement>("hud");
  private readonly hudCode = el<HTMLElement>("hud-code");
  private readonly lost = el<HTMLDivElement>("lost");
  private readonly rejoin = el<HTMLButtonElement>("rejoin");
  private readonly roles = [...document.querySelectorAll<HTMLButtonElement>("#roles .role")];
  /** rol elegido: el último usado en este navegador o, si no hay, caballero */
  private cls: ClassId = isClassId(readStored(CLASS_KEY)) ? (readStored(CLASS_KEY) as ClassId) : "warrior";

  constructor(handlers: LobbyHandlers, onRejoin: () => void) {
    this.name.value = readStored(NAME_KEY);
    this.code.value = initialCode();
    for (const b of this.roles) {
      b.addEventListener("click", () => {
        if (isClassId(b.dataset.cls)) this.pickRole(b.dataset.cls);
      });
    }
    this.pickRole(this.cls);
    this.createBtn.addEventListener("click", () => {
      this.begin();
      handlers.onCreate(this.name.value, this.cls);
    });
    this.lobby.addEventListener("submit", (e) => {
      e.preventDefault(); // Enter o "Unirse"
      if (this.code.value.trim() === "") {
        this.code.focus();
        return;
      }
      this.begin();
      handlers.onJoin(this.name.value, this.code.value, this.cls);
    });
    this.rejoin.addEventListener("click", () => {
      this.rejoin.disabled = true;
      onRejoin();
    });
  }

  showLobby(error = ""): void {
    this.hud.hidden = true;
    this.lost.hidden = true;
    this.lobby.hidden = false;
    this.setBusy(false);
    this.error.textContent = error;
  }

  /** Mientras se conecta: botones desactivados para no crear dos salas. */
  setBusy(busy: boolean): void {
    this.createBtn.disabled = busy;
    this.joinBtn.disabled = busy;
  }

  showGame(roomCode: string): void {
    writeStored(CODE_KEY, roomCode);
    this.lobby.hidden = true;
    this.lost.hidden = true;
    this.hud.hidden = false;
    this.hudCode.textContent = roomCode;
  }

  showConnectionLost(): void {
    this.rejoin.disabled = false;
    this.hud.hidden = true;
    this.lost.hidden = false;
  }

  private pickRole(cls: ClassId): void {
    this.cls = cls;
    writeStored(CLASS_KEY, cls);
    for (const b of this.roles) {
      const on = b.dataset.cls === cls;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", String(on));
    }
  }

  private begin(): void {
    this.error.textContent = "";
    writeStored(NAME_KEY, this.name.value.trim());
    this.setBusy(true);
  }
}

/** `?sala=CODE` en la URL manda; si no, el último código usado en este navegador. */
function initialCode(): string {
  const fromUrl = new URLSearchParams(location.search).get("sala");
  return (fromUrl ?? readStored(CODE_KEY)).trim().toUpperCase().slice(0, 5);
}

function readStored(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // sin almacenamiento solo se pierde el recordatorio
  }
}
