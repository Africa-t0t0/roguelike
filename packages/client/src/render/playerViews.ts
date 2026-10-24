import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCapsule } from "@babylonjs/core/Meshes/Builders/capsuleBuilder";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { PLAYER_RADIUS } from "@roguelike/shared";

const BODY_HEIGHT = 1.8;
const LABEL_W = 2;
const LABEL_H = 0.5;

interface PlayerView {
  root: TransformNode;
  dispose(): void;
}

function bodyMaterial(scene: Scene, name: string, color: Color3): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = color;
  m.specularColor = new Color3(0.1, 0.1, 0.1);
  return m;
}

function createLabel(scene: Scene, key: string, text: string, parent: TransformNode): Mesh {
  const tex = new DynamicTexture(`label-${key}`, { width: 512, height: 128 }, scene, false);
  tex.hasAlpha = true;
  tex.drawText(text, null, 88, "bold 72px system-ui, sans-serif", "white", "transparent", true);
  const mat = new StandardMaterial(`labelMat-${key}`, scene);
  mat.diffuseTexture = tex;
  mat.emissiveColor = Color3.White();
  mat.disableLighting = true;
  mat.backFaceCulling = false;
  mat.useAlphaFromDiffuseTexture = true;

  const plane = CreatePlane(`labelPlane-${key}`, { width: LABEL_W, height: LABEL_H }, scene);
  plane.material = mat;
  plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
  plane.parent = parent;
  plane.position.y = BODY_HEIGHT + 0.4;
  return plane;
}

/** Una cápsula con nombre por jugador; el propio en otro color. */
export class PlayerViews {
  private readonly views = new Map<string, PlayerView>();
  private readonly mine: StandardMaterial;
  private readonly others: StandardMaterial;

  constructor(
    private readonly scene: Scene,
    private readonly myKey: string,
  ) {
    this.mine = bodyMaterial(scene, "playerMine", new Color3(0.95, 0.65, 0.2));
    this.others = bodyMaterial(scene, "playerOther", new Color3(0.3, 0.6, 0.95));
  }

  /** Crea las vistas de los que entraron y destruye las de los que salieron. */
  sync(players: Map<string, { name: string }>): void {
    for (const [key, p] of players) {
      if (!this.views.has(key)) this.views.set(key, this.create(key, p.name));
    }
    for (const [key, view] of this.views) {
      if (!players.has(key)) {
        view.dispose();
        this.views.delete(key);
      }
    }
  }

  place(key: string, x: number, y: number, z: number, facing: number): void {
    const view = this.views.get(key);
    if (!view) return;
    view.root.position.set(x, y, z);
    view.root.rotation.y = facing;
  }

  dispose(): void {
    for (const view of this.views.values()) view.dispose();
    this.views.clear();
  }

  private create(key: string, name: string): PlayerView {
    const scene = this.scene;
    const root = new TransformNode(`player-${key}`, scene);
    const material = key === this.myKey ? this.mine : this.others;

    const body = CreateCapsule(`body-${key}`, { height: BODY_HEIGHT, radius: PLAYER_RADIUS }, scene);
    body.material = material;
    body.parent = root;
    body.position.y = BODY_HEIGHT / 2;

    // Una "nariz" hacia +Z local para ver hacia dónde mira.
    const nose = CreateBox(`nose-${key}`, { width: 0.2, height: 0.2, depth: 0.3 }, scene);
    nose.material = material;
    nose.parent = root;
    nose.position.set(0, BODY_HEIGHT * 0.75, PLAYER_RADIUS + 0.1);

    const label = createLabel(scene, key, name, root);
    return {
      root,
      dispose() {
        label.material?.getActiveTextures().forEach((t) => t.dispose());
        label.material?.dispose();
        root.dispose();
      },
    };
  }
}
