import { describe, expect, it } from "vitest";
import { WEATHER_PRESETS } from "./weather";
import { randomWeatherAt } from "./weather-cycle";

const MINUTE = 60_000;
const start = Date.UTC(2026, 9, 13, 8, 0, 0);

describe("random weather", () => {
  it("is the same in every window at the same moment, and holds for its whole slot", () => {
    expect(randomWeatherAt(start, 10, true)).toBe(randomWeatherAt(start, 10, true));
    expect(randomWeatherAt(start + 1 * MINUTE, 10, true)).toBe(randomWeatherAt(start + 9 * MINUTE, 10, true));
  });

  it("changes as time goes on and visits every preset", () => {
    const seen = new Set<string>();
    let repeats = 0;
    let previous = "";
    for (let slot = 0; slot < 500; slot += 1) {
      const weather = randomWeatherAt(start + slot * 10 * MINUTE, 10, true);
      if (weather === previous) repeats += 1;
      previous = weather;
      seen.add(weather);
    }
    expect(seen.size).toBe(WEATHER_PRESETS.length);
    // Back-to-back repeats are avoided (a rare one can slip through the shift).
    expect(repeats).toBeLessThan(25);
  });

  it("leaves out rain when asked", () => {
    for (let slot = 0; slot < 300; slot += 1) {
      expect(randomWeatherAt(start + slot * 5 * MINUTE, 5, false)).not.toBe("rain");
    }
  });
});
