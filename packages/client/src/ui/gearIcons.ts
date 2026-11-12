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

/** Tela del mago: degradados de paño índigo, forro oscuro y bordado dorado (el oro y la runa son los de `defs`). */
function clothDefs(p: string): string {
  return (
    `<defs>` +
    `<linearGradient id="${p}c" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8f86e0"/><stop offset="0.45" stop-color="#4f45a8"/><stop offset="1" stop-color="#231c55"/></linearGradient>` +
    `<linearGradient id="${p}k" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a2f78"/><stop offset="1" stop-color="#140f2c"/></linearGradient>` +
    `<linearGradient id="${p}g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe9a6"/><stop offset="0.5" stop-color="#d9a93f"/><stop offset="1" stop-color="#8a5f1a"/></linearGradient>` +
    `<linearGradient id="${p}l" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#a5764a"/><stop offset="1" stop-color="#5b3a1e"/></linearGradient>` +
    `</defs>`
  );
}
const cloth = (p: string, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" class="hud-gear-svg" aria-hidden="true">${clothDefs(p)}${body}</svg>`;

/** Capucha: paño que cae en pico, sombra honda donde va la cara, ribete dorado y dos ojos que brillan. */
const HOOD = cloth(
  "mh",
  `<path d="M24 3C14 6 8 15 8 26c0 7 2 13 5 17h22c3-4 5-10 5-17C40 15 34 6 24 3Z" fill="url(#mhc)" stroke="${OUT}" stroke-width="1.600" stroke-linejoin="round"/>` +
    `<path d="M24 12c-7 2-10 8-10 15 0 5 2 10 4 13h12c2-3 4-8 4-13 0-7-3-13-10-15Z" fill="url(#mhk)" stroke="${OUT}" stroke-width="1.200"/>` +
    `<path d="M14 27c0-7 3-13 10-15 7 2 10 8 10 15" fill="none" stroke="url(#mhg)" stroke-width="1.800"/>` +
    `<path d="M19.500 27.500h3M25.500 27.500h3" stroke="#c9a8ff" stroke-width="2" stroke-linecap="round"/>` +
    `<path d="M12 12c3-4 7-6.500 12-8" fill="none" stroke="#fff" stroke-width="1.300" stroke-linecap="round" opacity="0.55"/>` +
    `<path d="M13 43h22" stroke="url(#mhg)" stroke-width="1.600"/>`,
);

/** Túnica: mangas anchas, cuello en pico, faja central bordada y caída hasta los pies. */
const ROBE = cloth(
  "mr",
  `<path d="M17 4h14l3 4 9 5-3 12-5-2 2 21H11l2-21-5 2-3-12 9-5Z" fill="url(#mrc)" stroke="${OUT}" stroke-width="1.600" stroke-linejoin="round"/>` +
    `<path d="M17 4l7 10 7-10" fill="url(#mrk)" stroke="${OUT}" stroke-width="1.200" stroke-linejoin="round"/>` +
    `<path d="M21 14h6l1 30h-8Z" fill="url(#mrk)" opacity="0.85"/>` +
    `<path d="M21 14v30M27 14v30" stroke="url(#mrg)" stroke-width="1.400"/>` +
    `<path d="M22.500 20l1.500 2 1.500-2M22.500 27l1.500 2 1.500-2M22.500 34l1.500 2 1.500-2" fill="none" stroke="url(#mrg)" stroke-width="1"/>` +
    `<path d="M5.500 22l4.500-1.500M42.500 22 38 20.500" stroke="url(#mrg)" stroke-width="1.600" stroke-linecap="round"/>` +
    `<path d="M15 9c-2 4-2 9-1 14" fill="none" stroke="#fff" stroke-width="1.200" stroke-linecap="round" opacity="0.45"/>`,
);

/** Guantes de seda: dedos largos y finos, puño acampanado con ribete y una piedra en el dorso. */
function silkGlove(x: number, flip: boolean): string {
  const t = flip ? `translate(${x + 20} 0) scale(-1 1)` : `translate(${x} 0)`;
  return (
    `<g transform="${t}">` +
    `<path d="M4 34V14c0-2 2.600-2 2.600 0v8h.8V8c0-2.400 2.800-2.400 2.800 0v14h.8V6c0-2.400 2.800-2.400 2.800 0v16h.8V9c0-2.200 2.600-2.200 2.600 0v18l1.500-3c1-2 3.200-1 2.400 1.200L16 34Z" fill="url(#mgc)" stroke="${OUT}" stroke-width="1.300" stroke-linejoin="round"/>` +
    `<path d="M2 34h16l1 8H1Z" fill="url(#mgk)" stroke="${OUT}" stroke-width="1.200" stroke-linejoin="round"/>` +
    `<path d="M2 34h16" stroke="url(#mgg)" stroke-width="1.400"/>` +
    `<circle cx="10" cy="27" r="1.800" fill="#c9a8ff" stroke="${OUT}" stroke-width="0.7"/>` +
    `<path d="M5.500 16v12" stroke="#fff" stroke-width="1" stroke-linecap="round" opacity="0.45"/>` +
    `</g>`
  );
}
const SILK_GLOVES = cloth("mg", silkGlove(2, false) + silkGlove(26, true));

/** Fajín: banda de tela anudada con dos colas que cuelgan y flecos dorados. */
const SASH = cloth(
  "ms",
  `<path d="M2 16c8 2 15 3 22 3s14-1 22-3v12c-8 2-15 3-22 3S10 30 2 28Z" fill="url(#msc)" stroke="${OUT}" stroke-width="1.500" stroke-linejoin="round"/>` +
    `<path d="M2 19c8 2 15 3 22 3s14-1 22-3" fill="none" stroke="#fff" stroke-width="1" opacity="0.35"/>` +
    `<path d="M22 22l-6 18 4 1 5-15Z" fill="url(#msk)" stroke="${OUT}" stroke-width="1.200" stroke-linejoin="round"/>` +
    `<path d="M26 22l5 17-4 1-3-14Z" fill="url(#msc)" stroke="${OUT}" stroke-width="1.200" stroke-linejoin="round"/>` +
    `<path d="M16 40l-.5 3M18 40.500l-.5 3M27.500 40l.5 3M30 39.500l.5 3" stroke="url(#msg)" stroke-width="1.200" stroke-linecap="round"/>` +
    `<ellipse cx="24" cy="22" rx="4" ry="3.500" fill="url(#msk)" stroke="${OUT}" stroke-width="1.200"/>` +
    `<path d="M21 21.500c2-1 4-1 6 0" fill="none" stroke="url(#msg)" stroke-width="1"/>`,
);

/** Sandalias: suela de cuero y tiras de tela cruzadas sobre el empeine y el tobillo. */
function sandal(x: number, flip: boolean): string {
  const t = flip ? `translate(${x + 20} 0) scale(-1 1)` : `translate(${x} 0)`;
  return (
    `<g transform="${t}">` +
    `<path d="M3 38c0-3 2-5 5-5h7c4 0 7 2 7 5v3H3Z" fill="url(#mbl)" stroke="${OUT}" stroke-width="1.400" stroke-linejoin="round"/>` +
    `<path d="M6 10h8l1 21H6Z" fill="#e7c9a3" stroke="${OUT}" stroke-width="1.200" opacity="0.9"/>` +
    `<path d="M5 14l11 5M5 20l11 5M5 26l11 5M16 14 5 19M16 20 5 25" stroke="url(#mbc)" stroke-width="2.200" stroke-linecap="round"/>` +
    `<path d="M5 33c4-2 10-2 15 1" fill="none" stroke="url(#mbc)" stroke-width="2.400" stroke-linecap="round"/>` +
    `<circle cx="10.500" cy="12" r="1.300" fill="url(#mbg)" stroke="${OUT}" stroke-width="0.6"/>` +
    `</g>`
  );
}
const SANDALS = cloth("mb", sandal(2, false) + sandal(26, true));

const CLOTH_ICONS: Record<GearSlot, string> = { helmet: HOOD, chest: ROBE, gloves: SILK_GLOVES, belt: SASH, boots: SANDALS };

/** SVG (cadena) del icono de una ranura de equipo o de la reliquia; con `cloth`, la versión de tela del mago. */
export function gearIconSvg(slot: GearSlot | "relic", cloth = false): string {
  return cloth && slot !== "relic" ? CLOTH_ICONS[slot] : SLOT_ICONS[slot];
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
