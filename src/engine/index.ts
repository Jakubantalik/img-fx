/** Public engine surface — exposes the renderer/reveal/cycle primitives so
 *  power users can drive the pipeline without React. */

export {
  createInstance,
  destroyInstance,
  effectiveCardBg,
  getFrameRate,
  getMaxDpr,
  renderInstanceOnce,
  setFrameRate,
  setInstanceCardBg,
  setInstancePaused,
  setInstancePreset,
  setInstanceStrength,
  setInstanceVisible,
  setMaxDpr,
  updateInstanceSize,
  type CreateInstanceOptions,
  type Instance
} from './renderer';

export {
  createReveal,
  loadImage,
  pickRandomImage,
  type CreateRevealOptions,
  type RevealState,
  type RevealStartOptions
} from './reveal';

export {
  createCycle,
  type Cycle,
  type CycleAnimationCompleteEvent,
  type CycleEvent,
  type CycleOptions,
  type CyclePhase
} from './cycle';

export { ease, EASING_FNS, type EaseFn } from './tween';
