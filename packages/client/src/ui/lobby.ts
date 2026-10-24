const NAME_KEY = "roguelike.name";

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`falta #${id} en index.html`);
  return found as T;
}

export interface LobbyHandlers {
  onCreate(name: string): void;
  onJoin(name: string, code: string): void;
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

  constructor(handlers: LobbyHandlers, onRejoin: () => void) {
    this.name.value = readName();
    this.createBtn.addEventListener("click", () => {
      this.begin();
      handlers.onCreate(this.name.value);
    });
    this.lobby.addEventListener("submit", (e) => {
      e.preventDefault(); // Enter o "Unirse"
      if (this.code.value.trim() === "") {
        this.code.focus();
        return;
      }
      this.begin();
      handlers.onJoin(this.name.value, this.code.value);
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

  private begin(): void {
    this.error.textContent = "";
    writeName(this.name.value.trim());
    this.setBusy(true);
  }
}

function readName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // sin almacenamiento solo se pierde el recordatorio del nombre
  }
}
