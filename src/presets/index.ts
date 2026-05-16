/**
 * Bundled preset configurations for the image-fx effect.
 *
 * Direct ports of the four JSON files in `presets/`:
 *   • preset-dot-style-1.json     -> dots-organic   (Plasma)
 *   • preset-dot-style-2.json     -> dots-mechanic  (Noise Flow)
 *   • preset-pixels-style-3.json  -> pixels-organic  (Chromium Flow)
 *   • preset-pixels-style-4.json  -> pixels-mechanic (Nebula)
 *
 * Each preset ships a `dark` and `light` mode block; the resolved theme picks
 * the right one at runtime.
 */

import { DOTS_MECHANIC } from './dots-mechanic';
import { DOTS_ORGANIC } from './dots-organic';
import { PIXELS_MECHANIC } from './pixels-mechanic';
import { PIXELS_ORGANIC } from './pixels-organic';

export type PresetName = 'dots-organic' | 'dots-mechanic' | 'pixels-organic' | 'pixels-mechanic';
export type PresetTheme = 'dark' | 'light';

/** Per-mosaic-type render config (shader picks one based on `dotMode`). */
export interface MosaicConfig {
  /** Cell-size 0..1; converted in shader to `floor(6 + cellSize*74)` cells. */
  cellSize: number;
  /** Inter-cell spacing 0..1. */
  gap: number;
  /** Per-cell base opacity (only used in dot mode). */
  dotOpacity: number;
  /** Disc radius 0..1 (dot mode). */
  dotSize: number;
  /** Disc edge softness. */
  dotSoftness: number;
  /** Highlight scale boost 0..1. */
  hlScale: number;
  /** Background fill opacity (pixel mode). */
  fillOpacity: number;
  /** Edge fade band in CSS px. */
  edgeFade: number;
  /** Edge fade strength 0..1. */
  fadeStr: number;
}

/** Reveal animation tunings (per-mode). */
export interface RevealConfig {
  /** Duration of the shader-based reveal mask animation (sec). */
  duration: number;
  /** Easing key applied during the reveal animation. */
  easing: EasingKey;
  /** Mask-shape type (geometric or shader-driven). */
  maskShape: MaskShape;
  /** Mask edge softness 0..1. */
  softness: number;
  /** Max CSS-px blur applied to the mask canvas during reveal. */
  blur: number;
  /** Pixel-cell dissolve duration (sec) when in pixel mode. */
  pixDuration: number;
  /** Easing for the pixel-cell dissolve. */
  pixEasing: EasingKey;
  /** Dot-mode reveal duration (sec). */
  dotDuration: number;
  /** Easing for the dot-mode reveal. */
  dotEasing: EasingKey;
}

export type EasingKey =
  | 'linear'
  | 'smoothstep'
  | 'easeOutCubic'
  | 'easeOutQuint'
  | 'easeInOutCubic'
  | 'easeOutExpo'
  | 'easeOutBack';

export type MaskShape =
  | 'shader'
  | 'shaderHighlight'
  | 'shaderColor1'
  | 'shaderColor2'
  | 'shaderColor3'
  | 'shaderColor4'
  | 'shaderColor5'
  | 'radialCenter'
  | 'radialCorner'
  | 'linearTop'
  | 'linearBottom'
  | 'linearLeft'
  | 'linearRight'
  | 'diagonalTL'
  | 'diagonalBR'
  | 'diamond'
  | 'blindsH'
  | 'blindsV';

/** A single theme-mode block of a preset (mirrors the JSON shape). */
export interface PresetMode {
  theme: PresetTheme;
  effectIndex: number;
  colors: [string, string, string, string, string, string, string];
  alphas: [number, number, number, number, number, number, number];
  cardBg: string;
  /** 0 = off (raw shader), 1 = pixels, 2 = dots. */
  dotMode: 0 | 1 | 2;
  pixelConfig: MosaicConfig;
  dotConfig: MosaicConfig;
  /** Drift angle (degrees). */
  direction: number;
  speed: number;
  intensity: number;
  scale: number;
  softness: number;
  distortion: number;
  complexity: number;
  shape: number;
  blur: number;
  highlight: number;
  vignette: number;
  vigOpacity: number;
  shaderOpacity: number;
  revealConfig: RevealConfig;
  /** Human-readable effect name for diagnostics. */
  effect: string;
}

export interface Preset {
  name: PresetName;
  modes: Record<PresetTheme, PresetMode>;
}

export const PRESETS: Record<PresetName, Preset> = {
  'dots-organic': DOTS_ORGANIC,
  'dots-mechanic': DOTS_MECHANIC,
  'pixels-organic': PIXELS_ORGANIC,
  'pixels-mechanic': PIXELS_MECHANIC
};

/** `#rrggbb` -> normalized [r, g, b] in 0..1. */
export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255
  ];
}

export { DOTS_ORGANIC, DOTS_MECHANIC, PIXELS_ORGANIC, PIXELS_MECHANIC };
