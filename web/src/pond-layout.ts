// Shared bits for the pond visitors.

import * as THREE from "three";
import { FISH } from "./config";

/** A lotus leaf as a circle on the surface (see LotusMotion for where they are). */
export interface LeafCircle {
  x: number;
  y: number;
  radius: number;
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
