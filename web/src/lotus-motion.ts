// Lotus leaves float. They wander on the current and ride a gentle swell, and
// when something disturbs the water under them (a ripple ring passing, a frog
// landing) they drift, rise, and twist, then bob back to rest. Stepped by
// School, so the ducks steering around the leaves and the frogs sitting on
// them see the same leaves the renderer draws.

import { LOTUS, LOTUS_LEAVES, RIPPLES, viewportPoint, type LotusFlowerSetting } from "./config";
import type { LeafCircle } from "./pond-layout";
import type { RippleSystem } from "./ripple-system";

export interface LeafPose extends LeafCircle {
  /** Sway plus twist, in radians. */
  rotation: number;
  /** How high the leaf rides, as a share of its size: it scales the leaf and throws its shadow farther. */
  lift: number;
}

interface LeafDynamics {
  offsetX: number;
  offsetY: number;
  velocityX: number;
  velocityY: number;
  lift: number;
  liftVelocity: number;
  twist: number;
  twistVelocity: number;
}

export class LotusMotion {
  /** The visible leaves, by leaf index. */
  public readonly leaves: LeafPose[] = [];

  private readonly dynamics: LeafDynamics[] = [];

  public constructor() {
    this.update(0, 0);
  }

  /** Lets every leaf settle back to rest. */
  public reset(): void {
    this.dynamics.length = 0;
  }

  /** A frog landing on (or leaping off) a leaf pushes it under a little; it bobs back up. */
  public bump(index: number, amount = LOTUS.float.frogBump): void {
    const motion = this.dynamics[index];
    if (motion) motion.liftVelocity -= amount;
  }

  /** Where a flower sits on its leaf right now, or null while that leaf is hidden. */
  public flowerAt(flower: LotusFlowerSetting): { x: number; y: number; scale: number } | null {
    const pose = this.leaves[flower.leafIndex];
    if (!pose) return null;
    const scale = 1 + pose.lift;
    const cosine = Math.cos(pose.rotation);
    const sine = Math.sin(pose.rotation);
    return {
      x: pose.x + (flower.offsetX * cosine - flower.offsetY * sine) * scale,
      y: pose.y + (flower.offsetX * sine + flower.offsetY * cosine) * scale,
      scale,
    };
  }

  public update(dt: number, time: number, ripples?: RippleSystem): void {
    const float = LOTUS.float;
    const count = Math.min(LOTUS.visibleLeafCount, LOTUS_LEAVES.length);
    // Leaves bob up and down faster than they drift sideways.
    const liftStiffness = float.spring * 6;
    const liftDamping = float.damping * 2;

    for (let index = 0; index < count; index += 1) {
      const leaf = LOTUS_LEAVES[index];
      const motion = this.dynamics[index] ?? (this.dynamics[index] = {
        offsetX: 0, offsetY: 0, velocityX: 0, velocityY: 0, lift: 0, liftVelocity: 0, twist: 0, twistVelocity: 0,
      });
      const radius = leaf.radius * LOTUS.radiusScale;
      const placement = viewportPoint(leaf.x, leaf.y);
      const restX = placement.x
        + Math.sin(time * 0.12 + leaf.phase) * LOTUS.driftX
        + Math.sin(time * 0.041 + leaf.phase * 2.3) * float.wander;
      const restY = placement.y
        + Math.cos(time * 0.15 + leaf.phase * 1.3) * LOTUS.driftY
        + Math.cos(time * 0.037 + leaf.phase * 1.9) * float.wander;
      const x = restX + motion.offsetX;
      const y = restY + motion.offsetY;

      if (ripples && dt > 0) {
        let pushX = 0;
        let pushY = 0;
        let lift = 0;
        let twist = 0;
        for (const ripple of ripples.instances) {
          if (!ripple.alive || ripple.age < 0) continue;
          const weight = float.rippleWeights[ripple.type];
          if (weight <= 0) continue;
          const profile = RIPPLES.types[ripple.type];
          const ring = profile.startRadius + profile.expansionSpeed * ripple.age;
          const dx = x - ripple.center.x;
          const dy = y - ripple.center.y;
          const distance = Math.hypot(dx, dy);
          // How much of the ring's front is passing under the leaf right now.
          const under = 1 - Math.abs(distance - ring) / Math.max(radius, 1);
          if (under <= 0) continue;
          const fade = Math.max(0, 1 - ripple.age / Math.max(profile.lifetime, 0.001));
          const strength = under * weight * ripple.strength * fade;
          if (distance > 0.001) {
            pushX += (dx / distance) * strength;
            pushY += (dy / distance) * strength;
          }
          lift += strength;
          // The ring reaches one side of the leaf first, which turns it a little.
          twist += strength * Math.sin(Math.atan2(dy, dx) - leaf.angle);
        }

        // Damped springs: pushed out by the ring, the leaf bobs back to rest.
        motion.velocityX += (pushX * float.ripplePush - motion.offsetX * float.spring - motion.velocityX * float.damping) * dt;
        motion.velocityY += (pushY * float.ripplePush - motion.offsetY * float.spring - motion.velocityY * float.damping) * dt;
        motion.offsetX += motion.velocityX * dt;
        motion.offsetY += motion.velocityY * dt;
        const offset = Math.hypot(motion.offsetX, motion.offsetY);
        if (offset > float.maxOffset && offset > 0) {
          const scale = float.maxOffset / offset;
          motion.offsetX *= scale;
          motion.offsetY *= scale;
          motion.velocityX *= scale;
          motion.velocityY *= scale;
        }
        motion.liftVelocity += (lift * float.rippleLift - motion.lift * liftStiffness - motion.liftVelocity * liftDamping) * dt;
        motion.lift += motion.liftVelocity * dt;
        motion.twistVelocity += (twist * float.rippleTwist - motion.twist * float.spring - motion.twistVelocity * float.damping) * dt;
        motion.twist += motion.twistVelocity * dt;
      }

      const swell =
        (Math.sin(time * float.swellSpeed + leaf.phase * 2.7) * 0.7
          + Math.sin(time * float.swellSpeed * 1.73 + leaf.phase) * 0.3) * float.swell;
      const lift = swell + motion.lift;
      const pose = this.leaves[index] ?? (this.leaves[index] = { x: 0, y: 0, radius: 0, rotation: 0, lift: 0 });
      pose.x = restX + motion.offsetX;
      pose.y = restY + motion.offsetY;
      pose.radius = radius * (1 + lift);
      pose.rotation = Math.sin(time * 0.085 + leaf.phase) * LOTUS.rotationAmount + motion.twist;
      pose.lift = lift;
    }
    this.leaves.length = count;
    this.dynamics.length = Math.min(this.dynamics.length, count);
  }
}
