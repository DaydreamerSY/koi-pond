// Desktop-wallpaper mode (?wallpaper). The pond is hosted full-screen behind
// the desktop icons by the Koi Paper WebView2 shell (../app), which can't
// receive input itself, so the shell drives it through WebView2 web messages
// and gets the pond's state back the same way.

import type { FrameRateCap } from "./performance-prefs";
import type { WeatherPresetId } from "./weather";

/** The pond visitors the shell's tray menu can switch on and off. */
export const VISITOR_KINDS = ["ducks", "crabs", "shrimp", "frogs"] as const;
export type VisitorKind = (typeof VISITOR_KINDS)[number];

export const WALLPAPER_MODE =
  typeof window !== "undefined" && new URLSearchParams(window.location.search).has("wallpaper");

/** Messages the shell sends. Points are normalized to the viewport (0..1). */
export type HostMessage =
  | { type: "call"; x: number; y: number }
  | { type: "scatter" }
  | { type: "paused"; value: boolean }
  | { type: "sound"; value: boolean }
  | { type: "weather"; value: WeatherPresetId }
  | { type: "rain"; value: boolean }
  | { type: "koi"; value: number }
  | { type: "fps"; value: FrameRateCap }
  | { type: "visitor"; kind: VisitorKind; value: boolean }
  /** Re-read saved settings (a host whose web views don't share storage events). */
  | { type: "resync" };

/** What the pond reports back so the shell's tray menu can show it. */
export interface PondState {
  type: "state";
  weather: WeatherPresetId;
  rain: boolean;
  koi: number;
  fps: FrameRateCap;
  /** How many of each visitor are in the pond. */
  visitors: Record<VisitorKind, number>;
}

interface WebViewBridge {
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  postMessage(message: unknown): void;
}

function bridge(): WebViewBridge | undefined {
  return (window as unknown as { chrome?: { webview?: WebViewBridge } }).chrome?.webview;
}

export function onHostMessage(handler: (message: HostMessage) => void): () => void {
  const webview = bridge();
  if (!WALLPAPER_MODE || !webview) return () => undefined;
  const listener = (event: MessageEvent): void => {
    const message = event.data as HostMessage | null;
    if (message && typeof message === "object" && typeof message.type === "string") handler(message);
  };
  webview.addEventListener("message", listener);
  return () => webview.removeEventListener("message", listener);
}

/** Frames actually drawn in the last second, for the shell's resource monitor. */
export interface PondStats {
  type: "stats";
  fps: number;
}

export function postToHost(report: PondState | PondStats): void {
  if (WALLPAPER_MODE) bridge()?.postMessage(report);
}

/** Wallpaper render size: the pond's pixel height (or width) at the screen's aspect ratio. */
export function wallpaperRenderSize(
  base: { width: number; height: number },
  width: number,
  height: number,
): { width: number; height: number } {
  if (width <= 0 || height <= 0) return base;
  const aspect = width / height;
  return aspect >= base.width / base.height
    ? { width: Math.round(base.height * aspect), height: base.height }
    : { width: base.width, height: Math.round(base.width / aspect) };
}
