import * as THREE from "three";
import { RotateCcw } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { LoopClipPanel } from "./loop-clip-panel";
import { SettingsColorInput, SettingsSlider } from "./settings-controls";
import { useSetting } from "./settings/react";
import { settings } from "./settings/store";
import type { SectionId } from "./settings/definition";
import { definition } from "./settings/definition";
import { WEATHER_PRESETS, type WeatherPresetId } from "./weather";

interface QuickSettingsProps {
  weather: WeatherPresetId;
  rainEnabled: boolean;
  soundEnabled: boolean;
  onWeatherChange: (id: WeatherPresetId) => void;
  onRainChange: (enabled: boolean) => void;
  onSoundChange: (enabled: boolean) => void;
  onResetSection: (sectionIds: readonly SectionId[]) => void;
  onResetAtmosphere: () => void;
  selectedFamily: number;
  previewFamily: number | null;
  onFamilyChange: (index: number) => void;
  onPreviewFamilyChange: (index: number | null) => void;
}

function SettingSlider({
  label,
  description,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  description: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="quick-setting" data-base-ui-swipe-ignore>
      <div className="quick-setting__copy">
        <span className="quick-setting__label">{label}</span>
        <small>{description}</small>
      </div>
      <SettingsSlider
        label={label}
        aria-label={label}
        showLabel={false}
        min={min}
        max={max}
        step={step}
        value={value}
        onValueChange={onChange}
        className="drawer-elastic-slider"
      />
    </div>
  );
}

function hexFromRgb(value: readonly [number, number, number]): string {
  return `#${new THREE.Color().setRGB(...value).getHexString(THREE.SRGBColorSpace)}`;
}

function hexFromInt(value: number): string {
  return `#${value.toString(16).padStart(6, "0").slice(-6)}`;
}

function QuickColor({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="quick-color" data-base-ui-swipe-ignore>
      <Label htmlFor={id}>{label}</Label>
      <SettingsColorInput id={id} value={value} onChange={onChange} />
    </div>
  );
}

export function QuickSettings({
  weather,
  rainEnabled,
  soundEnabled,
  onWeatherChange,
  onRainChange,
  onSoundChange,
  onResetSection,
  onResetAtmosphere,
  selectedFamily,
  previewFamily,
  onFamilyChange,
  onPreviewFamilyChange,
}: QuickSettingsProps) {
  const paletteIndex = selectedFamily;
  const palettes = settings.live["koi-palettes"];
  const selectedPalette = palettes[paletteIndex] ?? palettes[0];

  const [koiCount, setKoiCount] = useSetting<number>(["koi", "initialCount"]);
  const [base, setBase] = useSetting<number>(["koi-palettes", paletteIndex, "base"]);
  const [accent, setAccent] = useSetting<number>(["koi-palettes", paletteIndex, "accent"]);
  const [marking, setMarking] = useSetting<number>(["koi-palettes", paletteIndex, "marking"]);
  const [fin, setFin] = useSetting<number>(["koi-palettes", paletteIndex, "fin"]);

  // Koi motion: how the body bends in turns and how hard the tail sways.
  const motion = {
    tailSway: useSetting<number>(["koi", "swimming", "tailAmplitude"]),
    tailFromSpeed: useSetting<number>(["koi", "swimming", "speedTailEffort"]),
    bodyBend: useSetting<number>(["koi", "turning", "bodyFollow"]),
    cruiseTurn: useSetting<number>(["koi", "turning", "cruiseTightness"]),
    turnaround: useSetting<number>(["koi", "turning", "pivotTightness"]),
    tightestC: useSetting<number>(["koi", "turning", "maxBodyBend"]),
    smoothing: useSetting<number>(["koi", "turning", "bodyResponse"]),
  };
  const resetMotion = (): void => {
    const { swimming, turning } = definition.children.koi.children;
    motion.tailSway[1](swimming.children.tailAmplitude.default);
    motion.tailFromSpeed[1](swimming.children.speedTailEffort.default);
    motion.bodyBend[1](turning.children.bodyFollow.default);
    motion.cruiseTurn[1](turning.children.cruiseTightness.default);
    motion.turnaround[1](turning.children.pivotTightness.default);
    motion.tightestC[1](turning.children.maxBodyBend.default);
    motion.smoothing[1](turning.children.bodyResponse.default);
  };

  const [deepColor, setDeepColor] = useSetting<readonly [number, number, number]>(["pond-bed", "deepColor"]);
  const [shallowColor, setShallowColor] = useSetting<readonly [number, number, number]>(["pond-bed", "shallowColor"]);
  const [clarity, setClarity] = useSetting<number>(["water", "clarity"]);

  const [visibleLeafCount, setVisibleLeafCount] = useSetting<number>(["lotus", "visibleLeafCount"]);
  const [visibleFlowerCount, setVisibleFlowerCount] = useSetting<number>(["lotus", "visibleFlowerCount"]);
  const [visiblePatchCount, setVisiblePatchCount] = useSetting<number>(["duckweed", "visiblePatchCount"]);
  const [visibleButterflyCount, setVisibleButterflyCount] = useSetting<number>(["butterflies", "visibleCount"]);

  const [randomWeather, setRandomWeather] = useSetting<boolean>(["atmosphere", "randomWeather"]);
  const [randomMinutes] = useSetting<number>(["atmosphere", "randomMinutes"]);

  const [pixelDetail, setPixelDetail] = useSetting<number>(["display", "pixelDetail"]);
  const pixelDetailRange = definition.children.display.children.pixelDetail;

  const [duckCount, setDuckCount] = useSetting<number>(["ducks", "visibleCount"]);
  const [crabCount, setCrabCount] = useSetting<number>(["crabs", "visibleCount"]);
  const [shrimpCount, setShrimpCount] = useSetting<number>(["shrimp", "visibleCount"]);
  const [frogCount, setFrogCount] = useSetting<number>(["frogs", "visibleCount"]);

  return (
    <div className="settings-quick">
      <section className="settings-quick__section" aria-labelledby="quick-koi-heading">
        <div className="settings-quick__heading">
          <div className="settings-quick__heading-row"><h3 id="quick-koi-heading">Koi</h3><button type="button" className="settings-section-reset" onClick={() => onResetSection(["koi", "koi-palettes", "koi-patterns"])}><RotateCcw aria-hidden="true" /> Reset</button></div>
          <p>Choose how many koi swim in the pond and color each koi family.</p>
        </div>
        <SettingSlider
          label="Koi count"
          description="Add or remove koi without restarting the pond."
          value={koiCount}
          min={1}
          max={48}
          onChange={setKoiCount}
        />
        <div className="quick-setting" data-base-ui-swipe-ignore>
          <div className="quick-setting__copy">
            <Label htmlFor="quick-koi-family">Koi family</Label>
            <small>The colors below change every koi of this pattern.</small>
          </div>
          <select
            id="quick-koi-family"
            className="quick-setting__select"
            value={paletteIndex}
            onChange={(event) => onFamilyChange(Number(event.target.value))}
          >
            {palettes.map((palette, index) => (
              <option key={palette.name} value={index}>{palette.name}</option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="family-preview-toggle"
          aria-pressed={previewFamily !== null}
          onClick={() => onPreviewFamilyChange(previewFamily === null ? paletteIndex : null)}
        >
          {previewFamily === null
            ? `Preview ${selectedPalette.name} family in the pond`
            : `Showing ${selectedPalette.name} family · Show all fish`}
        </button>
        <div className="quick-colors">
          <QuickColor id="quick-koi-base" label="Body" value={hexFromInt(base)} onChange={(hex) => setBase(Number.parseInt(hex.slice(1), 16))} />
          <QuickColor id="quick-koi-accent" label="Accent patches" value={hexFromInt(accent)} onChange={(hex) => setAccent(Number.parseInt(hex.slice(1), 16))} />
          <QuickColor id="quick-koi-marking" label="Dark markings" value={hexFromInt(marking)} onChange={(hex) => setMarking(Number.parseInt(hex.slice(1), 16))} />
          <QuickColor id="quick-koi-fin" label="Fins" value={hexFromInt(fin)} onChange={(hex) => setFin(Number.parseInt(hex.slice(1), 16))} />
        </div>
      </section>

      <section className="settings-quick__section" aria-labelledby="quick-motion-heading">
        <div className="settings-quick__heading">
          <div className="settings-quick__heading-row"><h3 id="quick-motion-heading">Koi motion</h3><button type="button" className="settings-section-reset" onClick={resetMotion}><RotateCcw aria-hidden="true" /> Reset</button></div>
          <p>How the tail sways and how far the body bends in turns. More in Advanced controls › Koi › Turning and Swimming.</p>
        </div>
        <SettingSlider
          label="Tail sway"
          description="How far the tail swings to each side at full effort (share of body width)."
          value={motion.tailSway[0]}
          min={0}
          max={1.5}
          step={0.01}
          onChange={(value) => motion.tailSway[1](value)}
        />
        <SettingSlider
          label="Tail effort from speed"
          description="How much harder the tail works as the koi speeds up. A slow koi only sways it."
          value={motion.tailFromSpeed[0]}
          min={0}
          max={1.5}
          step={0.01}
          onChange={(value) => motion.tailFromSpeed[1](value)}
        />
        <SettingSlider
          label="Body bend in turns"
          description="How much the body curves along a turn (1 = follows the curve exactly, 0 = stays straight)."
          value={motion.bodyBend[0]}
          min={0}
          max={1}
          step={0.01}
          onChange={(value) => motion.bodyBend[1](value)}
        />
        <SettingSlider
          label="Cruising turn tightness"
          description="How sharply a cruising koi turns, as a share of its tightest C. Lower = wider, gentler turns."
          value={motion.cruiseTurn[0]}
          min={0.05}
          max={1}
          step={0.01}
          onChange={(value) => motion.cruiseTurn[1](value)}
        />
        <SettingSlider
          label="Turnaround tightness"
          description="How sharply a koi turning around turns, as a share of its tightest C."
          value={motion.turnaround[0]}
          min={0.05}
          max={1}
          step={0.01}
          onChange={(value) => motion.turnaround[1](value)}
        />
        <SettingSlider
          label="Tightest C (radians)"
          description="The most any koi can curl, head to tail; longer koi a bit less (2.5 ≈ 143°)."
          value={motion.tightestC[0]}
          min={0.3}
          max={2.9}
          step={0.01}
          onChange={(value) => motion.tightestC[1](value)}
        />
        <SettingSlider
          label="Body curve smoothing (s)"
          description="How lazily the body's curve follows a change of turn. Higher = smoother."
          value={motion.smoothing[0]}
          min={0.05}
          max={1.5}
          step={0.01}
          onChange={(value) => motion.smoothing[1](value)}
        />
      </section>

      <section className="settings-quick__section" aria-labelledby="quick-water-heading">
        <div className="settings-quick__heading">
          <div className="settings-quick__heading-row"><h3 id="quick-water-heading">Water</h3><button type="button" className="settings-section-reset" onClick={() => onResetSection(["pond-bed", "water", "ripples"])}><RotateCcw aria-hidden="true" /> Reset</button></div>
          <p>Change the pond colors and how clearly the koi show through the surface.</p>
        </div>
        <div className="quick-colors">
          <QuickColor
            id="quick-deep-color"
            label="Deep water"
            value={hexFromRgb(deepColor)}
            onChange={(hex) => setDeepColor(new THREE.Color(hex).toArray().map((c) => Number(c.toFixed(4))) as [number, number, number])}
          />
          <QuickColor
            id="quick-shallow-color"
            label="Shallow water"
            value={hexFromRgb(shallowColor)}
            onChange={(hex) => setShallowColor(new THREE.Color(hex).toArray().map((c) => Number(c.toFixed(4))) as [number, number, number])}
          />
        </div>
        <SettingSlider
          label="Water clarity"
          description="Soften surface patterns to make the koi easier to see."
          value={clarity}
          min={0}
          max={1}
          step={0.01}
          onChange={setClarity}
        />
      </section>

      <section className="settings-quick__section" aria-labelledby="quick-plants-heading">
        <div className="settings-quick__heading">
          <div className="settings-quick__heading-row"><h3 id="quick-plants-heading">Plants &amp; life</h3><button type="button" className="settings-section-reset" onClick={() => onResetSection(["lotus", "lotus-leaves", "lotus-flowers", "duckweed", "duckweed-patches", "butterflies", "butterfly-spawns"])}><RotateCcw aria-hidden="true" /> Reset</button></div>
          <p>Fill the edges without changing the koi already swimming.</p>
        </div>
        <SettingSlider
          label="Lotus leaves"
          description="Add floating leaves around the pond."
          value={visibleLeafCount}
          min={0}
          max={32}
          onChange={setVisibleLeafCount}
        />
        <SettingSlider
          label="Lotus flowers"
          description="Place more flowers on the visible leaves."
          value={visibleFlowerCount}
          min={0}
          max={16}
          onChange={setVisibleFlowerCount}
        />
        <SettingSlider
          label="Duckweed patches"
          description="Add small clusters of floating greenery."
          value={visiblePatchCount}
          min={0}
          max={16}
          onChange={setVisiblePatchCount}
        />
        <SettingSlider
          label="Butterflies"
          description="Change how many butterflies visit the flowers."
          value={visibleButterflyCount}
          min={0}
          max={12}
          onChange={setVisibleButterflyCount}
        />
      </section>

      <section className="settings-quick__section" aria-labelledby="quick-visitors-heading">
        <div className="settings-quick__heading">
          <div className="settings-quick__heading-row"><h3 id="quick-visitors-heading">Pond visitors</h3><button type="button" className="settings-section-reset" onClick={() => onResetSection(["ducks", "duck-spawns", "crabs", "shrimp", "frogs"])}><RotateCcw aria-hidden="true" /> Reset</button></div>
          <p>Ducks paddle over when you click; everything else would rather not be disturbed.</p>
        </div>
        <SettingSlider
          label="Ducks"
          description="Each duck may lead a line of ducklings (see Duck spawns)."
          value={duckCount}
          min={0}
          max={8}
          onChange={setDuckCount}
        />
        <SettingSlider
          label="Crabs"
          description="Sideways walkers on the pond bed."
          value={crabCount}
          min={0}
          max={16}
          onChange={setCrabCount}
        />
        <SettingSlider
          label="Shrimp"
          description="Small foragers that flick backward when startled."
          value={shrimpCount}
          min={0}
          max={32}
          onChange={setShrimpCount}
        />
        <SettingSlider
          label="Frogs"
          description="Croakers that hop between the lotus leaves."
          value={frogCount}
          min={0}
          max={8}
          onChange={setFrogCount}
        />
      </section>

      <section className="settings-quick__section" aria-labelledby="quick-atmosphere-heading">
        <div className="settings-quick__heading">
          <div className="settings-quick__heading-row"><h3 id="quick-atmosphere-heading">Atmosphere</h3><button type="button" className="settings-section-reset" onClick={onResetAtmosphere}><RotateCcw aria-hidden="true" /> Reset</button></div>
          <p>Choose the light, ripples, and background river sound.</p>
        </div>
        <div className="quick-setting" data-base-ui-swipe-ignore>
          <div className="quick-setting__copy">
            <Label htmlFor="quick-weather">Weather</Label>
            <small>A preset changes its own pond colors and lighting.</small>
          </div>
          <select
            id="quick-weather"
            className="quick-setting__select"
            value={weather}
            onChange={(event) => onWeatherChange(event.target.value as WeatherPresetId)}
          >
            {WEATHER_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>{preset.label}</option>
            ))}
          </select>
        </div>
        <div className="quick-setting quick-setting--switch" data-base-ui-swipe-ignore>
          <div className="quick-setting__copy">
            <Label htmlFor="quick-rain">Rain ripples</Label>
            <small>Show raindrops spreading across the surface.</small>
          </div>
          <Switch id="quick-rain" checked={rainEnabled} onCheckedChange={onRainChange} />
        </div>
        <div className="quick-setting quick-setting--switch" data-base-ui-swipe-ignore>
          <div className="quick-setting__copy">
            <Label htmlFor="quick-random-weather">Random weather</Label>
            <small>{`A different weather every ${randomMinutes} min. Picking one above turns this off.`}</small>
          </div>
          <Switch id="quick-random-weather" checked={randomWeather} onCheckedChange={(checked) => setRandomWeather(checked)} />
        </div>
        <div className="quick-setting quick-setting--switch" data-base-ui-swipe-ignore>
          <div className="quick-setting__copy">
            <Label htmlFor="quick-sound">River sound</Label>
            <small>Play the gentle background recording. Off by default.</small>
          </div>
          <Switch id="quick-sound" checked={soundEnabled} onCheckedChange={onSoundChange} />
        </div>
      </section>

      <section className="settings-quick__section" aria-labelledby="quick-display-heading">
        <div className="settings-quick__heading">
          <div className="settings-quick__heading-row"><h3 id="quick-display-heading">Display</h3><button type="button" className="settings-section-reset" onClick={() => onResetSection(["display"])}><RotateCcw aria-hidden="true" /> Reset</button></div>
          <p>Make the pixel art chunkier or smoother; the pond itself stays the same.</p>
        </div>
        <SettingSlider
          label="Pixel detail"
          description={`${pixelDetail}× · 1 is the original look. Higher is smoother and works the GPU harder; lower is chunkier.`}
          value={pixelDetail}
          min={pixelDetailRange.min ?? 0.5}
          max={pixelDetailRange.max ?? 4}
          step={pixelDetailRange.step ?? 0.25}
          onChange={setPixelDetail}
        />
      </section>

      <LoopClipPanel />
    </div>
  );
}
