// Pure frame-pacing math for the render loop. The loop keeps running on
// requestAnimationFrame; the limiter only decides whether a given rAF tick
// should simulate + draw or be skipped, and how long the loop may sleep on a
// timer before asking for the next tick (so a capped rate doesn't wake the
// page on every refresh of a 144 Hz display).

/** A gap this long means the tab was hidden or the main thread stalled. */
const MAX_CATCH_UP_MS = 250;
/** Timestamps jitter, so a frame arriving 1 ms early still counts as on time. */
const EARLY_TOLERANCE_MS = 1;
/** Sleeps shorter than this aren't worth a timer: ask for the tick right away. */
const MIN_SLEEP_MS = 2;
/** Bounds for how early a sleep ends, to absorb late timers. */
const MIN_WAKE_LEAD_MS = 2;
const MAX_WAKE_LEAD_MS = 20;

export interface FrameLimiter {
  /**
   * Call once per rAF tick. `fps` is the cap, or null for native (render every
   * tick). Returns true when this tick should render.
   */
  shouldRender(now: number, fps: number | null): boolean;
  /**
   * How long (ms) the loop can sleep before requesting the rAF tick that
   * should render next; 0 means request it now. Waking a little early is
   * harmless (that tick is skipped), so this ends the sleep `wakeLead` early.
   */
  sleepTime(now: number, fps: number | null): number;
  /** Reports how late (ms) a sleep timer fired, so later sleeps end earlier. */
  noteWakeLateness(lateMs: number): void;
}

export function createFrameLimiter(): FrameLimiter {
  let lastRender: number | null = null;
  let wakeLead = MIN_WAKE_LEAD_MS * 2;

  return {
    shouldRender(now, fps) {
      if (fps === null || lastRender === null) {
        lastRender = now;
        return true;
      }

      const interval = 1000 / fps;
      const elapsed = now - lastRender;
      if (elapsed < interval - EARLY_TOLERANCE_MS) return false;

      if (elapsed > MAX_CATCH_UP_MS) {
        lastRender = now;
      } else {
        // Advance along the ideal schedule rather than snapping to `now`, so
        // rounding and jitter never accumulate into drift.
        const steps = Math.max(1, Math.floor((elapsed + EARLY_TOLERANCE_MS) / interval));
        lastRender += steps * interval;
      }
      return true;
    },

    sleepTime(now, fps) {
      if (fps === null || lastRender === null) return 0;
      const due = lastRender + 1000 / fps - EARLY_TOLERANCE_MS;
      const sleep = due - now - wakeLead;
      return sleep >= MIN_SLEEP_MS ? sleep : 0;
    },

    noteWakeLateness(lateMs) {
      // Jump up to cover a late timer at once; ease back down slowly.
      wakeLead = Math.min(
        MAX_WAKE_LEAD_MS,
        Math.max(MIN_WAKE_LEAD_MS, Math.max(0, lateMs) + 1, wakeLead * 0.98),
      );
    },
  };
}
