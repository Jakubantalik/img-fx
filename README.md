# img-fx

Animated WebGL "image generation / loader" effect for React. Wrap any card and it gets a real-time shader-driven loading mosaic that periodically reveals an image from a pool you provide. Ports the canonical `image.html` effect into a small, performant React library.

Live demo: [image.jakubantalik.com](https://image.jakubantalik.com)

## Install

```bash
npm install img-fx
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
import { ImageGeneration } from 'img-fx';

export function Card() {
  return (
    <ImageGeneration
      preset="pixels-organic"
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
| `preset`            | `'pixels-organic' \| 'pixels-mechanic'`                               | `'pixels-organic'` | Selects the bundled effect preset (Type × Variant).                                              |
| `theme`             | `'auto' \| 'dark' \| 'light'`                                          | `'auto'`    | `auto` checks `<html data-theme>`, `.dark`/`.light` class, inline `color-scheme`, then `prefers-color-scheme`. Live-updates via MutationObserver. |
| `strength`          | `number` (0..1)                                                       | `1`         | Final opacity multiplier. Doesn't change shader animation.                                       |
| `cardBg`            | `string` (any CSS colour)                                             | preset      | Override the host card surface colour. Applied verbatim to the wrapper background (alpha preserved) AND parsed to opaque RGB for the shader's `u_cardBg` so colour-proximity logic stays in sync. Accepts hex, `rgb()`/`rgba()`, `hsl()`, named colours, etc. |
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
import { ImageGeneration, type ImageGenerationHandle } from 'img-fx';

export function Card() {
  const ref = useRef<ImageGenerationHandle>(null);
  return (
    <>
      <ImageGeneration ref={ref} preset="pixels-organic" images={['/a.jpg', '/b.jpg']}>
        <div className="card" style={{ width: 320, height: 320, borderRadius: 20 }} />
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

For a **Reveal / Hide toggle** button (like the playground on the demo
page), pair `triggerReveal({ hold: 'manual' })` with `triggerHide()` and
use `isImageActive()` to drive the button label:

```tsx
const onToggle = () => {
  const h = ref.current;
  if (!h) return;
  if (h.isImageActive()) h.triggerHide();
  else h.triggerReveal({ hold: 'manual' });
};
```

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
