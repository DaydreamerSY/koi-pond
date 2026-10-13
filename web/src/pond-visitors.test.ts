import { describe, expect, it } from "vitest";
import { CANVAS_HEIGHT, CANVAS_WIDTH } from "./config";
import { Crabs } from "./crabs";
import { DuckFamilies, duckBodyRadius, duckRadius } from "./ducks";
import { Frogs } from "./frogs";
import { LotusMotion } from "./lotus-motion";
import { length, sub, vec } from "./math";
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

/** The floating leaves and the ripples that move them, stepped like School does. */
function pond(): { lotus: LotusMotion; ripples: RippleSystem; step: (dt: number, time: number) => void } {
  const lotus = new LotusMotion();
  const ripples = new RippleSystem();
  return {
    lotus,
    ripples,
    step: (dt, time) => {
      lotus.update(dt, time, ripples);
      ripples.update(dt);
    },
  };
}

describe("ducks", () => {
  it("paddle around for minutes without ever climbing onto a lotus leaf or leaving the pond", () => {
    const { lotus, ripples, step } = pond();
    const families = new DuckFamilies(lotus);
    let worstOverlap = 0;
    run(180, (dt, time) => {
      step(dt, time);
      families.update(dt, ripples);
      for (const duck of families.ducks) {
        expect(duck.position.x).toBeGreaterThanOrEqual(0);
        expect(duck.position.x).toBeLessThanOrEqual(CANVAS_WIDTH);
        expect(duck.position.y).toBeGreaterThanOrEqual(0);
        expect(duck.position.y).toBeLessThanOrEqual(CANVAS_HEIGHT);
        for (const leaf of lotus.leaves) {
          worstOverlap = Math.max(worstOverlap, leaf.radius + duckRadius(duck) * 0.7 - length(sub(duck.position, leaf)));
        }
      }
    });
    expect(worstOverlap).toBeLessThan(0.5);
  });

  it("keep ducklings in a line close behind their mother", () => {
    const { lotus, ripples, step } = pond();
    const families = new DuckFamilies(lotus);
    run(60, (dt, time) => {
      step(dt, time);
      families.update(dt, ripples);
    });
    const ducklings = families.ducks.filter((duck) => duck.duckling);
    expect(ducklings.length).toBeGreaterThan(0);
    for (const duckling of ducklings) {
      const leader = families.ducks[duckling.leader];
      expect(length(sub(duckling.position, leader.position))).toBeLessThan(30);
    }
  });

  it("paddle over to a click nearby, then dabble there", () => {
    const { lotus, ripples, step } = pond();
    const families = new DuckFamilies(lotus);
    const mother = families.ducks[0];
    const food = { x: mother.position.x + 50, y: mother.position.y };
    families.callTo(food);
    expect(mother.state).toBe("approach");
    let closest = Infinity;
    let dabbled = false;
    run(10, (dt, time) => {
      step(dt, time);
      families.update(dt, ripples);
      closest = Math.min(closest, length(sub(mother.position, food)));
      dabbled ||= mother.state === "dabble";
    });
    expect(closest).toBeLessThan(10);
    expect(dabbled).toBe(true);
  });

  it("keep their bodies apart, even crowding around food", () => {
    const { lotus, ripples, step } = pond();
    const families = new DuckFamilies(lotus);
    const ducks = families.ducks;
    let worst = Infinity;
    run(120, (dt, time) => {
      step(dt, time);
      // Throw food between the ducks every few seconds, and startle them now and then.
      if (Math.round(time * 60) % 480 === 0) families.callTo({ x: 240 + Math.sin(time) * 60, y: 135 + Math.cos(time) * 40 });
      if (Math.round(time * 60) % 1800 === 900) families.scatter();
      families.update(dt, ripples);
      for (let a = 0; a < ducks.length; a += 1) {
        for (let b = a + 1; b < ducks.length; b += 1) {
          const room = duckBodyRadius(ducks[a]) + duckBodyRadius(ducks[b]);
          worst = Math.min(worst, length(sub(ducks[a].position, ducks[b].position)) / room);
        }
      }
    });
    expect(worst).toBeGreaterThan(0.9);
  });

  it("leave a wake while paddling", () => {
    const { lotus, ripples } = pond();
    const families = new DuckFamilies(lotus);
    run(5, (dt) => families.update(dt, ripples));
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
    const { lotus, ripples, step } = pond();
    const frogs = new Frogs(lotus);
    const frog = frogs.frogs[0];
    expect(frog.state).toBe("sit");
    expect(length(sub(frog.position, lotus.leaves[frog.leaf]))).toBeLessThan(lotus.leaves[frog.leaf].radius);

    frogs.startleFrom(vec(frog.position.x + 5, frog.position.y));
    expect(frog.state).toBe("hop");
    let splashed = false;
    const time = run(1, (dt, now) => {
      step(dt, now);
      frogs.update(dt, ripples);
      splashed ||= ripples.instances.some((ripple) => ripple.alive && ripple.type === "touch");
    });
    expect(frog.state).toBe("swim");
    expect(splashed).toBe(true);

    let backOnLeaf = false;
    run(30, (dt, now) => {
      step(dt, now);
      frogs.update(dt, ripples);
      backOnLeaf ||= frog.state === "sit";
    }, time);
    expect(backOnLeaf).toBe(true);
  });
});

describe("lotus leaves", () => {
  it("drift, rise, and twist as a ripple passes under, then bob back to rest", () => {
    const disturbed = pond();
    const calm = pond();
    const leaf = disturbed.lotus.leaves[12];
    disturbed.ripples.trigger("touch", { x: leaf.x - leaf.radius - 4, y: leaf.y });

    let farthest = 0;
    let highest = 0;
    let twisted = 0;
    let time = run(2, (dt, now) => {
      disturbed.step(dt, now);
      calm.step(dt, now);
      const a = disturbed.lotus.leaves[12];
      const b = calm.lotus.leaves[12];
      farthest = Math.max(farthest, length(sub(a, b)));
      highest = Math.max(highest, a.lift - b.lift);
      twisted = Math.max(twisted, Math.abs(a.rotation - b.rotation));
    });
    expect(farthest).toBeGreaterThan(1);
    expect(highest).toBeGreaterThan(0.01);
    expect(twisted).toBeGreaterThan(0.01);
    // Pushed away from where the ring came from.
    expect(disturbed.lotus.leaves[12].x).toBeGreaterThan(calm.lotus.leaves[12].x);

    time = run(25, (dt, now) => {
      disturbed.step(dt, now);
      calm.step(dt, now);
    }, time);
    expect(length(sub(disturbed.lotus.leaves[12], calm.lotus.leaves[12]))).toBeLessThan(0.1);
    expect(Math.abs(disturbed.lotus.leaves[12].lift - calm.lotus.leaves[12].lift)).toBeLessThan(0.002);
    expect(time).toBeGreaterThan(0);
  });

  it("dip when a frog lands on them", () => {
    const disturbed = pond();
    const calm = pond();
    disturbed.lotus.bump(3);
    let deepest = 0;
    run(0.5, (dt, now) => {
      disturbed.step(dt, now);
      calm.step(dt, now);
      deepest = Math.min(deepest, disturbed.lotus.leaves[3].lift - calm.lotus.leaves[3].lift);
    });
    expect(deepest).toBeLessThan(-0.02);
  });
});
