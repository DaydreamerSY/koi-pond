// Records the pond into a seamlessly looping MP4 (e.g. for the Mac lock
// screen, see mac/lockscreen-clip.sh). A separate pond is simulated and drawn
// offscreen, frame by frame at a steady rate, so the clip is smooth however
// fast the machine is and the pond on screen carries on undisturbed. It's
// loaded on demand: the wallpaper never pays for the encoder.

import {
  BufferTarget,
  CanvasSource,
  getFirstEncodableVideoCodec,
  Mp4OutputFormat,
  Output,
  QUALITY_VERY_HIGH,
} from "mediabunny";
import { CANVAS_HEIGHT, CANVAS_WIDTH, FIXED_STEP } from "./config";
import { FishRenderer } from "./fish-renderer";
import { School } from "./school";
import { settings } from "./settings/store";

export interface LoopClipOptions {
  /** Output height in pixels; the width follows the pond's shape. */
  height: number;
  /** Length of the loop, in seconds. */
  seconds: number;
  /** Frames per second. */
  fps?: number;
  /** How long (seconds) the end fades into the start, hiding the seam. */
  fade?: number;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export interface LoopClip {
  blob: Blob;
  fileName: string;
  codec: string;
}

/** Whether this browser can encode video at all (WebCodecs). */
export const canRecordClips = (): boolean => typeof VideoEncoder !== "undefined";

/** Lets the pond's slower changes (the weather's light easing in) settle before frame one. */
const WARM_UP_SECONDS = 4;

function context2d(canvas: OffscreenCanvas): OffscreenCanvasRenderingContext2D {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No 2D canvas");
  return context;
}

export async function recordLoopClip(options: LoopClipOptions): Promise<LoopClip> {
  const fps = options.fps ?? 30;
  const fadeFrames = Math.round((options.fade ?? 2) * fps);
  const loopFrames = Math.round(options.seconds * fps);
  // Even sizes, as video encoders want.
  const height = Math.round(options.height / 2) * 2;
  const width = Math.round((height * CANVAS_WIDTH) / CANVAS_HEIGHT / 2) * 2;

  const codec = await getFirstEncodableVideoCodec(["hevc", "avc"], { width, height, quality: QUALITY_VERY_HIGH });
  if (!codec) throw new Error(`This browser can't encode ${width}×${height} video`);

  // A pond of its own, set up like the one on screen.
  const glCanvas = document.createElement("canvas");
  const school = new School();
  const renderer = new FishRenderer(glCanvas);
  const meta = settings.meta();
  renderer.setWeatherPreset(meta.weather);
  school.setRainIntensity(meta.rain ? 1 : 0);

  const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target: new BufferTarget() });
  const outputCanvas = new OffscreenCanvas(width, height);
  // Generous quality and few key frames: a lock screen clip is small anyway, and
  // each key frame is a tiny jolt in pixel art's fine detail.
  const source = new CanvasSource(outputCanvas, { codec, quality: QUALITY_VERY_HIGH, keyFrameInterval: 5 });
  output.addVideoTrack(source, { frameRate: fps });

  try {
    await output.start();
    let time = 0;
    const advance = (seconds: number): void => {
      const steps = Math.round(seconds / FIXED_STEP);
      for (let step = 0; step < steps; step += 1) {
        time += FIXED_STEP;
        school.update(FIXED_STEP, time);
      }
    };
    for (let warm = 0; warm < WARM_UP_SECONDS * 10; warm += 1) {
      advance(0.1);
      renderer.draw(school, time, false);
    }

    // Frames are drawn at the pond's own pixel size, then blown up without
    // smoothing so the pixel art stays crisp.
    const frameWidth = glCanvas.width;
    const frameHeight = glCanvas.height;
    const compose = new OffscreenCanvas(frameWidth, frameHeight);
    const composeContext = context2d(compose);
    const outputContext = context2d(outputCanvas);
    outputContext.imageSmoothingEnabled = false;

    // The loop: frames fade..loop-1 as drawn, then loop..loop+fade-1 fading
    // into the first `fade` frames, so the clip's end runs on into its start.
    const opening: OffscreenCanvas[] = [];
    let written = 0;
    const total = loopFrames + fadeFrames;
    for (let frame = 0; frame < total; frame += 1) {
      if (options.signal?.aborted) throw new DOMException("Recording canceled", "AbortError");
      advance(1 / fps);
      renderer.draw(school, time, false);

      if (frame < fadeFrames) {
        // Kept to fade into at the end (copied now: WebGL clears its canvas after this task).
        const kept = new OffscreenCanvas(frameWidth, frameHeight);
        context2d(kept).drawImage(glCanvas, 0, 0);
        opening.push(kept);
      } else {
        composeContext.globalAlpha = 1;
        composeContext.drawImage(glCanvas, 0, 0);
        if (frame >= loopFrames) {
          const into = frame - loopFrames;
          composeContext.globalAlpha = into / fadeFrames;
          composeContext.drawImage(opening[into], 0, 0);
        }
        outputContext.drawImage(compose, 0, 0, width, height);
        await source.add(written / fps, 1 / fps);
        written += 1;
      }
      options.onProgress?.((frame + 1) / total);
    }
    await output.finalize();
  } catch (error) {
    if (output.state === "started") await output.cancel();
    throw error;
  } finally {
    renderer.dispose();
    glCanvas.getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext();
  }

  const buffer = (output.target as BufferTarget).buffer;
  if (!buffer) throw new Error("The recording came out empty");
  return {
    blob: new Blob([buffer], { type: "video/mp4" }),
    fileName: `koi-pond-loop-${width}x${height}-${options.seconds}s.mp4`,
    codec,
  };
}
