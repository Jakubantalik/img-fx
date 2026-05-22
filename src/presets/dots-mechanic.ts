/**
 * Direct port of `presets/preset-dot-style-2.json`.
 * Dots renderer + Noise Flow effect (mechanical / structured).
 */
import type { Preset } from './index';

export const DOTS_MECHANIC: Preset = {
  name: 'dots-mechanic',
  modes: {
    dark: {
      theme: 'dark',
      effectIndex: 2,
      colors: ['#0f0f0f', '#0f0f0f', '#ffffff', '#404040', '#ffffff', '#0f0f0f', '#ffffff'],
      alphas: [1, 1, 1, 1, 1, 1, 1],
      cardBg: '#0f0f0f',
      dotMode: 2,
      pixelConfig: {
        // `cellSize` here drives the REVEAL pixelation grid (the chunky
        // pixel-mode-style dropout layer). The shader itself ignores
        // `pixelConfig` for dot presets (it uses `dotConfig`), so this
        // value is only ever seen during the reveal animation and the
        // 0..1 documented range does not apply — we deliberately push
        // past it to land on a finer grid.
        //
        // 1.0 → baseCount = 80 → 70 cells per dim on a 280px card →
        // ~4 dest-px square cells. That is roughly half the linear size
        // of the legacy 0.5 value (~7.5 px cells) — the actual visible
        // 50% reduction the user asked for. Cell count grows from 37x37
        // (~1.4k) to 70x70 (~4.9k); the per-frame alpha-update loop is a
        // handful of typed-array ops per cell so total cost stays sub-
        // millisecond, well below the 100 ms per-frame budget at the
        // 10 fps reveal cap.
        cellSize: 1.0,
        gap: 0.3,
        dotOpacity: 0.58,
        dotSize: 0.8,
        dotSoftness: 0.1,
        hlScale: 0,
        fillOpacity: 0,
        edgeFade: 16,
        fadeStr: 1
      },
      dotConfig: {
        cellSize: 0.52,
        gap: 0,
        dotOpacity: 1,
        dotSize: 0.28,
        dotSoftness: 0.1,
        hlScale: 0.1,
        fillOpacity: 0,
        edgeFade: 34,
        fadeStr: 0.34
      },
      direction: 0,
      speed: 0.45,
      intensity: 1,
      scale: 3.9,
      softness: 0.76,
      distortion: 0.24,
      complexity: 0,
      shape: 0.52,
      blur: 0.42,
      highlight: 0,
      vignette: 0.26,
      vigOpacity: 1,
      shaderOpacity: 0.76,
      revealConfig: {
        duration: 0.9,
        easing: 'easeOutCubic',
        maskShape: 'shader',
        softness: 0.5,
        blur: 0,
        pixDuration: 2,
        pixEasing: 'easeOutCubic',
        dotDuration: 2.05,
        dotEasing: 'easeOutCubic'
      },
      effect: 'Noise Flow'
    },
    light: {
      theme: 'light',
      effectIndex: 2,
      colors: ['#f9f9f9', '#1e1e1e', '#f9f9f9', '#f9f9f9', '#f9f9f9', '#f9f9f9', '#f9f9f9'],
      alphas: [1, 1, 1, 1, 1, 1, 1],
      cardBg: '#f9f9f9',
      dotMode: 2,
      pixelConfig: {
        // See dark-mode comment above — reveal pixelation grid.
        cellSize: 1.0,
        gap: 0.3,
        dotOpacity: 0.58,
        dotSize: 0.8,
        dotSoftness: 0.1,
        hlScale: 0,
        fillOpacity: 0,
        edgeFade: 16,
        fadeStr: 1
      },
      dotConfig: {
        cellSize: 0.52,
        gap: 0,
        dotOpacity: 1,
        dotSize: 0.28,
        dotSoftness: 0.1,
        hlScale: 0.1,
        fillOpacity: 0,
        edgeFade: 34,
        fadeStr: 0.8
      },
      direction: 0,
      speed: 0.45,
      intensity: 1,
      scale: 3.9,
      softness: 0.76,
      distortion: 0.24,
      complexity: 0,
      shape: 0.52,
      blur: 0.42,
      highlight: 0,
      vignette: 0.26,
      vigOpacity: 1,
      shaderOpacity: 0.76,
      revealConfig: {
        duration: 0.9,
        easing: 'easeOutCubic',
        maskShape: 'shader',
        softness: 0.5,
        blur: 0,
        pixDuration: 2,
        pixEasing: 'easeOutCubic',
        dotDuration: 2.05,
        dotEasing: 'easeOutCubic'
      },
      effect: 'Noise Flow'
    }
  }
};
