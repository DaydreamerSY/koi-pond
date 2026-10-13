import { describe, expect, it } from "vitest";
import { createFrameLimiter } from "./frame-limiter";

/** Simulates `frames` rAF ticks at `hz`; returns the indices that rendered. */
function run(hz: number, fps: number | null, frames: number, start = 1000): number[] {
  const limiter = createFrameLimiter();
  const period = 1000 / hz;
  const rendered: number[] = [];
  for (let i = 0; i < frames; i += 1) {
    if (limiter.shouldRender(start + i * period, fps)) rendered.push(i);
  }
  return rendered;
}

function expectEvery(indices: number[], n: number): void {
  indices.forEach((index, position) => expect(index).toBe(position * n));
}

describe("frame limiter", () => {
  it("renders every 2nd frame for a 30 cap on a 60 Hz display", () => {
    const rendered = run(60, 30, 120);
    expectEvery(rendered, 2);
    expect(rendered).toHaveLength(60);
  });

  it("renders every 4th frame for a 30 cap on a 120 Hz display", () => {
    expectEvery(run(120, 30, 240), 4);
  });

  it("renders every 2nd frame for a 60 cap on a 120 Hz display", () => {
    expectEvery(run(120, 60, 240), 2);
  });

  it("renders every 3rd frame for a 20 cap on a 60 Hz display", () => {
    expectEvery(run(60, 20, 180), 3);
  });

  it("renders every frame for a 60 cap on a 60 Hz display", () => {
    expect(run(60, 60, 120)).toHaveLength(120);
  });

  it("renders every frame when native", () => {
    expect(run(60, null, 100)).toHaveLength(100);
    expect(run(144, null, 100)).toHaveLength(100);
  });

  it("does not drift over 1000 frames", () => {
    const rendered = run(60, 30, 1000);
    expectEvery(rendered, 2);
    const rendered120 = run(120, 20, 1000);
    expect(rendered120).toHaveLength(Math.ceil(1000 / 6));
    expectEvery(rendered120, 6);
  });

  it("holds the average rate on a display that does not divide evenly", () => {
    // 75 Hz with a 60 cap: 750 ticks are 10 s, expect ~600 renders.
    const rendered = run(75, 60, 750);
    expect(rendered.length).toBeGreaterThanOrEqual(598);
    expect(rendered.length).toBeLessThanOrEqual(602);
  });

  it("tolerates small timestamp jitter", () => {
    const limiter = createFrameLimiter();
    let renders = 0;
    for (let i = 0; i < 600; i += 1) {
      const jitter = (i % 3 - 1) * 0.4;
      if (limiter.shouldRender(i * (1000 / 60) + jitter, 30)) renders += 1;
    }
    expect(renders).toBe(300);
  });

  it("resets after a long gap and resumes the cadence", () => {
    const limiter = createFrameLimiter();
    const period = 1000 / 60;
    let now = 0;
    for (let i = 0; i < 10; i += 1) {
      limiter.shouldRender(now, 30);
      now += period;
    }
    now += 30_000;
    expect(limiter.shouldRender(now, 30)).toBe(true);
    const after: boolean[] = [];
    for (let i = 0; i < 6; i += 1) {
      now += period;
      after.push(limiter.shouldRender(now, 30));
    }
    expect(after).toEqual([false, true, false, true, false, true]);
  });

  describe("sleeping between frames", () => {
    /**
     * Runs the render loop the way app.tsx does: after each tick it sleeps for
     * sleepTime() (the timer firing `lateMs` late), then waits for the next
     * display refresh. Returns the refreshes that rendered and how many rAF
     * ticks it took.
     */
    function loop(hz: number, fps: number | null, refreshes: number, lateMs = 0, drawMs = 3) {
      const limiter = createFrameLimiter();
      const period = 1000 / hz;
      const nextRefresh = (time: number): number => Math.ceil(time / period - 1e-9);
      const rendered: number[] = [];
      let ticks = 0;
      let refresh = 1;
      while (refresh < refreshes) {
        ticks += 1;
        const now = refresh * period;
        const render = limiter.shouldRender(now, fps);
        if (render) rendered.push(refresh);
        const after = now + (render ? drawMs : 0.2);
        const sleep = limiter.sleepTime(after, fps);
        if (sleep > 0) {
          const fired = after + sleep + lateMs;
          limiter.noteWakeLateness(lateMs);
          refresh = Math.max(refresh + 1, nextRefresh(fired));
        } else {
          refresh += 1;
        }
      }
      return { rendered, ticks };
    }

    it("renders on the same refreshes as ticking every refresh", () => {
      for (const [hz, fps] of [[60, 30], [144, 30], [164, 30], [120, 60], [75, 60], [60, 20], [240, 20]] as const) {
        const awake = run(hz, fps, hz * 10 - 1, 1000 / hz).map((index) => index + 1);
        const { rendered } = loop(hz, fps, hz * 10);
        expect(rendered).toEqual(awake);
      }
    });

    it("wakes far less often on a fast display", () => {
      const { rendered, ticks } = loop(164, 30, 1640);
      expect(rendered.length).toBeGreaterThan(295);
      expect(ticks).toBeLessThan(rendered.length * 2.1);
    });

    it("never sleeps without a cap", () => {
      const { rendered, ticks } = loop(144, null, 1440);
      expect(ticks).toBe(rendered.length);
      expect(ticks).toBe(1439);
    });

    it("holds the frame rate when timers fire late", () => {
      const { rendered } = loop(144, 30, 1440, 8);
      // 10 s at 30 fps; a late timer may only delay a frame, never drop it.
      expect(rendered.length).toBeGreaterThanOrEqual(297);
    });
  });

  it("switches cap on the fly", () => {
    const limiter = createFrameLimiter();
    const period = 1000 / 60;
    const results: boolean[] = [];
    for (let i = 0; i < 6; i += 1) results.push(limiter.shouldRender(i * period, 30));
    for (let i = 6; i < 10; i += 1) results.push(limiter.shouldRender(i * period, null));
    expect(results.slice(6)).toEqual([true, true, true, true]);
  });
});
