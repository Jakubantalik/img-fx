import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  ImageGeneration,
  type ImageGenerationCycleEvent,
  type ImageGenerationHandle,
  type ImageGenerationPreset,
  type ImageGenerationTheme
} from 'img-fx';

// Image pool consumed by all three hero cards + the playground. Kept in sync
// with `../../../images/` (the source-of-truth folder one level above the
// library). When you add/remove a file there, mirror it into
// `demo/public/images/` AND update this list — the four cards coordinate via
// `excludeSrcs` so they never show the same image at once, which only works
// if every URL here actually resolves.
const IMAGE_POOL = [
  '/images/Screenshot 2026-05-13 at 17.22.03.png',
  '/images/Screenshot 2026-05-13 at 17.34.13.png',
  '/images/Screenshot 2026-05-13 at 17.36.02.png',
  '/images/Screenshot 2026-05-13 at 17.36.38.png',
  '/images/Screenshot 2026-05-13 at 17.37.11.png',
  '/images/Screenshot 2026-05-13 at 17.37.37.png',
  '/images/Screenshot 2026-05-13 at 17.37.43.png',
  '/images/Screenshot 2026-05-13 at 17.37.49.png',
  '/images/Screenshot 2026-05-16 at 12.50.03.png',
  '/images/Screenshot 2026-05-16 at 12.51.21.png',
  '/images/Screenshot 2026-05-16 at 12.52.16.png',
  '/images/Screenshot 2026-05-16 at 12.53.21.png',
  '/images/Screenshot 2026-05-16 at 12.55.02.png',
  '/images/Untitled.jpg',
  '/images/Untitled2.jpg',
  '/images/Untitled4.jpg',
  '/images/photo-1773236759289-251d9687b6e3.avif'
];

function CopyIcon(): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon(): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function GitHubIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

/** X (formerly Twitter) glyph — same path as `metal-fx/demo/components/icons.tsx`. */
function XIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" width="15" height="16" viewBox="0 0 1200 1227">
      <path d="M714.163 519.284L1160.89 0H1055.03L667.137 450.887L357.328 0H0L468.492 681.821L0 1226.37H105.866L515.491 750.218L842.672 1226.37H1200L714.137 519.284H714.163ZM569.165 687.828L521.697 619.934L144.011 79.6944H306.615L611.412 515.685L658.88 583.579L1055.08 1150.3H892.476L569.165 687.854V687.828Z" />
    </svg>
  );
}

function PlayIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path d="M4.5 2.5v11l9-5.5z" />
    </svg>
  );
}

function PauseIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <rect x="4" y="3" width="3" height="10" rx="1" />
      <rect x="9" y="3" width="3" height="10" rx="1" />
    </svg>
  );
}


function CopyButton({ text, label }: { text: string; label: string }): JSX.Element {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }, [text]);

  return (
    <button
      type="button"
      className="copy-btn"
      onClick={handleCopy}
      aria-label={copied ? 'Copied' : label}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  );
}

/** Subset of `ImageGenerationPreset` exposed in the playground's Type picker.
 *  `dots-organic` (Plasma) is intentionally omitted because its blurred slow
 *  reveal duplicates the visual story already covered by `pixels-organic`. */
type PlaygroundPreset = Extract<
  ImageGenerationPreset,
  'pixels-organic' | 'pixels-mechanic' | 'dots-mechanic'
>;

/* Label-to-preset mapping reflects the visual character of each shader, NOT
 * the source JSON filename (preset-pixels-style-3 / -4):
 *   - "Pixel Organic" → pixels-mechanic (Nebula, effect #11) — softer
 *     drifting nebula clouds that read as organic.
 *   - "Pixel Mechanic" → pixels-organic (Chromium Flow, effect #22) —
 *     sharp curved chrome ridges that read as structured / mechanical.
 * Library preset names stay aligned to the source JSONs so consumers
 * importing the package directly aren't affected. */
const PRESET_OPTIONS: Array<{ value: PlaygroundPreset; label: string }> = [
  { value: 'pixels-mechanic', label: 'Pixel Organic' },
  { value: 'pixels-organic', label: 'Pixel Mechanic' },
  { value: 'dots-mechanic', label: 'Dots Mechanic' }
];

export function App(): JSX.Element {
  // Demo page is locked to dark theme as the default look. Removed the
  // header toggle and OS-preference listener so first paint and subsequent
  // OS theme flips don't override this choice.
  const [theme] = useState<ImageGenerationTheme>('dark');
  const [preset, setPreset] = useState<PlaygroundPreset>('pixels-organic');
  const [strength, setStrength] = useState(100);
  // Playground starts paused so the page loads quietly; the Play/Pause toggle
  // below only flips this local state. The hero examples keep auto-playing.
  const [playgroundPaused, setPlaygroundPaused] = useState(true);
  const [imageRevealed, setImageRevealed] = useState(false);
  const strengthId = useId();
  const playgroundRef = useRef<ImageGenerationHandle | null>(null);

  const handleTogglePlay = useCallback(() => {
    setPlaygroundPaused((p) => !p);
  }, []);
  const handleToggleReveal = useCallback(() => {
    const handle = playgroundRef.current;
    if (!handle) return;
    if (handle.isImageActive()) {
      handle.triggerHide();
    } else {
      handle.triggerReveal({ hold: 'manual' });
    }
  }, []);

  // Coordinate the four cards so no two ever show the same image at once.
  // Map: card id -> currently-displayed src (set on `reveal`, cleared on `idle`).
  const inUseImagesRef = useRef<Map<string, string>>(new Map());
  const makeCardCoordinator = useCallback(
    (cardId: string) => ({
      excludeSrcs: () => Array.from(inUseImagesRef.current.values()),
      onCycle: (e: ImageGenerationCycleEvent) => {
        if (e.phase === 'reveal' && e.src) {
          inUseImagesRef.current.set(cardId, e.src);
        } else if (e.phase === 'idle') {
          inUseImagesRef.current.delete(cardId);
        }
      }
    }),
    []
  );
  const heroWideCoord = useMemo(() => makeCardCoordinator('hero-wide'), [makeCardCoordinator]);
  const heroTallCoord = useMemo(() => makeCardCoordinator('hero-tall'), [makeCardCoordinator]);
  const heroSquareCoord = useMemo(() => makeCardCoordinator('hero-square'), [makeCardCoordinator]);
  const playgroundBaseCoord = useMemo(
    () => makeCardCoordinator('playground'),
    [makeCardCoordinator]
  );
  // Wrap the playground coordinator so it also drives the local
  // `imageRevealed` state used to flip the toggle button's icon/label.
  const playgroundCoord = useMemo(
    () => ({
      excludeSrcs: playgroundBaseCoord.excludeSrcs,
      onCycle: (e: ImageGenerationCycleEvent) => {
        playgroundBaseCoord.onCycle(e);
        if (e.phase === 'reveal' || e.phase === 'visible') setImageRevealed(true);
        else if (e.phase === 'idle') setImageRevealed(false);
      }
    }),
    [playgroundBaseCoord]
  );

  // Sync the page theme attribute so background + chrome match.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Dark-theme card surface for the demo cards. Light theme falls back to the
  // preset's bundled cardBg so we don't tint it.
  const demoCardBg = theme === 'dark' ? '#1B1B1B' : undefined;
  const installCmd = 'npm install img-fx';
  // Both code snippets below are designed to be copy-paste runnable: full
  // imports, real function components, inline image URLs as placeholders.
  // `playgroundCode` mirrors the actual playground toggle logic — note the
  // `hold: 'manual'` and the `isImageActive()` / `triggerHide()` round-trip,
  // not a bare `triggerReveal()` (which would auto-hide after `revealHoldMs`).
  const usageCode = `import { ImageGeneration } from 'img-fx';

export function Card() {
  return (
    <ImageGeneration
      preset="${preset}"
      images={['/a.jpg', '/b.jpg']}
      autoReveal
    >
      <div style={{ width: 280, height: 280, borderRadius: 24 }} />
    </ImageGeneration>
  );
}`;
  const playgroundCode = `import { useRef } from 'react';
import { ImageGeneration, type ImageGenerationHandle } from 'img-fx';

export function Card() {
  const ref = useRef<ImageGenerationHandle>(null);

  const onToggle = () => {
    const h = ref.current;
    if (!h) return;
    if (h.isImageActive()) h.triggerHide();
    else h.triggerReveal({ hold: 'manual' });
  };

  return (
    <>
      <ImageGeneration
        ref={ref}
        preset="${preset}"
        strength={${(strength / 100).toFixed(2)}}
        images={['/a.jpg', '/b.jpg']}
      >
        <div style={{ width: 280, height: 280, borderRadius: 24 }} />
      </ImageGeneration>
      <button onClick={onToggle}>Reveal / hide</button>
    </>
  );
}`;

  return (
    <>
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>

      <main id="main-content" className="app">
        <header className="header">
          <nav aria-label="External links" className="top-bar-links">
            <a
              className="icon-btn"
              href="https://github.com/Jakubantalik/img-fx"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub repository"
            >
              <GitHubIcon />
            </a>
            <a
              className="icon-btn"
              href="https://x.com/jakubantalik"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Follow on X (Twitter)"
            >
              <XIcon />
            </a>
          </nav>
          <div className="header-icon" aria-hidden="true">
            <img
              src="/image-header.png"
              alt=""
              width={207}
              height={138}
              decoding="async"
            />
          </div>
          <h1 className="title">Image generation</h1>
          <p className="subtitle-sm">Animated image generation and reveal component</p>
        </header>

        <section className="examples-section" aria-label="Effect demonstrations">
          {/* Hero card 1 — labelled "Pixel Organic" in the playground —
              uses the Nebula preset (effect #11) since its softer drifting
              clouds read as organic. The library preset name stays
              `pixels-mechanic` to match the source JSON file. */}
          <div className="example-row-full">
            <ImageGeneration
              preset="pixels-mechanic"
              theme={theme}
              cardBg={demoCardBg}
              images={IMAGE_POOL}
              autoReveal
              revealDelayRange={[2, 4]}
              revealHoldMs={[750, 1250]}
              className="hero-card-wide"
              excludeSrcs={heroWideCoord.excludeSrcs}
              onCycle={heroWideCoord.onCycle}
            >
              <div />
            </ImageGeneration>
          </div>
          <div className="example-row-split">
            {/* Hero card 2 — Dots / Mechanic (Noise Flow): dot-grid shader
                with the smooth shader-shaped reveal mask. Random 1-3s
                initial offset staggers it after card 1.
                Image hold is randomised 0.75-1.25s per cycle. */}
            <div className="example-cell">
              <ImageGeneration
                preset="dots-mechanic"
                theme={theme}
                cardBg={demoCardBg}
                images={IMAGE_POOL}
                autoReveal
                revealDelayRange={[2.5, 4.5]}
                revealInitialDelay={[1, 3]}
                revealHoldMs={[750, 1250]}
                /* The dots-mechanic shader fills the entire card with bright
                 * uniform white dots, which raises the average luminance of
                 * the visible card area noticeably above the sparser pixel
                 * presets (mostly-dark mosaic with a few bright cells). At
                 * full strength the card reads "lighter" than the other
                 * hero cards even though the literal cardBg is identical
                 * (#1B1B1B for every card via demoCardBg).
                 *
                 * Strength only modulates the shader canvas opacity (see
                 * ImageGeneration.tsx -> inst.canvas = shader); the overlay
                 * canvas that paints the revealed image is unaffected. So
                 * dimming strength to 0.5 evens out the shader brightness
                 * across hero cards without darkening the revealed image
                 * or modifying the source-of-truth preset values. */
                strength={0.5}
                className="hero-card-tall"
                excludeSrcs={heroTallCoord.excludeSrcs}
                onCycle={heroTallCoord.onCycle}
              >
                <div />
              </ImageGeneration>
            </div>
            {/* Hero card 3 — labelled "Pixel Mechanic" in the playground —
                uses the Chromium Flow preset (effect #22) since its sharp
                curved chrome ridges read as structured / mechanical. The
                library preset name stays `pixels-organic` to match the
                source JSON file. Random 1-3s initial offset staggers it
                after card 1. Image hold is randomised 0.75-1.25s per cycle. */}
            <div className="example-cell">
              <ImageGeneration
                preset="pixels-organic"
                theme={theme}
                cardBg={demoCardBg}
                images={IMAGE_POOL}
                autoReveal
                revealDelayRange={[2, 3.5]}
                revealInitialDelay={[1, 3]}
                revealHoldMs={[750, 1250]}
                className="hero-card"
                excludeSrcs={heroSquareCoord.excludeSrcs}
                onCycle={heroSquareCoord.onCycle}
              >
                <div />
              </ImageGeneration>
            </div>
          </div>
        </section>

        <section className="section" aria-label="Installation">
          <h2 className="section-title">Installation</h2>
          <div className="code-block">
            <code>{installCmd}</code>
            <CopyButton text={installCmd} label="Copy install command" />
          </div>
        </section>

        <section className="section" aria-label="Usage">
          <h2 className="section-title section-title--muted">Usage</h2>
          <div className="code-block code-block--multi">
            <code>{usageCode}</code>
            <CopyButton text={usageCode} label="Copy usage example" />
          </div>
        </section>

        <section className="playground-section" aria-label="Interactive playground">
          <h2 className="section-title">Playground</h2>

          <div className="playground-controls">
            <div className="control-group" role="radiogroup" aria-label="Type">
              <span className="control-label">Type</span>
              <div className="control-options">
                {PRESET_OPTIONS.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    className="tab-btn"
                    role="radio"
                    aria-checked={preset === value}
                    data-active={preset === value}
                    onClick={() => setPreset(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="control-group control-group--strength">
              <label className="control-label" htmlFor={strengthId}>
                Strength
              </label>
              <div className="strength-track">
                {strength > 0 && <div className="strength-fill" style={{ width: `${strength}%` }} />}
                <span className="strength-value">{strength}%</span>
                <input
                  id={strengthId}
                  type="range"
                  className="strength-input"
                  value={strength}
                  onChange={(e) => setStrength(parseInt(e.target.value, 10))}
                  min={0}
                  max={100}
                  step={1}
                  aria-label="Effect strength"
                />
              </div>
            </div>
          </div>

          <div className="playground-preview">
            <ImageGeneration
              ref={playgroundRef}
              preset={preset}
              theme={theme}
              cardBg={demoCardBg}
              strength={strength / 100}
              images={IMAGE_POOL}
              paused={playgroundPaused}
              excludeSrcs={playgroundCoord.excludeSrcs}
              onCycle={playgroundCoord.onCycle}
            >
              <div className="playground-card" />
            </ImageGeneration>

            <div className="playground-toolbar">
              <button
                type="button"
                className="playground-toggle"
                onClick={handleTogglePlay}
                aria-pressed={!playgroundPaused}
                aria-label={playgroundPaused ? 'Play shader animation' : 'Pause shader animation'}
                title={playgroundPaused ? 'Play' : 'Pause'}
              >
                {playgroundPaused ? <PlayIcon /> : <PauseIcon />}
              </button>
              <button
                type="button"
                className="playground-toggle playground-toggle--text"
                onClick={handleToggleReveal}
                aria-pressed={imageRevealed}
                disabled={playgroundPaused}
                aria-disabled={playgroundPaused}
                title={playgroundPaused ? 'Press Play to enable' : undefined}
              >
                {imageRevealed ? 'Hide image' : 'Reveal image'}
              </button>
            </div>
          </div>

          <div className="code-block code-block--multi">
            <code>{playgroundCode}</code>
            <CopyButton text={playgroundCode} label="Copy playground code" />
          </div>
        </section>

        <footer className="footer">
          <span className="footer-muted">Made by</span>{' '}
          <a
            className="footer-name"
            href="https://x.com/jakubantalik"
            target="_blank"
            rel="noopener noreferrer"
          >
            Jakub Antalik
          </a>
        </footer>
      </main>
    </>
  );
}
