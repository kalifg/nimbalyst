// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '@nimbalyst/runtime/store';

import { activeWorkspacePathAtom } from '../openProjects';
import {
  canGoForwardAtom,
  clearNavigationHistory,
  goBackAtom,
  goForwardAtom,
  pushNavigationEntryAtom,
  registerNavigationRestoreCallbacks,
} from '../navigationHistory';

vi.stubGlobal('window', {});
vi.stubGlobal('requestAnimationFrame', (cb: () => void) => setTimeout(cb, 0));

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

function visitSession(workstreamId: string, childSessionId: string | null = null) {
  store.set(pushNavigationEntryAtom, { mode: 'agent', agent: { workstreamId, childSessionId } });
}

describe('agent session back/forward', () => {
  beforeEach(() => {
    store.set(activeWorkspacePathAtom, '/workspace');
    clearNavigationHistory();
  });

  it('reopens the session that was visited, not the workstream it belongs to', async () => {
    const openSession = vi.fn();
    registerNavigationRestoreCallbacks({ restoreAgentSession: openSession });
    visitSession('workstream-1', 'child-a');
    visitSession('workstream-1', 'child-b');

    store.set(goBackAtom);
    await settle();

    expect(openSession).toHaveBeenCalledWith('child-a');
  });

  it('ignores the selection changes a slow session open causes, so Forward still works', async () => {
    let finishOpening!: () => void;
    const openSession = vi.fn(() => new Promise<void>((resolve) => { finishOpening = resolve; }));
    registerNavigationRestoreCallbacks({ restoreAgentSession: openSession });
    visitSession('session-1');
    visitSession('session-2');

    store.set(goBackAtom);
    await settle();
    // AgentMode records whatever is selected while the session list loads.
    visitSession('session-stale');
    finishOpening();
    await settle();

    expect(store.get(canGoForwardAtom)).toBe(true);
    store.set(goForwardAtom);
    expect(openSession).toHaveBeenLastCalledWith('session-2');
  });
});
