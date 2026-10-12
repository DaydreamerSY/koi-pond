// Ducks paddle on the surface, steering around lotus leaves, with their
// ducklings in a line behind them. Stepped by School at the fixed 60 Hz rate.

import { CANVAS_HEIGHT, CANVAS_WIDTH, DUCKS, DUCK_SPAWNS, viewportPoint } from "./config";
import { add, clamp, fromAngle, length, mul, normalize, sub, vec, wrapAngle, type Vec2, XorShift32 } from "./math";
import { lotusLeafCircles, type LeafCircle } from "./pond-layout";
import type { RippleSystem } from "./ripple-system";

export type DuckState = "paddle" | "rest" | "dabble" | "preen" | "approach" | "flee";

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
}

const DIP_SECONDS = 0.8;
const DIP_CYCLE = 1.15;

/** Head-under curve for dabbling: a dip every DIP_CYCLE seconds. */
function dipCurve(time: number): number {
  if (time < 0) return 0;
  const cycle = time % DIP_CYCLE;
  return cycle < DIP_SECONDS ? Math.sin((cycle / DIP_SECONDS) * Math.PI) : 0;
}

export function duckRadius(duck: Duck): number {
  return DUCKS.bodyLength * 0.5 * (duck.duckling ? DUCKS.ducklingScale : 1);
}

export class DuckFamilies {
  public readonly ducks: Duck[] = [];

  private readonly random = new XorShift32(0x0d0c0d0c);
  private readonly leaves: LeafCircle[] = [];

  public constructor() {
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

  /** A click on the water: nearby ducks paddle over, hoping it's food. */
  public callTo(point: Vec2): void {
    for (const duck of this.ducks) {
      if (duck.duckling) continue;
      if (length(sub(duck.position, point)) > DUCKS.callRadius) continue;
      const jitter = mul(fromAngle(this.random.range(0, Math.PI * 2)), this.random.range(2, 7));
      this.begin(duck, "approach", 14);
      duck.target = add(point, jitter);
    }
  }

  /** Startles every duck into a short, wing-flapping dash. */
  public scatter(): void {
    for (const duck of this.ducks) {
      duck.flap = 1;
      if (duck.duckling) continue;
      const angle = duck.heading + this.random.range(-1.6, 1.6);
      this.begin(duck, "flee", this.random.range(1.8, 2.6));
      duck.target = this.clampToPond(add(duck.position, mul(fromAngle(angle), 90)));
      duck.speed = Math.max(duck.speed, DUCKS.fleeSpeed * 0.6);
    }
  }

  public update(dt: number, time: number, ripples: RippleSystem): void {
    lotusLeafCircles(time, this.leaves);
    for (const duck of this.ducks) {
      if (duck.duckling) this.follow(duck, dt);
      else this.steer(duck, dt, ripples);
      this.integrate(duck, dt);
      if (!duck.duckling) this.paddleWake(duck, dt, ripples);
    }
  }

  // ---- spawning --------------------------------------------------------------

  private spawn(previous: Map<string, Duck>): void {
    const count = Math.min(DUCKS.visibleCount, DUCK_SPAWNS.length);
    for (let spawnIndex = 0; spawnIndex < count; spawnIndex += 1) {
      const spawn = DUCK_SPAWNS[spawnIndex];
      const placement = viewportPoint(spawn.x, spawn.y);
      const mother = this.ducks.length;
      this.add(previous, spawnIndex, 0, placement, spawn.heading, false, spawn.palette, -1, mother);
      for (let chain = 1; chain <= spawn.ducklings; chain += 1) {
        const behind = sub(placement, mul(fromAngle(spawn.heading), DUCKS.ducklingSpacing * chain));
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
        if (duck.stateAge >= duck.stateDuration) this.begin(duck, "rest", this.randomRange(DUCKS.restDuration));
        break;
    }

    const ease = 1 - Math.exp(-dt * 6);
    duck.headTurn += (headTurn - duck.headTurn) * ease;
    duck.headDip += (headDip - duck.headDip) * Math.min(1, ease * 2);
    this.turnAndAccelerate(duck, goal, targetSpeed, turnRate, dt);
  }

  private afterPaddle(duck: Duck): void {
    const roll = this.random.unit();
    if (roll < DUCKS.dabbleChance) this.begin(duck, "dabble", this.random.range(1.6, 3.4));
    else if (roll < DUCKS.dabbleChance + DUCKS.preenChance) this.begin(duck, "preen", this.random.range(2.5, 5));
    else if (roll < DUCKS.dabbleChance + DUCKS.preenChance + 0.2) this.begin(duck, "rest", this.randomRange(DUCKS.restDuration));
    else this.beginPaddle(duck);
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

  private follow(duck: Duck, dt: number): void {
    const leader = this.ducks[duck.leader];
    const mother = this.ducks[duck.mother];
    if (!leader || !mother) return;
    const spacing = DUCKS.ducklingSpacing * (leader.duckling ? 1 : 1.3);
    const anchor = sub(leader.position, mul(fromAngle(leader.heading), spacing));
    const toAnchor = sub(anchor, duck.position);
    const distance = length(toAnchor);
    const goal = distance > 1.2 ? anchor : add(duck.position, fromAngle(leader.heading));
    const targetSpeed = clamp(leader.speed * 0.95 + (distance - 1) * 2.4, 0, DUCKS.fleeSpeed * 1.15);

    const dip = mother.state === "dabble" ? dipCurve(mother.stateAge - duck.chainIndex * 0.3) * 0.8 : 0;
    const turn = mother.state === "preen" ? Math.sin(mother.stateAge * 3.1 + duck.phase) * 0.6 : 0;
    const ease = 1 - Math.exp(-dt * 6);
    duck.headDip += (dip - duck.headDip) * Math.min(1, ease * 2);
    duck.headTurn += (turn - duck.headTurn) * ease;
    this.turnAndAccelerate(duck, goal, targetSpeed, DUCKS.turnRate * 2.6, dt);
  }

  // ---- shared movement ------------------------------------------------------------

  private turnAndAccelerate(duck: Duck, goal: Vec2 | null, targetSpeed: number, turnRate: number, dt: number): void {
    if (goal && targetSpeed > 0.05) {
      const toGoal = normalize(sub(goal, duck.position), fromAngle(duck.heading));
      const steer = normalize(add(toGoal, this.avoidance(duck)), toGoal);
      const turn = wrapAngle(Math.atan2(steer.y, steer.x) - duck.heading);
      duck.heading = wrapAngle(duck.heading + clamp(turn, -turnRate * dt, turnRate * dt));
      // Slow down for sharp turns, like a real paddler.
      targetSpeed *= 0.55 + 0.45 * Math.max(0, Math.cos(turn));
    }
    const rate = targetSpeed > duck.speed ? 1.8 : 1.1;
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
      if (other === duck) continue;
      const personal = (radius + duckRadius(other)) * (duck.duckling || other.duckling ? 0.9 : 1.6);
      const away = sub(duck.position, other.position);
      const distance = length(away);
      if (distance >= personal || distance < 0.001) continue;
      push = add(push, mul(away, (1 - distance / personal) * 1.4 / distance));
    }
    return push;
  }

  private integrate(duck: Duck, dt: number): void {
    duck.position = add(duck.position, mul(fromAngle(duck.heading), duck.speed * dt));
    // Never sit on a leaf, even if one drifts into the duck.
    const radius = duckRadius(duck);
    for (const leaf of this.leaves) {
      const away = sub(duck.position, leaf);
      const distance = length(away);
      const minimum = leaf.radius + radius * 0.7;
      if (distance < minimum && distance > 0.001) duck.position = add(leaf, mul(away, minimum / distance));
    }
    duck.position = this.clampToPond(duck.position, 4);
    duck.paddlePhase += dt * (1.8 + duck.speed * 0.85);
    duck.flap = Math.max(0, duck.flap - dt * 0.75);
  }

  private paddleWake(duck: Duck, dt: number, ripples: RippleSystem): void {
    if (duck.speed < 1.2) return;
    duck.wakeCountdown -= dt * clamp(duck.speed / 7, 0.4, 2.5);
    if (duck.wakeCountdown > 0) return;
    duck.wakeCountdown = DUCKS.wakeInterval;
    ripples.trigger("wake", sub(duck.position, mul(fromAngle(duck.heading), duckRadius(duck) * 1.1)));
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
