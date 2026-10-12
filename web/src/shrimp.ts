// Shrimp picking along the pond bed. When startled they do what real shrimp
// do: face the threat and flick their tail to shoot backward, away from it.

import { CANVAS_HEIGHT, CANVAS_WIDTH, SHRIMP } from "./config";
import { add, clamp, fromAngle, length, mul, sub, wrapAngle, type Vec2, XorShift32 } from "./math";

export type ShrimpState = "forage" | "rest" | "dart";

export interface Shrimp {
  position: Vec2;
  heading: number;
  /** Along the heading; negative while darting backward. */
  speed: number;
  bodyLength: number;
  palette: number;
  state: ShrimpState;
  stateAge: number;
  stateDuration: number;
  cruiseSpeed: number;
  turnTarget: number;
  turnTimer: number;
  /** Tail flick: the abdomen folds under the body (0..1). */
  curl: number;
  /** Seconds until a startled shrimp darts (the alarm spreads outward). */
  dartDelay: number;
  legPhase: number;
  antennaPhase: number;
  phase: number;
}

export class ShrimpSchool {
  public readonly shrimp: Shrimp[] = [];

  private readonly random = new XorShift32(0x5b1e7e57);

  public constructor() {
    this.reset();
  }

  public reset(): void {
    this.random.state = 0x5b1e7e57;
    this.shrimp.length = 0;
    this.respawn();
  }

  public respawn(): void {
    this.shrimp.length = Math.min(this.shrimp.length, SHRIMP.visibleCount);
    for (const shrimp of this.shrimp) {
      shrimp.bodyLength = clamp(shrimp.bodyLength, SHRIMP.bodyLength[0], SHRIMP.bodyLength[1]);
    }
    while (this.shrimp.length < SHRIMP.visibleCount) this.shrimp.push(this.create(this.shrimp.length));
  }

  public resize(scaleX: number, scaleY: number): void {
    for (const shrimp of this.shrimp) {
      shrimp.position.x *= scaleX;
      shrimp.position.y *= scaleY;
    }
  }

  public fleeFrom(point: Vec2): void {
    for (const shrimp of this.shrimp) {
      const toPoint = sub(point, shrimp.position);
      const distance = length(toPoint);
      if (distance > SHRIMP.fleeRadius) continue;
      // Face the threat; the dart then carries the shrimp straight away from it.
      shrimp.heading = Math.atan2(toPoint.y, toPoint.x) + this.random.range(-0.35, 0.35);
      shrimp.turnTarget = shrimp.heading;
      shrimp.dartDelay = distance / 220 + this.random.range(0, 0.08);
    }
  }

  public startle(): void {
    for (const shrimp of this.shrimp) shrimp.dartDelay = this.random.range(0, 0.25);
  }

  public update(dt: number): void {
    const margin = SHRIMP.edgeMargin;
    for (const shrimp of this.shrimp) {
      shrimp.stateAge += dt;
      if (shrimp.dartDelay >= 0) {
        shrimp.dartDelay -= dt;
        if (shrimp.dartDelay < 0) this.begin(shrimp, "dart", 0.9);
      }

      switch (shrimp.state) {
        case "forage": {
          shrimp.turnTimer -= dt;
          if (shrimp.turnTimer <= 0) {
            shrimp.turnTimer = this.random.range(0.6, 2.2);
            shrimp.turnTarget = shrimp.heading + this.random.range(-0.9, 0.9);
          }
          // Head back toward the middle when the edge gets close.
          const ahead = add(shrimp.position, mul(fromAngle(shrimp.heading), 14));
          if (ahead.x < margin || ahead.x > CANVAS_WIDTH - margin || ahead.y < margin || ahead.y > CANVAS_HEIGHT - margin) {
            shrimp.turnTarget = Math.atan2(CANVAS_HEIGHT * 0.5 - shrimp.position.y, CANVAS_WIDTH * 0.5 - shrimp.position.x);
          }
          shrimp.speed += (shrimp.cruiseSpeed - shrimp.speed) * (1 - Math.exp(-dt * 3));
          if (this.random.unit() < SHRIMP.dartChance * dt) this.begin(shrimp, "dart", 0.9);
          else if (shrimp.stateAge >= shrimp.stateDuration) this.begin(shrimp, "rest", this.randomRange(SHRIMP.restDuration));
          break;
        }
        case "rest":
          shrimp.speed *= Math.exp(-dt * 5);
          if (shrimp.stateAge >= shrimp.stateDuration) this.beginForage(shrimp);
          break;
        case "dart":
          // One hard flick, then a glide that bleeds off speed.
          shrimp.speed = -SHRIMP.dartSpeed * Math.exp(-shrimp.stateAge * 3.5);
          if (shrimp.stateAge >= shrimp.stateDuration) this.begin(shrimp, "rest", this.randomRange(SHRIMP.restDuration));
          break;
      }

      const flick = shrimp.state === "dart" ? clamp(1 - shrimp.stateAge / 0.3, 0, 1) : 0;
      shrimp.curl += (flick - shrimp.curl) * (1 - Math.exp(-dt * 30));
      const turn = wrapAngle(shrimp.turnTarget - shrimp.heading);
      shrimp.heading = wrapAngle(shrimp.heading + clamp(turn, -2 * dt, 2 * dt));
      shrimp.position = add(shrimp.position, mul(fromAngle(shrimp.heading), shrimp.speed * dt));
      shrimp.position.x = clamp(shrimp.position.x, 3, CANVAS_WIDTH - 3);
      shrimp.position.y = clamp(shrimp.position.y, 3, CANVAS_HEIGHT - 3);
      shrimp.legPhase += dt * (9 + Math.abs(shrimp.speed) * 1.5);
      shrimp.antennaPhase += dt * (shrimp.state === "rest" ? 2.4 : 1.4);
    }
  }

  private create(index: number): Shrimp {
    const margin = SHRIMP.edgeMargin + 6;
    const heading = this.random.range(-Math.PI, Math.PI);
    const shrimp: Shrimp = {
      position: {
        x: this.random.range(margin, Math.max(margin, CANVAS_WIDTH - margin)),
        y: this.random.range(margin, Math.max(margin, CANVAS_HEIGHT - margin)),
      },
      heading,
      speed: 0,
      bodyLength: this.randomRange(SHRIMP.bodyLength),
      palette: index,
      state: "rest",
      stateAge: 0,
      stateDuration: this.randomRange(SHRIMP.restDuration),
      cruiseSpeed: this.randomRange(SHRIMP.cruiseSpeed),
      turnTarget: heading,
      turnTimer: 0,
      curl: 0,
      dartDelay: -1,
      legPhase: this.random.range(0, Math.PI * 2),
      antennaPhase: this.random.range(0, Math.PI * 2),
      phase: this.random.range(0, Math.PI * 2),
    };
    return shrimp;
  }

  private beginForage(shrimp: Shrimp): void {
    this.begin(shrimp, "forage", this.randomRange(SHRIMP.forageDuration));
    shrimp.cruiseSpeed = this.randomRange(SHRIMP.cruiseSpeed);
  }

  private begin(shrimp: Shrimp, state: ShrimpState, duration: number): void {
    shrimp.state = state;
    shrimp.stateAge = 0;
    shrimp.stateDuration = duration;
  }

  private randomRange(range: readonly [number, number]): number {
    return this.random.range(range[0], range[1]);
  }
}
