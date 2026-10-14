// Ducks paddle on the surface, steering around lotus leaves, with their
// ducklings in a line behind them; now and then a duck dives and comes up
// somewhere else while her ducklings wait. Stepped by School at the fixed
// 60 Hz rate.

import { CANVAS_HEIGHT, CANVAS_WIDTH, DUCKS, DUCK_SPAWNS, viewportPoint } from "./config";
import { add, clamp, fromAngle, length, mul, normalize, sub, vec, wrapAngle, type Vec2, XorShift32 } from "./math";
import type { LotusMotion } from "./lotus-motion";
import type { LeafCircle } from "./pond-layout";
import type { RippleSystem } from "./ripple-system";

export type DuckState = "paddle" | "rest" | "dabble" | "preen" | "approach" | "flee" | "dive" | "surface";

export interface Duck {
  position: Vec2;
  heading: number;
  speed: number;
  duckling: boolean;
  /** Index into DUCKS.palettes (ducklings use DUCKS.ducklingPalette). */
  palette: number;
  /** Index of the duck this duckling follows, or -1. */
  leader: number;
  /** Index of this family's adult. */
  mother: number;
  spawnIndex: number;
  chainIndex: number;
  state: DuckState;
  stateAge: number;
  stateDuration: number;
  target: Vec2;
  cruiseSpeed: number;
  /** Drives the paddling feet and the gentle bob. */
  paddlePhase: number;
  wakeCountdown: number;
  /** Preening: how far the head is turned toward the back (−1..1). */
  headTurn: number;
  /** Dabbling: how far the head is tipped under (0..1). */
  headDip: number;
  /** Wing spread while fleeing (0..1). */
  flap: number;
  phase: number;
  dipRippled: boolean;
  /** Duckling pottering about its resting mother (rather than in line behind her). */
  milling: boolean;
  /** Where a milling duckling heads, relative to its mother. */
  spot: Vec2;
  /** Seconds until a milling duckling moves to a new spot. */
  spotTimer: number;
  /** Seconds left before a duckling sets off after its mother (−1: not waiting). */
  followDelay: number;
  /** A milling duckling's own dabble, seconds in (−1: not dabbling). */
  dipTime: number;
  /** How far under the water the duck is (0 afloat, 1 out of sight), diving. */
  submerged: number;
  /** A tail waggle, seconds in (−1: not waggling). */
  wagTime: number;
  /** Duckling staying put while its mother is under, until she's back up. */
  waiting: boolean;
}

const DIP_SECONDS = 0.8;
const DIP_CYCLE = 1.15;
/** Tipping forward and slipping under, at the start of a dive. */
const DIVE_DOWN_SECONDS = 0.7;
/** Bobbing back up, then a shake of the tail. */
const SURFACE_SECONDS = 1.3;
const WAG_SECONDS = 0.75;

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** The tail's sideways swing (radians) during a waggle: quick, and dying away. */
export function tailWag(duck: Duck): number {
  if (duck.wagTime < 0) return 0;
  return Math.sin(duck.wagTime * Math.PI * 2 * 5.5) * 0.55 * (1 - duck.wagTime / WAG_SECONDS);
}

/** How far behind its leader a duckling swims: clear of the mother's tail, then nose to tail. */
function lineSpacing(leader: Duck, duck: Duck): number {
  if (leader.duckling) return DUCKS.ducklingSpacing;
  // The mother's tail reaches 0.66 of her length behind her middle (see duck-renderer).
  return duckSize(leader).length * 0.66 + duckSize(duck).length * 0.5 + DUCKS.motherGap;
}

/** Head-under curve for dabbling: a dip every DIP_CYCLE seconds. */
function dipCurve(time: number): number {
  if (time < 0) return 0;
  const cycle = time % DIP_CYCLE;
  return cycle < DIP_SECONDS ? Math.sin((cycle / DIP_SECONDS) * Math.PI) : 0;
}

export function duckRadius(duck: Duck): number {
  return DUCKS.bodyLength * 0.5 * (duck.duckling ? DUCKS.ducklingScale : 1);
}

/** Body length and width as drawn. Ducklings are round balls of fluff. */
export function duckSize(duck: Duck): { length: number; width: number } {
  const length = DUCKS.bodyLength * (duck.duckling ? DUCKS.ducklingScale : 1);
  return { length, width: length * Math.min(1, DUCKS.bodyWidthRatio * (duck.duckling ? 1.3 : 1)) };
}

/** How much room a duck's body takes on the water; ducks keep this far apart. */
export function duckBodyRadius(duck: Duck): number {
  const { length, width } = duckSize(duck);
  return (length + width) / 4;
}

export class DuckFamilies {
  public readonly ducks: Duck[] = [];

  private readonly random = new XorShift32(0x0d0c0d0c);
  public constructor(private readonly lotus: LotusMotion) {
    this.reset();
  }

  public reset(): void {
    this.random.state = 0x0d0c0d0c;
    this.ducks.length = 0;
    this.spawn(new Map());
  }

  /** Rebuilds the flock after a count or spawn change; ducks that still exist stay where they are. */
  public respawn(): void {
    const previous = new Map(this.ducks.map((duck) => [`${duck.spawnIndex}:${duck.chainIndex}`, duck]));
    this.ducks.length = 0;
    this.spawn(previous);
  }

  public resize(scaleX: number, scaleY: number): void {
    for (const duck of this.ducks) {
      duck.position.x *= scaleX;
      duck.position.y *= scaleY;
      duck.target.x *= scaleX;
      duck.target.y *= scaleY;
    }
  }

  /**
   * A click on the water: nearby ducks paddle over, hoping it's food. Each one
   * gets its own place around the food, on its own side, so they gather in a
   * ring instead of piling onto one spot.
   */
  public callTo(point: Vec2): void {
    const hungry = this.ducks
      .filter((duck) => !duck.duckling && duck.state !== "dive" && length(sub(duck.position, point)) <= DUCKS.callRadius)
      .map((duck) => ({ duck, angle: Math.atan2(duck.position.y - point.y, duck.position.x - point.x) }))
      .sort((a, b) => a.angle - b.angle);
    if (hungry.length === 0) return;
    const radius = Math.max(...hungry.map(({ duck }) => duckBodyRadius(duck)));
    const ring = radius * Math.max(1.1, hungry.length * 0.42);
    const spread = (Math.PI * 2) / hungry.length;
    const start = hungry.length === 1 ? hungry[0].angle : hungry[0].angle + this.random.range(-0.3, 0.3);
    for (const [index, { duck }] of hungry.entries()) {
      this.begin(duck, "approach", 14);
      duck.target = add(point, mul(fromAngle(start + index * spread), ring));
    }
  }

  /** Startles every duck into a short, wing-flapping dash (one underwater doesn't notice). */
  public scatter(): void {
    for (const duck of this.ducks) {
      if (duck.state === "dive") continue;
      duck.flap = 1;
      if (duck.duckling) continue;
      const angle = duck.heading + this.random.range(-1.6, 1.6);
      this.begin(duck, "flee", this.random.range(1.8, 2.6));
      duck.target = this.clampToPond(add(duck.position, mul(fromAngle(angle), 90)));
      duck.speed = Math.max(duck.speed, DUCKS.fleeSpeed * 0.6);
    }
  }

  public update(dt: number, ripples: RippleSystem): void {
    for (const duck of this.ducks) {
      if (duck.duckling) this.follow(duck, dt);
      else this.steer(duck, dt, ripples);
      this.move(duck, dt);
      this.waggle(duck, dt);
      if (!duck.duckling) this.paddleWake(duck, dt, ripples);
    }
    this.keepApart();
    for (const duck of this.ducks) this.keepClear(duck);
  }

  // ---- spawning --------------------------------------------------------------

  private spawn(previous: Map<string, Duck>): void {
    const count = Math.min(DUCKS.visibleCount, DUCK_SPAWNS.length);
    for (let spawnIndex = 0; spawnIndex < count; spawnIndex += 1) {
      const spawn = DUCK_SPAWNS[spawnIndex];
      const placement = viewportPoint(spawn.x, spawn.y);
      const mother = this.ducks.length;
      this.add(previous, spawnIndex, 0, placement, spawn.heading, false, spawn.palette, -1, mother);
      let behind = placement;
      for (let chain = 1; chain <= spawn.ducklings; chain += 1) {
        const leader = this.ducks[this.ducks.length - 1];
        behind = sub(behind, mul(fromAngle(spawn.heading), lineSpacing(leader, { ...leader, duckling: true })));
        this.add(previous, spawnIndex, chain, behind, spawn.heading, true, 0, this.ducks.length - 1, mother);
      }
    }
  }

  private add(
    previous: Map<string, Duck>,
    spawnIndex: number,
    chainIndex: number,
    position: Vec2,
    heading: number,
    duckling: boolean,
    palette: number,
    leader: number,
    mother: number,
  ): void {
    const old = previous.get(`${spawnIndex}:${chainIndex}`);
    if (old) {
      Object.assign(old, { duckling, palette, leader, mother });
      this.ducks.push(old);
      return;
    }
    const duck: Duck = {
      position: { ...position },
      heading,
      speed: 0,
      duckling,
      palette,
      leader,
      mother,
      spawnIndex,
      chainIndex,
      state: "paddle",
      stateAge: 0,
      stateDuration: 0,
      target: { ...position },
      cruiseSpeed: this.random.range(DUCKS.cruiseSpeed[0], DUCKS.cruiseSpeed[1]),
      paddlePhase: this.random.range(0, Math.PI * 2),
      wakeCountdown: this.random.range(0, DUCKS.wakeInterval),
      headTurn: 0,
      headDip: 0,
      flap: 0,
      phase: this.random.range(0, Math.PI * 2),
      dipRippled: false,
      milling: false,
      spot: { x: 0, y: 0 },
      spotTimer: 0,
      followDelay: -1,
      dipTime: -1,
      submerged: 0,
      wagTime: -1,
      waiting: false,
    };
    if (!duckling) this.beginPaddle(duck);
    this.ducks.push(duck);
  }

  // ---- adults ----------------------------------------------------------------

  private steer(duck: Duck, dt: number, ripples: RippleSystem): void {
    duck.stateAge += dt;
    let targetSpeed = 0;
    let goal: Vec2 | null = null;
    let turnRate = DUCKS.turnRate;
    let headTurn = 0;
    let headDip = 0;
    let avoid = true;

    switch (duck.state) {
      case "paddle":
        goal = duck.target;
        targetSpeed = duck.cruiseSpeed;
        if (length(sub(duck.target, duck.position)) < 10) this.chooseTarget(duck);
        if (duck.stateAge >= duck.stateDuration) this.afterPaddle(duck);
        break;
      case "approach": {
        goal = duck.target;
        const distance = length(sub(duck.target, duck.position));
        targetSpeed = DUCKS.hurrySpeed * clamp(distance / 30, 0.35, 1);
        turnRate *= 1.6;
        if (distance < 4 + duckRadius(duck) * 0.8) this.begin(duck, "dabble", this.random.range(2.4, 3.8));
        else if (duck.stateAge > duck.stateDuration) this.beginPaddle(duck);
        break;
      }
      case "flee":
        goal = duck.target;
        targetSpeed = DUCKS.fleeSpeed + (duck.cruiseSpeed - DUCKS.fleeSpeed) * clamp(duck.stateAge / duck.stateDuration, 0, 1);
        turnRate *= 2.2;
        if (duck.stateAge >= duck.stateDuration) this.beginPaddle(duck);
        break;
      case "rest":
        duck.heading += Math.sin(duck.stateAge * 0.6 + duck.phase) * 0.1 * dt;
        if (duck.stateAge >= duck.stateDuration) this.beginPaddle(duck);
        break;
      case "dabble":
        headDip = dipCurve(duck.stateAge);
        if (headDip > 0.85 && !duck.dipRippled) {
          duck.dipRippled = true;
          ripples.trigger("mouth", add(duck.position, mul(fromAngle(duck.heading), duckRadius(duck) * 1.15)));
        } else if (headDip < 0.2) {
          duck.dipRippled = false;
        }
        if (duck.stateAge >= duck.stateDuration && headDip === 0) {
          if (this.random.unit() < 0.4) this.begin(duck, "rest", this.randomRange(DUCKS.restDuration));
          else this.beginPaddle(duck);
        }
        break;
      case "preen":
        headTurn = Math.sin(duck.stateAge * 2.3 + duck.phase) * 0.9;
        if (duck.stateAge >= duck.stateDuration) {
          // A good shake of the tail to finish.
          duck.wagTime = 0;
          this.begin(duck, "rest", this.randomRange(DUCKS.restDuration));
        }
        break;
      case "dive": {
        // Tip forward and slip under, swim over underwater, then come up there.
        headDip = 1;
        goal = duck.target;
        if (duck.stateAge < DIVE_DOWN_SECONDS) {
          duck.submerged = smoothstep(0.2, DIVE_DOWN_SECONDS, duck.stateAge);
          targetSpeed = duck.cruiseSpeed * 0.5;
          if (duck.submerged > 0.5 && !duck.dipRippled) {
            duck.dipRippled = true;
            ripples.trigger("rain", duck.position, 0.8);
          }
          break;
        }
        duck.submerged = 1;
        avoid = false;
        turnRate *= 2.5;
        const distance = length(sub(duck.target, duck.position));
        targetSpeed = DUCKS.diveSpeed * clamp(distance / 12, 0.3, 1);
        // A few bubbles rise along the way.
        duck.wakeCountdown -= dt;
        if (duck.wakeCountdown <= 0) {
          duck.wakeCountdown = this.random.range(0.45, 0.9);
          ripples.trigger("mouth", duck.position, 0.35);
        }
        if (distance < 3 || duck.stateAge >= duck.stateDuration) {
          this.begin(duck, "surface", SURFACE_SECONDS);
          ripples.trigger("rain", duck.position, 0.9);
        }
        break;
      }
      case "surface":
        duck.submerged = 1 - smoothstep(0, 0.45, duck.stateAge);
        headDip = 1 - smoothstep(0.1, 0.55, duck.stateAge);
        if (duck.stateAge > 0.55 && !duck.dipRippled) {
          // Up again: a shake of the tail and a little flutter.
          duck.dipRippled = true;
          duck.wagTime = 0;
          duck.flap = Math.max(duck.flap, 0.3);
        }
        // Then she waits for her ducklings to catch up.
        if (duck.stateAge >= duck.stateDuration) this.begin(duck, "rest", this.randomRange(DUCKS.restDuration));
        break;
    }
    // Anything that ends a dive early (a click) brings the duck straight up.
    if (duck.state !== "dive" && duck.state !== "surface") duck.submerged = Math.max(0, duck.submerged - dt * 3);

    const ease = 1 - Math.exp(-dt * 6);
    duck.headTurn += (headTurn - duck.headTurn) * ease;
    duck.headDip += (headDip - duck.headDip) * Math.min(1, ease * 2);
    this.turnAndAccelerate(duck, goal, targetSpeed, turnRate, dt, avoid);
  }

  private afterPaddle(duck: Duck): void {
    let roll = this.random.unit();
    if (roll < DUCKS.diveChance && this.beginDive(duck)) return;
    roll -= DUCKS.diveChance;
    if (roll < DUCKS.dabbleChance) this.begin(duck, "dabble", this.random.range(1.6, 3.4));
    else if (roll < DUCKS.dabbleChance + DUCKS.preenChance) this.begin(duck, "preen", this.random.range(2.5, 5));
    else if (roll < DUCKS.dabbleChance + DUCKS.preenChance + 0.2) this.begin(duck, "rest", this.randomRange(DUCKS.restDuration));
    else this.beginPaddle(duck);
  }

  /** Dives for somewhere ahead in open water, to come up clear of the leaves. False if there's nowhere to go. */
  private beginDive(duck: Duck): boolean {
    const radius = duckRadius(duck);
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const distance = this.randomRange(DUCKS.diveDistance);
      const candidate = add(duck.position, mul(fromAngle(duck.heading + this.random.range(-1.3, 1.3)), distance));
      const margin = Math.max(DUCKS.edgeMargin, 4);
      const inPond = candidate.x > margin && candidate.x < CANVAS_WIDTH - margin && candidate.y > margin && candidate.y < CANVAS_HEIGHT - margin;
      const clear = this.leaves.every((leaf) => length(sub(candidate, leaf)) > leaf.radius + DUCKS.leafClearance + radius * 1.5);
      if (!inPond || !clear) continue;
      this.begin(duck, "dive", DIVE_DOWN_SECONDS + distance / Math.max(DUCKS.diveSpeed, 1) * 1.6 + 2);
      duck.target = candidate;
      duck.wakeCountdown = 0.4;
      return true;
    }
    return false;
  }

  private beginPaddle(duck: Duck): void {
    this.begin(duck, "paddle", this.randomRange(DUCKS.paddleDuration));
    duck.cruiseSpeed = this.randomRange(DUCKS.cruiseSpeed);
    this.chooseTarget(duck);
  }

  private begin(duck: Duck, state: DuckState, duration: number): void {
    duck.state = state;
    duck.stateAge = 0;
    duck.stateDuration = duration;
    duck.dipRippled = false;
  }

  /** Somewhere in open water, preferably ahead, away from leaves. */
  private chooseTarget(duck: Duck): void {
    let best = this.clampToPond(add(duck.position, mul(fromAngle(duck.heading), 60)));
    let bestScore = -Infinity;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const angle = duck.heading + this.random.range(-1.9, 1.9);
      const candidate = this.clampToPond(add(duck.position, mul(fromAngle(angle), this.random.range(45, 150))));
      let clearance = Infinity;
      for (const leaf of this.leaves) {
        clearance = Math.min(clearance, length(sub(candidate, leaf)) - leaf.radius);
      }
      const score = Math.min(clearance, 40) + this.random.range(0, 12);
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    duck.target = best;
  }

  // ---- ducklings ---------------------------------------------------------------

  /**
   * Ducklings line up behind a swimming mother; while she rests, preens, or
   * dabbles they potter about around her, each its own way, and when she sets
   * off again they follow after a short pause.
   */
  private follow(duck: Duck, dt: number): void {
    const mother = this.ducks[duck.mother];
    if (!mother) return;
    if (mother.state === "dive") {
      // Their mother is underwater: they stay where they are and wait for her.
      duck.waiting = true;
      duck.followDelay = -1;
      this.waitFor(duck, dt);
      return;
    }
    if (duck.waiting) {
      // She's back up: a moment's pause, then they paddle over to her.
      if (duck.followDelay < 0) duck.followDelay = this.randomRange(DUCKS.surfaceWait) + (duck.chainIndex - 1) * 0.15;
      duck.followDelay -= dt;
      if (duck.followDelay > 0) {
        this.waitFor(duck, dt);
        return;
      }
      duck.waiting = false;
      duck.followDelay = -1;
      duck.milling = false;
      duck.dipTime = -1;
    }
    const motherSwimming = mother.state === "paddle" || mother.state === "approach" || mother.state === "flee";
    if (!motherSwimming) {
      if (!duck.milling) {
        duck.milling = true;
        duck.stateAge = 0;
        this.pickSpot(duck, mother);
      }
      duck.followDelay = -1;
      this.mill(duck, mother, dt);
      return;
    }
    if (duck.milling) {
      if (duck.followDelay < 0) {
        // A frightened mother is followed at once.
        duck.followDelay = mother.state === "flee"
          ? this.random.range(0.05, 0.2)
          : this.randomRange(DUCKS.ducklingFollowDelay) + (duck.chainIndex - 1) * 0.15;
      }
      duck.followDelay -= dt;
      if (duck.followDelay > 0) {
        this.mill(duck, mother, dt);
        return;
      }
      duck.milling = false;
      duck.followDelay = -1;
      duck.dipTime = -1;
    }
    this.followLine(duck, mother, dt);
  }

  private followLine(duck: Duck, mother: Duck, dt: number): void {
    const leader = this.ducks[duck.leader];
    if (!leader) return;
    // Like beads on a string: each duckling paddles after the one in front,
    // keeping its distance, so the line follows the mother's own path. (Aiming
    // for a spot behind the leader instead made that spot swing wide on every
    // turn, and the ducklings had to dash about after it.)
    const slack = length(sub(leader.position, duck.position)) - lineSpacing(leader, duck);
    const targetSpeed = clamp(leader.speed + slack * 2.2, 0, DUCKS.fleeSpeed * 1.15);
    const goal = leader.position;

    const dip = mother.state === "dabble" ? dipCurve(mother.stateAge - duck.chainIndex * 0.3) * 0.8 : 0;
    const turn = mother.state === "preen" ? Math.sin(mother.stateAge * 3.1 + duck.phase) * 0.6 : 0;
    const ease = 1 - Math.exp(-dt * 6);
    duck.headDip += (dip - duck.headDip) * Math.min(1, ease * 2);
    duck.headTurn += (turn - duck.headTurn) * ease;
    // Ducklings are light: closing up on the one in front, they stop short
    // instead of coasting into its tail.
    this.turnAndAccelerate(duck, goal, targetSpeed, DUCKS.turnRate * 2.6, dt, true, 5);
  }

  /** Pottering about a resting mother: paddle to a spot, linger, look about, dabble. */
  private mill(duck: Duck, mother: Duck, dt: number): void {
    duck.stateAge += dt;
    duck.spotTimer -= dt;
    if (duck.spotTimer <= 0) this.pickSpot(duck, mother);

    const goal = add(mother.position, duck.spot);
    const distance = length(sub(goal, duck.position));
    if (distance > 2.5) {
      this.turnAndAccelerate(duck, goal, clamp(distance * 0.6, 1.5, duck.cruiseSpeed * 0.7), DUCKS.turnRate * 2, dt);
    } else {
      // Lingering: drift to a stop, turning this way and that.
      this.turnAndAccelerate(duck, null, 0, DUCKS.turnRate, dt);
      duck.heading = wrapAngle(duck.heading + Math.sin(duck.stateAge * 0.9 + duck.phase * 3) * 0.7 * dt);
    }

    // Its own little dabbles now and then, and glances about.
    if (duck.dipTime < 0 && this.random.unit() < 0.12 * dt) duck.dipTime = 0;
    let dip = 0;
    if (duck.dipTime >= 0) {
      duck.dipTime += dt;
      dip = dipCurve(duck.dipTime) * 0.8;
      if (duck.dipTime > DIP_CYCLE) duck.dipTime = -1;
    }
    const turn = Math.sin(duck.stateAge * 1.7 + duck.phase) * 0.35;
    const ease = 1 - Math.exp(-dt * 6);
    duck.headDip += (dip - duck.headDip) * Math.min(1, ease * 2);
    duck.headTurn += (turn - duck.headTurn) * ease;
  }

  /** Staying put: drift to a stop and look about. */
  private waitFor(duck: Duck, dt: number): void {
    duck.stateAge += dt;
    this.turnAndAccelerate(duck, null, 0, DUCKS.turnRate, dt);
    duck.speed *= Math.exp(-dt * 1.5);
    duck.heading = wrapAngle(duck.heading + Math.sin(duck.stateAge * 0.7 + duck.phase * 3) * 0.4 * dt);
    const ease = 1 - Math.exp(-dt * 6);
    duck.headDip += (0 - duck.headDip) * Math.min(1, ease * 2);
    duck.headTurn += (Math.sin(duck.stateAge * 1.3 + duck.phase) * 0.4 - duck.headTurn) * ease;
  }

  /** A random spot around the mother, in open water and inside the pond. */
  private pickSpot(duck: Duck, mother: Duck): void {
    const radius = duckRadius(duck);
    const margin = Math.max(DUCKS.edgeMargin, 4);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const offset = mul(fromAngle(this.random.range(0, Math.PI * 2)), this.randomRange(DUCKS.ducklingSpread) * DUCKS.bodyLength);
      const point = add(mother.position, offset);
      const inPond = point.x > margin && point.x < CANVAS_WIDTH - margin && point.y > margin && point.y < CANVAS_HEIGHT - margin;
      const clear = this.leaves.every((leaf) => length(sub(point, leaf)) > leaf.radius + radius * 1.5);
      duck.spot = offset;
      if (inPond && clear) break;
    }
    duck.spotTimer = this.randomRange(DUCKS.ducklingLinger);
  }

  // ---- shared movement ------------------------------------------------------------

  private turnAndAccelerate(
    duck: Duck,
    goal: Vec2 | null,
    targetSpeed: number,
    turnRate: number,
    dt: number,
    avoid = true,
    slowRate = 1.1,
  ): void {
    if (goal && targetSpeed > 0.05) {
      const toGoal = normalize(sub(goal, duck.position), fromAngle(duck.heading));
      const steer = avoid ? normalize(add(toGoal, this.avoidance(duck)), toGoal) : toGoal;
      const turn = wrapAngle(Math.atan2(steer.y, steer.x) - duck.heading);
      duck.heading = wrapAngle(duck.heading + clamp(turn, -turnRate * dt, turnRate * dt));
      // Slow down for sharp turns, like a real paddler.
      targetSpeed *= 0.55 + 0.45 * Math.max(0, Math.cos(turn));
    }
    const rate = targetSpeed > duck.speed ? 1.8 : slowRate;
    duck.speed += (targetSpeed - duck.speed) * (1 - Math.exp(-dt * rate));
  }

  /** Steering push away from lotus leaves, the pond's edge, and other ducks. */
  private avoidance(duck: Duck): Vec2 {
    const radius = duckRadius(duck);
    const look = add(duck.position, mul(fromAngle(duck.heading), radius * 1.5 + duck.speed * 0.7));
    let push = vec();
    for (const leaf of this.leaves) {
      const reach = leaf.radius + DUCKS.leafClearance + radius + 8;
      for (const point of [duck.position, look]) {
        const away = sub(point, leaf);
        const distance = length(away);
        if (distance >= reach || distance < 0.001) continue;
        push = add(push, mul(away, (1 - distance / reach) * 2.2 / distance));
      }
    }
    const margin = Math.max(DUCKS.edgeMargin, 1);
    if (look.x < margin) push.x += (margin - look.x) / margin * 1.5;
    if (look.x > CANVAS_WIDTH - margin) push.x -= (look.x - (CANVAS_WIDTH - margin)) / margin * 1.5;
    if (look.y < margin) push.y += (margin - look.y) / margin * 1.5;
    if (look.y > CANVAS_HEIGHT - margin) push.y -= (look.y - (CANVAS_HEIGHT - margin)) / margin * 1.5;
    for (const other of this.ducks) {
      if (other === duck || other.submerged > 0.5) continue;
      const personal = (radius + duckRadius(other)) * (duck.duckling || other.duckling ? 0.9 : 1.6);
      const away = sub(duck.position, other.position);
      const distance = length(away);
      if (distance >= personal || distance < 0.001) continue;
      push = add(push, mul(away, (1 - distance / personal) * 1.4 / distance));
    }
    return push;
  }

  private move(duck: Duck, dt: number): void {
    duck.position = add(duck.position, mul(fromAngle(duck.heading), duck.speed * dt));
    duck.paddlePhase += dt * (1.8 + duck.speed * 0.85);
    duck.flap = Math.max(0, duck.flap - dt * 0.75);
  }

  /** Now and then a quick waggle of the tail (and always after preening or a dive). */
  private waggle(duck: Duck, dt: number): void {
    if (duck.wagTime >= 0) {
      duck.wagTime += dt;
      if (duck.wagTime > WAG_SECONDS) duck.wagTime = -1;
    } else if (duck.submerged === 0 && this.random.unit() < DUCKS.tailWagChance * dt) {
      duck.wagTime = 0;
    }
  }

  /**
   * Ducks bump; they don't overlap. Any two bodies that overlap are pushed
   * apart, the smaller one giving way more (a duckling yields to an adult).
   */
  private keepApart(): void {
    for (let pass = 0; pass < 3; pass += 1) {
      for (let a = 0; a < this.ducks.length; a += 1) {
        for (let b = a + 1; b < this.ducks.length; b += 1) {
          const first = this.ducks[a];
          const second = this.ducks[b];
          // One underwater passes beneath the others.
          if (first.submerged > 0.5 || second.submerged > 0.5) continue;
          const firstRadius = duckBodyRadius(first);
          const secondRadius = duckBodyRadius(second);
          const apart = sub(second.position, first.position);
          const distance = length(apart);
          const overlap = firstRadius + secondRadius - distance;
          if (overlap <= 0) continue;
          const direction = distance > 0.001 ? mul(apart, 1 / distance) : fromAngle(first.heading + Math.PI / 2);
          const firstShare = (secondRadius * secondRadius) / (firstRadius * firstRadius + secondRadius * secondRadius);
          first.position = sub(first.position, mul(direction, overlap * firstShare));
          second.position = add(second.position, mul(direction, overlap * (1 - firstShare)));
        }
      }
    }
  }

  /** Never on a leaf (even one that drifts into the duck; underwater, under it is fine), never out of the pond. */
  private keepClear(duck: Duck): void {
    const radius = duckRadius(duck);
    for (const leaf of duck.submerged > 0.5 ? [] : this.leaves) {
      const away = sub(duck.position, leaf);
      const distance = length(away);
      const minimum = leaf.radius + radius * 0.7;
      if (distance < minimum && distance > 0.001) duck.position = add(leaf, mul(away, minimum / distance));
    }
    duck.position = this.clampToPond(duck.position, 4);
  }

  /** A V-shaped wake opening from the duck's breast as she paddles. */
  private paddleWake(duck: Duck, dt: number, ripples: RippleSystem): void {
    if (duck.speed < 1.2 || duck.submerged > 0) return;
    duck.wakeCountdown -= dt * clamp(duck.speed / 7, 0.4, 2.5);
    if (duck.wakeCountdown > 0) return;
    duck.wakeCountdown = DUCKS.wakeInterval;
    ripples.triggerWake(add(duck.position, mul(fromAngle(duck.heading), duckRadius(duck) * 0.5)), duck.heading, duck.speed);
  }

  /** The leaves as they float right now. */
  private get leaves(): readonly LeafCircle[] {
    return this.lotus.leaves;
  }

  private clampToPond(point: Vec2, margin = Math.max(DUCKS.edgeMargin, 4)): Vec2 {
    return {
      x: clamp(point.x, margin, Math.max(margin, CANVAS_WIDTH - margin)),
      y: clamp(point.y, margin, Math.max(margin, CANVAS_HEIGHT - margin)),
    };
  }

  private randomRange(range: readonly [number, number]): number {
    return this.random.range(range[0], range[1]);
  }
}
