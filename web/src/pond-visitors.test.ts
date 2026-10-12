import { describe, expect, it } from "vitest";
import { CANVAS_HEIGHT, CANVAS_WIDTH } from "./config";
import { Crabs } from "./crabs";
import { DuckFamilies, duckRadius } from "./ducks";
import { Frogs } from "./frogs";
import { length, sub, vec } from "./math";
import { lotusLeafCircles, type LeafCircle } from "./pond-layout";
import { RippleSystem } from "./ripple-system";
import { ShrimpSchool } from "./shrimp";

const STEP = 1 / 60;

function run(seconds: number, step: (dt: number, time: number) => void, startTime = 0): number {
  let time = startTime;
  for (let elapsed = 0; elapsed < seconds; elapsed += STEP) {
    time += STEP;
    step(STEP, time);
  }
  return time;
}

describe("ducks", () => {
  it("paddle around for minutes without ever climbing onto a lotus leaf or leaving the pond", () => {
    const families = new DuckFamilies();
    const ripples = new RippleSystem();
    const leaves: LeafCircle[] = [];
    let worstOverlap = 0;
    run(180, (dt, time) => {
      families.update(dt, time, ripples);
      lotusLeafCircles(time, leaves);
      for (const duck of families.ducks) {
        expect(duck.position.x).toBeGreaterThanOrEqual(0);
        expect(duck.position.x).toBeLessThanOrEqual(CANVAS_WIDTH);
        expect(duck.position.y).toBeGreaterThanOrEqual(0);
        expect(duck.position.y).toBeLessThanOrEqual(CANVAS_HEIGHT);
        for (const leaf of leaves) {
          worstOverlap = Math.max(worstOverlap, leaf.radius + duckRadius(duck) * 0.7 - length(sub(duck.position, leaf)));
        }
      }
    });
    expect(worstOverlap).toBeLessThan(0.5);
  });

  it("keep ducklings in a line close behind their mother", () => {
    const families = new DuckFamilies();
    const ripples = new RippleSystem();
    run(60, (dt, time) => families.update(dt, time, ripples));
    const ducklings = families.ducks.filter((duck) => duck.duckling);
    expect(ducklings.length).toBeGreaterThan(0);
    for (const duckling of ducklings) {
      const leader = families.ducks[duckling.leader];
      expect(length(sub(duckling.position, leader.position))).toBeLessThan(30);
    }
  });

  it("paddle over to a click nearby, then dabble there", () => {
    const families = new DuckFamilies();
    const ripples = new RippleSystem();
    const mother = families.ducks[0];
    const food = { x: mother.position.x + 50, y: mother.position.y };
    families.callTo(food);
    expect(mother.state).toBe("approach");
    let closest = Infinity;
    let dabbled = false;
    run(10, (dt, time) => {
      families.update(dt, time, ripples);
      closest = Math.min(closest, length(sub(mother.position, food)));
      dabbled ||= mother.state === "dabble";
    });
    expect(closest).toBeLessThan(10);
    expect(dabbled).toBe(true);
  });

  it("leave a wake while paddling", () => {
    const families = new DuckFamilies();
    const ripples = new RippleSystem();
    run(5, (dt, time) => families.update(dt, time, ripples));
    expect(ripples.instances.some((ripple) => ripple.alive && ripple.type === "wake")).toBe(true);
  });
});

describe("crabs and shrimp", () => {
  it("crabs scuttle away from a click", () => {
    const crabs = new Crabs();
    const crab = crabs.crabs[0];
    const threat = { x: crab.position.x + 10, y: crab.position.y };
    const before = length(sub(crab.position, threat));
    crabs.fleeFrom(threat);
    run(1.2, (dt) => crabs.update(dt));
    expect(length(sub(crab.position, threat))).toBeGreaterThan(before + 8);
  });

  it("shrimp face a click and dart backward, away from it", () => {
    const school = new ShrimpSchool();
    const shrimp = school.shrimp[0];
    const threat = { x: shrimp.position.x, y: shrimp.position.y + 12 };
    school.fleeFrom(threat);
    run(1, (dt) => school.update(dt));
    expect(length(sub(shrimp.position, threat))).toBeGreaterThan(28);
  });
});

describe("frogs", () => {
  it("start on lotus leaves, leap into the water when startled, and swim back to a leaf", () => {
    const frogs = new Frogs();
    const ripples = new RippleSystem();
    const leaves: LeafCircle[] = [];
    const frog = frogs.frogs[0];
    lotusLeafCircles(0, leaves);
    expect(frog.state).toBe("sit");
    expect(length(sub(frog.position, leaves[frog.leaf]))).toBeLessThan(leaves[frog.leaf].radius);

    frogs.startleFrom(vec(frog.position.x + 5, frog.position.y));
    expect(frog.state).toBe("hop");
    const time = run(1, (dt, now) => frogs.update(dt, now, ripples));
    expect(frog.state).toBe("swim");
    expect(ripples.instances.some((ripple) => ripple.alive && ripple.type === "touch")).toBe(true);

    let backOnLeaf = false;
    run(30, (dt, now) => {
      frogs.update(dt, now, ripples);
      backOnLeaf ||= frog.state === "sit";
    }, time);
    expect(backOnLeaf).toBe(true);
  });
});
