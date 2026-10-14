import * as THREE from "three";

/**
 * Shadows on the same surface merge into one: where they overlap (a koi's
 * head and body, two leaves, a koi under a leaf) the spot is darkened once,
 * by the first shadow drawn there, not again by every one on top. Needs a
 * render target with a stencil buffer, cleared each frame.
 */
export function mergeShadows<T extends THREE.Material>(material: T): T {
  material.stencilWrite = true;
  material.stencilRef = 1;
  material.stencilFunc = THREE.NotEqualStencilFunc;
  material.stencilZPass = THREE.ReplaceStencilOp;
  return material;
}
