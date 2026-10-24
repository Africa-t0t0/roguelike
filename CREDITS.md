# Créditos

KayKit: Adventurers Character Pack, Skeletons Character Pack y Dungeon Remastered, de Kay Lousberg
(www.kaylousberg.com), licencia CC0.

- <https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0>
- <https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Skeletons-1.0>
- <https://github.com/KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0>

Los archivos están en `packages/client/public/assets/kaykit/` y se obtienen con `node scripts/fetch-kaykit.mjs`.

## Personajes, animaciones y armas (`packages/client/public/assets/mixamo/`)

Se generan con `node scripts/assets/build-mixamo.mjs` (ver la sección "Assets" del README). Solo se versionan los GLB
que usa el juego; los FBX y los packs completos de Mixamo no se redistribuyen.

- **Kingslayer Assassin - Dark Fantasy**, de Pigcraft, licencia CC BY 4.0 (<https://creativecommons.org/licenses/by/4.0/>):
  <https://sketchfab.com/3d-models/kingslayer-assassin-dark-fantasy-6f4480e40a084355bdb660ffe4532c46>.
  Modificado: reducido a 20k triángulos, sin espada (la espada se separó en `weapons/kingslayer-sword.glb`) y
  con rig de Mixamo (`characters/kingslayer.glb`).
- **Mixamo**, de Adobe (<https://www.mixamo.com>): los personajes Warrok W Kurniawan (`characters/brute.glb`),
  Ch25 (`characters/minion.glb`) y Maw J Laygo (`characters/mage.glb`), el rig del Kingslayer y todas las
  animaciones de `anims/` (packs Sword and Shield, Great Sword, Creature y Magic Spell). Uso según las
  condiciones de Mixamo: incluidos en el juego, no se redistribuyen por separado.
- **Medieval Weapons Pack**, de Quaternius (<https://quaternius.com/packs/medievalweapons.html>), licencia CC0:
  `Sword.glb` → `weapons/guard-sword.glb` y `Claymore.glb` → `weapons/great-sword.glb`, recentrados y orientados.
  Descargados de <https://github.com/trebeljahr/quaternius-showcase>.
