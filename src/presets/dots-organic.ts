/**
 * Direct port of `presets/preset-dot-style-1.json`.
 * Dots renderer + Plasma effect (organic noise field).
 */
import type { Preset } from './index';

export const DOTS_ORGANIC: Preset = {
  name: 'dots-organic',
  modes: {
    dark: {
      theme: 'dark',
      effectIndex: 1,
      colors: ['#0f0f0f', '#9c9c9c', '#ffffff', '#0f0f0f', '#898989', '#606060', '#ffffff'],
      alphas: [1, 1, 1, 1, 1, 1, 1],
      cardBg: '#0f0f0f',
      dotMode: 2,
      pixelConfig: {
        cellSize: 0.5,
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
        cellSize: 0.58,
        gap: 0,
        dotOpacity: 1,
        dotSize: 0.22,
        dotSoftness: 0.1,
        hlScale: 0,
        fillOpacity: 0,
        edgeFade: 34,
        fadeStr: 0.34
      },
      direction: 0,
      speed: 0.9,
      intensity: 1,
      scale: 2,
      softness: 0.76,
      distortion: 0.3,
      complexity: 0.2,
      shape: 0.52,
      blur: 1,
      highlight: 0.64,
      vignette: 0.26,
      vigOpacity: 1,
      shaderOpacity: 0.76,
      revealConfig: {
        duration: 2,
        easing: 'easeOutQuint',
        maskShape: 'shader',
        softness: 0.5,
        blur: 16,
        pixDuration: 2,
        pixEasing: 'easeOutCubic',
        dotDuration: 2.05,
        dotEasing: 'easeOutCubic'
      },
      effect: 'Plasma'
    },
    light: {
      theme: 'light',
      effectIndex: 1,
      colors: ['#f9f9f9', '#353535', '#dbdbdb', '#6c6c6c', '#f9f9f9', '#f9f9f9', '#f9f9f9'],
      alphas: [1, 1, 1, 1, 1, 1, 1],
      cardBg: '#f9f9f9',
      dotMode: 2,
      pixelConfig: {
        cellSize: 0.5,
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
        cellSize: 0.58,
        gap: 0,
        dotOpacity: 1,
        dotSize: 0.22,
        dotSoftness: 0.1,
        hlScale: 0,
        fillOpacity: 0,
        edgeFade: 34,
        fadeStr: 0.7
      },
      direction: 0,
      speed: 0.9,
      intensity: 1,
      scale: 2,
      softness: 0.76,
      distortion: 0.3,
      complexity: 0.2,
      shape: 0.52,
      blur: 1,
      highlight: 1,
      vignette: 0.26,
      vigOpacity: 1,
      shaderOpacity: 1,
      revealConfig: {
        duration: 2,
        easing: 'easeOutCubic',
        maskShape: 'shader',
        softness: 0.5,
        blur: 15,
        pixDuration: 2,
        pixEasing: 'easeOutCubic',
        dotDuration: 2.05,
        dotEasing: 'easeOutCubic'
      },
      effect: 'Plasma'
    }
  }
};
