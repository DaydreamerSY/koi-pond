// Random weather. The schedule is worked out from the wall clock, so every
// window (each screen's wallpaper, the settings window) shows the same weather
// at the same time without having to agree on it.

import { WEATHER_PRESETS, type WeatherPresetId } from "./weather";

/** A well-mixed 32-bit hash of an integer. */
function mix(value: number): number {
  let x = (value | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}

/** The weather the random cycle shows at `time` (milliseconds since the epoch). */
export function randomWeatherAt(time: number, minutes: number, includeRain: boolean): WeatherPresetId {
  const choices = WEATHER_PRESETS.filter((preset) => includeRain || preset.rainStrength === 0);
  const slot = Math.floor(time / (Math.max(minutes, 1) * 60_000));
  const pick = (index: number): number => mix(index) % choices.length;
  let choice = pick(slot);
  // Don't land on the weather that just went by.
  if (choice === pick(slot - 1)) choice = (choice + 1) % choices.length;
  return choices[choice].id;
}
