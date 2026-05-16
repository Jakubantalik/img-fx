# image-fx

Animated WebGL "image generation / loader" effect for React. Wrap any card and it gets a real-time shader-driven loading mosaic that periodically reveals an image from a pool you provide. Ports the canonical `image.html` effect into a small, performant React library.

Live demo: [image.jakubantalik.com](https://image.jakubantalik.com)

## Install

```bash
npm install image-fx
```

`react`, `react-dom`, and `three` are peer dependencies.

### Local development

```bash
npm install
npm run dev          # local Vite playground
npm run build        # produce dist/ (ESM + CJS + .d.ts)
npm run build:demo   # produce dist-demo/ (static showcase site)
```

## Quick start

```tsx
import { ImageGeneration } from 'image-fx';

function Card() {
  return (
    <ImageGeneration
      preset="dots-organic"
      images={['/img/a.jpg', '/img/b.jpg']}
      autoReveal
    >
      <div className="card" style={{ width: 320, height: 320, borderRadius: 20 }} />
    </ImageGeneration>
  );
}
```

## Props

| Prop                | Type                                                                  | Default     | Notes                                                                                            |
| ------------------- | --------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------ |
| `preset`            | `'dots-organic' \| 'dots-mechanic' \| 'pixels-organic' \| 'pixels-mechanic'` | `'dots-organic'` | Selects the bundled effect preset (Type × Variant).                                              |
| `theme`             | `'auto' \| 'dark' \| 'light'`                                          | `'auto'`    | `auto` follows `prefers-color-scheme`.                                                           |
| `strength`          | `number` (0..1)                                                       | `1`         | Final opacity multiplier. Doesn't change shader animation.                                       |
| `cardBg`            | `string` (`#rrggbb` or any CSS color)                                 | preset      | Override the host card surface colour. Applied to the wrapper background AND fed into the shader's `u_cardBg` so colour-proximity logic stays in sync. |
| `images`            | `string \| string[]`                                                  | `[]`        | Reveal pool. Random pick per cycle, never repeats last.                                          |
| `autoReveal`        | `boolean`                                                             | `false`     | When true, runs the auto-loop scheduler.                                                         |
| `revealDelayRange`  | `[number, number]` seconds                                            | `[2, 4]`    | Random shader-only gap between reveals.                                                          |
| `revealHoldMs`      | `number`                                                              | `2000`      | Image visible duration after reveal animation completes.                                         |
| `revealFadeOutMs`   | `number`                                                              | `300`       | Cross-fade back to shader.                                                                       |
| `borderRadius`      | `number`                                                              | (auto)      | Override the corner radius (px). Auto-detected from the wrapped child by default.                |
| `paused`            | `boolean`                                                             | `false`     | Freezes shader and scheduler.                                                                    |
| `onCycle`           | `(p) => void`                                                         | -           | Fires on each phase change: `idle` / `reveal` / `visible` / `hide`.                              |

## Manual reveal (ref handle)

Pass a ref to trigger reveals from a button click or any other user action,
without enabling `autoReveal`:

```tsx
import { useRef } from 'react';
import { ImageGeneration, type ImageGenerationHandle } from 'image-fx';

function Card() {
  const ref = useRef<ImageGenerationHandle>(null);
  return (
    <>
      <ImageGeneration ref={ref} preset="dots-organic" images={pool}>
        <div className="card" />
      </ImageGeneration>
      <button onClick={() => ref.current?.triggerReveal()}>
        Reveal image
      </button>
    </>
  );
}
```

`triggerReveal()` runs one full reveal -> hold -> hide pass and is a no-op
while a reveal is already in progress. Works with or without `autoReveal`.

## Scale invariance

Cell size, vignette range, and edge-fade are computed in CSS pixels (the shader
gets `u_dpr` so it can convert from physical pixels back to CSS px). That means
a `pixels-organic` cell stays the same physical size whether the card is 200×200
or 600×600 — the cell *count* scales with the card, not the cell *size*. No
chunky pixels on big cards.

## Performance

- Single shared `THREE.WebGLRenderer` for the whole page; one WebGL context.
- 30 fps cap via rAF accumulator (matches `image.html`).
- `IntersectionObserver` pauses any card that scrolls offscreen.
- Strength is implemented as `canvas.style.opacity` — no shader recompile, no uniform reupload.
- Reveal scratch canvases are reused across frames; only re-allocated when grid size changes.
- Image bitmaps cached by URL across all card instances.

## License

MIT &copy; Jakub Antalik. See [LICENSE](./LICENSE).
