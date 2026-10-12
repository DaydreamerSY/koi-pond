// Where things are on the pond surface at a given time, for creatures that
// need to steer around (ducks) or sit on (frogs) the lotus leaves.

import * as THREE from "three";
import { FISH, LOTUS, LOTUS_LEAVES, viewportPoint } from "./config";

export interface LeafCircle {
  x: number;
  y: number;
  radius: number;
}

/**
 * Visible lotus leaves as circles. Mirrors the drift in LotusLeavesPass.update
 * (the simulation and renderer share one clock), reusing `out`'s objects.
 */
export function lotusLeafCircles(time: number, out: LeafCircle[]): LeafCircle[] {
  const count = Math.min(LOTUS.visibleLeafCount, LOTUS_LEAVES.length);
  for (let index = 0; index < count; index += 1) {
    const leaf = LOTUS_LEAVES[index];
    const placement = viewportPoint(leaf.x, leaf.y);
    const circle = out[index] ?? (out[index] = { x: 0, y: 0, radius: 0 });
    circle.x = placement.x + Math.sin(time * 0.12 + leaf.phase) * LOTUS.driftX;
    circle.y = placement.y + Math.cos(time * 0.15 + leaf.phase * 1.3) * LOTUS.driftY;
    circle.radius = leaf.radius * LOTUS.radiusScale;
  }
  out.length = count;
  return out;
}

/**
 * Colors a bed-dwelling creature the way deep koi are colored: dimmer, less
 * saturated, and tinted by the water (the same Koi › depth settings).
 */
export function tintForDepth(hex: number, depth: number, target: THREE.Color): THREE.Color {
  target.setHex(hex);
  const brightness = 1 + (FISH.depth.deepBrightness - 1) * depth;
  const saturation = 1 + (FISH.depth.deepSaturation - 1) * depth;
  const luminance = target.r * 0.2126 + target.g * 0.7152 + target.b * 0.0722;
  const [tintR, tintG, tintB] = FISH.depth.deepWaterTint;
  return target.setRGB(
    (luminance + (target.r - luminance) * saturation) * brightness * (1 + (tintR - 1) * depth),
    (luminance + (target.g - luminance) * saturation) * brightness * (1 + (tintG - 1) * depth),
    (luminance + (target.b - luminance) * saturation) * brightness * (1 + (tintB - 1) * depth),
  );
}
