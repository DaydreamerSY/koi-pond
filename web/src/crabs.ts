// Crabs on the pond bed: they walk sideways, pick at the bottom with their
// claws, now and then wave one, and scuttle off when something lands nearby.

import { CANVAS_HEIGHT, CANVAS_WIDTH, CRABS } from "./config";
import { add, clamp, fromAngle, length, mul, normalize, perpendicular, sub, wrapAngle, type Vec2, XorShift32 } from "./math";

export type CrabState = "idle" | "walk" | "turn" | "flee";

export interface Crab {
  position: Vec2;
  /** The way the claws point. Crabs walk along the perpendicular. */
  heading: number;
  /** −1 or 1: which side the crab walks toward. */
  walkDirection: number;
  speed: number;
  walkSpeed: number;
  shellWidth: number;
  palette: number;
  state: CrabState;
  stateAge: number;
  stateDuration: number;
  turnTarget: number;
  legPhase: number;
  /** Claws picking food from the bed. */
  clawPhase: number;
  /** How high the waving claw is raised (0..1). */
  clawWave: number;
  wavingClaw: number;
  waveTimer: number;
  phase: number;
}

export class Crabs {
  public readonly crabs: Crab[] = [];

  private readonly random = new XorShift32(0xc4ab5eed);

  public constructor() {
    this.reset();
  }

  public reset(): void {
    this.random.state = 0xc4ab5eed;
    this.crabs.length = 0;
    this.respawn();
  }

  /** Matches the crab count to the settings; existing crabs keep their place. */
  public respawn(): void {
    this.crabs.length = Math.min(this.crabs.length, CRABS.visibleCount);
    for (const crab of this.crabs) {
      crab.shellWidth = clamp(crab.shellWidth, CRABS.shellWidth[0], CRABS.shellWidth[1]);
    }
    while (this.crabs.length < CRABS.visibleCount) this.crabs.push(this.create(this.crabs.length));
  }

  public resize(scaleX: number, scaleY: number): void {
    for (const crab of this.crabs) {
      crab.position.x *= scaleX;
      crab.position.y *= scaleY;
    }
  }

  /** Crabs near the point scuttle sideways, away from it. */
  public fleeFrom(point: Vec2): void {
    for (const crab of this.crabs) {
      const away = sub(crab.position, point);
      if (length(away) > CRABS.fleeRadius) continue;
      this.flee(crab, normalize(away, fromAngle(crab.heading + Math.PI / 2)));
    }
  }

  public startle(): void {
    for (const crab of this.crabs) this.flee(crab, fromAngle(this.random.range(0, Math.PI * 2)));
  }

  public update(dt: number): void {
    for (const crab of this.crabs) {
      crab.stateAge += dt;
      let targetSpeed = 0;
      let legActivity = 0;

      switch (crab.state) {
        case "idle":
          crab.clawPhase += dt * 3.2;
          crab.waveTimer -= dt;
          if (crab.waveTimer <= 0) {
            crab.waveTimer = this.random.range(1.5, 4);
            if (this.random.unit() < CRABS.clawWaveChance) crab.wavingClaw = this.random.unit() < 0.5 ? -1 : 1;
            else crab.wavingClaw = 0;
          }
          if (crab.stateAge >= crab.stateDuration) {
            if (this.random.unit() < 0.65) this.beginWalk(crab);
            else this.begin(crab, "turn", 1.2, crab.heading + this.random.range(-1.2, 1.2));
          }
          break;
        case "walk":
          targetSpeed = crab.walkSpeed;
          if (crab.stateAge >= crab.stateDuration) this.beginIdle(crab);
          break;
        case "turn":
          legActivity = 5;
          if (crab.stateAge >= crab.stateDuration) this.beginIdle(crab);
          break;
        case "flee":
          targetSpeed = CRABS.fleeSpeed;
          if (crab.stateAge >= crab.stateDuration) this.beginIdle(crab);
          break;
      }

      if (crab.state !== "idle") crab.wavingClaw = 0;
      const turn = wrapAngle(crab.turnTarget - crab.heading);
      crab.heading = wrapAngle(crab.heading + clamp(turn, -1.6 * dt, 1.6 * dt));
      crab.speed += (targetSpeed - crab.speed) * (1 - Math.exp(-dt * 7));
      crab.clawWave += ((crab.wavingClaw !== 0 ? 1 : 0) - crab.clawWave) * (1 - Math.exp(-dt * 5));

      const side = perpendicular(fromAngle(crab.heading));
      const next = add(crab.position, mul(side, crab.walkDirection * crab.speed * dt));
      const margin = CRABS.edgeMargin;
      if (next.x < margin || next.x > CANVAS_WIDTH - margin || next.y < margin || next.y > CANVAS_HEIGHT - margin) {
        // Back off the edge the other way.
        crab.walkDirection *= -1;
      } else {
        crab.position = next;
      }
      crab.position.x = clamp(crab.position.x, 2, CANVAS_WIDTH - 2);
      crab.position.y = clamp(crab.position.y, 2, CANVAS_HEIGHT - 2);
      crab.legPhase += dt * (crab.speed * 2.4 + legActivity);
    }
  }

  private create(index: number): Crab {
    const margin = CRABS.edgeMargin + 6;
    const heading = this.random.range(-Math.PI, Math.PI);
    const crab: Crab = {
      position: {
        x: this.random.range(margin, Math.max(margin, CANVAS_WIDTH - margin)),
        y: this.random.range(margin, Math.max(margin, CANVAS_HEIGHT - margin)),
      },
      heading,
      walkDirection: this.random.unit() < 0.5 ? -1 : 1,
      speed: 0,
      walkSpeed: 0,
      shellWidth: this.random.range(CRABS.shellWidth[0], CRABS.shellWidth[1]),
      palette: index,
      state: "idle",
      stateAge: 0,
      stateDuration: 0,
      turnTarget: heading,
      legPhase: this.random.range(0, Math.PI * 2),
      clawPhase: this.random.range(0, Math.PI * 2),
      clawWave: 0,
      wavingClaw: 0,
      waveTimer: this.random.range(0, 3),
      phase: this.random.range(0, Math.PI * 2),
    };
    this.beginIdle(crab);
    crab.stateAge = this.random.unit() * crab.stateDuration;
    return crab;
  }

  private beginIdle(crab: Crab): void {
    this.begin(crab, "idle", this.random.range(CRABS.idleDuration[0], CRABS.idleDuration[1]), crab.heading);
  }

  private beginWalk(crab: Crab): void {
    this.begin(crab, "walk", this.random.range(CRABS.walkDuration[0], CRABS.walkDuration[1]), crab.heading);
    crab.walkSpeed = this.random.range(CRABS.walkSpeed[0], CRABS.walkSpeed[1]);
    if (this.random.unit() < 0.4) crab.walkDirection *= -1;
  }

  private flee(crab: Crab, away: Vec2): void {
    const side = perpendicular(fromAngle(crab.heading));
    crab.walkDirection = side.x * away.x + side.y * away.y >= 0 ? 1 : -1;
    // Square up so the scuttle points straight away from the threat.
    const angle = Math.atan2(away.y, away.x) - crab.walkDirection * Math.PI / 2;
    this.begin(crab, "flee", this.random.range(1.1, 1.9), angle);
  }

  private begin(crab: Crab, state: CrabState, duration: number, turnTarget: number): void {
    crab.state = state;
    crab.stateAge = 0;
    crab.stateDuration = duration;
    crab.turnTarget = turnTarget;
  }
}
