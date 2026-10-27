import { TIERS, type GearSlot, type WeaponTier } from "@roguelike/shared";

/**
 * Iconos vectoriales del equipo (SVG en línea, sin imágenes ni fuentes): acero con degradados, luces, contornos
 * oscuros y remaches. Todas las cadenas son constantes del código (nada viene de la red), así que se pueden
 * insertar con innerHTML. viewBox 48x48; legibles a ~44 px.
 */

const OUT = "#14110d";

/** Degradados de acero y de oro compartidos; los ids llevan prefijo por icono para no chocar en el DOM. */
function defs(p: string): string {
  return (
    `<defs>` +
    `<linearGradient id="${p}s" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f4f7fa"/><stop offset="0.35" stop-color="#b8c2cc"/><stop offset="0.7" stop-color="#6d7783"/><stop offset="1" stop-color="#363d46"/></linearGradient>` +
    `<linearGradient id="${p}d" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8f9aa6"/><stop offset="0.5" stop-color="#4b535d"/><stop offset="1" stop-color="#2a3037"/></linearGradient>` +
    `<linearGradient id="${p}g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe9a6"/><stop offset="0.5" stop-color="#d9a93f"/><stop offset="1" stop-color="#8a5f1a"/></linearGradient>` +
    `<radialGradient id="${p}r" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#fff" stop-opacity="0.95"/><stop offset="0.35" stop-color="#d9a8ff" stop-opacity="0.9"/><stop offset="1" stop-color="#8a3dff" stop-opacity="0"/></radialGradient>` +
    `</defs>`
  );
}

const svg = (p: string, body: string): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" class="hud-gear-svg" aria-hidden="true">${defs(p)}${body}</svg>`;
const rivet = (x: number, y: number): string => `<circle cx="${x}" cy="${y}" r="0.9" fill="#e8edf2" stroke="${OUT}" stroke-width="0.4"/>`;

/** Yelmo cerrado: cúpula, cresta central, visera con ranuras y remaches. */
const HELMET = svg(
  "gh",
  `<path d="M24 3C14 3 9 11 9 21v18l5 5h20l5-5V21C39 11 34 3 24 3Z" fill="url(#ghs)" stroke="${OUT}" stroke-width="1.6" stroke-linejoin="round"/>` +
    `<path d="M24 3c-4 4-4.500 12-4.500 22V44h9V25C28.500 15 28 7 24 3Z" fill="url(#ghd)" opacity="0.55"/>` +
    `<path d="M12 9c3-4 7-5.500 12-5.500" fill="none" stroke="#fff" stroke-width="1.4" stroke-linecap="round" opacity="0.85"/>` +
    `<path d="M9.500 20h29v4h-29Z" fill="#2c3239" stroke="${OUT}" stroke-width="1.2"/>` +
    `<path d="M12 21.200h10M26 21.200h10" stroke="#0a0908" stroke-width="2.200" stroke-linecap="round"/>` +
    `<path d="M11 28h26M13 33h22M15 38h18" stroke="${OUT}" stroke-width="1" opacity="0.6"/>` +
    `<path d="M20 28.500h1.500M20 32.500h1.500M26.500 28.500H28M26.500 32.500H28" stroke="#0a0908" stroke-width="1.800" stroke-linecap="round"/>` +
    rivet(12, 15) + rivet(36, 15) + rivet(12, 42) + rivet(36, 42)
);

/** Peto de placas: hombreras, escote, esternón y bandas con remaches. */
const CHEST = svg(
  "gc",
  `<path d="M3 13c0-3 3-6 8-7l6-2c1 3 3.500 4.500 7 4.500S30 7 31 4l6 2c5 1 8 4 8 7v6c0 3-2 4-4.500 4H38v4l-2 12c-1 3-3 4-6 4H18c-3 0-5-1-6-4L10 29v-4H7.500C5 25 3 24 3 21Z" fill="url(#gcs)" stroke="${OUT}" stroke-width="1.600" stroke-linejoin="round"/>` +
    `<path d="M17 4c1 3 3.500 4.500 7 4.500S30 7 31 4" fill="#1d2127" stroke="${OUT}" stroke-width="1.200"/>` +
    `<path d="M24 9v35" stroke="${OUT}" stroke-width="1.200" opacity="0.7"/>` +
    `<path d="M24 9c-6 1-11 4-13 9 3 3 8 4 13 4Z" fill="#fff" opacity="0.28"/>` +
    `<path d="M11 24c4 1.500 9 2 13 2s9-.5 13-2M12 31c4 1.500 8 2 12 2s8-.5 12-2" fill="none" stroke="${OUT}" stroke-width="1.100" opacity="0.7"/>` +
    `<path d="M7 14c0 3 2 5 6 5M41 14c0 3-2 5-6 5" fill="none" stroke="${OUT}" stroke-width="1.100"/>` +
    `<path d="M20 36h8l-1 5h-6Z" fill="url(#gcg)" stroke="${OUT}" stroke-width="0.9"/>` +
    rivet(10, 12) + rivet(38, 12) + rivet(16, 25) + rivet(32, 25) + rivet(15, 32) + rivet(33, 32)
);

/** Dos guanteletes de placas: puño, nudillos con dedos segmentados y puño de manga. */
function gauntlet(x: number, flip: boolean): string {
  const t = flip ? `translate(${x + 20} 0) scale(-1 1)` : `translate(${x} 0)`;
  return (
    `<g transform="${t}">` +
    `<path d="M2 36l2-10V14c0-2 3-2 3 0v8h1V9c0-2.800 3.200-2.800 3.200 0v13h1V7c0-2.800 3.200-2.800 3.200 0v15h1V10c0-2.600 3-2.600 3 0v18l1.500-4c1-2 3.500-1 2.500 1.500L17 32l-1 8H4Z" fill="url(#ggs)" stroke="${OUT}" stroke-width="1.400" stroke-linejoin="round"/>` +
    `<path d="M4 15h3M8.500 12h3M12.500 10h3M4 20h3M8.500 18h3M12.500 17h3" stroke="${OUT}" stroke-width="0.9" opacity="0.7"/>` +
    `<path d="M3 36h14l-.5 4.500H3.500Z" fill="url(#ggd)" stroke="${OUT}" stroke-width="1.200"/>` +
    `<path d="M4.500 38h1M9 38h1M13.500 38h1" stroke="#e8edf2" stroke-width="1" stroke-linecap="round"/>` +
    `<path d="M5 26l5 1.500" stroke="#fff" stroke-width="1.200" stroke-linecap="round" opacity="0.6"/>` +
    `</g>`
  );
}
const GLOVES = svg("gg", gauntlet(2, false) + gauntlet(26, true));

/** Cinturón de cuero: correa con costuras, hebilla metálica con aguja y dos bolsitas con remaches. */
const BELT = svg(
  "gl",
  `<path d="M2 17h44v14H2Z" fill="#6b4423" stroke="${OUT}" stroke-width="1.600" stroke-linejoin="round"/>` +
    `<path d="M2 20h44" stroke="#9a6a3c" stroke-width="1.400" opacity="0.8"/>` +
    `<path d="M2 28.500h44" stroke="#3a2412" stroke-width="1.200" opacity="0.7"/>` +
    `<path d="M3 22.500h42" stroke="#d8b27a" stroke-width="0.9" stroke-dasharray="2 1.800" opacity="0.75"/>` +
    `<path d="M3 26h42" stroke="#d8b27a" stroke-width="0.9" stroke-dasharray="2 1.800" opacity="0.75"/>` +
    `<rect x="6" y="31" width="9" height="8" rx="1.500" fill="#7d5230" stroke="${OUT}" stroke-width="1.200"/>` +
    `<rect x="33" y="31" width="9" height="8" rx="1.500" fill="#7d5230" stroke="${OUT}" stroke-width="1.200"/>` +
    `<path d="M6.500 33.500h8M33.500 33.500h8" stroke="${OUT}" stroke-width="0.9" opacity="0.6"/>` +
    `<rect x="15" y="12" width="18" height="24" rx="3" fill="url(#gls)" stroke="${OUT}" stroke-width="1.700" stroke-linejoin="round"/>` +
    `<rect x="19.500" y="17" width="9" height="14" rx="1.500" fill="#2c3239" stroke="${OUT}" stroke-width="1.200"/>` +
    `<path d="M24 19v10" stroke="url(#glg)" stroke-width="2.600" stroke-linecap="round"/>` +
    `<path d="M17 14.500c3-1.500 8-1.500 12-.5" fill="none" stroke="#fff" stroke-width="1.300" stroke-linecap="round" opacity="0.8"/>` +
    rivet(17.500, 34) + rivet(30.500, 34) + rivet(10, 24) + rivet(38, 24)
);

/** Dos grebas/botas de placas: caña con rodillera, empeine articulado y puntera. */
function boot(x: number, flip: boolean): string {
  const t = flip ? `translate(${x + 20} 0) scale(-1 1)` : `translate(${x} 0)`;
  return (
    `<g transform="${t}">` +
    `<path d="M5 5h10l1 22 5 6c2 2 3 4 3 6v3H3v-6c0-1 .5-2 1-3Z" fill="url(#gbs)" stroke="${OUT}" stroke-width="1.500" stroke-linejoin="round"/>` +
    `<path d="M4 12h12M4.500 18h11.500" stroke="${OUT}" stroke-width="1" opacity="0.65"/>` +
    `<path d="M6 7v18" stroke="#fff" stroke-width="1.300" stroke-linecap="round" opacity="0.6"/>` +
    `<path d="M3 38h21v3H3Z" fill="url(#gbd)" stroke="${OUT}" stroke-width="1.200"/>` +
    `<path d="M17 32l5 4M13 30l7 5" stroke="${OUT}" stroke-width="1" opacity="0.7"/>` +
    `<path d="M3 23c4-2.500 8-2.500 12 0l-.5 4c-3.500-1.500-7-1.500-10.500 0Z" fill="url(#gbg)" stroke="${OUT}" stroke-width="1"/>` +
    rivet(7, 9) + rivet(12, 9) +
    `</g>`
  );
}
const BOOTS = svg("gb", boot(2, false) + boot(26, true));

/** Cáliz dorado con una runa violeta brillante en la copa. */
const RELIC = svg(
  "gr",
  `<circle cx="24" cy="18" r="13" fill="url(#grr)"/>` +
    `<path d="M9 7h30c0 8-3 15-8 18-2 1-4 1.500-5 2.500v6c0 1 1 2 3 3l3 2.500v3H13v-3l3-2.500c2-1 3-2 3-3v-6c-1-1-3-1.500-5-2.500C12 22 9 15 9 7Z" fill="url(#grg)" stroke="${OUT}" stroke-width="1.600" stroke-linejoin="round"/>` +
    `<path d="M9 7h30" stroke="#fff3c4" stroke-width="2" stroke-linecap="round"/>` +
    `<path d="M12 9c.5 5 2 9 5 12" fill="none" stroke="#fff" stroke-width="1.300" stroke-linecap="round" opacity="0.65"/>` +
    `<ellipse cx="24" cy="31" rx="3.500" ry="1.800" fill="#fff0b8" stroke="${OUT}" stroke-width="0.9"/>` +
    `<path d="M16 41h16" stroke="${OUT}" stroke-width="1" opacity="0.6"/>` +
    `<path d="M24 8.500v13M20 12.500l4 3 4-3M20 17.500l4-3 4 3" fill="none" stroke="#e6c8ff" stroke-width="2.600" stroke-linecap="round" stroke-linejoin="round" opacity="0.55"/>` +
    `<path d="M24 8.500v13M20 12.500l4 3 4-3M20 17.500l4-3 4 3" fill="none" stroke="#fff" stroke-width="1.200" stroke-linecap="round" stroke-linejoin="round"/>` +
    rivet(15, 43) + rivet(33, 43)
);

const SLOT_ICONS: Record<GearSlot | "relic", string> = { helmet: HELMET, chest: CHEST, gloves: GLOVES, belt: BELT, boots: BOOTS, relic: RELIC };

/** SVG (cadena) del icono de una ranura de equipo o de la reliquia. */
export function gearIconSvg(slot: GearSlot | "relic"): string {
  return SLOT_ICONS[slot];
}

/** Color base del halo de cada tier (oxidado: marrón apagado); el resto sale del brillo del tier. */
export function tierGlowRgb(tier: WeaponTier): [number, number, number] {
  const g = TIERS[tier].glow;
  if (!g) return [120, 92, 62];
  return [Math.round(g[0] * 255), Math.round(g[1] * 255), Math.round(g[2] * 255)];
}

/** Fondo del rombo: halo radial teñido por el tier (o violeta-dorado para la reliquia); apagado si no hay nada puesto. */
export function gearTileBackground(tier: WeaponTier | "relic" | null): string {
  if (tier === null) return "radial-gradient(circle at 50% 50%, #1c1813 0%, #0e0c09 100%)";
  if (tier === "relic") return "radial-gradient(circle at 50% 50%, rgba(214, 170, 255, 0.85) 0%, rgba(130, 70, 210, 0.6) 45%, rgba(110, 80, 20, 0.5) 80%, #120d08 100%)";
  const [r, g, b] = tierGlowRgb(tier);
  return `radial-gradient(circle at 50% 50%, rgba(${r}, ${g}, ${b}, 0.85) 0%, rgba(${r}, ${g}, ${b}, 0.45) 55%, #120d08 100%)`;
}
