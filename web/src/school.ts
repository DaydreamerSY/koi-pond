import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  FISH,
  MAX_FISH,
  SPINE_NODES,
} from "./config";
import { Crabs } from "./crabs";
import { DuckFamilies } from "./ducks";
import { Frogs } from "./frogs";
import { Koi, SwimState } from "./koi";
import { LotusMotion } from "./lotus-motion";
import { ShrimpSchool } from "./shrimp";
import { TinyFishSchools } from "./tiny-fish";
import {
  add,
  clamp,
  fromAngle,
  length,
  mul,
  normalize,
  perpendicular,
  sub,
  type Vec2,
  vec,
  wrapAngle,
  XorShift32,
} from "./math";
import { RippleSystem } from "./ripple-system";

export class School {
  public readonly fish: Koi[] = Array.from({ length: MAX_FISH }, () => new Koi());
  public readonly ripples = new RippleSystem();
  public readonly tinyFish = new TinyFishSchools();
  /** The floating lotus leaves (the renderer, ducks, and frogs all follow them). */
  public readonly lotus = new LotusMotion();
  public readonly ducks = new DuckFamilies(this.lotus);
  public readonly crabs = new Crabs();
  public readonly shrimp = new ShrimpSchool();
  public readonly frogs = new Frogs(this.lotus);

  public count: number = FISH.initialCount;
  public targetActive = false;

  private random = new XorShift32();
  private target = vec(CANVAS_WIDTH * 0.5, CANVAS_HEIGHT * 0.5);
  private targetAge = 0;

  public constructor() {
    this.fish.forEach((fish, index) => fish.reset(index, this.random));
  }

  public setCount(count: number): void {
    this.count = clamp(Math.round(count), 1, MAX_FISH);
  }

  public updateBodyProportions(previous: {
    regularLength: readonly [number, number];
    tinyLength: readonly [number, number];
    regularWidthRatio: readonly [number, number];
    tinyWidthRatio: readonly [number, number];
    tinyEvery: number;
  }): void {
    const midpoint = (range: readonly [number, number]): number =>
      (range[0] + range[1]) * 0.5;
    for (const [index, fish] of this.fish.entries()) {
      const wasTiny = index % previous.tinyEvery === previous.tinyEvery - 1;
      const isTiny = index % FISH.tinyEvery === FISH.tinyEvery - 1;
      const oldLength = midpoint(wasTiny ? previous.tinyLength : previous.regularLength);
      const newLength = midpoint(isTiny ? FISH.tinyLength : FISH.regularLength);
      const oldWidth = midpoint(
        wasTiny ? previous.tinyWidthRatio : previous.regularWidthRatio,
      );
      const newWidth = midpoint(isTiny ? FISH.tinyWidthRatio : FISH.regularWidthRatio);
      const lengthRatio = newLength / Math.max(oldLength, 0.001);
      fish.bodyLength *= lengthRatio;
      fish.bodyWidth *= lengthRatio * newWidth / Math.max(oldWidth, 0.001);
    }
  }

  public resize(scaleX: number, scaleY: number): void {
    for (const fish of this.fish) {
      const nextX = fish.position.x * scaleX;
      const nextY = fish.position.y * scaleY;
      const shiftX = nextX - fish.position.x;
      const shiftY = nextY - fish.position.y;
      fish.position.x = nextX;
      fish.position.y = nextY;
      for (const node of fish.spine) {
        node.x += shiftX;
        node.y += shiftY;
      }
      for (const node of fish.renderSpine) {
        node.x += shiftX;
        node.y += shiftY;
      }
    }
    this.target.x *= scaleX;
    this.target.y *= scaleY;
    this.tinyFish.resize(scaleX, scaleY);
    this.ducks.resize(scaleX, scaleY);
    this.crabs.resize(scaleX, scaleY);
    this.shrimp.resize(scaleX, scaleY);
    this.frogs.resize(scaleX, scaleY);
    for (const ripple of this.ripples.instances) {
      ripple.center.x *= scaleX;
      ripple.center.y *= scaleY;
    }
  }

  public reset(): void {
    this.random.state = 0x00c0ffee;
    this.fish.forEach((fish, index) => fish.reset(index, this.random));
    this.tinyFish.reset();
    this.lotus.reset();
    this.ducks.reset();
    this.crabs.reset();
    this.shrimp.reset();
    this.frogs.reset();
    this.ripples.reset();
    this.targetActive = false;
  }

  public setRainIntensity(intensity: number): void {
    this.ripples.setRainIntensity(intensity);
  }

  public callTo(point: Vec2): void {
    this.target = { ...point };
    this.targetActive = true;
    this.targetAge = 0;
    for (let index = 0; index < this.count; index += 1) {
      const fish = this.fish[index];
      const response = FISH.callResponse;
      const distanceToCall = length(sub(fish.position, point));
      const distanceAmount = Math.pow(
        clamp(distanceToCall / response.distanceAtMaximumDelay, 0, 1),
        response.distanceExponent,
      );
      fish.callDelay =
        response.minimumDelaySeconds +
        distanceAmount * response.maximumDistanceDelaySeconds +
        this.random.range(0, response.randomJitterSeconds) +
        (1 - fish.reactivity) * response.temperamentDelaySeconds;
      fish.respondedToCall = false;
      fish.callResponseAge = 0;
    }
    this.tinyFish.fleeFrom(point);
    this.ducks.callTo(point);
    this.crabs.fleeFrom(point);
    this.shrimp.fleeFrom(point);
    this.frogs.startleFrom(point);
    this.ripples.trigger("touch", point);
  }

  public scatter(): void {
    for (let index = 0; index < this.count; index += 1) {
      const fish = this.fish[index];
      // Startled koi dart off and swerve; they don't snap round on the spot.
      fish.speed = fish.maximumSpeed;
      fish.angularVelocity += this.random.range(-3, 3);
      this.enterState(fish, SwimState.Burst);
    }
    this.targetActive = false;
    this.ducks.scatter();
    this.crabs.startle();
    this.shrimp.startle();
    this.frogs.startle();
  }

  public update(dt: number, time: number): void {
    this.targetAge += dt;
    if (
      this.targetActive &&
      this.targetAge > FISH.callResponse.targetLifetimeSeconds
    ) {
      this.targetActive = false;
    }

    const desired: Vec2[] = [];
    const desiredSpeed: number[] = [];
    for (let index = 0; index < this.count; index += 1) {
      const fish = this.fish[index];
      fish.callDelay = Math.max(0, fish.callDelay - dt);
      if (this.targetActive && fish.respondedToCall) {
        fish.callResponseAge += dt;
      }
      if (this.targetActive && fish.callDelay <= 0 && !fish.respondedToCall) {
        fish.respondedToCall = true;
        fish.callResponseAge = 0;
        fish.targetDepth = FISH.depth.callRiseDepth;
        fish.depthTransitionRate = 3 / Math.max(FISH.depth.callRiseSeconds, 0.1);
        this.enterState(fish, SwimState.Burst);
      }
      this.updateNaturalState(fish, dt);
      this.updateDepth(fish, dt);
      this.updateFeeding(fish, dt);
      desired[index] = this.steeringFor(index, time);
      desiredSpeed[index] = this.desiredSpeedFor(index);
    }
    for (let index = 0; index < this.count; index += 1) {
      const fish = this.fish[index];
      this.integrate(fish, desired[index], desiredSpeed[index], dt);
      this.updateWake(fish, dt);
    }
    this.tinyFish.update(dt, time);
    this.lotus.update(dt, time, this.ripples);
    this.ducks.update(dt, this.ripples);
    this.crabs.update(dt);
    this.shrimp.update(dt);
    this.frogs.update(dt, this.ripples);

    this.ripples.update(dt);
  }

  private updateDepth(fish: Koi, dt: number): void {
    fish.depthStateAge += dt;
    const risingForCall = this.targetActive && fish.respondedToCall;
    if (!risingForCall && fish.depthStateAge >= fish.depthStateDuration) {
      fish.depthStateAge = 0;
      if (this.behaviorUnit(fish) < FISH.depth.changeProbability) {
        fish.inDeepPeriod = !fish.inDeepPeriod;
      }
      const range = fish.inDeepPeriod
        ? FISH.depth.deepRange
        : FISH.depth.shallowRange;
      const durations = fish.inDeepPeriod
        ? FISH.depth.deepDurationSeconds
        : FISH.depth.surfaceDurationSeconds;
      fish.targetDepth = this.behaviorRange(fish, range[0], range[1]);
      fish.depthStateDuration = this.behaviorRange(
        fish,
        durations[0],
        durations[1],
      );
      const transitionSeconds = this.behaviorRange(
        fish,
        FISH.depth.transitionSeconds[0],
        FISH.depth.transitionSeconds[1],
      );
      fish.depthTransitionRate = 3 / Math.max(transitionSeconds, 0.1);
    }

    fish.depth +=
      (fish.targetDepth - fish.depth) *
      (1 - Math.exp(-fish.depthTransitionRate * dt));
  }

  /**
   * A koi swimming just under the surface parts the water: rings trail off
   * behind it like a duck's wake, stronger the shallower and faster it goes.
   */
  private updateWake(fish: Koi, dt: number): void {
    const wake = FISH.wake;
    const shallowness = 1 - fish.depth / Math.max(wake.depth, 0.001);
    if (shallowness <= 0 || fish.speed < wake.minimumSpeed) {
      fish.wakeCountdown = Math.min(fish.wakeCountdown, wake.interval);
      return;
    }
    const pace = clamp(fish.speed / Math.max(fish.cruiseSpeed, 0.001), 0.4, 2.5);
    fish.wakeCountdown -= dt * pace;
    if (fish.wakeCountdown > 0) return;
    fish.wakeCountdown = wake.interval;
    // The water parts over the back, behind the widest part of the body.
    const back = fish.spine[Math.round((SPINE_NODES - 1) * 0.55)];
    this.ripples.trigger("wake", back, Math.min(1.6, shallowness * wake.strength * Math.min(pace, 1.6)));
  }

  private updateFeeding(fish: Koi, dt: number): void {
    fish.gulpAnimation = Math.max(0, fish.gulpAnimation - dt);
    fish.gulpCountdown -= dt;
    if (fish.gulpCountdown > 0) return;

    const calmState =
      fish.state === SwimState.Hover ||
      fish.state === SwimState.Coast ||
      fish.state === SwimState.Glide;
    const chasing = this.targetActive && fish.respondedToCall;
    const eligible =
      calmState &&
      !chasing &&
      fish.depth <= FISH.feeding.eligibleDepth &&
      fish.speed <= fish.cruiseSpeed * FISH.feeding.eligibleSpeedFraction;

    if (!eligible) {
      fish.gulpCountdown = this.behaviorRange(
        fish,
        FISH.feeding.retryDelaySeconds[0],
        FISH.feeding.retryDelaySeconds[1],
      );
      return;
    }

    const forwardX = Math.cos(fish.heading);
    const forwardY = Math.sin(fish.heading);
    const mouthDistance = fish.bodyWidth * FISH.feeding.mouthForwardOffset;
    this.ripples.trigger("mouth", {
      x: fish.position.x + forwardX * mouthDistance,
      y: fish.position.y + forwardY * mouthDistance,
    });
    fish.gulpAnimation = FISH.feeding.animationDurationSeconds;
    fish.gulpCountdown = this.behaviorRange(
      fish,
      FISH.feeding.intervalSeconds[0],
      FISH.feeding.intervalSeconds[1],
    );
  }

  private behaviorUnit(fish: Koi): number {
    let value = fish.behaviorRng >>> 0;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    fish.behaviorRng = value >>> 0;
    return (fish.behaviorRng & 0x00ffffff) / 0x01000000;
  }

  private behaviorRange(fish: Koi, low: number, high: number): number {
    return low + (high - low) * this.behaviorUnit(fish);
  }

  private enterState(fish: Koi, next: SwimState): void {
    fish.state = next;
    fish.stateAge = 0;
    switch (next) {
      case SwimState.Glide:
        fish.stateDuration = this.behaviorRange(fish, 1.7, 5.2);
        break;
      case SwimState.Coast:
        fish.stateDuration = this.behaviorRange(fish, 0.7, 2.1);
        break;
      case SwimState.Hover:
        fish.stateDuration = this.behaviorRange(fish, 0.65, 3.1);
        break;
      case SwimState.Burst:
        fish.stateDuration = this.behaviorRange(fish, 0.32, 0.92);
        break;
      case SwimState.Pivot: {
        fish.stateDuration = this.behaviorRange(fish, 0.3, 0.78);
        const direction = this.behaviorUnit(fish) < 0.5 ? -1 : 1;
        fish.pivotHeading = wrapAngle(
          fish.heading + direction * this.behaviorRange(fish, 0.85, 2.35),
        );
        break;
      }
    }
  }

  private updateNaturalState(fish: Koi, dt: number): void {
    fish.stateAge += dt;
    if (fish.stateAge < fish.stateDuration) return;
    // A pivot keeps swimming round until it faces its new way (or gives up).
    if (
      fish.state === SwimState.Pivot &&
      fish.stateAge < 6 &&
      Math.abs(wrapAngle(fish.pivotHeading - fish.heading)) > 0.25
    ) return;

    const roll = this.behaviorUnit(fish);
    switch (fish.state) {
      case SwimState.Glide:
        if (roll < 0.25) this.enterState(fish, SwimState.Coast);
        else if (roll < 0.43) this.enterState(fish, SwimState.Hover);
        else if (roll < 0.61) this.enterState(fish, SwimState.Pivot);
        else if (roll < 0.72) this.enterState(fish, SwimState.Burst);
        else this.enterState(fish, SwimState.Glide);
        break;
      case SwimState.Coast:
        if (roll < 0.38) this.enterState(fish, SwimState.Hover);
        else if (roll < 0.72) this.enterState(fish, SwimState.Glide);
        else if (roll < 0.9) this.enterState(fish, SwimState.Pivot);
        else this.enterState(fish, SwimState.Burst);
        break;
      case SwimState.Hover:
        if (roll < 0.34) this.enterState(fish, SwimState.Pivot);
        else if (roll < 0.55) this.enterState(fish, SwimState.Burst);
        else this.enterState(fish, SwimState.Glide);
        break;
      case SwimState.Burst:
        this.enterState(fish, SwimState.Coast);
        break;
      case SwimState.Pivot:
        this.enterState(fish, roll < 0.38 ? SwimState.Burst : SwimState.Glide);
        break;
    }
  }

  private steeringFor(index: number, time: number): Vec2 {
    const fish = this.fish[index];
    const forward = fromAngle(fish.heading);
    let steering = mul(forward, 0.95);

    if (fish.state === SwimState.Pivot) {
      steering = mul(fromAngle(fish.pivotHeading), 4.7);
    } else if (fish.state !== SwimState.Hover) {
      const wander =
        Math.sin(time * 0.29 + fish.wanderSeed) * 0.7 +
        Math.sin(time * 0.113 + fish.wanderSeed * 1.73) * 0.45;
      steering = add(steering, mul(fromAngle(fish.heading + wander), 0.62));
    }

    let separation = vec();
    let alignment = vec();
    let cohesion = vec();
    let neighbours = 0;

    for (let other = 0; other < this.count; other += 1) {
      if (other === index) continue;
      const offset = sub(fish.position, this.fish[other].position);
      const distance = length(offset);
      if (distance > 0.001 && distance < 37) {
        neighbours += 1;
        cohesion = add(cohesion, this.fish[other].position);
        alignment = add(alignment, normalize(this.fish[other].velocity));
        if (distance < 14) {
          separation = add(separation, mul(normalize(offset), (14 - distance) / 14));
        }
      }
    }

    if (neighbours > 0) {
      cohesion = normalize(sub(mul(cohesion, 1 / neighbours), fish.position), forward);
      alignment = normalize(alignment, forward);
      steering = add(steering, mul(cohesion, 0.25));
      steering = add(steering, mul(alignment, 0.42));
      steering = add(steering, mul(separation, 2.8));
    }

    const margin = 32;
    const edgeForce = vec();
    if (fish.position.x < margin) edgeForce.x += (margin - fish.position.x) / margin;
    if (fish.position.x > CANVAS_WIDTH - margin) {
      edgeForce.x -= (fish.position.x - (CANVAS_WIDTH - margin)) / margin;
    }
    if (fish.position.y < margin) edgeForce.y += (margin - fish.position.y) / margin;
    if (fish.position.y > CANVAS_HEIGHT - margin) {
      edgeForce.y -= (fish.position.y - (CANVAS_HEIGHT - margin)) / margin;
    }
    steering = add(steering, mul(edgeForce, 4.8));

    if (this.targetActive && fish.callDelay <= 0) {
      const toTarget = sub(this.target, fish.position);
      const distance = length(toTarget);
      if (distance > 13) {
        const chasePull =
          fish.callResponseAge < FISH.callResponse.chaseBoostSeconds
            ? 3.35
            : 2.45;
        steering = add(steering, mul(normalize(toTarget), chasePull));
      } else {
        const targetDirection = normalize(toTarget, forward);
        steering = add(steering, mul(perpendicular(targetDirection), 2.2));
        steering = add(steering, mul(targetDirection, -0.5));
      }
    }

    return normalize(steering, forward);
  }

  private desiredSpeedFor(index: number): number {
    const fish = this.fish[index];
    const chaseDuration = FISH.callResponse.chaseBoostSeconds;
    const chasing =
      this.targetActive &&
      fish.respondedToCall &&
      fish.callResponseAge < chaseDuration;
    if (chasing) {
      const chaseFade = 1 - clamp(fish.callResponseAge / chaseDuration, 0, 1);
      return (
        fish.maximumSpeed *
        (FISH.callResponse.chaseSpeedMultiplier +
          chaseFade * FISH.callResponse.initialExtraSpeedMultiplier)
      );
    }

    let intention = fish.cruiseSpeed;
    if (this.targetActive && fish.callDelay <= 0) {
      const distance = length(sub(this.target, fish.position));
      const urgency = clamp(distance / 105, 0.2, 1);
      intention = fish.cruiseSpeed + (fish.maximumSpeed - fish.cruiseSpeed) * urgency;
    }

    switch (fish.state) {
      case SwimState.Glide:
        return intention;
      case SwimState.Coast:
        return intention * 0.28;
      case SwimState.Hover:
        // Holding still is never quite still.
        return fish.cruiseSpeed * FISH.swimming.hoverDrift;
      case SwimState.Burst:
        return fish.maximumSpeed * 1.08;
      case SwimState.Pivot:
        // Turning takes way: a pivot is a tight turn swum forward.
        return fish.cruiseSpeed * 0.85;
    }
  }

  private integrate(fish: Koi, desired: Vec2, desiredSpeed: number, dt: number): void {
    let speedResponse = 1.65;
    // Gliding koi hold their tails nearly still.
    let tailUse = 1;
    switch (fish.state) {
      case SwimState.Glide:
        break;
      case SwimState.Coast:
        speedResponse = 1.05;
        tailUse = 0.35;
        break;
      case SwimState.Hover:
        // Ease to a near stop rather than braking; the fins keep sculling.
        speedResponse = 1.3;
        break;
      case SwimState.Burst:
        speedResponse = 6.4;
        break;
      case SwimState.Pivot:
        speedResponse = 3.2;
        break;
    }
    fish.speed += (desiredSpeed - fish.speed) * (1 - Math.exp(-speedResponse * dt));

    // The tail works as hard as the swimming needs: harder the faster the koi
    // goes and the harder it speeds up. A slow koi only sways it.
    const swimming = FISH.swimming;
    const pace = clamp(fish.speed / fish.maximumSpeed, 0, 1.3);
    const push = clamp((desiredSpeed - fish.speed) / fish.maximumSpeed, 0, 1);
    const desiredTailEffort =
      (swimming.idleTailEffort + pace * swimming.speedTailEffort + push * swimming.accelerationTailEffort) * tailUse;
    fish.tailEffort += (desiredTailEffort - fish.tailEffort) * (1 - Math.exp(-swimming.effortResponse * dt));

    const desiredHeading = Math.atan2(desired.y, desired.x);
    const headingError = wrapAngle(desiredHeading - fish.heading);
    const pivoting = fish.state === SwimState.Pivot;
    const turnMultiplier = pivoting ? 2.65 : 1;
    const angularDamping = pivoting ? 2.15 : 3.8;
    const turning = FISH.turning;
    // Turns ease in and out rather than snapping.
    const angularAcceleration = clamp(
      headingError * fish.turnStrength * turnMultiplier - fish.angularVelocity * angularDamping,
      -turning.turnEase,
      turning.turnEase,
    );
    fish.angularVelocity += angularAcceleration * dt;
    // A koi never spins on the spot: it turns by swimming forward along a
    // curve. How tight that curve may be depends on its body (a longer koi is
    // stiffer), on the kind of turn (only a koi racing to food turns as hard
    // as it can), and on its speed (a slow koi barely bends).
    const chasing = this.targetActive && fish.respondedToCall;
    const tightness = chasing || fish.state === SwimState.Burst
      ? 1
      : pivoting ? turning.pivotTightness : turning.cruiseTightness;
    const bendForSpeed = clamp(fish.speed / Math.max(fish.cruiseSpeed * turning.fullBendSpeed, 0.001), 0.1, 1);
    const curvatureLimit = (this.maximumBend(fish) / fish.bodyLength) * tightness * bendForSpeed;
    const steerage = Math.max(fish.speed, turning.idleTurnSpeed);
    const turnLimit = Math.min(pivoting ? 4.35 : 2.25, steerage * curvatureLimit);
    fish.angularVelocity = clamp(fish.angularVelocity, -turnLimit, turnLimit);
    fish.heading = wrapAngle(fish.heading + fish.angularVelocity * dt);

    // Thrust comes in pulses, one per stroke of the tail.
    const stroke = 1 + swimming.strokeSurge * Math.min(fish.tailEffort, 1) * Math.sin(2 * fish.swimPhase);
    fish.velocity = mul(fromAngle(fish.heading), fish.speed * stroke);
    fish.position = add(fish.position, mul(fish.velocity, dt));

    fish.swimPhase += (1.2 + Math.min(pace, 1) * 6 + fish.tailEffort * 1.2) * dt;
    fish.finPhase += (3 + (1 - Math.min(pace, 1)) * 3) * dt;

    // The body bends along the curve the head is swimming (or a share of it):
    // an even arc, settling like a body would.
    const targetCurvature = (fish.angularVelocity / steerage) * turning.bodyFollow;
    fish.curvature += (targetCurvature - fish.curvature) * (1 - Math.exp(-dt / turning.bodyResponse));
    this.layBody(fish);
  }

  /** Lays the spine back from the head along an arc of the body's curvature. */
  private layBody(fish: Koi): void {
    const spacing = fish.bodyLength / (SPINE_NODES - 1);
    fish.spine[0] = { ...fish.position };
    for (let node = 1; node < SPINE_NODES; node += 1) {
      const angle = fish.heading - fish.curvature * spacing * (node - 0.5);
      fish.spine[node] = sub(fish.spine[node - 1], mul(fromAngle(angle), spacing));
    }
  }

  /** The tightest C this koi can curl into, head to tail (radians). */
  public maximumBend(fish: Koi): number {
    const turning = FISH.turning;
    const stiffness = Math.pow(turning.referenceLength / Math.max(fish.bodyLength, 1), turning.lengthStiffness);
    return clamp(turning.maxBodyBend * stiffness, 0.2, 2.9);
  }

}
