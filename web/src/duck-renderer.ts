import * as THREE from "three";
import { DUCKS, type DuckPaletteSetting } from "./config";
import { duckSize, type Duck } from "./ducks";
import { add, fromAngle, mul, perpendicular, type Vec2 } from "./math";
import { tintForDepth } from "./pond-layout";
import { SurfaceGeometryBatch } from "./surface-geometry";

const EYE_COLOR = 0x161412;

/** Rotates a unit vector by `angle` radians. */
function rotate(vector: Vec2, angle: number): Vec2 {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return { x: vector.x * cosine - vector.y * sine, y: vector.x * sine + vector.y * cosine };
}

/**
 * Ducks seen from above, drawn on the water surface. Like lotus leaves, they
 * float, so their shadow falls on the pond bed (`shadowGroup` goes in the
 * underwater shadow scene).
 */
export class DuckRenderer {
  public readonly shadowGroup = new THREE.Group();
  public readonly group = new THREE.Group();

  private readonly shadowGeometry = new THREE.BufferGeometry();
  private readonly shapeGeometry = new THREE.BufferGeometry();
  private readonly shadowBatch = new SurfaceGeometryBatch(this.shadowGeometry, 8_192);
  private readonly shapeBatch = new SurfaceGeometryBatch(this.shapeGeometry, 65_536, true);
  private readonly shadowMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    // One flat color, so a single pass looks the same as three's
    // two-pass (back, then front) redraw of two-sided transparents.
    forceSinglePass: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
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
    const shadowMesh = new THREE.Mesh(this.shadowGeometry, this.shadowMaterial);
    const shapeMesh = new THREE.Mesh(
      this.shapeGeometry,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    shadowMesh.frustumCulled = false;
    shapeMesh.frustumCulled = false;
    shadowMesh.renderOrder = 2;
    // Above lotus leaves and flowers (1–3), below butterflies (10).
    shapeMesh.renderOrder = 6;
    this.shadowGroup.add(shadowMesh);
    this.group.add(shapeMesh);
  }

  public update(ducks: readonly Duck[], time: number): void {
    this.shadowMaterial.color.setHex(DUCKS.shadow.color);
    this.shadowMaterial.opacity = DUCKS.shadow.opacity;
    this.shadowBatch.reset();
    this.shapeBatch.reset();
    for (const duck of ducks) this.drawDuck(duck, time);
    this.shadowBatch.commit();
    this.shapeBatch.commit();
  }

  private setColors(source: Omit<DuckPaletteSetting, "name">, headDip: number): void {
    const c = this.colors;
    c.body.setHex(source.body);
    c.wing.setHex(source.wing);
    c.accent.setHex(source.accent);
    c.neck.setHex(source.neck);
    c.beak.setHex(source.beak);
    c.tail.setHex(source.tail);
    c.eye.setHex(EYE_COLOR);
    // The feet are always underwater; the head is while dabbling.
    tintForDepth(source.feet, 0.55, c.feet);
    tintForDepth(source.head, headDip * 0.75, c.head);
    if (headDip > 0) tintForDepth(source.beak, headDip * 0.75, c.beak);
  }

  private drawDuck(duck: Duck, time: number): void {
    const palette = duck.duckling
      ? DUCKS.ducklingPalette
      : DUCKS.palettes[duck.palette % Math.max(1, DUCKS.palettes.length)];
    if (!palette) return;
    this.setColors(palette, duck.headDip);
    const c = this.colors;
    const batch = this.shapeBatch;

    const { length, width } = duckSize(duck);
    const forward = fromAngle(duck.heading);
    const side = perpendicular(forward);
    const at = (along: number, across: number): Vec2 =>
      add(add(duck.position, mul(forward, length * along)), mul(side, width * across));

    // Shadow on the pond bed.
    const shadowCenter = add(duck.position, DUCKS.shadow.offset);
    this.shadowBatch.ellipse(shadowCenter, forward, side, length * 0.56, width * 0.52, undefined, 12);

    // Paddling feet, seen through the water.
    for (const direction of [-1, 1]) {
      const stroke = Math.sin(duck.paddlePhase + (direction > 0 ? Math.PI : 0));
      const heel = at(-0.18 + stroke * 0.1, direction * 0.26);
      const toe = add(heel, mul(rotate(forward, Math.PI + direction * 0.5), length * 0.16));
      batch.triangle(heel, add(toe, mul(side, direction * width * 0.14)), add(toe, mul(side, -direction * width * 0.1)), c.feet);
    }

    // Wings spread while flapping off in a hurry.
    if (duck.flap > 0.02) {
      const beat = 0.55 + 0.45 * Math.abs(Math.sin(time * 17 + duck.phase));
      for (const direction of [-1, 1]) {
        const reach = 0.45 + duck.flap * beat * 0.65;
        batch.ellipse(at(-0.02, direction * reach), forward, side, length * 0.24, width * (0.18 + duck.flap * beat * 0.3), c.wing, 10);
      }
    }

    // Tail, body, and folded wings.
    batch.triangle(at(-0.36, 0.26), at(-0.66, 0), at(-0.36, -0.26), c.tail);
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
