// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { focus: vi.fn() } }));
vi.mock('../../utils/logger', () => ({
  logger: { main: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}));

import { revealReadyWindow } from '../revealReadyWindow';
import {
  beginStartupActivation,
  finishStartupWindowCreation,
  registerStartupWindow,
  resetStartupActivationForTests,
} from '../StartupActivation';
import { captureRestorableWindowBounds, restoreVisibleWindowBounds } from '../windowBounds';

const DISPLAY = { x: 0, y: 0, width: 3008, height: 1692 };
const NORMAL = { x: 200, y: 150, width: 900, height: 600 };

function persistedBounds(state: { isMaximized: boolean; isFullScreen: boolean }) {
  const saved = captureRestorableWindowBounds({
    getNormalBounds: () => NORMAL,
    isMaximized: () => state.isMaximized,
    isFullScreen: () => state.isFullScreen,
  });
  return restoreVisibleWindowBounds(JSON.parse(JSON.stringify(saved)), [DISPLAY], DISPLAY);
}

class TestWindow {
  private listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  readonly calls: string[] = [];

  isDestroyed = vi.fn(() => false);
  show = vi.fn(() => this.calls.push('show'));
  showInactive = vi.fn(() => this.calls.push('showInactive'));
  focus = vi.fn(() => this.calls.push('focus'));
  maximize = vi.fn(() => this.calls.push('maximize'));
  setFullScreen = vi.fn((flag: boolean) => this.calls.push(`setFullScreen:${flag}`));

  once(event: string, listener: (...args: unknown[]) => void) {
    const wrapped = (...args: unknown[]) => {
      this.removeListener(event, wrapped);
      listener(...args);
    };
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(wrapped);
    this.listeners.set(event, listeners);
    return this;
  }

  removeListener(event: string, listener: (...args: unknown[]) => void) {
    this.listeners.get(event)?.delete(listener);
    return this;
  }
}

describe('revealReadyWindow', () => {
  beforeEach(() => {
    resetStartupActivationForTests();
  });

  // The regression this whole mechanism exists for: gating show() on "the app
  // is currently active" meant a window whose ready-to-show landed while the
  // user was in another app was never shown at all.
  it('reveals a startup window even though the app never became active', () => {
    const window = new TestWindow();
    beginStartupActivation({ platform: 'darwin' });
    registerStartupWindow(window);

    revealReadyWindow(window, { showInactive: true, startupReveal: true }, undefined);

    expect(window.calls).toEqual(['showInactive']);
  });

  // Greg's review (PR #1079): maximize() shows a hidden window, so it has to
  // run after the show it belongs to, never before it.
  it('maximizes a restored window only after revealing it', () => {
    const window = new TestWindow();
    beginStartupActivation({ platform: 'darwin' });
    registerStartupWindow(window);

    revealReadyWindow(
      window,
      { showInactive: true, startupReveal: true },
      { isMaximized: true },
    );

    expect(window.calls).toEqual(['showInactive', 'maximize']);
  });

  // #1310: getBounds() is the whole display while fullscreen or maximized, so
  // saving it restored a screen-sized normal window with nothing to return to.
  it.each([
    { state: { isMaximized: true, isFullScreen: false }, after: ['maximize', 'show', 'focus'] },
    { state: { isMaximized: false, isFullScreen: true }, after: ['show', 'focus', 'setFullScreen:true'] },
  ])('round-trips $state at its normal size', ({ state, after }) => {
    const bounds = persistedBounds(state);
    expect(bounds).toEqual({ ...NORMAL, ...state });

    const window = new TestWindow();
    beginStartupActivation({ platform: 'darwin' });
    registerStartupWindow(window, { frontmost: true });
    revealReadyWindow(window, { showInactive: true, startupReveal: true }, bounds);
    finishStartupWindowCreation();

    expect(window.calls).toEqual(['showInactive', ...after]);
  });

  it('enters fullscreen right after showing a window opened after startup', () => {
    const window = new TestWindow();

    revealReadyWindow(window, undefined, persistedBounds({ isMaximized: false, isFullScreen: true }));

    expect(window.calls).toEqual(['show', 'setFullScreen:true']);
  });

  it('activates a window opened after startup has finished', () => {
    const window = new TestWindow();

    // Same call shape as a file opened from Finder while Nimbalyst is running:
    // the coordinator is not accepting members, so this window shows normally.
    revealReadyWindow(window, { startupReveal: true }, undefined);

    expect(window.calls).toEqual(['show']);
  });
});
