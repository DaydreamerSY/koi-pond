// Frogs live on the lotus leaves: they sit and croak, leap from leaf to leaf,
// or plop into the water and kick their way back to a leaf.

import { CANVAS_HEIGHT, CANVAS_WIDTH, FROGS } from "./config";
import { add, clamp, fromAngle, length, lerp, mul, normalize, sub, wrapAngle, type Vec2, XorShift32 } from "./math";
import type { LotusMotion } from "./lotus-motion";
import type { LeafCircle } from "./pond-layout";
import type { RippleSystem } from "./ripple-system";

export type FrogState = "sit" | "hop" | "swim";

export interface Frog {
  state: FrogState;
  stateAge: number;
  stateDuration: number;
  /** Leaf the frog sits on, is leaping to, or swims toward (−1: none). */
  leaf: number;
  /** Where on the leaf it sits, relative to the leaf's center. */
  seat: Vec2;
  position: Vec2;
  heading: number;
  hopFrom: Vec2;
  /** Leap destination in open water (used when `leaf` is −1). */
  hopTo: Vec2;
  /** Height of the leap arc (0..1). */
  height: number;
  /** Throat sac while croaking (0..1). */
  croak: number;
  croakTime: number;
  /** How high its leaf is riding (the frog rides with it). */
  lift: number;
  kickPhase: number;
  wakeCountdown: number;
  palette: number;
  phase: number;
}

export class Frogs {
  public readonly frogs: Frog[] = [];

  private readonly random = new XorShift32(0xf2066f20);
  public constructor(private readonly lotus: LotusMotion) {
    this.reset();
  }

  public reset(): void {
    this.random.state = 0xf2066f20;
    this.frogs.length = 0;
    this.respawn();
  }

  public respawn(): void {
    this.frogs.length = Math.min(this.frogs.length, FROGS.visibleCount);
    while (this.frogs.length < FROGS.visibleCount) this.frogs.push(this.create(this.frogs.length));
  }

  public resize(scaleX: number, scaleY: number): void {
    for (const frog of this.frogs) {
      frog.position.x *= scaleX;
      frog.position.y *= scaleY;
      frog.hopFrom.x *= scaleX;
      frog.hopFrom.y *= scaleY;
      frog.hopTo.x *= scaleX;
      frog.hopTo.y *= scaleY;
    }
  }

  /** Frogs sitting near the point leap into the water, away from it. */
  public startleFrom(point: Vec2): void {
    for (const frog of this.frogs) {
      if (frog.state !== "sit") continue;
      const away = sub(frog.position, point);
      if (length(away) > FROGS.startleRadius) continue;
      this.leapIntoWater(frog, normalize(away, fromAngle(frog.heading)));
    }
  }

  public startle(): void {
    for (const frog of this.frogs) {
      if (frog.state === "sit") this.leapIntoWater(frog, fromAngle(this.random.range(0, Math.PI * 2)));
    }
  }

  public update(dt: number, ripples: RippleSystem): void {
    for (const frog of this.frogs) {
      frog.stateAge += dt;
      if (frog.leaf >= this.leaves.length) frog.leaf = -1;
      switch (frog.state) {
        case "sit":
          this.sit(frog, dt);
          break;
        case "hop":
          this.hop(frog, ripples);
          break;
        case "swim":
          this.swim(frog, dt, ripples);
          break;
      }
    }
  }

  // ---- states ------------------------------------------------------------------

  private sit(frog: Frog, dt: number): void {
    const leaf = this.lotus.leaves[frog.leaf];
    frog.lift = leaf?.lift ?? 0;
    // The frog rides the leaf: it moves and scales with it.
    if (leaf) frog.position = add(leaf, mul(frog.seat, 1 + frog.lift));
    frog.height = 0;

    // A croak: the throat sac puffs three times.
    if (frog.croakTime > 0) {
      frog.croakTime = Math.max(0, frog.croakTime - dt);
      frog.croak = Math.max(0, Math.sin((1.6 - frog.croakTime) * Math.PI * 1.9));
    } else {
      frog.croak = 0;
      if (this.random.unit() < FROGS.croakChance * 0.12 * dt) frog.croakTime = 1.6;
    }

    if (frog.stateAge < frog.stateDuration || frog.croakTime > 0) return;
    const nextLeaf = this.random.unit() < FROGS.swimChance ? -1 : this.pickLeaf(frog, FROGS.hopRange);
    if (nextLeaf >= 0) {
      this.leapTo(frog, nextLeaf);
    } else {
      const angle = frog.heading + this.random.range(-1.2, 1.2);
      this.leapIntoWater(frog, fromAngle(angle));
    }
  }

  private hop(frog: Frog, ripples: RippleSystem): void {
    const t = clamp(frog.stateAge / frog.stateDuration, 0, 1);
    const leaf = this.leaves[frog.leaf];
    const to = leaf ? add(leaf, frog.seat) : frog.hopTo;
    frog.position = lerp(frog.hopFrom, to, t);
    frog.height = Math.sin(t * Math.PI);
    if (t < 1) return;

    frog.height = 0;
    if (leaf) {
      // The leaf dips under the frog's weight, then bobs back.
      this.lotus.bump(frog.leaf);
      this.begin(frog, "sit", this.randomRange(FROGS.sitDuration));
    } else {
      // Plop.
      ripples.trigger("touch", frog.position);
      this.begin(frog, "swim", 30);
      frog.leaf = this.pickLeaf(frog, Infinity);
    }
  }

  private swim(frog: Frog, dt: number, ripples: RippleSystem): void {
    const leaf = this.leaves[frog.leaf];
    frog.kickPhase += dt * 4.2;
    if (!leaf) {
      // No leaves to return to: float where it is.
      if (frog.stateAge > 2) frog.leaf = this.pickLeaf(frog, Infinity);
      return;
    }
    const toLeaf = sub(leaf, frog.position);
    const distance = length(toLeaf);
    const desired = Math.atan2(toLeaf.y, toLeaf.x);
    frog.heading = wrapAngle(frog.heading + clamp(wrapAngle(desired - frog.heading), -2.5 * dt, 2.5 * dt));
    // Frogs swim in strokes: a strong kick, then a glide.
    const stroke = 0.25 + 0.75 * Math.max(0, Math.sin(frog.kickPhase));
    frog.position = add(frog.position, mul(fromAngle(frog.heading), FROGS.swimSpeed * stroke * dt));
    frog.position.x = clamp(frog.position.x, 3, CANVAS_WIDTH - 3);
    frog.position.y = clamp(frog.position.y, 3, CANVAS_HEIGHT - 3);

    frog.wakeCountdown -= dt;
    if (frog.wakeCountdown <= 0) {
      frog.wakeCountdown = Math.PI * 2 / 4.2;
      ripples.trigger("wake", sub(frog.position, mul(fromAngle(frog.heading), FROGS.bodyLength * 0.6)));
    }

    // At the leaf's edge: climb on with a little hop.
    if (distance < leaf.radius + FROGS.bodyLength * 0.4) {
      frog.seat = this.seatOn(leaf, sub(frog.position, leaf));
      this.begin(frog, "hop", FROGS.hopSeconds * 0.6);
      frog.hopFrom = { ...frog.position };
    }
  }

  // ---- helpers ------------------------------------------------------------------

  private create(index: number): Frog {
    const visible = this.visibleLeaves();
    const leaf = visible.length > 0 ? visible[(index * 5 + 3) % visible.length] : -1;
    const frog: Frog = {
      state: "sit",
      stateAge: 0,
      stateDuration: this.randomRange(FROGS.sitDuration),
      leaf,
      seat: { x: 0, y: 0 },
      position: { x: CANVAS_WIDTH * 0.5, y: CANVAS_HEIGHT * 0.5 },
      heading: this.random.range(-Math.PI, Math.PI),
      hopFrom: { x: 0, y: 0 },
      hopTo: { x: 0, y: 0 },
      height: 0,
      croak: 0,
      croakTime: 0,
      lift: 0,
      kickPhase: 0,
      wakeCountdown: 0,
      palette: index,
      phase: this.random.range(0, Math.PI * 2),
    };
    const circle = this.leaves[leaf];
    if (circle) {
      const towardPond = { x: CANVAS_WIDTH * 0.5 - circle.x, y: CANVAS_HEIGHT * 0.5 - circle.y };
      frog.seat = this.seatOn(circle, towardPond);
      frog.position = add(circle, frog.seat);
      // Face the open water, away from the leaf's center.
      frog.heading = Math.atan2(CANVAS_HEIGHT * 0.5 - circle.y, CANVAS_WIDTH * 0.5 - circle.x);
    } else {
      this.begin(frog, "swim", 30);
    }
    frog.stateAge = this.random.unit() * frog.stateDuration;
    return frog;
  }

  /** A random seat in the inner part of the leaf, on the side `direction` points to. */
  private seatOn(leaf: LeafCircle, direction: Vec2): Vec2 {
    const toward = normalize(direction, fromAngle(this.random.range(0, Math.PI * 2)));
    return mul(toward, leaf.radius * this.random.range(0.15, 0.5));
  }

  /** Leaves whose middle is on screen (edge leaves are cut off or under desktop icons). */
  private visibleLeaves(): number[] {
    const margin = 14;
    const visible: number[] = [];
    for (const [index, leaf] of this.leaves.entries()) {
      if (leaf.x > margin && leaf.x < CANVAS_WIDTH - margin && leaf.y > margin && leaf.y < CANVAS_HEIGHT - margin) visible.push(index);
    }
    return visible.length > 0 ? visible : this.leaves.map((_, index) => index);
  }

  /** A visible leaf within `range` that no other frog has claimed, or −1. */
  private pickLeaf(frog: Frog, range: number): number {
    const claimed = new Set(this.frogs.filter((other) => other !== frog).map((other) => other.leaf));
    const candidates: number[] = [];
    for (const index of this.visibleLeaves()) {
      const leaf = this.leaves[index];
      if (index === frog.leaf && frog.state === "sit") continue;
      if (claimed.has(index)) continue;
      if (length(sub(leaf, frog.position)) - leaf.radius > range) continue;
      candidates.push(index);
    }
    if (candidates.length === 0) return -1;
    if (range === Infinity) {
      // Swimming back: the nearest free leaf.
      return candidates.reduce((best, index) =>
        length(sub(this.leaves[index], frog.position)) < length(sub(this.leaves[best], frog.position)) ? index : best);
    }
    return candidates[Math.floor(this.random.unit() * candidates.length)];
  }

  private leapTo(frog: Frog, leafIndex: number): void {
    const leaf = this.leaves[leafIndex];
    this.pushOff(frog);
    frog.hopFrom = { ...frog.position };
    frog.leaf = leafIndex;
    frog.seat = this.seatOn(leaf, sub(frog.position, leaf));
    const to = add(leaf, frog.seat);
    frog.heading = Math.atan2(to.y - frog.position.y, to.x - frog.position.x);
    const distance = length(sub(to, frog.position));
    this.begin(frog, "hop", FROGS.hopSeconds * clamp(distance / 45, 0.7, 1.7));
  }

  private leapIntoWater(frog: Frog, direction: Vec2): void {
    const from = this.leaves[frog.leaf];
    this.pushOff(frog);
    frog.hopFrom = { ...frog.position };
    frog.leaf = -1;
    // Land clear of the leaf it leaves (and of any other leaf, if possible).
    let landing = add(frog.position, mul(direction, (from?.radius ?? 0) + 14));
    for (let attempt = 0; attempt < 6 && this.onAnyLeaf(landing); attempt += 1) {
      landing = add(landing, mul(direction, 8));
    }
    frog.hopTo = {
      x: clamp(landing.x, 6, CANVAS_WIDTH - 6),
      y: clamp(landing.y, 6, CANVAS_HEIGHT - 6),
    };
    frog.heading = Math.atan2(direction.y, direction.x);
    frog.croakTime = 0;
    frog.croak = 0;
    this.begin(frog, "hop", FROGS.hopSeconds);
  }

  /** Leaving a leaf: the frog stops riding its bob. (Only landing dips a leaf.) */
  private pushOff(frog: Frog): void {
    frog.lift = 0;
  }

  /** The leaves as they float right now. */
  private get leaves(): readonly LeafCircle[] {
    return this.lotus.leaves;
  }

  private onAnyLeaf(point: Vec2): boolean {
    return this.leaves.some((leaf) => length(sub(point, leaf)) < leaf.radius + 3);
  }

  private begin(frog: Frog, state: FrogState, duration: number): void {
    frog.state = state;
    frog.stateAge = 0;
    frog.stateDuration = duration;
  }

  private randomRange(range: readonly [number, number]): number {
    return this.random.range(range[0], range[1]);
  }
}
