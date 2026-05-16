import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import type { CycleEvent } from './engine';
import type { PresetName } from './presets';

/**
 * Theme mode for the image-fx effect.
 *
 * - `auto` (default): follows the user's `prefers-color-scheme` and updates
 *   live when the OS / browser theme changes. SSR-safe — defaults to `dark`
 *   during SSR and re-resolves on hydration.
 * - `dark` / `light`: pin to a specific mode regardless of system preference.
 */
export type ImageGenerationTheme = 'auto' | 'dark' | 'light';

/** Bundled preset names. Each preset ships both a dark and light tunings block. */
export type ImageGenerationPreset = PresetName;

/** Phase event emitted by the auto-reveal scheduler. */
export type ImageGenerationCycleEvent = CycleEvent;

/**
 * Imperative handle exposed via `ref` on `<ImageGeneration>`. Lets callers
 * trigger a single reveal from a button click or other user action without
 * enabling `autoReveal`.
 *
 * The wrapper element itself is also reachable via `handle.element`.
 */
export interface ImageGenerationHandle {
  /** The wrapper `<div>` element. */
  element: HTMLDivElement | null;
  /**
   * Run a reveal pass now.
   *
   * - No-op if a reveal is already in progress (currently revealing, holding
   *   the image visible, or fading back to the shader).
   * - `hold: 'auto'` (default) — runs reveal -> hold (`revealHoldMs`) -> hide
   *   automatically, mirroring the auto-loop's pass.
   * - `hold: 'manual'` — runs reveal then stays in the visible phase until
   *   `triggerHide()` is called. Use this for "Reveal / Hide" toggle buttons.
   *
   * Requires a non-empty `images` prop; otherwise it's a silent no-op.
   */
  triggerReveal: (opts?: { hold?: 'auto' | 'manual' }) => void;
  /**
   * Manually trigger the hide fade if an image is currently revealed (in
   * `reveal` or `visible` phase). No-op otherwise.
   */
  triggerHide: () => void;
  /**
   * Returns true while an image is showing on top of the shader (any of the
   * `reveal`, `visible`, or `hide` phases). Useful for driving the label /
   * icon of a Reveal/Hide toggle button.
   */
  isImageActive: () => boolean;
}

export interface ImageGenerationProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /**
   * Single host element to wrap. The wrapper sizes itself to the child; the
   * shader paints inside the wrapper at full size, clipped to the child's
   * border-radius.
   */
  children: ReactNode;

  /**
   * Selects which bundled preset to render.
   *
   * - `dots-organic`   - Plasma noise field rendered as glowing dots.
   * - `dots-mechanic`  - Noise Flow rendered as structured dots.
   * - `pixels-organic` - Chromium Flow rendered as a pixel mosaic.
   * - `pixels-mechanic`- Nebula rendered as a pixel mosaic.
   *
   * @default 'dots-organic'
   */
  preset?: ImageGenerationPreset;

  /**
   * Theme mode. `'auto'` resolves via `matchMedia('(prefers-color-scheme: dark)')`
   * and switches live when the OS theme changes.
   * @default 'auto'
   */
  theme?: ImageGenerationTheme;

  /**
   * Effect strength (0..1). Multiplies the shader canvas opacity. The shader
   * keeps animating at full intensity at any value; only the rendered alpha
   * is scaled down.
   * @default 1
   */
  strength?: number;

  /**
   * Card background color (`#rrggbb` or any valid CSS color). Applied to the
   * wrapper element AND fed into the shader's `u_cardBg` uniform — colour
   * proximity / luminance contrast logic in the shader uses this so any
   * shader colours that match the card background get faded out, keeping the
   * effect visually balanced against the host card's surface.
   *
   * Use this to keep colours in sync when the host card surface changes
   * (e.g. dark mode card swatch). When omitted, the preset's bundled
   * `cardBg` value is used.
   */
  cardBg?: string;

  /**
   * Image pool used by the reveal animation. Pass a single string to reveal
   * the same image every cycle, or an array for random pick (never
   * repeating the previous index).
   * @default []
   */
  images?: string | string[];

  /**
   * When true, runs the auto-reveal scheduler:
   *   shader (random delay) -> reveal -> hold -> hide -> repeat.
   * @default false
   */
  autoReveal?: boolean;

  /**
   * Random shader-only delay range in seconds between reveals.
   * @default [2, 4]
   */
  revealDelayRange?: [number, number];

  /**
   * One-time delay applied before the very first reveal (after `autoReveal`
   * is enabled or `triggerReveal` runs the first cycle). Subsequent reveals
   * follow `revealDelayRange`.
   *
   * - `number`: exact seconds.
   * - `[min, max]`: seconds range, randomised once at cycle creation.
   * - `undefined` (default): library picks a small jitter (0-1.5 s) so
   *   multiple instances on the same page don't tick in lockstep.
   *
   * Useful for staggering hero cards (e.g. card #2 = `[1, 3]`, card #3 =
   * `[1, 3]`) so they don't all reveal at once.
   */
  revealInitialDelay?: number | [number, number];

  /**
   * Time the image stays fully visible after the reveal animation completes,
   * before the hide cross-fade kicks in.
   *
   * - `number` — fixed milliseconds.
   * - `[min, max]` — random milliseconds per cycle, picked fresh each reveal.
   *
   * @default 2000
   */
  revealHoldMs?: number | [number, number];

  /** ms cross-fade back to the shader. @default 300 */
  revealFadeOutMs?: number;

  /**
   * Optional explicit corner radius (CSS px). When omitted, reads the
   * computed `border-radius` of the wrapped child each resize.
   */
  borderRadius?: number;

  /** Freezes the shader and the auto-reveal scheduler. @default false */
  paused?: boolean;

  /** Phase event hook for the auto-reveal cycle. */
  onCycle?: (event: ImageGenerationCycleEvent) => void;

  /**
   * Optional callback invoked just before each image pick that returns a list
   * of src strings the cycle MUST avoid this round. Use this to coordinate
   * multiple `<ImageGeneration>` instances that share an image pool so they
   * never display the same image at the same time.
   *
   * The callback runs on every pick (including manual `triggerReveal()`) so
   * it can read live state. If every candidate is excluded, the cycle falls
   * back to a normal random pick so it never gets stuck.
   */
  excludeSrcs?: () => string[] | Set<string> | null | undefined;

  /** Forwarded class name for the wrapper element. */
  className?: string;

  /** Forwarded inline styles for the wrapper element. */
  style?: CSSProperties;
}
