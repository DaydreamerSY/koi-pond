import * as THREE from "three";
import { DUCKS, type DuckPaletteSetting } from "./config";
import { duckSize, tailWag, type Duck } from "./ducks";
import { add, fromAngle, mul, perpendicular, sub, type Vec2 } from "./math";
import { tintForDepth } from "./pond-layout";
import { mergeShadows } from "./shadows";
import { SurfaceGeometryBatch } from "./surface-geometry";

const EYE_COLOR = 0x161412;

/** Rotates a unit vector by `angle` radians. */
function rotate(vector: Vec2, angle: number): Vec2 {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return { x: vector.x * cosine - vector.y * sine, y: vector.x * sine + vector.y * cosine };
}

/** A diving duck this far under is drawn below the water, with the koi. */
const UNDERWATER = 0.5;

/**
 * Ducks seen from above, drawn on the water surface. Like lotus leaves, they
 * float, so their shadow falls on the pond bed (`shadowGroup` goes in the
 * underwater shadow scene). A diving duck darkens as it sinks and, once
 * under, is drawn below the water like a koi (`underwaterGroup` goes in the
 * underwater fish scene), seen through the ripples and currents.
 */
export class DuckRenderer {
  public readonly shadowGroup = new THREE.Group();
  public readonly group = new THREE.Group();
  public readonly underwaterGroup = new THREE.Group();

  private readonly shadowGeometry = new THREE.BufferGeometry();
  private readonly shapeGeometry = new THREE.BufferGeometry();
  private readonly underwaterGeometry = new THREE.BufferGeometry();
  private readonly shadowBatch = new SurfaceGeometryBatch(this.shadowGeometry, 8_192);
  private readonly shapeBatch = new SurfaceGeometryBatch(this.shapeGeometry, 65_536, true);
  private readonly underwaterBatch = new SurfaceGeometryBatch(this.underwaterGeometry, 16_384, true);
  private readonly shadowMaterial = mergeShadows(new THREE.MeshBasicMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    // One flat color, so a single pass looks the same as three's
    // two-pass (back, then front) redraw of two-sided transparents.
    forceSinglePass: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  }));
  private readonly colors = {
    body: new THREE.Color(),
    wing: new THREE.Color(),
    accent: new THREE.Color(),
    head: new THREE.Color(),
    neck: new THREE.Color(),
    beak: new THREE.Color(),
    feet: new THREE.Color(),
    tail: new THREE.Color(),
    eye: new THREE.Color(),
  };

  public constructor() {
    this.shadowGeometry.name = "duck shadows";
    this.shapeGeometry.name = "ducks";
    this.underwaterGeometry.name = "diving ducks";
    const shapeMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const shadowMesh = new THREE.Mesh(this.shadowGeometry, this.shadowMaterial);
    const shapeMesh = new THREE.Mesh(this.shapeGeometry, shapeMaterial);
    const underwaterMesh = new THREE.Mesh(this.underwaterGeometry, shapeMaterial);
    shadowMesh.frustumCulled = false;
    shapeMesh.frustumCulled = false;
    underwaterMesh.frustumCulled = false;
    shadowMesh.renderOrder = 2;
    // Above lotus leaves and flowers (1–3), below butterflies (10).
    shapeMesh.renderOrder = 6;
    // Below the koi (1–3): a diving duck stays fairly deep.
    underwaterMesh.renderOrder = 0;
    this.shadowGroup.add(shadowMesh);
    this.group.add(shapeMesh);
    this.underwaterGroup.add(underwaterMesh);
  }

  public update(ducks: readonly Duck[], time: number): void {
    this.shadowMaterial.color.setHex(DUCKS.shadow.color);
    this.shadowMaterial.opacity = DUCKS.shadow.opacity;
    this.shadowBatch.reset();
    this.shapeBatch.reset();
    this.underwaterBatch.reset();
    // Feet are underwater, below every duck; ducklings go under the adults.
    for (const duck of ducks) this.drawFeet(duck);
    for (const duck of ducks) if (duck.duckling) this.drawDuck(duck, time);
    for (const duck of ducks) if (!duck.duckling) this.drawDuck(duck, time);
    this.shadowBatch.commit();
    this.shapeBatch.commit();
    this.underwaterBatch.commit();
  }

  private paletteOf(duck: Duck): Omit<DuckPaletteSetting, "name"> | undefined {
    return duck.duckling ? DUCKS.ducklingPalette : DUCKS.palettes[duck.palette % Math.max(1, DUCKS.palettes.length)];
  }

  /** Paddling feet, seen through the water. */
  private drawFeet(duck: Duck): void {
    const palette = this.paletteOf(duck);
    if (!palette || duck.submerged > 0.3) return;
    const feet = tintForDepth(palette.feet, 0.55, this.colors.feet);
    const { length, width } = duckSize(duck);
    const forward = fromAngle(duck.heading);
    const side = perpendicular(forward);
    for (const direction of [-1, 1]) {
      const stroke = Math.sin(duck.paddlePhase + (direction > 0 ? Math.PI : 0));
      const heel = add(add(duck.position, mul(forward, length * (-0.18 + stroke * 0.1))), mul(side, width * direction * 0.26));
      const toe = add(heel, mul(rotate(forward, Math.PI + direction * 0.5), length * 0.16));
      this.shapeBatch.triangle(heel, add(toe, mul(side, direction * width * 0.14)), add(toe, mul(side, -direction * width * 0.1)), feet);
    }
  }

  private setColors(source: Omit<DuckPaletteSetting, "name">, headDip: number, submerged: number): void {
    const c = this.colors;
    // Sinking on a dive, the whole duck darkens with the water's tint, as a
    // koi does going deep.
    const under = submerged * 0.85;
    tintForDepth(source.body, under, c.body);
    tintForDepth(source.wing, under, c.wing);
    tintForDepth(source.accent, under, c.accent);
    tintForDepth(source.neck, under, c.neck);
    tintForDepth(source.tail, under, c.tail);
    tintForDepth(EYE_COLOR, under, c.eye);
    // The head is underwater while dabbling.
    tintForDepth(source.head, Math.max(headDip * 0.75, under), c.head);
    tintForDepth(source.beak, Math.max(headDip * 0.75, under), c.beak);
  }

  private drawDuck(duck: Duck, time: number): void {
    const palette = this.paletteOf(duck);
    if (!palette) return;
    this.setColors(palette, duck.headDip, duck.submerged);
    const c = this.colors;
    const batch = duck.submerged >= UNDERWATER ? this.underwaterBatch : this.shapeBatch;

    const size = duckSize(duck);
    // A little smaller the deeper it goes.
    const shrink = 1 - duck.submerged * 0.2;
    const length = size.length * shrink;
    const width = size.width * shrink;
    const forward = fromAngle(duck.heading);
    const side = perpendicular(forward);
    const at = (along: number, across: number): Vec2 =>
      add(add(duck.position, mul(forward, length * along)), mul(side, width * across));

    // Shadow on the pond bed, closer under the duck as it dives toward it.
    const shadowCenter = add(duck.position, mul(DUCKS.shadow.offset, 1 - duck.submerged * 0.45));
    this.shadowBatch.ellipse(shadowCenter, forward, side, length * 0.56, width * 0.52, undefined, 12);

    // Wings spread while flapping off in a hurry.
    if (duck.flap > 0.02) {
      const beat = 0.55 + 0.45 * Math.abs(Math.sin(time * 17 + duck.phase));
      for (const direction of [-1, 1]) {
        const reach = 0.45 + duck.flap * beat * 0.65;
        batch.ellipse(at(-0.02, direction * reach), forward, side, length * 0.24, width * (0.18 + duck.flap * beat * 0.3), c.wing, 10);
      }
    }

    // Tail (its tip swings side to side in a waggle), body, and folded wings.
    const wag = tailWag(duck);
    const tailRoot = at(-0.36, 0);
    const tailTip = add(tailRoot, mul(rotate(forward, Math.PI + wag), length * 0.3));
    const tailSide = mul(rotate(side, wag * 0.4), width * 0.26);
    batch.triangle(add(tailRoot, tailSide), tailTip, sub(tailRoot, tailSide), c.tail);
    batch.ellipse(duck.position, forward, side, length * 0.5, width * 0.5, c.body, 14);
    for (const direction of [-1, 1]) {
      batch.ellipse(at(-0.12, direction * 0.2), forward, side, length * 0.32, width * 0.22, c.wing, 10);
      batch.ellipse(at(-0.14, direction * 0.33), forward, side, length * 0.1, width * 0.07, c.accent, 6);
    }

    // Neck and head, turned while preening and tipped under while dabbling.
    const headDirection = rotate(forward, duck.headTurn * 1.7);
    const headSide = perpendicular(headDirection);
    const headRadius = width * (duck.duckling ? 0.42 : 0.36) * (1 - duck.headDip * 0.3);
    const neckBase = at(0.26, 0);
    const headCenter = add(neckBase, mul(headDirection, length * (0.15 + duck.headDip * 0.08)));
    batch.circle(add(neckBase, mul(headDirection, length * 0.07)), headRadius * 1.02, c.neck, 10);
    batch.circle(headCenter, headRadius, c.head, 10);
    batch.ellipse(add(headCenter, mul(headDirection, headRadius * 1.05)), headDirection, headSide, length * 0.1, headRadius * 0.5, c.beak, 8);
    if (duck.headDip < 0.5) {
      for (const direction of [-1, 1]) {
        batch.circle(
          add(add(headCenter, mul(headDirection, headRadius * 0.25)), mul(headSide, direction * headRadius * 0.62)),
          Math.max(0.4, headRadius * 0.16),
          c.eye,
          5,
        );
      }
    }
  }
}
