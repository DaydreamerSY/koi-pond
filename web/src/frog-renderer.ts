import * as THREE from "three";
import { FROGS } from "./config";
import type { Frog } from "./frogs";
import { add, fromAngle, mul, perpendicular, type Vec2 } from "./math";
import { tintForDepth } from "./pond-layout";
import { SurfaceGeometryBatch } from "./surface-geometry";

const PUPIL_COLOR = 0x141210;
const SHADOW_COLOR = 0x0f2a22;

/** Frogs from above: on lotus leaves, mid-leap, or half-submerged and kicking. */
export class FrogRenderer {
  public readonly group = new THREE.Group();

  private readonly shadowGeometry = new THREE.BufferGeometry();
  private readonly shapeGeometry = new THREE.BufferGeometry();
  private readonly shadowBatch = new SurfaceGeometryBatch(this.shadowGeometry, 4_096);
  private readonly shapeBatch = new SurfaceGeometryBatch(this.shapeGeometry, 32_768, true);
  private readonly colors = Array.from({ length: 6 }, () => new THREE.Color());

  public constructor() {
    this.shadowGeometry.name = "frog shadows";
    this.shapeGeometry.name = "frogs";
    const shadowMesh = new THREE.Mesh(
      this.shadowGeometry,
      new THREE.MeshBasicMaterial({
        color: SHADOW_COLOR,
        opacity: 0.32,
        transparent: true,
        side: THREE.DoubleSide,
        // One flat color, so a single pass looks the same as three's
        // two-pass (back, then front) redraw of two-sided transparents.
        forceSinglePass: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    );
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
    // On top of lotus leaves and flowers (1–3), next to the ducks.
    shadowMesh.renderOrder = 4;
    shapeMesh.renderOrder = 5;
    this.group.add(shadowMesh, shapeMesh);
  }

  public update(frogs: readonly Frog[]): void {
    this.shadowBatch.reset();
    this.shapeBatch.reset();
    for (const frog of frogs) this.drawFrog(frog);
    this.shadowBatch.commit();
    this.shapeBatch.commit();
  }

  private drawFrog(frog: Frog): void {
    const palette = FROGS.palettes[frog.palette % Math.max(1, FROGS.palettes.length)];
    if (!palette) return;
    // Swimming frogs are half under water.
    const submerged = frog.state === "swim" ? 0.35 : 0;
    const [body, back, spot, belly, eye, pupil] = this.colors;
    tintForDepth(palette.body, submerged, body);
    tintForDepth(palette.back, submerged, back);
    tintForDepth(palette.spot, submerged, spot);
    tintForDepth(palette.belly, submerged, belly);
    tintForDepth(palette.eye, submerged * 0.5, eye);
    pupil.setHex(PUPIL_COLOR);

    // Closer to the eye mid-leap, and riding up and down with its leaf.
    const length = FROGS.bodyLength * (1 + frog.height * FROGS.hopHeight * 0.035 + frog.lift);
    const width = length * 0.74;
    const forward = fromAngle(frog.heading);
    const side = perpendicular(forward);
    const at = (along: number, across: number): Vec2 =>
      add(add(frog.position, mul(forward, length * along)), mul(side, width * across));
    const batch = this.shapeBatch;

    if (frog.state !== "swim") {
      const lift = 0.25 + frog.height * FROGS.hopHeight * 0.18;
      this.shadowBatch.ellipse(
        add(frog.position, { x: 1.4 * lift + 0.5, y: 2.2 * lift + 0.8 }),
        forward, side, length * 0.5, width * 0.5, undefined, 10,
      );
    }

    // Back legs: folded while sitting, stretched back on a kick or a leap.
    const stretch = frog.state === "swim"
      ? Math.max(0, Math.sin(frog.kickPhase))
      : frog.height;
    for (const direction of [-1, 1]) {
      const thigh = at(-0.18 - stretch * 0.32, direction * (0.44 - stretch * 0.16));
      batch.ellipse(thigh, forward, side, length * (0.28 + stretch * 0.12), width * 0.15, body, 8);
      const foot = at(0.02 - stretch * 0.86, direction * (0.62 - stretch * 0.34));
      batch.triangle(
        add(foot, mul(forward, length * 0.12)),
        add(foot, mul(side, direction * width * 0.2)),
        add(foot, mul(side, -direction * width * 0.08)),
        body,
      );
      batch.ellipse(at(0.26, direction * 0.42), forward, side, length * 0.1, width * 0.08, body, 6);
    }

    // The throat sac puffs out in front of the chin while croaking.
    if (frog.croak > 0.02) batch.circle(at(0.44, 0), width * 0.34 * frog.croak, belly, 10);

    batch.ellipse(frog.position, forward, side, length * 0.5, width * 0.5, body, 14);
    batch.ellipse(at(-0.05, 0), forward, side, length * 0.36, width * 0.32, back, 12);
    batch.circle(at(-0.12, 0.14), width * 0.08, spot, 6);
    batch.circle(at(0.06, -0.18), width * 0.07, spot, 6);
    batch.circle(at(-0.28, -0.06), width * 0.07, spot, 6);
    for (const direction of [-1, 1]) {
      const eyeCenter = at(0.3, direction * 0.33);
      batch.circle(eyeCenter, width * 0.17, eye, 8);
      batch.circle(add(eyeCenter, mul(forward, width * 0.03)), width * 0.08, pupil, 6);
    }
  }
}
