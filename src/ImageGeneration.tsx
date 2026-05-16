import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties
} from 'react';
import {
  createCycle,
  createInstance,
  createReveal,
  destroyInstance,
  renderInstanceOnce,
  setInstanceCardBg,
  setInstancePaused,
  setInstancePreset,
  setInstanceStrength,
  setInstanceVisible,
  updateInstanceSize,
  type Cycle,
  type Instance,
  type RevealState
} from './engine';
import { PRESETS } from './presets';
import { ensureStylesInjected } from './styles';
import type { ImageGenerationHandle, ImageGenerationProps, ImageGenerationTheme } from './types';

ensureStylesInjected();

function useResolvedTheme(theme: ImageGenerationTheme): 'dark' | 'light' {
  const [resolved, setResolved] = useState<'dark' | 'light'>(() => {
    if (theme !== 'auto') return theme;
    if (typeof window === 'undefined' || !window.matchMedia) return 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    if (theme !== 'auto') {
      setResolved(theme);
      return;
    }
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const update = (): void => setResolved(mql.matches ? 'dark' : 'light');
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, [theme]);

  return resolved;
}

function normaliseImages(input: string | string[] | undefined): string[] {
  if (!input) return [];
  if (typeof input === 'string') return [input];
  return input.slice();
}

export const ImageGeneration = forwardRef<ImageGenerationHandle, ImageGenerationProps>(function ImageGeneration(
  {
    children,
    preset = 'dots-organic',
    theme = 'auto',
    strength = 1,
    cardBg: cardBgProp,
    images,
    autoReveal = false,
    revealDelayRange = [2, 4],
    revealInitialDelay,
    revealHoldMs = 2000,
    revealFadeOutMs = 300,
    borderRadius,
    paused = false,
    onCycle,
    excludeSrcs,
    className,
    style,
    ...rest
  },
  forwardedRef
) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const shaderCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<Instance | null>(null);
  const revealRef = useRef<RevealState | null>(null);
  const cycleRef = useRef<Cycle | null>(null);
  const onCycleRef = useRef(onCycle);
  const excludeSrcsRef = useRef(excludeSrcs);

  useImperativeHandle(
    forwardedRef,
    () => ({
      get element() {
        return rootRef.current;
      },
      triggerReveal(opts) {
        cycleRef.current?.triggerOnce(opts);
      },
      triggerHide() {
        cycleRef.current?.triggerHide();
      },
      isImageActive() {
        const phase = cycleRef.current?.getPhase() ?? 'idle';
        return phase === 'reveal' || phase === 'visible' || phase === 'hide';
      }
    }),
    []
  );
  useLayoutEffect(() => {
    ensureStylesInjected();
  }, []);

  // Keep the latest callbacks live without re-subscribing the cycle.
  useEffect(() => {
    onCycleRef.current = onCycle;
  }, [onCycle]);
  useEffect(() => {
    excludeSrcsRef.current = excludeSrcs;
  }, [excludeSrcs]);

  const resolvedTheme = useResolvedTheme(theme);
  const presetMode = useMemo(() => PRESETS[preset].modes[resolvedTheme], [preset, resolvedTheme]);
  // Effective background colour (override > preset). Drives both the wrapper's
  // CSS background and the shader's `u_cardBg` uniform so contrast logic in
  // the shader stays in sync with the actual host card surface.
  const cardBg = cardBgProp ?? presetMode.cardBg;

  // Normalised image pool + refs holding the latest cycle inputs so the
  // mount-only lifecycle effect can read them when constructing the cycle.
  // (The cycle itself is created in the lifecycle effect so manual
  // `triggerReveal()` works regardless of the `autoReveal` flag.)
  const imagesArr = useMemo(() => normaliseImages(images), [images]);
  const imagesArrRef = useRef(imagesArr);
  const revealDelayRangeRef = useRef(revealDelayRange);
  const revealHoldMsRef = useRef(revealHoldMs);
  const revealFadeOutMsRef = useRef(revealFadeOutMs);
  imagesArrRef.current = imagesArr;
  revealDelayRangeRef.current = revealDelayRange;
  revealHoldMsRef.current = revealHoldMs;
  revealFadeOutMsRef.current = revealFadeOutMs;

  // Resolve `revealInitialDelay` into a stable ms value at mount time.
  // Range tuples randomise ONCE here so re-renders never reseed the value.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional one-shot resolution at mount
  const initialDelayMsRef = useRef<number | undefined>(
    useMemo(() => {
      if (revealInitialDelay == null) return undefined;
      if (typeof revealInitialDelay === 'number') {
        return Math.max(0, revealInitialDelay) * 1000;
      }
      const [min, max] = revealInitialDelay;
      const lo = Math.max(0, Math.min(min, max));
      const hi = Math.max(0, Math.max(min, max));
      return (lo + Math.random() * (hi - lo)) * 1000;
    }, [])
  );

  // Lifecycle: create instance + reveal on mount, destroy on unmount.
  // biome-ignore lint/correctness/useExhaustiveDependencies: stable lifecycle effect; preset / theme syncs handled separately
  useLayoutEffect(() => {
    const root = rootRef.current;
    const shader = shaderCanvasRef.current;
    const overlay = overlayCanvasRef.current;
    if (!root || !shader || !overlay) return;

    const measure = (): { w: number; h: number; r: number } => {
      const rect = root.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width));
      const h = Math.max(1, Math.round(rect.height));
      let r = 0;
      if (typeof borderRadius === 'number') {
        r = borderRadius;
      } else {
        const childEl = contentRef.current?.firstElementChild as HTMLElement | null;
        if (childEl) {
          const parsed = parseFloat(getComputedStyle(childEl).borderTopLeftRadius);
          if (Number.isFinite(parsed) && parsed > 0) r = parsed;
        }
        if (r === 0) {
          const parsed = parseFloat(getComputedStyle(root).borderTopLeftRadius);
          if (Number.isFinite(parsed) && parsed > 0) r = parsed;
        }
      }
      return { w, h, r };
    };

    const initial = measure();
    const inst = createInstance({
      canvas: shader,
      cssWidth: initial.w,
      cssHeight: initial.h,
      preset: presetMode,
      strength,
      cardBg: cardBgProp ?? null
    });
    instanceRef.current = inst;
    inst.canvas.style.opacity = String(Math.max(0, Math.min(1, strength)));

    const reveal = createReveal({
      canvas: overlay,
      cssWidth: initial.w,
      cssHeight: initial.h,
      shaderCanvas: shader
    });
    inst.reveal = reveal;
    revealRef.current = reveal;

    // Cycle is created up-front (independent of `autoReveal`) so that the
    // imperative `triggerReveal()` works for manual user-driven reveals too.
    // `start()` is only called when `autoReveal` is true (separate effect).
    const cycle = createCycle({
      reveal,
      images: imagesArrRef.current,
      delayRange: revealDelayRangeRef.current,
      holdMs: revealHoldMsRef.current,
      fadeOutMs: revealFadeOutMsRef.current,
      initialDelayMs: initialDelayMsRef.current,
      onPhase: (e) => onCycleRef.current?.(e),
      excludeSrcs: () => excludeSrcsRef.current?.() ?? null
    });
    cycleRef.current = cycle;
    if (paused) cycle.setPaused(true);

    root.style.setProperty('--image-gen-radius', `${initial.r}px`);
    root.style.borderRadius = `${initial.r}px`;

    let resizeRaf = 0;
    const ro = new ResizeObserver(() => {
      if (resizeRaf !== 0) return;
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = 0;
        const next = measure();
        const i = instanceRef.current;
        if (!i) return;
        updateInstanceSize(i, next.w, next.h);
        root.style.setProperty('--image-gen-radius', `${next.r}px`);
        root.style.borderRadius = `${next.r}px`;
      });
    });
    ro.observe(root);

    let io: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver(
        (entries) => {
          const i = instanceRef.current;
          if (!i) return;
          for (const e of entries) setInstanceVisible(i, e.isIntersecting);
        },
        { rootMargin: '64px' }
      );
      io.observe(root);
    }

    return () => {
      ro.disconnect();
      io?.disconnect();
      if (resizeRaf !== 0) cancelAnimationFrame(resizeRaf);
      cycleRef.current?.dispose();
      cycleRef.current = null;
      reveal.dispose();
      revealRef.current = null;
      const i = instanceRef.current;
      if (i) destroyInstance(i);
      instanceRef.current = null;
    };
  }, []);

  // Sync preset/theme to the instance + force a one-shot repaint so paused
  // instances reflect the prop change live (rAF tick is gated on `!paused`).
  useEffect(() => {
    const i = instanceRef.current;
    if (!i) return;
    setInstancePreset(i, presetMode);
    renderInstanceOnce(i);
  }, [presetMode]);

  // Sync cardBg override to the instance (shader uniform + reveal helper),
  // then repaint once so the change shows immediately even while paused.
  useEffect(() => {
    const i = instanceRef.current;
    if (!i) return;
    setInstanceCardBg(i, cardBgProp ?? null);
    renderInstanceOnce(i);
  }, [cardBgProp]);

  // Sync strength via the visible canvas opacity (no shader recompile).
  // The `opacity` style change is purely DOM and applies even while paused;
  // no GL repaint needed.
  useEffect(() => {
    const i = instanceRef.current;
    if (!i) return;
    setInstanceStrength(i, strength);
    if (i.canvas) {
      i.canvas.style.opacity = String(Math.max(0, Math.min(1, strength)));
    }
  }, [strength]);

  // Sync paused.
  useEffect(() => {
    const i = instanceRef.current;
    if (i) setInstancePaused(i, paused);
    cycleRef.current?.setPaused(paused);
  }, [paused]);

  // Patch live updates to the always-on cycle (avoid recreating per prop change).
  useEffect(() => {
    cycleRef.current?.setImages(imagesArr);
  }, [imagesArr]);
  useEffect(() => {
    cycleRef.current?.setOptions({
      delayRange: revealDelayRange,
      holdMs: revealHoldMs,
      fadeOutMs: revealFadeOutMs
    });
  }, [revealDelayRange, revealHoldMs, revealFadeOutMs]);

  // Start/stop the auto-loop in response to the `autoReveal` flag. The cycle
  // itself is created in the lifecycle effect so manual `triggerReveal()` works
  // even when `autoReveal === false`.
  useEffect(() => {
    const cycle = cycleRef.current;
    if (!cycle) return;
    if (autoReveal) {
      cycle.start();
      return () => cycle.stop();
    }
    cycle.stop();
    return undefined;
  }, [autoReveal]);

  const wrapperStyle = useMemo<CSSProperties>(() => {
    return {
      background: cardBg,
      ...style
    };
  }, [cardBg, style]);

  return (
    <div
      {...rest}
      ref={rootRef}
      className={['image-gen-root', className].filter(Boolean).join(' ')}
      data-preset={preset}
      data-theme={resolvedTheme}
      data-paused={paused ? 'true' : undefined}
      style={wrapperStyle}
    >
      <canvas ref={shaderCanvasRef} className="image-gen-shader" aria-hidden="true" />
      <canvas ref={overlayCanvasRef} className="image-gen-overlay" aria-hidden="true" />
      <div ref={contentRef} className="image-gen-child">
        {children}
      </div>
    </div>
  );
});

ImageGeneration.displayName = 'ImageGeneration';
