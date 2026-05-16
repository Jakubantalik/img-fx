/**
 * Shared Three.js renderer driving every <ImageGeneration> on the page.
 *
 * Architecture:
 *   1. One module-scope SharedRenderer is lazily created on first card mount.
 *      It owns a single offscreen <canvas> + THREE.WebGLRenderer + ortho
 *      camera + ShaderMaterial + plane mesh.
 *   2. Each card registers an Instance: a visible 2D canvas + its own uniform
 *      cache + dirty flag + reveal/cycle state. Per frame the loop iterates
 *      every visible/unpaused instance, resizes the GL canvas to the
 *      instance's CSS size × DPR, uploads its uniforms, renders, then
 *      ctx.drawImage()'s the GL output into the instance's visible canvas.
 *   3. IntersectionObserver pauses offscreen instances; when no instances are
 *      active, the rAF loop short-circuits.
 *   4. Last unmount disposes everything (geometry, material, renderer).
 *
 * This mirrors the metal-fx shared-renderer pattern but built around Three.js
 * (peer dep) so the GLSL from image.html drops in unchanged.
 */
import * as THREE from 'three';
import { hexToRgb, type PresetMode } from '../presets';
import { FRAG_SRC, VERT_SRC } from './shaders';
import type { RevealState } from './reveal';

/** Frame interval (ms). 15 fps cap is plenty for the slow drifting shader
 *  fields used by the bundled presets (Plasma / Noise Flow / Chromium Flow /
 *  Nebula run at speed 0.3-0.9), and saves ~50% CPU vs. the original 30 fps
 *  while staying perceptually smooth (well above the 12 fps animation
 *  flicker threshold and close to cinematic 24 fps territory).
 *
 *  Mutable so power users / the demo page can flip back to a higher rate
 *  via `setFrameRate()` for side-by-side comparison. */
let frameIntervalMs = 1000 / 15;
/** Maximum device-pixel-ratio applied to the GL canvas (image.html line 952).
 *  At 1.25 (vs the original 1.5) fragment work drops by ~31% per render
 *  with essentially no visible difference on the cell-quantised mosaic
 *  presets bundled with the library. Mutable via `setMaxDpr()`. */
let maxDpr = 1.25;

/** Instance handle returned by `createInstance`. Each <ImageGeneration> owns one. */
export interface Instance {
  /** Visible 2D canvas painted into the host wrapper. */
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** CSS-px size (synced from ResizeObserver). */
  cssWidth: number;
  cssHeight: number;
  /** DPR cached at creation; refreshed on resize. */
  dpr: number;
  /** Active preset mode block (dark or light). */
  preset: PresetMode;
  /** Optional override for `preset.cardBg` (#rrggbb). When set, this color is
   *  used as the shader's `u_cardBg` and forwarded to the reveal helper so
   *  background-derived shader logic stays in sync with the host card color. */
  cardBgOverride: string | null;
  /** Strength multiplier 0..1 (drives `canvas.style.opacity`). */
  strength: number;
  /** True when in viewport. */
  visible: boolean;
  /** True when the user has paused this instance. */
  paused: boolean;
  /** Dirty flag - true until uniforms have been re-uploaded. */
  uniformsDirty: boolean;
  /** Reveal state (image overlay drawn on top of shader). Null when no overlay. */
  reveal: RevealState | null;
  /** Per-instance accumulated time so each card animates at its own preset.speed. */
  accumulatedTime: number;
  /** When created (ms) — used for first-tick init only. */
  startedAtMs: number;
}

interface SharedRenderer {
  glCanvas: HTMLCanvasElement;
  /** WebGL2 context if available, otherwise WebGL1. */
  gl: WebGLRenderingContext | WebGL2RenderingContext;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  material: THREE.ShaderMaterial;
  geometry: THREE.PlaneGeometry;
  mesh: THREE.Mesh;
  uniforms: Record<string, THREE.IUniform>;
  instances: Set<Instance>;
  rafId: number;
  lastFrameMs: number;
  lastTickMs: number;
  /** Last instance whose uniforms were uploaded to `uniforms`. Used to skip
   *  re-uploading full uniform blocks when the same clean instance renders
   *  again back-to-back (e.g. single-card page, manual repaint). Null after
   *  destroy or when the next instance can't trust this cache. */
  lastInstance: Instance | null;
  /** Cached glCanvas pixel size (after `setSize` × DPR). Used to skip the
   *  no-op re-allocation when target size matches. */
  lastSizeW: number;
  lastSizeH: number;
}

let SHARED: SharedRenderer | null = null;

function createUniforms(): Record<string, THREE.IUniform> {
  return {
    u_resolution: { value: new THREE.Vector2(1, 1) },
    u_dpr: { value: 1 },
    u_time: { value: 0 },
    u_color1: { value: new THREE.Color(0x1a1a1a) },
    u_color2: { value: new THREE.Color(0x808080) },
    u_color3: { value: new THREE.Color(0xd9d9d9) },
    u_color4: { value: new THREE.Color(0x404040) },
    u_color5: { value: new THREE.Color(0xc0c0c0) },
    u_color6: { value: new THREE.Color(0x606060) },
    u_color7: { value: new THREE.Color(0xa0a0a0) },
    u_cardBg: { value: new THREE.Color(0x0f0f0f) },
    u_alpha1: { value: 1 },
    u_alpha2: { value: 1 },
    u_alpha3: { value: 1 },
    u_alpha4: { value: 1 },
    u_alpha5: { value: 1 },
    u_alpha6: { value: 1 },
    u_alpha7: { value: 1 },
    u_speed: { value: 1 },
    u_intensity: { value: 1 },
    u_scale: { value: 1.5 },
    u_direction: { value: 0 },
    u_softness: { value: 0.75 },
    u_distortion: { value: 0.3 },
    u_complexity: { value: 0.2 },
    u_shape: { value: 0.5 },
    u_vignette: { value: 0.25 },
    u_vigOpacity: { value: 1 },
    u_blur: { value: 0 },
    u_highlight: { value: 0.4 },
    u_shaderOpacity: { value: 1 },
    u_cellSize: { value: 0.5 },
    u_gap: { value: 0.3 },
    u_dotSize: { value: 0.8 },
    u_dotSoftness: { value: 0.1 },
    u_dotOpacity: { value: 1 },
    u_hlScale: { value: 0 },
    u_fillOpacity: { value: 0 },
    u_edgeFade: { value: 16 },
    u_fadeStr: { value: 1 },
    u_dotMode: { value: 2 },
    u_effect: { value: 4 }
  };
}

function ensureShared(): SharedRenderer {
  if (SHARED) return SHARED;

  const glCanvas = document.createElement('canvas');
  glCanvas.width = 8;
  glCanvas.height = 8;

  const renderer = new THREE.WebGLRenderer({
    canvas: glCanvas,
    alpha: true,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
    antialias: false,
    powerPreference: 'high-performance'
  });
  renderer.setPixelRatio(Math.min(typeof window !== 'undefined' ? window.devicePixelRatio : 1, maxDpr));
  renderer.setClearColor(0x000000, 0);
  renderer.autoClear = true;

  const gl = renderer.getContext();

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const uniforms = createUniforms();
  const material = new THREE.ShaderMaterial({
    vertexShader: VERT_SRC,
    fragmentShader: FRAG_SRC,
    uniforms,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NormalBlending
  });
  const geometry = new THREE.PlaneGeometry(2, 2);
  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);

  SHARED = {
    glCanvas,
    gl,
    renderer,
    scene,
    camera,
    material,
    geometry,
    mesh,
    uniforms,
    instances: new Set(),
    rafId: 0,
    lastFrameMs: 0,
    lastTickMs: performance.now(),
    lastInstance: null,
    lastSizeW: 0,
    lastSizeH: 0
  };

  startLoop();
  return SHARED;
}

function destroyShared(): void {
  if (!SHARED) return;
  cancelAnimationFrame(SHARED.rafId);
  SHARED.geometry.dispose();
  SHARED.material.dispose();
  SHARED.renderer.dispose();
  SHARED = null;
}

function uploadInstanceUniforms(s: SharedRenderer, inst: Instance): void {
  const p = inst.preset;
  const u = s.uniforms;
  u.u_effect.value = p.effectIndex;
  u.u_speed.value = p.speed;
  u.u_intensity.value = p.intensity;
  u.u_scale.value = p.scale;
  u.u_direction.value = (p.direction * Math.PI) / 180;
  u.u_softness.value = p.softness;
  u.u_distortion.value = p.distortion;
  u.u_complexity.value = p.complexity;
  u.u_shape.value = p.shape;
  u.u_vignette.value = p.vignette;
  u.u_vigOpacity.value = p.vigOpacity;
  u.u_blur.value = p.blur;
  u.u_highlight.value = p.highlight;
  u.u_shaderOpacity.value = p.shaderOpacity;
  u.u_dotMode.value = p.dotMode;

  const mosaic = p.dotMode === 1 ? p.pixelConfig : p.dotConfig;
  u.u_cellSize.value = mosaic.cellSize;
  u.u_gap.value = mosaic.gap;
  u.u_dotSize.value = mosaic.dotSize;
  u.u_dotSoftness.value = mosaic.dotSoftness;
  u.u_dotOpacity.value = mosaic.dotOpacity;
  u.u_hlScale.value = mosaic.hlScale;
  u.u_fillOpacity.value = mosaic.fillOpacity;
  u.u_edgeFade.value = mosaic.edgeFade;
  u.u_fadeStr.value = mosaic.fadeStr;

  for (let i = 0; i < 7; i++) {
    const [r, g, b] = hexToRgb(p.colors[i]);
    (u[`u_color${i + 1}`].value as THREE.Color).setRGB(r, g, b);
    u[`u_alpha${i + 1}`].value = p.alphas[i];
  }
  const [br, bg, bb] = hexToRgb(inst.cardBgOverride ?? p.cardBg);
  (u.u_cardBg.value as THREE.Color).setRGB(br, bg, bb);

  inst.uniformsDirty = false;
}

/** Hex (#rrggbb) currently in effect for this instance, accounting for override. */
export function effectiveCardBg(inst: Instance): string {
  return inst.cardBgOverride ?? inst.preset.cardBg;
}

/** Inner render — assumes the caller has already gated on visibility / size /
 *  pause where appropriate. Mutates GL canvas size + uniforms for this
 *  instance, draws one frame, and copies the result into the visible canvas.
 *
 *  Two perf guards layered in:
 *  1. `setSize` is skipped when the GL canvas is already at the target
 *     resolution. Three.js's `setSize` re-assigns `canvas.width/height`
 *     unconditionally which forces a drawing-buffer reallocation each call.
 *  2. Full uniform block re-upload is skipped when the same instance just
 *     rendered AND its `uniformsDirty` flag is clear (only `u_time` and
 *     `u_resolution` need refreshing in that case). For multi-card pages
 *     instances rotate so this always re-uploads, but it removes the cost
 *     for single-card pages, manual `renderInstanceOnce` repaints, and
 *     reveal sampling re-renders that don't switch instance. */
function paintInstance(s: SharedRenderer, inst: Instance, nowMs: number): void {
  const w = Math.max(1, Math.round(inst.cssWidth));
  const h = Math.max(1, Math.round(inst.cssHeight));
  // Pre-compute target pixel size so we can skip `setSize` no-ops.
  const dpr = s.renderer.getPixelRatio();
  const targetW = Math.max(1, Math.floor(w * dpr));
  const targetH = Math.max(1, Math.floor(h * dpr));
  if (s.lastSizeW !== targetW || s.lastSizeH !== targetH) {
    s.renderer.setSize(w, h, false);
    s.lastSizeW = s.glCanvas.width;
    s.lastSizeH = s.glCanvas.height;
  }
  (s.uniforms.u_resolution.value as THREE.Vector2).set(s.glCanvas.width, s.glCanvas.height);
  // u_dpr lets the shader convert physical pixels back to CSS px so cell sizes,
  // vignette, and edge fade stay scale-invariant across card sizes & DPRs.
  s.uniforms.u_dpr.value = inst.dpr || 1;

  // Reuse uniforms when the same clean instance is rendering again.
  const canReuseUniforms = s.lastInstance === inst && !inst.uniformsDirty;
  if (!canReuseUniforms) {
    uploadInstanceUniforms(s, inst);
    s.lastInstance = inst;
  }
  s.uniforms.u_time.value = inst.accumulatedTime;

  s.renderer.render(s.scene, s.camera);

  // Copy GL output into the instance's visible 2D canvas.
  if (inst.canvas.width !== s.glCanvas.width || inst.canvas.height !== s.glCanvas.height) {
    inst.canvas.width = s.glCanvas.width;
    inst.canvas.height = s.glCanvas.height;
  }
  inst.ctx.clearRect(0, 0, inst.canvas.width, inst.canvas.height);
  inst.ctx.drawImage(s.glCanvas, 0, 0);

  // Reveal pipeline (defined in reveal.ts) — paints overlay image into its
  // own mask canvas; we just notify it that the shader frame just finished.
  // Sampling inside `afterShaderFrame` mutates u_dotMode/u_fillOpacity, so
  // invalidate the uniform cache after the hook runs.
  inst.reveal?.afterShaderFrame(s, inst, nowMs);
  if (inst.reveal && inst.reveal.isActive()) {
    s.lastInstance = null;
  }
}

/** Render a single instance into its visible canvas (rAF tick path).
 *  Skips paused / offscreen / zero-size instances so the loop stays cheap. */
function renderInstance(s: SharedRenderer, inst: Instance, nowMs: number): void {
  if (!inst.visible || inst.paused) return;
  if (inst.cssWidth < 1 || inst.cssHeight < 1) return;
  paintInstance(s, inst, nowMs);
}

/**
 * Force a single repaint of an instance regardless of its pause state.
 * Used by React sync effects (preset / cardBg changes etc.) so paused cards
 * still reflect prop edits live in the playground without resuming the
 * animation loop. Skips if the instance is offscreen or zero-sized.
 */
export function renderInstanceOnce(inst: Instance): void {
  if (!SHARED) return;
  if (!inst.visible) return;
  if (inst.cssWidth < 1 || inst.cssHeight < 1) return;
  paintInstance(SHARED, inst, performance.now());
}

let onAfterTick: (() => void) | null = null;
/** Hook for cycle scheduler so it can advance phase timers in lockstep. */
export function setAfterTick(cb: (() => void) | null): void {
  onAfterTick = cb;
}

function startLoop(): void {
  const tick = (now: number): void => {
    if (!SHARED) return;
    SHARED.rafId = requestAnimationFrame(tick);

    const elapsed = now - SHARED.lastFrameMs;
    if (elapsed < frameIntervalMs) return;
    SHARED.lastFrameMs = now - (elapsed % frameIntervalMs);

    const deltaSec = (now - SHARED.lastTickMs) / 1000;
    SHARED.lastTickMs = now;

    let hasActive = false;
    for (const inst of SHARED.instances) {
      if (inst.visible && !inst.paused) {
        hasActive = true;
        inst.accumulatedTime += deltaSec;
      }
    }
    if (!hasActive) {
      onAfterTick?.();
      return;
    }

    for (const inst of SHARED.instances) {
      renderInstance(SHARED, inst, now);
    }

    onAfterTick?.();
  };
  SHARED!.lastTickMs = performance.now();
  SHARED!.rafId = requestAnimationFrame(tick);
}

/** Public API */

export interface CreateInstanceOptions {
  canvas: HTMLCanvasElement;
  cssWidth: number;
  cssHeight: number;
  preset: PresetMode;
  strength?: number;
  cardBg?: string | null;
}

export function createInstance(opts: CreateInstanceOptions): Instance {
  const s = ensureShared();
  const ctx = opts.canvas.getContext('2d');
  if (!ctx) throw new Error('img-fx: 2D context unavailable');
  const inst: Instance = {
    canvas: opts.canvas,
    ctx,
    cssWidth: opts.cssWidth,
    cssHeight: opts.cssHeight,
    dpr: Math.min(typeof window !== 'undefined' ? window.devicePixelRatio : 1, maxDpr),
    preset: opts.preset,
    cardBgOverride: opts.cardBg ?? null,
    strength: opts.strength ?? 1,
    visible: true,
    paused: false,
    uniformsDirty: true,
    reveal: null,
    accumulatedTime: Math.random() * 1000,
    startedAtMs: performance.now()
  };
  s.instances.add(inst);
  return inst;
}

export function destroyInstance(inst: Instance): void {
  if (!SHARED) return;
  SHARED.instances.delete(inst);
  // Drop the uniform-cache pointer if it referenced the dead instance, so the
  // next render of any other instance won't trust stale per-instance uniforms.
  if (SHARED.lastInstance === inst) SHARED.lastInstance = null;
  inst.reveal?.dispose();
  inst.reveal = null;
  if (SHARED.instances.size === 0) destroyShared();
}

export function updateInstanceSize(inst: Instance, cssWidth: number, cssHeight: number): void {
  inst.cssWidth = cssWidth;
  inst.cssHeight = cssHeight;
  if (typeof window !== 'undefined') {
    inst.dpr = Math.min(window.devicePixelRatio, maxDpr);
  }
}

export function setInstancePreset(inst: Instance, preset: PresetMode): void {
  inst.preset = preset;
  inst.uniformsDirty = true;
}

export function setInstanceCardBg(inst: Instance, cardBg: string | null): void {
  inst.cardBgOverride = cardBg;
  inst.uniformsDirty = true;
}

export function setInstanceVisible(inst: Instance, visible: boolean): void {
  inst.visible = visible;
}

export function setInstancePaused(inst: Instance, paused: boolean): void {
  inst.paused = paused;
}

export function setInstanceStrength(inst: Instance, strength: number): void {
  inst.strength = Math.max(0, Math.min(1, strength));
}

/**
 * Cap the rAF tick rate (frames per second). Applies globally to every
 * instance sharing the renderer. Values are clamped to a sensible range so
 * a callsite can't accidentally starve the loop or burn CPU at >60.
 *
 * @example setFrameRate(15) // ~67ms per frame, lowest visually-OK rate
 * @example setFrameRate(30) // restore the original cap
 */
export function setFrameRate(fps: number): void {
  const safe = Math.max(1, Math.min(60, fps));
  frameIntervalMs = 1000 / safe;
}

/**
 * Cap the device-pixel-ratio used by the GL canvas. Lower values mean
 * fewer fragments to shade per frame (~quadratic GPU saving). Updates the
 * shared `THREE.WebGLRenderer.setPixelRatio` AND every live instance's
 * cached `inst.dpr` so the next render uses the new ratio. Existing
 * instances are forced to re-upload uniforms because the change invalidates
 * the per-instance `u_dpr` value used by the shader's CSS-px calculations.
 *
 * Values are clamped to [1, 4]. Pass `1` for the strongest GPU saving on
 * retina displays; the default is `1.25`.
 */
export function setMaxDpr(dpr: number): void {
  maxDpr = Math.max(1, Math.min(4, dpr));
  if (!SHARED) return;
  const next = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio : 1, maxDpr);
  SHARED.renderer.setPixelRatio(next);
  // Force every instance to re-pick its DPR + re-upload uniforms next paint
  // so `u_dpr`, `u_resolution`, and the GL canvas size all stay coherent.
  for (const inst of SHARED.instances) {
    inst.dpr = next;
    inst.uniformsDirty = true;
  }
  // Invalidate size + uniform caches so the next paint really resizes
  // and re-uploads, not just rolls forward with the stale values.
  SHARED.lastInstance = null;
  SHARED.lastSizeW = 0;
  SHARED.lastSizeH = 0;
}

/** Read the current cap (frames per second). */
export function getFrameRate(): number {
  return 1000 / frameIntervalMs;
}

/** Read the current MAX_DPR cap. */
export function getMaxDpr(): number {
  return maxDpr;
}

/** Internal helper for the reveal sampler — exposes the shared renderer to
 *  reveal.ts so it can momentarily re-render with a different dotMode and read
 *  pixels back via gl.readPixels. */
export function withSharedRenderer<T>(fn: (s: SharedRenderer) => T): T {
  return fn(ensureShared());
}

export type { SharedRenderer };
