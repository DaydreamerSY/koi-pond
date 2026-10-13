import { describe, expect, it } from "vitest";
import { SPINE_NODES } from "./config";
import { SwimState } from "./koi";
import { length, sub, wrapAngle } from "./math";
import { School } from "./school";

const STEP = 1 / 60;

function bodyBend(school: School, index: number): number {
  const fish = school.fish[index];
  const tail = sub(fish.spine[SPINE_NODES - 2], fish.spine[SPINE_NODES - 1]);
  return Math.abs(wrapAngle(fish.heading - Math.atan2(tail.y, tail.x)));
}

describe("koi turning", () => {
  it("curl into a C at most, and never fold the head back against the body", () => {
    const school = new School();
    let time = 0;
    let worstExcess = 0;
    let closestHead = Infinity;
    for (let step = 0; step < 60 * 90; step += 1) {
      school.update(STEP, (time += STEP));
      // Calls and scatters force the sharpest turns.
      if (step % 600 === 0) school.callTo({ x: 60 + ((step * 7) % 360), y: 40 + ((step * 3) % 190) });
      if (step % 1500 === 750) school.scatter();
      for (let index = 0; index < school.count; index += 1) {
        const fish = school.fish[index];
        worstExcess = Math.max(worstExcess, bodyBend(school, index) - school.maximumBend(fish));
        for (let node = 5; node < SPINE_NODES; node += 1) {
          closestHead = Math.min(closestHead, length(sub(fish.spine[0], fish.spine[node])) / fish.bodyLength);
        }
      }
    }
    expect(worstExcess).toBeLessThan(0.05);
    expect(closestHead).toBeGreaterThan(0.25);
  }, 30_000);

  it("lets a shorter koi curl tighter than a longer one", () => {
    const school = new School();
    const short = school.fish[0];
    const long = school.fish[1];
    short.bodyLength = 18;
    long.bodyLength = 40;
    expect(school.maximumBend(short)).toBeGreaterThan(school.maximumBend(long));
  });

  it("turns a slow koi around the middle of its body, not around its nose", () => {
    const school = new School();
    school.setCount(1);
    const fish = school.fish[0];
    let time = 0;
    for (let step = 0; step < 60; step += 1) school.update(STEP, (time += STEP));
    const middleBefore = { ...fish.spine[4] };
    const headBefore = { ...fish.spine[0] };
    fish.state = SwimState.Pivot;
    fish.stateAge = 0;
    fish.stateDuration = 0.6;
    fish.pivotHeading = wrapAngle(fish.heading + 2);
    for (let step = 0; step < 36; step += 1) school.update(STEP, (time += STEP));
    expect(length(sub(fish.spine[0], headBefore))).toBeGreaterThan(length(sub(fish.spine[4], middleBefore)));
  });
});
