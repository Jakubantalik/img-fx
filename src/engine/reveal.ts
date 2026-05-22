/**
 * Per-instance reveal pipeline.
 *
 * Direct port of image.html `drawMaskedImage` (lines 2481–2703) and the
 * `getMaskValue` geometric mask helper (line 2367), reorganised so each
 * <ImageGeneration> card has its own private scratch canvases and overlay
 * state. The reveal canvas sits on top of the shader canvas and is gradually
 * filled with the source image; the shader canvas underneath fades to 0 over
 * the same duration, producing the same crossfade as the original demo.
 *
 * The shader luminance / shader-color sampling renders the live shader into a
 * small `MASK_SIZE` × `MASK_SIZE` buffer (image.html's `MASK_SIZE` was 100; we
 * use 64 — visually indistinguishable after the upscale-with-smoothing step
 * but ~60% cheaper to allocate and iterate). The dotMode is temporarily
 * forced to 0 / 1 so the mask reads from the raw / pixel-rendered shader
 * colour field rather than the dot mosaic.
 */
import { parseCssColor, type MaskShape, type PresetMode } from '../presets';
import { ease } from './tween';
import { effectiveCardBg, type Instance, type SharedRenderer } from './renderer';

/** Side length of the square buffer used to evaluate the reveal mask shape
 *  (and to sample the live shader field for the `shaderColor*` / `shaderHighlight`
 *  mask shapes). The buffer is upscaled to the visible canvas size with
 *  image-smoothing on, so dropping below ~50 still produces a clean edge.
 *  64 (vs the original 100) cuts the per-frame JS pixel loop and the
 *  `getImageData` allocation by ~59% with no perceptible visual change. */
const MASK_SIZE = 64;
const DOT_MASK_SIZE = 96;
/** Reference card edge length (CSS px) used by the shader's `gridCounts` for
 *  scale-invariant cell sizing. The pixel-mode reveal dissolve mirrors that
 *  same constant so its chunky cells line up visually with the shader's. */
const REVEAL_REF_DIM = 320;

/** Source rect for a cover-fit draw of `img` into a target of `targetW × targetH`.
 *  Mirrors CSS `object-fit: cover`: image aspect is preserved, the overflowing
 *  axis is centre-cropped. Never squashes / stretches. */
function computeCoverSourceRect(
  img: HTMLImageElement,
  targetW: number,
  targetH: number
): { sx: number; sy: number; sw: number; sh: number } {
  const targetAspect = targetW / Math.max(1, targetH);
  const imgAspect = img.width / Math.max(1, img.height);
  let sx = 0;
  let sy = 0;
  let sw = img.width;
  let sh = img.height;
  if (imgAspect > targetAspect) {
    // Image is wider than target — crop left/right.
    sw = img.height * targetAspect;
    sx = (img.width - sw) / 2;
  } else {
    // Image is taller than target — crop top/bottom.
    sh = img.width / targetAspect;
    sy = (img.height - sh) / 2;
  }
  return { sx, sy, sw, sh };
}

/** Cache decoded <img> elements globally so repeat URLs only decode once. */
const IMAGE_CACHE = new Map<string, Promise<HTMLImageElement>>();

/**
 * Load (and cache) an image. Resolves once the bitmap is decoded and ready.
 *
 * Note: we do NOT set `img.crossOrigin` — for same-origin assets that would
 * trigger an unnecessary CORS preflight that most static dev servers don't
 * satisfy. Drawing images into a 2D canvas does not taint the canvas if the
 * image is same-origin. Consumers serving cross-origin images should set
 * proper CORS headers on their CDN.
 */
export function loadImage(src: string): Promise<HTMLImageElement> {
  let entry = IMAGE_CACHE.get(src);
  if (entry) return entry;
  entry = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) => {
      IMAGE_CACHE.delete(src);
      reject(e);
    };
    img.src = src;
  });
  IMAGE_CACHE.set(src, entry);
  return entry;
}

export interface RevealStartOptions {
  /** Image to reveal. */
  image: HTMLImageElement;
  /** Output canvas size (CSS px). Reveal canvas matches the shader canvas. */
  cssWidth: number;
  cssHeight: number;
  /** Phase scheduler hooks. */
  onRevealComplete?: () => void;
}

export interface RevealState {
  /** The DOM canvas painted on top of the shader canvas. */
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** Per-frame hook invoked after the shader has rendered. Decides what to do
   *  with the overlay this frame (paint mask, hold, fade out, idle). */
  afterShaderFrame: (s: SharedRenderer, inst: Instance, nowMs: number) => void;
  /** Begin a new reveal animation. */
  startReveal: (opts: RevealStartOptions) => void;
  /** Begin the fade-out (hide) phase. */
  startHide: (durationMs?: number) => void;
  /** Force-clear the overlay back to idle. */
  clear: () => void;
  /** True while a reveal/hold/hide is in progress. */
  isActive: () => boolean;
  dispose: () => void;
}

interface RevealInternals {
  // Animation state
  active: boolean;
  phase: 'idle' | 'reveal' | 'hold' | 'hide';
  revealStartMs: number;
  hideStartMs: number;
  hideDurationMs: number;
  image: HTMLImageElement | null;
  onRevealComplete?: () => void;

  // Output dims (CSS px)
  cssWidth: number;
  cssHeight: number;

  // Mask scratch (geometric / shader-luminance)
  sampleCanvas: HTMLCanvasElement | null;
  sampleCtx: CanvasRenderingContext2D | null;
  /** Pooled image-data for `getImageData` reads from `sampleCanvas`. Allocated
   *  once and reused every frame — without this the reveal hot path allocates
   *  a fresh Uint8ClampedArray per frame per active card, putting heavy
   *  GC pressure on Chrome over long sessions. */
  sampleImgData: ImageData | null;
  /** Last-read sample buffer (the `.data` view of `sampleImgData`). Cached
   *  so we can skip the expensive `renderer.render()` + `getImageData`
   *  round-trip on every other reveal frame — the shader colour field drifts
   *  slowly enough (~0.3-0.9 rad/s) that a 1-frame-stale sample is
   *  imperceptible at the soft-banded mask threshold. */
  sampleDataCache: Uint8ClampedArray | null;
  /** Monotonically increasing reveal-frame counter used to decide when to
   *  re-sample. Even values trigger a fresh sample, odd values reuse the
   *  cache. Reset to 0 on every new `startReveal()`. */
  sampleFrameCounter: number;
  maskGrad: HTMLCanvasElement | null;
  maskGradCtx: CanvasRenderingContext2D | null;
  /** Pooled image-data for the mask gradient. Allocated lazily on first paint
   *  and reused thereafter; MASK_SIZE is a compile-time constant so the
   *  buffer dimensions never need to change. */
  maskImgData: ImageData | null;

  // Pixel-mode + dot-mode pixelation scratch. The same canvases are reused
  // by both code paths because `preset.dotMode` is fixed per-instance, so
  // only one of the two ever runs against a given reveal state. The drop
  // pattern is the per-cell random threshold used to gradually transition
  // cells from chunky-pixelated to smooth as `fadeT` increases.
  pixCanvas: HTMLCanvasElement | null;
  pixCtx: CanvasRenderingContext2D | null;
  pixDrop: HTMLCanvasElement | null;
  pixDropCtx: CanvasRenderingContext2D | null;
  pixDropImgData: ImageData | null;
  pixDropPattern: Float32Array | null;
  pixDropPatternW: number;
  pixDropPatternH: number;
  pixDropRevealStart: number;
}

function getMaskSize(p: PresetMode): number {
  return p.dotMode === 2 ? DOT_MASK_SIZE : MASK_SIZE;
}

function getActiveRevealTiming(p: PresetMode): { duration: number; easingKey: PresetMode['revealConfig']['easing'] } {
  // Mode-aware: dot uses dotDuration/dotEasing, everything else uses duration/easing.
  // Mirrors image.html `getActiveRevealTiming` (line 2353).
  const r = p.revealConfig;
  if (p.dotMode === 2) {
    return { duration: Math.max(0.05, r.dotDuration), easingKey: r.dotEasing };
  }
  return { duration: Math.max(0.05, r.duration), easingKey: r.easing };
}

function getMaskValue(shape: MaskShape, r: number, c: number, size: number): number {
  const nx = c / (size - 1);
  const ny = r / (size - 1);
  const cx = nx - 0.5;
  const cy = ny - 0.5;
  switch (shape) {
    case 'radialCenter':
      return 1 - Math.sqrt(cx * cx + cy * cy) * 2;
    case 'radialCorner':
      return 1 - Math.sqrt(nx * nx + ny * ny) / 1.414;
    case 'linearTop':
      return 1 - ny;
    case 'linearBottom':
      return ny;
    case 'linearLeft':
      return 1 - nx;
    case 'linearRight':
      return nx;
    case 'diagonalTL':
      return 1 - (nx + ny) / 2;
    case 'diagonalBR':
      return (nx + ny) / 2;
    case 'diamond':
      return 1 - (Math.abs(cx) + Math.abs(cy));
    case 'blindsH':
      return 1 - ((ny * 8) % 1);
    case 'blindsV':
      return 1 - ((nx * 8) % 1);
    default:
      return -1;
  }
}

/** Sample the current shader frame into an N×N RGBA buffer for the reveal
 *  mask. Mirrors the original `image.html` (line 2530) sampling rule so each
 *  preset gets its authentic mask character:
 *
 *    presetDotMode === 1 (PIXELS) → sample at u_dotMode = 0 (RAW smooth
 *      shader field), so the reveal silhouette never inherits the chunky
 *      pixel cells from the foreground render. The pixel-cell dissolve is
 *      a separate effect handled in paintPixelMasked().
 *
 *    presetDotMode === 2 (DOTS)  → sample at u_dotMode = 1 (PIXEL-rendered
 *      shader field). The dot foreground would leave huge gaps if sampled
 *      directly; pixel-rendered sampling produces a solid, cell-stepped
 *      field whose chunks line up with the shader's mosaic grid, giving the
 *      dots presets their distinctive cell-quantised mask edge.
 *
 *  Restores the original dotMode / fillOpacity before returning so the
 *  next regular tick is unaffected.
 */
function sampleShaderField(
  state: RevealInternals,
  s: SharedRenderer,
  inst: Instance,
  scratchCtx: CanvasRenderingContext2D,
  maskSize: number
): Uint8ClampedArray {
  const origDotMode = s.uniforms.u_dotMode.value as number;
  const origFillOpacity = s.uniforms.u_fillOpacity.value as number;
  const presetDotMode = inst.preset.dotMode;
  const sampleDotMode = presetDotMode < 1.5 ? 0 : 1;
  s.uniforms.u_dotMode.value = sampleDotMode;
  // When sampling as pixel-rendering (dots presets), preserve the active
  // mosaic's fillOpacity so colour-target masks (`shaderColorN`) read the
  // same colour distribution the user sees. When sampling raw (pixels
  // presets), zero it out so pixel fills don't bleed into the mask field.
  s.uniforms.u_fillOpacity.value =
    sampleDotMode > 0.5
      ? presetDotMode === 1
        ? inst.preset.pixelConfig.fillOpacity
        : inst.preset.dotConfig.fillOpacity
      : 0;
  s.renderer.render(s.scene, s.camera);

  // The instance's pixels live in the BOTTOM-LEFT iw×ih sub-rect of the
  // shared GL canvas (paintInstance sets the viewport accordingly). In
  // image-space coords (top-left origin used by drawImage source rects) that
  // sub-rect starts at y = glCanvas.height - ih.
  const iw = Math.max(1, Math.floor(inst.cssWidth * inst.dpr));
  const ih = Math.max(1, Math.floor(inst.cssHeight * inst.dpr));
  const sy = Math.max(0, s.glCanvas.height - ih);
  scratchCtx.clearRect(0, 0, maskSize, maskSize);
  scratchCtx.drawImage(s.glCanvas, 0, sy, iw, ih, 0, 0, maskSize, maskSize);
  // Restore uniforms; the next instance / tick re-uploads its own values
  // before rendering so we don't need to re-render the GL canvas here.
  s.uniforms.u_dotMode.value = origDotMode;
  s.uniforms.u_fillOpacity.value = origFillOpacity;
  // Hold the latest ImageData on the state so the typed array isn't
  // immediately collected — keeps the buffer alive for the rest of the
  // current frame's mask paint without depending on JS engine GC timing.
  // (Canvas 2D's `getImageData` has no zero-alloc variant, so we can't
  // truly pool here; this just minimises pressure for the active call.)
  state.sampleImgData = scratchCtx.getImageData(0, 0, maskSize, maskSize);
  state.sampleDataCache = state.sampleImgData.data;
  return state.sampleDataCache;
}

function ensureScratch(state: RevealInternals, maskSize: number): void {
  if (!state.sampleCanvas) {
    state.sampleCanvas = document.createElement('canvas');
    state.sampleCtx = state.sampleCanvas.getContext('2d', { willReadFrequently: true });
  }
  if (state.sampleCanvas.width !== maskSize || state.sampleCanvas.height !== maskSize) {
    state.sampleCanvas.width = maskSize;
    state.sampleCanvas.height = maskSize;
    state.sampleImgData = null;
    state.sampleDataCache = null;
    state.sampleFrameCounter = 0;
  }
  if (!state.maskGrad) {
    state.maskGrad = document.createElement('canvas');
    state.maskGradCtx = state.maskGrad.getContext('2d');
  }
  if (state.maskGrad.width !== maskSize || state.maskGrad.height !== maskSize) {
    state.maskGrad.width = maskSize;
    state.maskGrad.height = maskSize;
    state.maskImgData = null;
  }
  if (!state.maskImgData && state.maskGradCtx) {
    // Pool the mask-gradient buffer and only resize when mask resolution changes.
    // The original code called `createImageData(MASK_SIZE, MASK_SIZE)` every frame,
    // allocating 40 KB per card per frame.
    state.maskImgData = state.maskGradCtx.createImageData(maskSize, maskSize);
  }
}

function paintMaskedFrame(
  state: RevealInternals,
  s: SharedRenderer,
  inst: Instance,
  ctx: CanvasRenderingContext2D
): void {
  if (!state.image) return;
  const preset = inst.preset;
  // Resize visible canvas to match shader canvas pixel size.
  const targetW = inst.canvas.width;
  const targetH = inst.canvas.height;
  if (ctx.canvas.width !== targetW || ctx.canvas.height !== targetH) {
    ctx.canvas.width = targetW;
    ctx.canvas.height = targetH;
  }
  ctx.clearRect(0, 0, targetW, targetH);

  const { duration, easingKey } = getActiveRevealTiming(preset);
  const elapsed = (performance.now() - state.revealStartMs) / 1000;
  const progress = Math.min(elapsed / duration, 1);
  const eased = ease(easingKey, progress);

  // Cover-fit crop (CSS object-fit: cover) — preserves image aspect ratio,
  // centre-crops the overflowing axis. Never squashes the image.
  const img = state.image;
  const { sx, sy, sw, sh } = computeCoverSourceRect(img, targetW, targetH);

  // CSS blur fade
  const maxBlur = preset.revealConfig.blur;
  if (progress < 1 && maxBlur > 0) {
    const b = maxBlur * (1 - eased);
    ctx.canvas.style.filter = b > 0.1 ? `blur(${b.toFixed(1)}px)` : 'none';
  } else {
    ctx.canvas.style.filter = 'none';
  }

  if (progress >= 1) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, targetW, targetH);
    return;
  }

  const maskSize = getMaskSize(preset);
  ensureScratch(state, maskSize);
  const sampleCtx = state.sampleCtx as CanvasRenderingContext2D;
  const maskGrad = state.maskGrad as HTMLCanvasElement;
  const maskGradCtx = state.maskGradCtx as CanvasRenderingContext2D;

  const maskShape = preset.revealConfig.maskShape;
  const softBand = preset.revealConfig.softness;
  const useShader = maskShape.startsWith('shader');

  let sampleData: Uint8ClampedArray | null = null;
  let targetColor: [number, number, number] | null = null;
  let highlightColors: Array<[number, number, number]> | null = null;

  if (useShader) {
    // Throttle the shader re-sample to every 2nd reveal frame. The shader's
    // colour field drifts at speed 0.3-0.9 rad/s and the mask's soft-band
    // threshold (~0.07) easily absorbs a 100-200 ms staleness in the sample
    // — far below the perceptual flicker threshold — while halving both the
    // extra `renderer.render()` calls and the `getImageData` allocations.
    // Frame 0 always samples so the very first reveal frame is fresh.
    const counter = state.sampleFrameCounter++;
    const shouldSample = state.sampleDataCache == null || (counter & 1) === 0;
    if (shouldSample) {
      sampleData = sampleShaderField(state, s, inst, sampleCtx, maskSize);
    } else {
      sampleData = state.sampleDataCache;
    }
    const colorMap: Record<string, number> = {
      shaderColor1: 0,
      shaderColor2: 1,
      shaderColor3: 2,
      shaderColor4: 3,
      shaderColor5: 4
    };
    if (colorMap[maskShape] != null) {
      targetColor = parseCssColor(preset.colors[colorMap[maskShape]]);
    }
    if (maskShape === 'shaderHighlight') {
      // `effectiveCardBg` may return any CSS colour the consumer passed via
      // the `cardBg` prop (rgba, hsl, named, …). parseCssColor handles all
      // of it; alpha is dropped so the proximity test below stays in RGB
      // space against the same opaque tint the shader uniform sees.
      const bg = parseCssColor(effectiveCardBg(inst));
      highlightColors = [];
      for (let i = 0; i < 5; i++) {
        const c = parseCssColor(preset.colors[i]);
        const dr = c[0] - bg[0];
        const dg = c[1] - bg[1];
        const db = c[2] - bg[2];
        const distC = Math.sqrt(dr * dr + dg * dg + db * db);
        if (distC > 0.15) highlightColors.push(c);
      }
      if (highlightColors.length === 0) highlightColors = [parseCssColor(preset.colors[0])];
    }
  }

  const threshold = 1 - eased * (1 + softBand);

  // Reuse the pooled buffer initialised by ensureScratch above.
  const maskImgData = state.maskImgData as ImageData;
  const md = maskImgData.data;
  for (let r = 0; r < maskSize; r++) {
    for (let c = 0; c < maskSize; c++) {
      let val: number;
      if (useShader && sampleData) {
        const i = (r * maskSize + c) * 4;
        const pr = sampleData[i] / 255;
        const pg = sampleData[i + 1] / 255;
        const pb = sampleData[i + 2] / 255;
        if (highlightColors) {
          let maxProx = 0;
          for (const hc of highlightColors) {
            const dr = pr - hc[0];
            const dg = pg - hc[1];
            const db = pb - hc[2];
            const prox = Math.exp(-10 * (dr * dr + dg * dg + db * db));
            if (prox > maxProx) maxProx = prox;
          }
          val = maxProx;
        } else if (targetColor) {
          const dr = pr - targetColor[0];
          const dg = pg - targetColor[1];
          const db = pb - targetColor[2];
          val = Math.exp(-8 * (dr * dr + dg * dg + db * db));
        } else {
          val = (sampleData[i] * 0.299 + sampleData[i + 1] * 0.587 + sampleData[i + 2] * 0.114) / 255;
        }
      } else {
        val = getMaskValue(maskShape, r, c, maskSize);
      }
      let a = (val - threshold) / softBand;
      if (a < 0) a = 0;
      else if (a > 1) a = 1;
      a = a * a * (3 - 2 * a);
      const idx = (r * maskSize + c) * 4;
      md[idx] = 255;
      md[idx + 1] = 255;
      md[idx + 2] = 255;
      md[idx + 3] = (a * 255 + 0.5) | 0;
    }
  }
  maskGradCtx.putImageData(maskImgData, 0, 0);

  if (preset.dotMode === 1) {
    paintPixelMasked(state, ctx, img, sx, sy, sw, sh, preset, elapsed, targetW, targetH, inst);
  } else {
    if (preset.dotMode === 2) {
      // Dot presets reveal the image through TWO independent layers:
      //   1. A pixel-mode-style per-cell dropout: every cell starts as a
      //      chunky pixel (downsampled image) and individually transitions
      //      to smooth photo as `fadeT` crosses its random per-cell
      //      threshold. Driven by `pixDuration` / `pixEasing` so it feels
      //      identical to the pixel presets the user is familiar with.
      //   2. The shader-luminance mask (applied below) which gates which
      //      AREAS of the card are visible at all at any given moment —
      //      so the chunky pixels only appear inside the area the shader
      //      mask has currently uncovered, not across the whole card.
      //
      // Composite order inside this branch: smooth base + pixelated/dropped
      // overlay. The shader mask is applied via destination-in AFTER this
      // branch (see further down), cutting the combined image down to the
      // revealed area.
      //
      // PERF: this matches `paintPixelMasked` exactly — same per-frame
      // downsample to a small ~38x38 grid (browser-accelerated, ~0.3 ms),
      // same cached random drop pattern (one `Float32Array` per reveal),
      // same pooled `pixDropImgData` for the per-frame alpha update. Total
      // per-frame overhead is in line with pixel-mode presets, which we
      // already validated at ~4.4% CPU in the prior perf pass.
      // Cell size is sourced from `pixelConfig.cellSize` (NOT `dotConfig`)
      // so it matches the pixel-mode pipeline byte-for-byte and produces
      // visibly chunky blocks. dots-mechanic's `pixelConfig` is otherwise
      // unused by the shader (which switches to `dotConfig` when
      // `dotMode === 2` — see `renderer.ts` mosaic switch), so the preset
      // is free to tune this field purely for the reveal look.
      paintPixelatedDropLayer(state, ctx, img, sx, sy, sw, sh, preset.pixelConfig.cellSize, elapsed, preset.revealConfig.pixDuration, preset.revealConfig.pixEasing, inst, targetW, targetH);
    } else {
      // Non-dot, non-pixel modes (custom presets) keep the original smooth
      // photo for the revealed region.
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, targetW, targetH);
    }
    ctx.globalCompositeOperation = 'destination-in';
    // Mask upscale strategy depends on the sampling source:
    //   - Dots presets (dotMode === 2) sample from the PIXEL-RENDERED shader,
    //     so `maskGrad` is naturally cell-stepped. Upscaling 64 -> ~280 with
    //     smoothing on blurs those cells into a mushy gradient (the very
    //     issue introduced when MASK_SIZE shrank from 100 to 64 in the perf
    //     pass). Switch to nearest-neighbour so the cells stay crisp — that
    //     also matches the dotty character of these presets.
    //   - Pixel presets (dotMode === 1) take the paintPixelMasked branch above.
    //   - Geometric masks (useShader === false) compute analytical smooth
    //     values, so smoothing stays on for them even in dot mode.
    const sharpMask = preset.dotMode === 2 && useShader;
    if (sharpMask) ctx.imageSmoothingEnabled = false;
    ctx.drawImage(maskGrad, 0, 0, targetW, targetH);
    if (sharpMask) ctx.imageSmoothingEnabled = true;
    ctx.globalCompositeOperation = 'source-over';
  }
}

/** Paints the pixel-mode-style "downsampled image with per-cell random
 *  drop-out" effect at an arbitrary cell-size scale, then leaves the
 *  caller to compose any additional masks on top. Used by the dots-mechanic
 *  reveal so the gradual pixel-to-smooth transition matches the pixel
 *  presets — but at the dot grid's denser cell count, and with the shader
 *  mask applied AFTER this function returns to gate visible areas.
 *
 *  Shares scratch state (`pixCanvas`, `pixDrop`, `pixDropPattern`) with
 *  `paintPixelMasked`; safe because `preset.dotMode` is fixed per-instance,
 *  so only one of the two paths ever touches these for a given reveal state. */
function paintPixelatedDropLayer(
  state: RevealInternals,
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  cellSize: number,
  elapsed: number,
  pixDuration: number,
  pixEasing: PresetMode['revealConfig']['pixEasing'],
  inst: Instance,
  targetW: number,
  targetH: number
): void {
  const baseCount = 6 + cellSize * 74;
  const cssW = Math.max(1, inst.cssWidth);
  const cssH = Math.max(1, inst.cssHeight);
  const gridX = Math.max(2, Math.floor((baseCount * cssW) / REVEAL_REF_DIM));
  const gridY = Math.max(2, Math.floor((baseCount * cssH) / REVEAL_REF_DIM));
  const cellCount = gridX * gridY;

  const pixDur = Math.max(0.05, pixDuration);
  const fadeRaw = Math.max(0, Math.min(1, elapsed / pixDur));
  const fadeT = ease(pixEasing, fadeRaw);

  if (!state.pixCanvas) {
    state.pixCanvas = document.createElement('canvas');
    state.pixCtx = state.pixCanvas.getContext('2d');
  }
  const pixCanvas = state.pixCanvas as HTMLCanvasElement;
  const pixCtx = state.pixCtx as CanvasRenderingContext2D;
  if (pixCanvas.width !== gridX || pixCanvas.height !== gridY) {
    pixCanvas.width = gridX;
    pixCanvas.height = gridY;
  }

  if (!state.pixDrop) {
    state.pixDrop = document.createElement('canvas');
    state.pixDropCtx = state.pixDrop.getContext('2d');
  }
  const pixDrop = state.pixDrop as HTMLCanvasElement;
  const pixDropCtx = state.pixDropCtx as CanvasRenderingContext2D;
  if (pixDrop.width !== gridX || pixDrop.height !== gridY) {
    pixDrop.width = gridX;
    pixDrop.height = gridY;
    state.pixDropImgData = pixDropCtx.createImageData(gridX, gridY);
    const dd0 = state.pixDropImgData.data;
    for (let i = 0; i < dd0.length; i += 4) {
      dd0[i] = 255;
      dd0[i + 1] = 255;
      dd0[i + 2] = 255;
    }
  }

  // Per-cell random drop thresholds — one Float32Array per reveal, reused
  // every frame. Keeps GC pressure flat over long auto-cycle sessions.
  const softBand = 0.07;
  const invBand2 = 1 / (2 * softBand);
  if (
    !state.pixDropPattern ||
    state.pixDropPatternW !== gridX ||
    state.pixDropPatternH !== gridY ||
    state.pixDropRevealStart !== state.revealStartMs
  ) {
    state.pixDropPattern = new Float32Array(cellCount);
    const lo = softBand;
    const span = 1 - 2 * softBand;
    for (let i = 0; i < state.pixDropPattern.length; i++) {
      state.pixDropPattern[i] = lo + Math.random() * span;
    }
    state.pixDropPatternW = gridX;
    state.pixDropPatternH = gridY;
    state.pixDropRevealStart = state.revealStartMs;
  }
  const dd = (state.pixDropImgData as ImageData).data;
  const pattern = state.pixDropPattern;
  for (let i = 0; i < pattern.length; i++) {
    const dt = pattern[i];
    let a = 0.5 + (dt - fadeT) * invBand2;
    if (a < 0) a = 0;
    else if (a > 1) a = 1;
    dd[i * 4 + 3] = (a * 255 + 0.5) | 0;
  }
  pixDropCtx.putImageData(state.pixDropImgData as ImageData, 0, 0);

  // 1. Downsample the source image into the pixelated grid (per frame —
  //    the drop mask below is destructive, so we can't cache between frames
  //    without an extra work canvas. The downsample is GPU-accelerated on
  //    a ~38x38 target so the cost is in the 0.1-0.3 ms range).
  pixCtx.globalCompositeOperation = 'source-over';
  pixCtx.clearRect(0, 0, gridX, gridY);
  pixCtx.imageSmoothingEnabled = true;
  pixCtx.imageSmoothingQuality = 'high';
  pixCtx.drawImage(img, sx, sy, sw, sh, 0, 0, gridX, gridY);
  // 2. Drop cells whose random threshold has fallen below `fadeT` — those
  //    cells go transparent and the smooth base painted at step 3 shows
  //    through.
  pixCtx.globalCompositeOperation = 'destination-in';
  pixCtx.imageSmoothingEnabled = false;
  pixCtx.drawImage(pixDrop, 0, 0);
  pixCtx.globalCompositeOperation = 'source-over';

  // 3. Smooth full-res image as the base layer — visible wherever a cell
  //    has already dropped out.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, targetW, targetH);
  // 4. Chunky pixelated cells (with drops applied) composited on top.
  //    Nearest-neighbour upscale keeps the dot grid blocks crisp.
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(pixCanvas, 0, 0, gridX, gridY, 0, 0, targetW, targetH);
  ctx.imageSmoothingEnabled = true;
}

function paintPixelMasked(
  state: RevealInternals,
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  preset: PresetMode,
  elapsed: number,
  targetW: number,
  targetH: number,
  inst: Instance
): void {
  // Per-cell random dissolve mask (port of image.html lines 2598-2695), with
  // an anisotropic grid so cells are SQUARE in screen space — matches the
  // shader's `gridCounts(...)` so the pixel-mode dissolve and the underlying
  // pixel mosaic share the same cell grid.
  const cellSize = preset.pixelConfig.cellSize;
  const baseCount = 6 + cellSize * 74;
  const cssW = Math.max(1, inst.cssWidth);
  const cssH = Math.max(1, inst.cssHeight);
  const gridX = Math.max(2, Math.floor((baseCount * cssW) / REVEAL_REF_DIM));
  const gridY = Math.max(2, Math.floor((baseCount * cssH) / REVEAL_REF_DIM));
  const cellCount = gridX * gridY;

  const pixDur = Math.max(0.05, preset.revealConfig.pixDuration);
  const fadeRaw = Math.max(0, Math.min(1, elapsed / pixDur));
  const fadeT = ease(preset.revealConfig.pixEasing, fadeRaw);

  if (!state.pixCanvas) {
    state.pixCanvas = document.createElement('canvas');
    state.pixCtx = state.pixCanvas.getContext('2d');
  }
  const pixCanvas = state.pixCanvas as HTMLCanvasElement;
  const pixCtx = state.pixCtx as CanvasRenderingContext2D;
  if (pixCanvas.width !== gridX || pixCanvas.height !== gridY) {
    pixCanvas.width = gridX;
    pixCanvas.height = gridY;
  }
  if (!state.pixDrop) {
    state.pixDrop = document.createElement('canvas');
    state.pixDropCtx = state.pixDrop.getContext('2d');
  }
  const pixDrop = state.pixDrop as HTMLCanvasElement;
  const pixDropCtx = state.pixDropCtx as CanvasRenderingContext2D;
  if (pixDrop.width !== gridX || pixDrop.height !== gridY) {
    pixDrop.width = gridX;
    pixDrop.height = gridY;
    state.pixDropImgData = pixDropCtx.createImageData(gridX, gridY);
    const dd0 = state.pixDropImgData.data;
    for (let i = 0; i < dd0.length; i += 4) {
      dd0[i] = 255;
      dd0[i + 1] = 255;
      dd0[i + 2] = 255;
    }
  }

  const softBand = 0.07;
  const invBand2 = 1 / (2 * softBand);
  if (
    !state.pixDropPattern ||
    state.pixDropPatternW !== gridX ||
    state.pixDropPatternH !== gridY ||
    state.pixDropRevealStart !== state.revealStartMs
  ) {
    state.pixDropPattern = new Float32Array(cellCount);
    const lo = softBand;
    const span = 1 - 2 * softBand;
    for (let i = 0; i < state.pixDropPattern.length; i++) {
      state.pixDropPattern[i] = lo + Math.random() * span;
    }
    state.pixDropPatternW = gridX;
    state.pixDropPatternH = gridY;
    state.pixDropRevealStart = state.revealStartMs;
  }
  const dd = (state.pixDropImgData as ImageData).data;
  const pattern = state.pixDropPattern;
  for (let i = 0; i < pattern.length; i++) {
    const dt = pattern[i];
    let a = 0.5 + (dt - fadeT) * invBand2;
    if (a < 0) a = 0;
    else if (a > 1) a = 1;
    dd[i * 4 + 3] = (a * 255 + 0.5) | 0;
  }
  pixDropCtx.putImageData(state.pixDropImgData as ImageData, 0, 0);

  // 1. Downsample image into pixCanvas at the anisotropic grid (cover-fit
  //    crop already chosen by caller, aspect preserved).
  //    Mirrors image.html step 1 (line 2667).
  pixCtx.globalCompositeOperation = 'source-over';
  pixCtx.clearRect(0, 0, gridX, gridY);
  pixCtx.imageSmoothingEnabled = true;
  pixCtx.imageSmoothingQuality = 'high';
  pixCtx.drawImage(img, sx, sy, sw, sh, 0, 0, gridX, gridY);
  // 2. Apply per-cell drop mask so dropped cells go transparent.
  //    Mirrors image.html step 2 (line 2671).
  pixCtx.globalCompositeOperation = 'destination-in';
  pixCtx.imageSmoothingEnabled = false;
  pixCtx.drawImage(pixDrop, 0, 0);
  pixCtx.globalCompositeOperation = 'source-over';

  // 3. Draw smooth image as the base layer — shows through any cell that
  //    has already dropped out.
  //    Mirrors image.html step 3 (line 2678).
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, targetW, targetH);
  // 4. Composite the still-present pixelated cells on top with crisp blocks
  //    (nearest-neighbour upscale → chunky cells).
  //    Mirrors image.html step 4 (line 2681).
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(pixCanvas, 0, 0, gridX, gridY, 0, 0, targetW, targetH);
  ctx.imageSmoothingEnabled = true;

  // 5. Quantise the reveal mask to the same anisotropic gridX×gridY so the
  //    mask shape's edge follows the cell boundaries — i.e. the reveal
  //    silhouette is cell-stepped, aligned with the shader's pixel mosaic.
  //    This is what gives the pixel presets (Chromium Flow / Nebula) their
  //    distinctive blocky reveal edge in image.html (step 5, lines 2686-2695).
  //    The pixCanvas scratch is reused: it currently holds the per-cell
  //    dissolved image from steps 1-2, but we overwrite it with the
  //    downsampled maskGrad here before using it as a destination-in clip.
  pixCtx.globalCompositeOperation = 'source-over';
  pixCtx.clearRect(0, 0, gridX, gridY);
  pixCtx.imageSmoothingEnabled = true;
  pixCtx.imageSmoothingQuality = 'high';
  pixCtx.drawImage(state.maskGrad as HTMLCanvasElement, 0, 0, gridX, gridY);
  ctx.imageSmoothingEnabled = false;
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(pixCanvas, 0, 0, gridX, gridY, 0, 0, targetW, targetH);
  ctx.imageSmoothingEnabled = true;
  ctx.globalCompositeOperation = 'source-over';
}

export interface CreateRevealOptions {
  /** The DOM canvas overlay (sibling of the shader canvas). */
  canvas: HTMLCanvasElement;
  cssWidth: number;
  cssHeight: number;
  /** Shader canvas — its opacity is driven by the reveal so the image
   *  cross-fades over it. */
  shaderCanvas: HTMLCanvasElement;
}

export function createReveal(opts: CreateRevealOptions): RevealState {
  const ctx = opts.canvas.getContext('2d');
  if (!ctx) throw new Error('img-fx: 2D context unavailable for reveal canvas');

  const state: RevealInternals = {
    active: false,
    phase: 'idle',
    revealStartMs: 0,
    hideStartMs: 0,
    hideDurationMs: 300,
    image: null,
    cssWidth: opts.cssWidth,
    cssHeight: opts.cssHeight,
    sampleCanvas: null,
    sampleCtx: null,
    sampleImgData: null,
    sampleDataCache: null,
    sampleFrameCounter: 0,
    maskGrad: null,
    maskGradCtx: null,
    maskImgData: null,
    pixCanvas: null,
    pixCtx: null,
    pixDrop: null,
    pixDropCtx: null,
    pixDropImgData: null,
    pixDropPattern: null,
    pixDropPatternW: 0,
    pixDropPatternH: 0,
    pixDropRevealStart: -1
  };

  const shaderCanvas = opts.shaderCanvas;

  const handle: RevealState = {
    canvas: opts.canvas,
    ctx,
    afterShaderFrame(s, inst, nowMs) {
      // Keep canvas dims in sync with the dynamic CSS dims.
      state.cssWidth = inst.cssWidth;
      state.cssHeight = inst.cssHeight;

      if (!state.active) {
        // Idle - nothing to paint, leave overlay clear.
        ctx.canvas.style.filter = 'none';
        return;
      }

      const { duration, easingKey } = getActiveRevealTiming(inst.preset);

      if (state.phase === 'reveal' && state.image) {
        const elapsed = (nowMs - state.revealStartMs) / 1000;
        const t = Math.min(elapsed / duration, 1);
        const eased = ease(easingKey, t);
        // Cross-fade: shader opacity drops as overlay fills in.
        shaderCanvas.style.opacity = String(1 - eased);
        paintMaskedFrame(state, s, inst, ctx);
        if (t >= 1) {
          state.phase = 'hold';
          shaderCanvas.style.opacity = '0';
          state.onRevealComplete?.();
        }
      } else if (state.phase === 'hold' && state.image) {
        // Image fully visible. Re-paint a final stable frame so resizes are
        // honored without re-running the dissolve.
        ctx.canvas.style.filter = 'none';
        if (
          ctx.canvas.width !== inst.canvas.width ||
          ctx.canvas.height !== inst.canvas.height
        ) {
          ctx.canvas.width = inst.canvas.width;
          ctx.canvas.height = inst.canvas.height;
        }
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        const img = state.image;
        const { sx, sy, sw, sh } = computeCoverSourceRect(img, ctx.canvas.width, ctx.canvas.height);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, ctx.canvas.width, ctx.canvas.height);
        shaderCanvas.style.opacity = '0';
      } else if (state.phase === 'hide') {
        const elapsed = nowMs - state.hideStartMs;
        const t = Math.min(elapsed / Math.max(1, state.hideDurationMs), 1);
        const overlayAlpha = 1 - t;
        ctx.canvas.style.opacity = String(overlayAlpha);
        shaderCanvas.style.opacity = String(t);
        if (t >= 1) {
          // Done - reset.
          state.active = false;
          state.phase = 'idle';
          ctx.canvas.style.opacity = '1';
          ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
          shaderCanvas.style.opacity = '1';
          state.image = null;
        }
      }
    },
    startReveal(opts) {
      state.image = opts.image;
      state.cssWidth = opts.cssWidth;
      state.cssHeight = opts.cssHeight;
      state.onRevealComplete = opts.onRevealComplete;
      state.revealStartMs = performance.now();
      state.phase = 'reveal';
      state.active = true;
      // Reset the sample throttle so the very first frame of this reveal
      // always does a fresh shader read; the cached buffer (if any) is from
      // a previous reveal and would be visually misaligned.
      state.sampleFrameCounter = 0;
      state.sampleDataCache = null;
      ctx.canvas.style.opacity = '1';
    },
    startHide(durationMs = 300) {
      if (!state.active || state.phase === 'hide') return;
      state.phase = 'hide';
      state.hideStartMs = performance.now();
      state.hideDurationMs = durationMs;
    },
    clear() {
      state.active = false;
      state.phase = 'idle';
      state.image = null;
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.canvas.style.filter = 'none';
      ctx.canvas.style.opacity = '1';
      shaderCanvas.style.opacity = '1';
    },
    isActive() {
      return state.active;
    },
    dispose() {
      state.image = null;
      state.sampleCanvas = null;
      state.sampleCtx = null;
      state.sampleImgData = null;
      state.sampleDataCache = null;
      state.sampleFrameCounter = 0;
      state.maskGrad = null;
      state.maskGradCtx = null;
      state.maskImgData = null;
      state.pixCanvas = null;
      state.pixCtx = null;
      state.pixDrop = null;
      state.pixDropCtx = null;
      state.pixDropImgData = null;
      state.pixDropPattern = null;
    }
  };

  return handle;
}

/** Pull a random image from `pool`, never repeating the previous index. */
export function pickRandomImage(pool: string[], lastIdx: number): { src: string; idx: number } | null {
  if (pool.length === 0) return null;
  if (pool.length === 1) return { src: pool[0], idx: 0 };
  let idx: number;
  do {
    idx = Math.floor(Math.random() * pool.length);
  } while (idx === lastIdx);
  return { src: pool[idx], idx };
}

