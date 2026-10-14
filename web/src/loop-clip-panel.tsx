import { useRef, useState } from "react";
import { Clapperboard, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

const HEIGHTS = [
  { value: 1080, label: "1080p" },
  { value: 1440, label: "1440p" },
  { value: 2160, label: "4K (2160p)" },
];
const LENGTHS = [20, 30, 60];

/** Quick-settings section: record the pond into a seamless looping MP4. */
export function LoopClipPanel() {
  const [height, setHeight] = useState(2160);
  const [seconds, setSeconds] = useState(30);
  const [percent, setPercent] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const supported = typeof VideoEncoder !== "undefined";
  const recording = percent !== null;

  const record = async (): Promise<void> => {
    const controller = new AbortController();
    abort.current = controller;
    setPercent(0);
    setMessage(null);
    try {
      // The encoder only loads when a clip is recorded.
      const { recordLoopClip } = await import("./clip-recorder");
      const clip = await recordLoopClip({
        height,
        seconds,
        signal: controller.signal,
        onProgress: (fraction) => setPercent(Math.floor(fraction * 100)),
      });
      const url = URL.createObjectURL(clip.blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = clip.fileName;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setMessage(`Saved ${clip.fileName} (${clip.codec.toUpperCase()}, ${(clip.blob.size / 1e6).toFixed(0)} MB) to your downloads.`);
    } catch (error) {
      setMessage(
        controller.signal.aborted
          ? "Canceled."
          : `Couldn't record: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      abort.current = null;
      setPercent(null);
    }
  };

  return (
    <section className="settings-quick__section" aria-labelledby="quick-clip-heading">
      <div className="settings-quick__heading">
        <div className="settings-quick__heading-row"><h3 id="quick-clip-heading">Loop clip</h3></div>
        <p>
          Record the pond as it's set now (weather, koi, visitors) into a video that loops without a seam, e.g. for the
          Mac lock screen.
        </p>
      </div>
      <div className="quick-setting" data-base-ui-swipe-ignore>
        <div className="quick-setting__copy">
          <Label htmlFor="quick-clip-size">Size</Label>
          <small>The pixels stay crisp at any size.</small>
        </div>
        <select
          id="quick-clip-size"
          className="quick-setting__select"
          value={height}
          disabled={recording}
          onChange={(event) => setHeight(Number(event.target.value))}
        >
          {HEIGHTS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>
      <div className="quick-setting" data-base-ui-swipe-ignore>
        <div className="quick-setting__copy">
          <Label htmlFor="quick-clip-length">Length</Label>
          <small>The last 2 seconds fade into the first, so it loops smoothly.</small>
        </div>
        <select
          id="quick-clip-length"
          className="quick-setting__select"
          value={seconds}
          disabled={recording}
          onChange={(event) => setSeconds(Number(event.target.value))}
        >
          {LENGTHS.map((length) => (
            <option key={length} value={length}>{length} s</option>
          ))}
        </select>
      </div>
      <div className="quick-setting" data-base-ui-swipe-ignore>
        {recording ? (
          <>
            <div className="quick-setting__copy">
              <span className="quick-setting__label">Recording… {percent}%</span>
              <small>The pond on screen keeps going meanwhile.</small>
            </div>
            <Button variant="outline" onClick={() => abort.current?.abort()}>
              <X aria-hidden="true" /> Cancel
            </Button>
          </>
        ) : (
          <>
            <div className="quick-setting__copy">
              <small>{supported ? message ?? "Takes about as long as the clip, or less." : "This browser can't encode video."}</small>
            </div>
            <Button onClick={() => void record()} disabled={!supported}>
              <Clapperboard aria-hidden="true" /> Record loop clip
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
