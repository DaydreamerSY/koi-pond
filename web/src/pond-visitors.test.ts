import { describe, expect, it } from "vitest";
import { CANVAS_HEIGHT, CANVAS_WIDTH, DUCKS, RIPPLES } from "./config";
import { Crabs } from "./crabs";
import { DuckFamilies, duckBodyRadius, duckRadius, duckSize, tailWag, type Duck } from "./ducks";
import { Frogs } from "./frogs";
import { LotusMotion } from "./lotus-motion";
import { length, sub, vec } from "./math";
import { rippleArc, rippleRadius, RippleSystem } from "./ripple-system";
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

/** Sends a duck diving right away (beginDive is private, and fails without open water ahead, so retry). */
function sendDiving(families: DuckFamilies, duck: Duck): boolean {
  const diver = families as unknown as { beginDive(duck: Duck): boolean };
  for (let attempt = 0; attempt < 50; attempt += 1) if (diver.beginDive(duck)) return true;
  return false;
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
        // Diving, a duck may pass under a leaf.
        if (duck.submerged > 0.5) continue;
        for (const leaf of lotus.leaves) {
          worstOverlap = Math.max(worstOverlap, leaf.radius + duckRadius(duck) * 0.7 - length(sub(duck.position, leaf)));
        }
      }
    });
    expect(worstOverlap).toBeLessThan(0.5);
  });

  it("line ducklings up behind a mother who is swimming", () => {
    const { lotus, ripples, step } = pond();
    const families = new DuckFamilies(lotus);
    const mother = families.ducks[0];
    const ducklings = families.ducks.filter((duck) => duck.duckling && duck.mother === 0);
    run(8, (dt, time) => {
      mother.state = "paddle";
      mother.stateAge = 0;
      mother.stateDuration = 99;
      step(dt, time);
      families.update(dt, ripples);
    });
    expect(ducklings.length).toBeGreaterThan(1);
    for (const duckling of ducklings) {
      expect(duckling.milling).toBe(false);
      const leader = families.ducks[duckling.leader];
      const gap = length(sub(duckling.position, leader.position));
      if (leader.duckling) {
        expect(gap).toBeLessThan(15);
      } else {
        // The first one keeps clear of its mother's tail (it reaches 0.66 of her length back).
        const clear = duckSize(leader).length * 0.66 + duckSize(duckling).length * 0.5;
        expect(gap).toBeGreaterThan(clear);
        expect(gap).toBeLessThan(clear + 12);
      }
    }
  });

  it("dive and come up somewhere else", () => {
    const { lotus, ripples, step } = pond();
    const families = new DuckFamilies(lotus);
    const mother = families.ducks[0];
    const time = run(4, (dt, now) => {
      step(dt, now);
      families.update(dt, ripples);
    });
    const startedAt = { ...mother.position };
    expect(sendDiving(families, mother)).toBe(true);
    const target = { ...mother.target };
    let deepest = 0;
    let surfacedAt: { x: number; y: number } | null = null;
    run(12, (dt, now) => {
      step(dt, now);
      families.update(dt, ripples);
      deepest = Math.max(deepest, mother.submerged);
      if (!surfacedAt && mother.state === "surface") surfacedAt = { ...mother.position };
    }, time);
    // Right under, then up again where she was heading, well away from where she went down.
    expect(deepest).toBe(1);
    expect(surfacedAt).not.toBeNull();
    expect(mother.submerged).toBe(0);
    expect(length(sub(surfacedAt!, target))).toBeLessThan(5);
    expect(length(sub(surfacedAt!, startedAt))).toBeGreaterThan(30);
  });

  it("keep the ducklings still while their mother is underwater, and set off only after she is up", () => {
    const { lotus, ripples, step } = pond();
    const families = new DuckFamilies(lotus);
    const mother = families.ducks[0];
    const ducklings = families.ducks.filter((duck) => duck.duckling && duck.mother === 0);
    let time = run(4, (dt, now) => {
      step(dt, now);
      families.update(dt, ripples);
    });
    expect(sendDiving(families, mother)).toBe(true);
    // Let them come to a stop, then watch them while she's still under.
    time = run(2.5, (dt, now) => {
      step(dt, now);
      families.update(dt, ripples);
    }, time);
    expect(mother.state).toBe("dive");
    const held = ducklings.map((duck) => ({ ...duck.position }));
    let drift = 0;
    time = run(1, (dt, now) => {
      if (mother.state !== "dive") return;
      step(dt, now);
      families.update(dt, ripples);
      for (const [index, duck] of ducklings.entries()) drift = Math.max(drift, length(sub(duck.position, held[index])));
    }, time);
    expect(drift).toBeLessThan(3);
    expect(ducklings.every((duck) => duck.waiting)).toBe(true);

    // She comes up: a pause, then they head over to her.
    let upFor = -1;
    let firstMove = -1;
    run(14, (dt, now) => {
      step(dt, now);
      families.update(dt, ripples);
      if (upFor < 0 && mother.state !== "dive") upFor = 0;
      if (upFor >= 0) upFor += dt;
      if (upFor >= 0 && firstMove < 0 && ducklings.some((duck) => !duck.waiting)) firstMove = upFor;
    }, time);
    expect(firstMove).toBeGreaterThan(DUCKS.surfaceWait[0] * 0.9);
    for (const duck of ducklings) {
      expect(duck.waiting).toBe(false);
      expect(length(sub(duck.position, mother.position))).toBeLessThan(3 * 20 + 6);
    }
  });

  it("waggle their tails, always after preening", () => {
    const { lotus, ripples, step } = pond();
    const families = new DuckFamilies(lotus);
    const mother = families.ducks[0];
    mother.state = "preen";
    mother.stateAge = 0;
    mother.stateDuration = 0.5;
    let widest = 0;
    run(1.6, (dt, now) => {
      step(dt, now);
      families.update(dt, ripples);
      widest = Math.max(widest, Math.abs(tailWag(mother)));
    });
    expect(widest).toBeGreaterThan(0.2);
  });

  it("let ducklings potter about a resting mother, each its own way, then follow after a pause", () => {
    const { lotus, ripples, step } = pond();
    const families = new DuckFamilies(lotus);
    const mother = families.ducks[0];
    const ducklings = families.ducks.filter((duck) => duck.duckling && duck.mother === 0);
    const hold = (state: "rest" | "paddle"): void => {
      mother.state = state;
      mother.stateDuration = 99;
    };
    hold("rest");
    mother.stateAge = 0;
    let time = run(15, (dt, now) => {
      hold("rest");
      step(dt, now);
      families.update(dt, ripples);
    });
    // Scattered around her, not trailing in a line.
    const angles = ducklings.map((duck) => Math.atan2(duck.position.y - mother.position.y, duck.position.x - mother.position.x));
    let widest = 0;
    for (const a of angles) for (const b of angles) widest = Math.max(widest, Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))));
    expect(widest).toBeGreaterThan(1);
    for (const duck of ducklings) {
      expect(duck.milling).toBe(true);
      expect(length(sub(duck.position, mother.position))).toBeLessThan(3 * 20 + 6);
    }

    // She sets off: a short pause, then they follow.
    mother.stateAge = 0;
    time = run(0.15, (dt, now) => {
      hold("paddle");
      step(dt, now);
      families.update(dt, ripples);
    }, time);
    expect(ducklings.every((duck) => duck.milling)).toBe(true);
    run(3, (dt, now) => {
      hold("paddle");
      step(dt, now);
      families.update(dt, ripples);
    }, time);
    expect(ducklings.some((duck) => duck.milling)).toBe(false);
  });

  it("make the mother clearly bigger than her ducklings", () => {
    const { lotus } = pond();
    const families = new DuckFamilies(lotus);
    const mother = families.ducks[0];
    const duckling = families.ducks.find((duck) => duck.duckling)!;
    expect(duckSize(duckling).length).toBeLessThan(duckSize(mother).length * 0.5);
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
    // She takes her own place in the ring the hungry ducks form around the food.
    expect(closest).toBeLessThan(duckBodyRadius(mother) * 1.1 + 6);
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
          // A diving duck passes beneath the others.
          if (ducks[a].submerged > 0.5 || ducks[b].submerged > 0.5) continue;
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

describe("wakes", () => {
  /** How strongly the live ripples ring at a point, weighed as the water shader does. */
  function wakeAt(ripples: RippleSystem, point: { x: number; y: number }): number {
    let total = 0;
    for (const ripple of ripples.instances) {
      if (!ripple.alive || ripple.age < 0) continue;
      const delta = sub(point, ripple.center);
      const distance = length(delta);
      const band = Math.exp(-Math.abs(distance - rippleRadius(ripple)) * RIPPLES.types[ripple.type].bandSharpness);
      const arc = distance > 0.001 ? rippleArc(ripple, delta.x / distance, delta.y / distance) : 1;
      total += band * arc * ripple.strength;
    }
    return total;
  }

  it("trail a V behind a swimmer, not rings", () => {
    const ripples = new RippleSystem();
    const speed = 24;
    const position = { x: 60, y: 135 };
    let countdown = 0;
    run(1.4, (dt) => {
      position.x += speed * dt;
      countdown -= dt;
      if (countdown <= 0) {
        countdown = 0.08;
        ripples.triggerWake(position, 0, speed);
      }
      ripples.update(dt);
    });
    const half = (RIPPLES.wakeShape.halfAngle * Math.PI) / 180;
    let arms = 0;
    let middle = 0;
    let wide = 0;
    for (const back of [15, 20, 25]) {
      for (const sign of [-1, 1]) {
        // Along the arms of the V...
        arms += wakeAt(ripples, { x: position.x - back * Math.cos(half), y: position.y + sign * back * Math.sin(half) });
        // ...not well outside them, where rings would also reach...
        wide += wakeAt(ripples, { x: position.x - back * Math.cos(half * 2.6), y: position.y + sign * back * Math.sin(half * 2.6) });
      }
      // ...nor straight behind the swimmer.
      middle += wakeAt(ripples, { x: position.x - back, y: position.y }) * 2;
    }
    expect(arms).toBeGreaterThan(middle * 3);
    expect(arms).toBeGreaterThan(wide * 2.5);
    // Nothing ahead of the swimmer.
    expect(wakeAt(ripples, { x: position.x + 8, y: position.y })).toBeLessThan(arms * 0.02);
  });

  it("spread each crest at the swimmer's speed × sin(half-angle), or ring plainly when too slow for a V", () => {
    const ripples = new RippleSystem();
    ripples.triggerWake({ x: 100, y: 100 }, 0.5, 30);
    const crest = ripples.instances.find((ripple) => ripple.alive)!;
    expect(crest.spread).toBeCloseTo(30 * Math.sin((RIPPLES.wakeShape.halfAngle * Math.PI) / 180), 5);
    expect(Math.hypot(crest.directionX, crest.directionY)).toBeCloseTo(1, 5);
    ripples.reset();
    ripples.triggerWake({ x: 100, y: 100 }, 0.5, 1);
    const ring = ripples.instances.find((ripple) => ripple.alive)!;
    expect(ring.directionX).toBe(0);
    expect(ring.directionY).toBe(0);
    expect(rippleArc(ring, 1, 0)).toBe(1);
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
      highest = Math.max(highest, a.bob - b.bob);
      twisted = Math.max(twisted, Math.abs(a.rotation - b.rotation));
    });
    expect(farthest).toBeGreaterThan(1);
    expect(highest).toBeGreaterThan(0.3);
    expect(twisted).toBeGreaterThan(0.01);
    // Pushed away from where the ring came from.
    expect(disturbed.lotus.leaves[12].x).toBeGreaterThan(calm.lotus.leaves[12].x);

    time = run(25, (dt, now) => {
      disturbed.step(dt, now);
      calm.step(dt, now);
    }, time);
    expect(length(sub(disturbed.lotus.leaves[12], calm.lotus.leaves[12]))).toBeLessThan(0.1);
    expect(Math.abs(disturbed.lotus.leaves[12].bob - calm.lotus.leaves[12].bob)).toBeLessThan(0.05);
    expect(time).toBeGreaterThan(0);
  });

  it("dip when a frog lands on them, by only a percent or so", () => {
    const disturbed = pond();
    const calm = pond();
    disturbed.lotus.bump(3);
    let deepest = 0;
    let smallestScale = Infinity;
    run(3, (dt, now) => {
      disturbed.step(dt, now);
      calm.step(dt, now);
      deepest = Math.min(deepest, disturbed.lotus.leaves[3].bob - calm.lotus.leaves[3].bob);
      smallestScale = Math.min(smallestScale, 1 + disturbed.lotus.leaves[3].lift);
    });
    expect(deepest).toBeLessThan(-0.5);
    expect(smallestScale).toBeGreaterThan(1 - 0.015 - 1e-9);
  });

  it("scale by 0.5–1.5% at most, bigger leaves less (in inverse proportion to size)", () => {
    const { lotus, ripples, step } = pond();
    // A big disturbance: rain of touches everywhere.
    const widest = new Map<number, number>();
    run(20, (dt, now) => {
      if (Math.round(now * 60) % 20 === 0) ripples.trigger("touch", { x: (now * 97) % 480, y: (now * 53) % 270 });
      step(dt, now);
      for (const [index, leaf] of lotus.leaves.entries()) {
        widest.set(index, Math.max(widest.get(index) ?? 0, Math.abs(leaf.lift)));
      }
    });
    const leaves = lotus.leaves.map((leaf, index) => ({ radius: leaf.radius, widest: widest.get(index) ?? 0 }));
    for (const leaf of leaves) expect(leaf.widest).toBeLessThanOrEqual(0.015 + 1e-9);
    const small = leaves.reduce((a, b) => (a.radius < b.radius ? a : b));
    const big = leaves.reduce((a, b) => (a.radius > b.radius ? a : b));
    expect(big.widest).toBeLessThan(small.widest);
  });
});
