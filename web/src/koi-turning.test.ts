import { describe, expect, it } from "vitest";
import { SPINE_NODES } from "./config";
import { SwimState, swimWave } from "./koi";
import { length, sub, wrapAngle } from "./math";
import { School } from "./school";

const STEP = 1 / 60;

function bodyBend(school: School, index: number): number {
  const fish = school.fish[index];
  const tail = sub(fish.spine[SPINE_NODES - 2], fish.spine[SPINE_NODES - 1]);
  return Math.abs(wrapAngle(fish.heading - Math.atan2(tail.y, tail.x)));
}

function lone(): School {
  const school = new School();
  school.setCount(1);
  let time = 0;
  for (let step = 0; step < 60; step += 1) school.update(STEP, (time += STEP));
  return school;
}

describe("koi swimming and turning", () => {
  it("curl into a C at most, never fold the head back, and never snap round on the spot", () => {
    const school = new School();
    let time = 0;
    let worstExcess = 0;
    let closestHead = Infinity;
    let worstSnap = 0;
    for (let step = 0; step < 60 * 90; step += 1) {
      // Calls and scatters force the sharpest turns.
      if (step % 600 === 0) school.callTo({ x: 60 + ((step * 7) % 360), y: 40 + ((step * 3) % 190) });
      if (step % 1500 === 750) school.scatter();
      const headings = school.fish.slice(0, school.count).map((fish) => fish.heading);
      school.update(STEP, (time += STEP));
      for (let index = 0; index < school.count; index += 1) {
        const fish = school.fish[index];
        worstExcess = Math.max(worstExcess, bodyBend(school, index) - school.maximumBend(fish));
        worstSnap = Math.max(worstSnap, Math.abs(wrapAngle(fish.heading - headings[index])));
        for (let node = 5; node < SPINE_NODES; node += 1) {
          closestHead = Math.min(closestHead, length(sub(fish.spine[0], fish.spine[node])) / fish.bodyLength);
        }
      }
    }
    expect(worstExcess).toBeLessThan(0.05);
    expect(closestHead).toBeGreaterThan(0.25);
    // Never more than a few degrees of turn in one 60 Hz step.
    expect(worstSnap).toBeLessThan(0.08);
  }, 30_000);

  it("lets a shorter koi curl tighter than a longer one", () => {
    const school = new School();
    const short = school.fish[0];
    const long = school.fish[1];
    short.bodyLength = 18;
    long.bodyLength = 40;
    expect(school.maximumBend(short)).toBeGreaterThan(school.maximumBend(long));
  });

  it("turns around by swimming a curve, never spinning on the spot", () => {
    const school = lone();
    const fish = school.fish[0];
    fish.state = SwimState.Pivot;
    fish.stateAge = 0;
    fish.stateDuration = 0.6;
    fish.pivotHeading = wrapAngle(fish.heading + 2.2);
    let turned = 0;
    let travelled = 0;
    let time = 0;
    for (let step = 0; step < 240; step += 1) {
      const heading = fish.heading;
      const head = { ...fish.position };
      school.update(STEP, (time += STEP));
      turned += Math.abs(wrapAngle(fish.heading - heading));
      travelled += length(sub(fish.position, head));
    }
    expect(turned).toBeGreaterThan(1.5);
    // The head swims at least the arc of its tightest circle for that turn.
    const tightestRadius = fish.bodyLength / school.maximumBend(fish);
    expect(travelled).toBeGreaterThan(tightestRadius * turned * 0.8);
  });

  it("keeps drifting, sculling its fins, and swaying its tail while holding still", () => {
    const school = lone();
    const fish = school.fish[0];
    fish.state = SwimState.Hover;
    fish.stateAge = 0;
    fish.stateDuration = 99;
    let time = 0;
    for (let step = 0; step < 120; step += 1) school.update(STEP, (time += STEP));
    const start = { ...fish.position };
    const fins = fish.finPhase;
    const tail = fish.swimPhase;
    for (let step = 0; step < 180; step += 1) school.update(STEP, (time += STEP));
    expect(fish.finPhase - fins).toBeGreaterThan(9);
    expect(fish.swimPhase - tail).toBeGreaterThan(3);
    expect(fish.tailEffort).toBeGreaterThan(0.15);
    const drift = length(sub(fish.position, start));
    expect(drift).toBeGreaterThan(0.5);
    expect(drift).toBeLessThan(20);
  });

  it("starting off from rest, only sways its tail gently and keeps its body nearly straight while slow", () => {
    const school = lone();
    const fish = school.fish[0];
    fish.state = SwimState.Hover;
    fish.stateAge = 0;
    fish.stateDuration = 99;
    let time = 0;
    for (let step = 0; step < 180; step += 1) school.update(STEP, (time += STEP));
    // From rest, a koi often sets off by turning around.
    fish.state = SwimState.Pivot;
    fish.stateAge = 0;
    fish.stateDuration = 0.6;
    fish.pivotHeading = wrapAngle(fish.heading + 2.2);
    let effortWhileSlow = 0;
    let bendWhileSlow = 0;
    for (let step = 0; step < 120; step += 1) {
      school.update(STEP, (time += STEP));
      if (fish.speed > fish.cruiseSpeed * 0.35) break;
      effortWhileSlow = Math.max(effortWhileSlow, fish.tailEffort);
      bendWhileSlow = Math.max(bendWhileSlow, Math.abs(fish.curvature) * fish.bodyLength);
    }
    expect(effortWhileSlow).toBeLessThan(0.4);
    expect(bendWhileSlow).toBeLessThan(0.4);
  });

  it("keeps its body nearly straight on ordinary cruising turns", () => {
    const school = lone();
    const fish = school.fish[0];
    fish.state = SwimState.Glide;
    fish.stateAge = 0;
    fish.stateDuration = 999;
    let time = 0;
    let bend = 0;
    for (let step = 0; step < 60 * 30; step += 1) {
      school.update(STEP, (time += STEP));
      bend = Math.max(bend, Math.abs(fish.curvature) * fish.bodyLength);
    }
    // Under about 35°, head to tail.
    expect(bend).toBeLessThan(0.6);
  });

  it("works its tail harder the faster it swims", () => {
    const effortAt = (state: SwimState): number => {
      const school = lone();
      const fish = school.fish[0];
      fish.state = state;
      fish.stateAge = 0;
      fish.stateDuration = 999;
      let time = 0;
      for (let step = 0; step < 240; step += 1) school.update(STEP, (time += STEP));
      return fish.tailEffort;
    };
    const holding = effortAt(SwimState.Hover);
    const cruising = effortAt(SwimState.Glide);
    expect(holding).toBeLessThan(0.2);
    expect(cruising).toBeGreaterThan(holding + 0.15);
  });

  it("leaves a V-shaped wake from its head when swimming just under the surface, but not when deep", () => {
    const wakesBehind = (depth: number): number => {
      const school = lone();
      const fish = school.fish[0];
      fish.state = SwimState.Glide;
      fish.stateAge = 0;
      fish.stateDuration = 999;
      let time = 0;
      let count = 0;
      for (let step = 0; step < 240; step += 1) {
        fish.depth = depth;
        fish.targetDepth = depth;
        fish.depthStateAge = 0;
        school.update(STEP, (time += STEP));
        const bow = fish.spine[Math.round((SPINE_NODES - 1) * 0.15)];
        count += school.ripples.instances.filter(
          (ripple) =>
            ripple.alive && ripple.type === "wake" && ripple.age < STEP * 1.5 && length(sub(ripple.center, bow)) < 4 &&
            // A crest of a V, opening along the koi's heading.
            Math.cos(fish.heading) * ripple.directionX + Math.sin(fish.heading) * ripple.directionY > 0.99,
        ).length;
      }
      return count;
    };
    expect(wakesBehind(0.04)).toBeGreaterThan(4);
    expect(wakesBehind(0.6)).toBe(0);
  });

  it("sways like a fish, not an eel: the front of the body stays nearly still", () => {
    const fish = new School().fish[0];
    fish.tailEffort = 1;
    let front = 0;
    let tail = 0;
    for (let phase = 0; phase < Math.PI * 2; phase += 0.05) {
      fish.swimPhase = phase;
      front = Math.max(front, Math.abs(swimWave(fish, 0.35)));
      tail = Math.max(tail, Math.abs(swimWave(fish, 1)));
    }
    expect(front).toBeLessThan(tail * 0.2);
  });
});
