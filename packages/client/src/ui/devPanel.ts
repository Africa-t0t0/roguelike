import {
  ABILITIES,
  STAT_CARDS,
  WEAPONS,
  weaponDisplayName,
  type AbilityId,
  type CardOffer,
  type DevCommand,
  type EnemyKind,
  type Nature,
  type StatCardId,
  type WeaponId,
  type CasterTier,
  type WeaponTier,
} from "@roguelike/shared";

export const DEV_PANEL_KEY = "F2";

/** Todas las cartas de stat y cada habilidad en sus 3 rangos, con su etiqueta. */
export function devCardOptions(): { label: string; card: CardOffer }[] {
  const stats = (Object.keys(STAT_CARDS) as StatCardId[]).map((id) => ({
    label: STAT_CARDS[id].name,
    card: { kind: "stat", id } as CardOffer,
  }));
  const abilities = (Object.keys(ABILITIES) as AbilityId[]).flatMap((id) =>
    ([1, 2, 3] as const).map((rank) => ({
      label: `${ABILITIES[id].name} ${"I".repeat(rank)}`,
      card: { kind: "ability", id, rank } as CardOffer,
    })),
  );
  return [...abilities, ...stats];
}

const ENEMY_LABELS: Record<EnemyKind, string> = { minion: "Esbirro", brute: "Bruto", mage: "Mago", pyromancer: "Piromante", stormcaller: "Invocador del rayo" };
const TIER_LABELS = ["Desarmado", "Tier 1", "Tier 2", "Tier 3"];
/** Etiquetas del selector "Naturaleza" y el valor que cada una manda (la primera es "ninguna"). */
export const NATURE_LABELS = ["Sin naturaleza", "Fuego", "Hielo", "Rayo"];
const NATURES: Nature[] = ["none", "fire", "ice", "lightning"];
const STATUS_BUTTONS: { label: string; kind: "burn" | "slow" | "stun" }[] = [
  { label: "Quemarme", kind: "burn" },
  { label: "Ralentizarme", kind: "slow" },
  { label: "Aturdirme", kind: "stun" },
];

/** Lo que muestra un interruptor: "Invulnerable: sí". */
export function toggleLabel(name: string, on: boolean): string {
  return `${name}: ${on ? "sí" : "no"}`;
}

/**
 * Panel de pruebas (DOM) de una sala sandbox: se abre y cierra con F2 y suelta el puntero al abrirse. Cada
 * control manda un `DevCommand`; los interruptores recuerdan su estado aquí (el servidor no lo reenvía).
 */
export class DevPanel {
  private readonly tab = document.createElement("div");
  private readonly root = document.createElement("div");
  private open = false;
  private readonly onKey = (e: KeyboardEvent) => {
    if (e.code !== DEV_PANEL_KEY) return;
    e.preventDefault();
    this.setOpen(!this.open);
  };

  constructor(
    private readonly send: (cmd: DevCommand) => void,
    parent: HTMLElement = document.body,
  ) {
    this.tab.className = "dev-tab";
    this.tab.textContent = `${DEV_PANEL_KEY} · Pruebas`;
    this.root.className = "dev-panel";
    this.root.hidden = true;
    this.build();
    parent.append(this.tab, this.root);
    window.addEventListener("keydown", this.onKey);
  }

  private setOpen(open: boolean): void {
    this.open = open;
    this.root.hidden = !open;
    this.tab.hidden = open;
    if (open && document.pointerLockElement) document.exitPointerLock();
  }

  private build(): void {
    const level = this.section("Nivel");
    this.button(level, "+1 nivel (elegir carta)", () => ({ cmd: "levelUp", count: 1, choose: true }));
    this.button(level, "+5 niveles (sin cartas)", () => ({ cmd: "levelUp", count: 5, choose: false }));

    const cards = this.section("Cartas");
    const options = devCardOptions();
    const cardSel = this.select(cards, options.map((o) => o.label));
    this.button(cards, "Dar carta", () => ({ cmd: "card", card: options[cardSel.selectedIndex]!.card }));
    this.button(cards, "Quitar todas", () => ({ cmd: "clearCards" }));

    const me = this.section("Jugador");
    this.toggle(me, "Invulnerable", false, (on) => ({ cmd: "god", on }));
    this.toggle(me, "Sin enfriamiento", false, (on) => ({ cmd: "noCooldown", on }));
    this.button(me, "Curar y recargar", () => ({ cmd: "heal" }));
    for (const s of STATUS_BUTTONS) this.button(me, s.label, () => ({ cmd: "status", kind: s.kind }));

    const enemies = this.section("Enemigos");
    const kinds = Object.keys(ENEMY_LABELS) as EnemyKind[];
    const kindSel = this.select(enemies, kinds.map((k) => ENEMY_LABELS[k]));
    const countSel = this.select(enemies, ["1", "3", "5", "10", "20"]);
    const tierSel = this.select(enemies, TIER_LABELS);
    tierSel.selectedIndex = 1;
    const natureSel = this.select(enemies, NATURE_LABELS);
    let elite = false;
    const eliteBtn = this.button(enemies, toggleLabel("Élite", elite), () => {
      elite = !elite;
      eliteBtn.textContent = toggleLabel("Élite", elite);
      eliteBtn.classList.toggle("on", elite);
      return null; // solo cambia el interruptor; "Crear delante" lo lleva
    });
    this.button(enemies, "Crear delante", () => {
      const nature = NATURES[natureSel.selectedIndex]!;
      return {
        cmd: "spawn",
        kind: kinds[kindSel.selectedIndex]!,
        count: Number(countSel.value),
        tier: tierSel.selectedIndex as 0 | CasterTier,
        ...(elite ? { elite } : {}),
        ...(nature === "none" ? {} : { nature }),
      };
    });
    this.button(enemies, "Matar a todos", () => ({ cmd: "killAll" }));
    this.toggle(enemies, "Enemigos quietos", false, (on) => ({ cmd: "freeze", on }));
    this.button(enemies, "Hechizo ya", () => ({ cmd: "castNow" }));
    this.toggle(enemies, "Oleadas", false, (on) => ({ cmd: "waves", on }));

    const clock = this.section("Reloj del piso");
    this.button(clock, "+1 min", () => ({ cmd: "clock", seconds: 60 }));
    this.button(clock, "+5 min", () => ({ cmd: "clock", seconds: 300 }));

    const weapon = this.section("Arma");
    const weapons: { id: WeaponId; tier: WeaponTier }[] = (Object.keys(WEAPONS) as WeaponId[]).flatMap((id) =>
      ([1, 2, 3, 4] as const).map((tier) => ({ id, tier })),
    );
    const weaponSel = this.select(weapon, weapons.map((w) => weaponDisplayName(w.id, w.tier)));
    const weaponNatureSel = this.select(weapon, NATURE_LABELS);
    this.button(weapon, "Equipar", () => {
      const w = weapons[weaponSel.selectedIndex]!;
      return { cmd: "weapon", weaponId: w.id, tier: w.tier, nature: NATURES[weaponNatureSel.selectedIndex]! };
    });

    const chest = this.section("Cofres");
    this.button(chest, "Cofre delante", () => ({ cmd: "chest" }));
  }

  private section(title: string): HTMLDivElement {
    const s = document.createElement("div");
    s.className = "dev-section";
    const h = document.createElement("div");
    h.className = "dev-title";
    h.textContent = title;
    s.append(h);
    this.root.append(s);
    return s;
  }

  /** Botón que manda el comando que devuelve `cmd`; con null no manda nada (solo cambia su propio estado). */
  private button(parent: HTMLElement, label: string, cmd: () => DevCommand | null): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.addEventListener("click", () => {
      const c = cmd();
      if (c) this.send(c);
      b.blur(); // que Espacio (saltar) no lo vuelva a pulsar
    });
    parent.append(b);
    return b;
  }

  private toggle(parent: HTMLElement, name: string, initial: boolean, cmd: (on: boolean) => DevCommand): void {
    let on = initial;
    const b = this.button(parent, toggleLabel(name, on), () => {
      on = !on;
      b.textContent = toggleLabel(name, on);
      b.classList.toggle("on", on);
      return cmd(on);
    });
  }

  private select(parent: HTMLElement, labels: readonly string[]): HTMLSelectElement {
    const sel = document.createElement("select");
    for (const label of labels) sel.add(new Option(label));
    // Sin foco tras elegir: si no, WASD y las flechas cambiarían la opción mientras se juega.
    sel.addEventListener("change", () => sel.blur());
    parent.append(sel);
    return sel;
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKey);
    this.tab.remove();
    this.root.remove();
  }
}
