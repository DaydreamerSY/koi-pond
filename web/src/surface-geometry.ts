import * as THREE from "three";
import { CANVAS_HEIGHT, CANVAS_WIDTH } from "./config";
import { unitCircle } from "./math";

export interface SurfacePoint {
  x: number;
  y: number;
}

const DEFAULT_COLOR = new THREE.Color(0xffffff);

export class SurfaceGeometryBatch {
  // Reused for the rim points of circles and ellipses; point() copies them.
  private readonly rimA: SurfacePoint = { x: 0, y: 0 };
  private readonly rimB: SurfacePoint = { x: 0, y: 0 };

  private readonly positions: Float32Array;
  private readonly positionAttribute: THREE.BufferAttribute;
  private readonly colors?: Float32Array;
  private readonly colorAttribute?: THREE.BufferAttribute;
  private cursor = 0;

  public constructor(
    private readonly geometry: THREE.BufferGeometry,
    capacity: number,
    includeColors = false,
  ) {
    this.positions = new Float32Array(capacity);
    this.positionAttribute = new THREE.BufferAttribute(this.positions, 3);
    this.positionAttribute.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute("position", this.positionAttribute);
    this.geometry.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(CANVAS_WIDTH * 0.5, CANVAS_HEIGHT * 0.5, 0),
      Math.hypot(CANVAS_WIDTH, CANVAS_HEIGHT),
    );

    if (includeColors) {
      this.colors = new Float32Array(capacity);
      this.colorAttribute = new THREE.BufferAttribute(this.colors, 3);
      this.colorAttribute.setUsage(THREE.DynamicDrawUsage);
      this.geometry.setAttribute("color", this.colorAttribute);
    }
  }

  public reset(): void {
    this.cursor = 0;
  }

  public point(point: SurfacePoint, color: THREE.Color = DEFAULT_COLOR): void {
    if (this.cursor + 3 > this.positions.length) return;
    this.positions[this.cursor] = point.x;
    this.positions[this.cursor + 1] = point.y;
    this.positions[this.cursor + 2] = 0;
    if (this.colors) {
      this.colors[this.cursor] = color.r;
      this.colors[this.cursor + 1] = color.g;
      this.colors[this.cursor + 2] = color.b;
    }
    this.cursor += 3;
  }

  public triangle(
    a: SurfacePoint,
    b: SurfacePoint,
    c: SurfacePoint,
    color: THREE.Color = DEFAULT_COLOR,
  ): void {
    this.point(a, color);
    this.point(b, color);
    this.point(c, color);
  }

  public line(
    a: SurfacePoint,
    b: SurfacePoint,
    color: THREE.Color = DEFAULT_COLOR,
  ): void {
    this.point(a, color);
    this.point(b, color);
  }

  public circle(
    center: SurfacePoint,
    radius: number,
    color: THREE.Color = DEFAULT_COLOR,
    segments = 8,
  ): void {
    const unit = unitCircle(segments);
    let a = this.rimA;
    let b = this.rimB;
    a.x = center.x + unit[0] * radius;
    a.y = center.y + unit[1] * radius;
    for (let index = 0; index < segments; index += 1) {
      b.x = center.x + unit[index * 2 + 2] * radius;
      b.y = center.y + unit[index * 2 + 3] * radius;
      this.triangle(center, a, b, color);
      const next = a;
      a = b;
      b = next;
    }
  }

  /** An ellipse whose radii follow the given (unit) forward and side axes. */
  public ellipse(
    center: SurfacePoint,
    forward: SurfacePoint,
    side: SurfacePoint,
    forwardRadius: number,
    sideRadius: number,
    color: THREE.Color = DEFAULT_COLOR,
    segments = 10,
  ): void {
    const unit = unitCircle(segments);
    const pointAt = (index: number, point: SurfacePoint): void => {
      const cos = unit[index * 2];
      const sin = unit[index * 2 + 1];
      point.x = center.x + forward.x * cos * forwardRadius + side.x * sin * sideRadius;
      point.y = center.y + forward.y * cos * forwardRadius + side.y * sin * sideRadius;
    };
    let a = this.rimA;
    let b = this.rimB;
    pointAt(0, a);
    for (let index = 0; index < segments; index += 1) {
      pointAt(index + 1, b);
      this.triangle(center, a, b, color);
      const next = a;
      a = b;
      b = next;
    }
  }

  public commit(): void {
    this.geometry.setDrawRange(0, this.cursor / 3);
    this.positionAttribute.clearUpdateRanges();
    this.positionAttribute.addUpdateRange(0, this.cursor);
    this.positionAttribute.needsUpdate = true;
    if (this.colorAttribute) {
      this.colorAttribute.clearUpdateRanges();
      this.colorAttribute.addUpdateRange(0, this.cursor);
      this.colorAttribute.needsUpdate = true;
    }
  }
}
