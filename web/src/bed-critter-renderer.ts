import * as THREE from "three";
import { CRABS, SHRIMP } from "./config";
import type { Crab } from "./crabs";
import { add, fromAngle, mul, perpendicular, type Vec2 } from "./math";
import { tintForDepth } from "./pond-layout";
import type { Shrimp } from "./shrimp";
import { SurfaceGeometryBatch } from "./surface-geometry";

const SHADOW_COLOR = 0x0b211e;

function rotate(vector: Vec2, angle: number): Vec2 {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return { x: vector.x * cosine - vector.y * sine, y: vector.x * sine + vector.y * cosine };
}

function colorMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
}

/**
 * Crabs and shrimp on the pond bed. Drawn into the underwater image right
 * after the bed, so leaf and koi shadows pass over them and the water surface
 * ripples and tints them like everything else below it.
 */
export class BedCritterRenderer {
  public readonly group = new THREE.Group();

  private readonly crabShadowGeometry = new THREE.BufferGeometry();
  private readonly shrimpShadowGeometry = new THREE.BufferGeometry();
  private readonly underGeometry = new THREE.BufferGeometry();
  private readonly shapeGeometry = new THREE.BufferGeometry();
  private readonly overGeometry = new THREE.BufferGeometry();
  private readonly crabShadows = new SurfaceGeometryBatch(this.crabShadowGeometry, 8_192);
  private readonly shrimpShadows = new SurfaceGeometryBatch(this.shrimpShadowGeometry, 8_192);
  /** Legs and antennae, tucked under the bodies. */
  private readonly under = new SurfaceGeometryBatch(this.underGeometry, 16_384, true);
  private readonly shapes = new SurfaceGeometryBatch(this.shapeGeometry, 65_536, true);
  /** Shrimp back stripes and rostrums, on top. */
  private readonly over = new SurfaceGeometryBatch(this.overGeometry, 4_096, true);
  private readonly crabShadowMaterial = this.shadowMaterial();
  private readonly shrimpShadowMaterial = this.shadowMaterial();
  private readonly tints = Array.from({ length: 6 }, () => new THREE.Color());

  public constructor() {
    const crabShadowMesh = new THREE.Mesh(this.crabShadowGeometry, this.crabShadowMaterial);
    const shrimpShadowMesh = new THREE.Mesh(this.shrimpShadowGeometry, this.shrimpShadowMaterial);
    const underLines = new THREE.LineSegments(this.underGeometry, new THREE.LineBasicMaterial({
      vertexColors: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    }));
    const shapeMesh = new THREE.Mesh(this.shapeGeometry, colorMaterial());
    const overLines = new THREE.LineSegments(this.overGeometry, new THREE.LineBasicMaterial({
      vertexColors: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    }));
    const meshes = [crabShadowMesh, shrimpShadowMesh, underLines, shapeMesh, overLines];
    for (const [order, mesh] of meshes.entries()) {
      mesh.frustumCulled = false;
      mesh.renderOrder = 1 + order;
    }
    this.crabShadowGeometry.name = "crab shadows";
    this.shrimpShadowGeometry.name = "shrimp shadows";
    this.underGeometry.name = "crab legs and shrimp antennae";
    this.shapeGeometry.name = "crabs and shrimp";
    this.overGeometry.name = "shrimp stripes";
    this.group.add(...meshes);
  }

  public update(crabs: readonly Crab[], shrimp: readonly Shrimp[], time: number): void {
    this.crabShadowMaterial.opacity = CRABS.shadowOpacity;
    this.shrimpShadowMaterial.opacity = SHRIMP.shadowOpacity;
    for (const batch of [this.crabShadows, this.shrimpShadows, this.under, this.shapes, this.over]) batch.reset();
    for (const one of shrimp) this.drawShrimp(one);
    for (const crab of crabs) this.drawCrab(crab, time);
    for (const batch of [this.crabShadows, this.shrimpShadows, this.under, this.shapes, this.over]) batch.commit();
  }

  private shadowMaterial(): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({
      color: SHADOW_COLOR,
      transparent: true,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
  }

  private drawCrab(crab: Crab, time: number): void {
    const palette = CRABS.palettes[crab.palette % Math.max(1, CRABS.palettes.length)];
    if (!palette) return;
    const [shell, shellLight, claw, leg, eye] = this.tints;
    tintForDepth(palette.shell, CRABS.depth, shell);
    tintForDepth(palette.shellLight, CRABS.depth, shellLight);
    tintForDepth(palette.claw, CRABS.depth, claw);
    tintForDepth(palette.leg, CRABS.depth, leg);
    tintForDepth(palette.eye, CRABS.depth * 0.5, eye);

    const width = crab.shellWidth;
    const height = width * 0.72;
    const forward = fromAngle(crab.heading);
    const side = perpendicular(forward);
    const at = (along: number, across: number): Vec2 =>
      add(add(crab.position, mul(forward, along)), mul(side, across));

    this.crabShadows.ellipse(add(crab.position, { x: 0.9, y: 1.4 }), forward, side, height * 0.62, width * 0.64, undefined, 10);

    // Four walking legs a side, stepping in alternation.
    for (const direction of [-1, 1]) {
      for (let index = 0; index < 4; index += 1) {
        const swing = Math.sin(crab.legPhase * 2.2 + index * Math.PI * 0.5 + (direction > 0 ? Math.PI : 0));
        const root = at(height * (0.22 - index * 0.17), direction * width * 0.4);
        const knee = add(root, add(mul(side, direction * width * 0.3), mul(forward, swing * width * 0.07 - index * width * 0.04)));
        const foot = add(knee, add(mul(side, direction * width * 0.2), mul(forward, -width * 0.12 - index * width * 0.05 + swing * width * 0.09)));
        this.under.line(root, knee, leg);
        this.under.line(knee, foot, leg);
      }
    }

    // Claws: picking at the bed while idle; one held up while waving.
    for (const direction of [-1, 1]) {
      const pick = crab.state === "idle" ? Math.max(0, Math.sin(crab.clawPhase + (direction > 0 ? 0 : Math.PI))) : 0;
      const wave = crab.wavingClaw === direction ? crab.clawWave : 0;
      const shoulder = at(height * 0.38, direction * width * 0.3);
      const elbow = add(shoulder, add(mul(forward, width * 0.2), mul(side, direction * width * (0.14 + wave * 0.12))));
      const reach = wave * (0.1 + 0.06 * Math.sin(time * 7 + crab.phase));
      const clawCenter = add(elbow, add(
        mul(forward, width * (0.2 - pick * 0.1 + reach)),
        mul(side, direction * width * (-0.04 - pick * 0.12 + wave * 0.1)),
      ));
      const scale = 1 + wave * 0.3;
      this.under.line(shoulder, elbow, claw);
      this.under.line(elbow, clawCenter, claw);
      this.shapes.ellipse(clawCenter, forward, side, width * 0.24 * scale, width * 0.16 * scale, claw, 10);
      // The pincer's two fingers, open a little.
      for (const finger of [-1, 1]) {
        this.shapes.ellipse(
          add(clawCenter, add(mul(forward, width * 0.24 * scale), mul(side, finger * width * 0.07 * scale))),
          forward, side, width * 0.11 * scale, width * 0.05 * scale, finger === direction ? claw : leg, 6,
        );
      }
    }

    this.shapes.ellipse(crab.position, forward, side, height * 0.5, width * 0.5, shell, 14);
    this.shapes.ellipse(at(height * 0.08, 0), forward, side, height * 0.3, width * 0.32, shellLight, 10);
    for (const direction of [-1, 1]) {
      this.shapes.circle(at(height * 0.52, direction * width * 0.15), Math.max(0.4, width * 0.07), eye, 5);
    }
  }

  private drawShrimp(shrimp: Shrimp): void {
    const palette = SHRIMP.palettes[shrimp.palette % Math.max(1, SHRIMP.palettes.length)];
    if (!palette) return;
    const [body, light, stripe, antenna, eye] = this.tints;
    tintForDepth(palette.body, SHRIMP.depth, body);
    tintForDepth(palette.light, SHRIMP.depth, light);
    tintForDepth(palette.stripe, SHRIMP.depth, stripe);
    tintForDepth(palette.antenna, SHRIMP.depth, antenna);
    tintForDepth(palette.eye, SHRIMP.depth * 0.5, eye);

    const length = shrimp.bodyLength;
    const forward = fromAngle(shrimp.heading);
    const side = perpendicular(forward);
    // The tail flick folds the abdomen under, so from above the body shortens.
    const tail = 1 - shrimp.curl * 0.45;
    const at = (along: number, across: number): Vec2 =>
      add(add(shrimp.position, mul(forward, length * along)), mul(side, length * across));

    this.shrimpShadows.ellipse(add(shrimp.position, { x: 0.7, y: 1.1 }), forward, side, length * 0.45 * (0.7 + tail * 0.3), length * 0.13, undefined, 8);

    // Walking legs and long, waving antennae.
    for (const direction of [-1, 1]) {
      for (let index = 0; index < 3; index += 1) {
        const root = at(0.3 - index * 0.13, direction * 0.06);
        const foot = add(root, add(mul(side, direction * length * 0.17), mul(forward, Math.sin(shrimp.legPhase + index * 1.3) * length * 0.05)));
        this.under.line(root, foot, antenna);
      }
      const root = at(0.46, direction * 0.05);
      const sweep = Math.sin(shrimp.antennaPhase + direction + shrimp.phase) * 0.12;
      const middle = add(root, mul(rotate(forward, direction * (0.25 + sweep)), length * 0.4));
      const tip = add(middle, mul(rotate(forward, direction * (0.5 + sweep * 2)), length * 0.4));
      this.under.line(root, middle, antenna);
      this.under.line(middle, tip, antenna);
    }

    // Tail fan, abdomen segments, then the carapace over them.
    const tailEnd = at(-0.55 * tail, 0);
    this.shapes.triangle(
      tailEnd,
      add(add(tailEnd, mul(forward, -length * 0.2)), mul(side, length * 0.18)),
      add(add(tailEnd, mul(forward, -length * 0.2)), mul(side, -length * 0.18)),
      light,
    );
    const segments: [number, number, THREE.Color][] = [[-0.4, 0.095, body], [-0.24, 0.12, light], [-0.08, 0.14, body]];
    for (const [along, radius, color] of segments) {
      this.shapes.ellipse(at(along * tail, 0), forward, side, length * 0.12, length * radius, color, 8);
    }
    this.shapes.ellipse(at(0.2, 0), forward, side, length * 0.28, length * 0.17, body, 10);
    this.shapes.ellipse(at(0.24, 0), forward, side, length * 0.15, length * 0.08, light, 8);
    for (const direction of [-1, 1]) {
      this.shapes.circle(at(0.42, direction * 0.09), Math.max(0.4, length * 0.05), eye, 5);
    }
    this.over.line(at(0.36, 0), at(-0.42 * tail, 0), stripe);
    this.over.line(at(0.45, 0), at(0.6, 0), light);
  }
}
