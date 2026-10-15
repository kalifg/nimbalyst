// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  handlers: new Map<string, Function>(),
  listeners: new Set<(event: { type: string; sessionId: string }) => void>(),
  running: new Set<string>(),
  wakeups: [] as unknown[],
  dispatchMetaAgentTool: vi.fn(),
}));
vi.mock('electron', () => ({ BrowserWindow: { fromWebContents: () => ({}) } }));
vi.mock('../../../../utils/ipcRegistry', () => ({ safeHandle: (name: string, handler: Function) => h.handlers.set(name, handler) }));
vi.mock('../../../../utils/store', () => ({ getAttachedFolders: () => [] }));
vi.mock('../../../../window/WindowManager', () => ({ getWindowId: () => 1 }));
vi.mock('../../../../window/captureWindowWorkspace', () => ({ resolveSenderWorkspacePath: () => null }));
vi.mock('../../../../mcp/backendToolRegistry', () => ({ findOwnedBackendTool: vi.fn() }));
vi.mock('../../../../mcp/mcpWorkspaceResolver', () => ({ resolveBackendWorkspacePath: vi.fn() }));
vi.mock('../../../../mcp/tools/backendToolHandler', () => ({ handleBackendTool: vi.fn() }));
vi.mock('../../../../mcp/metaAgentServer', () => ({ dispatchMetaAgentTool: h.dispatchMetaAgentTool }));
vi.mock('../../../credentials/providerCredentials', () => ({ getProviderCredentials: vi.fn() }));
vi.mock('../../../RepositoryManager', () => ({
  getQueuedPromptsStore: () => ({ listForSession: async () => [] }),
  getSessionWakeupsStore: () => ({ listActiveForSession: async () => h.wakeups }),
}));
vi.mock('../../aiServiceUtils', () => ({
  extensionPromptRequiresConfiguredApiKey: () => false,
  extractModelForProvider: () => null,
  safeSend: vi.fn(),
}));
vi.mock('../../sessionHostAttribution', () => ({ getLocalHostDeviceId: () => 'host', stampSessionHost: vi.fn() }));
vi.mock('../../drainFollowUp', () => ({ isLeadTurnPending: () => false }));
vi.mock('@nimbalyst/runtime/ai/server', () => ({
  AIProvider: class {},
  ModelRegistry: { getDefaultModel: async () => 'claude-code:opus' },
  ProviderFactory: {},
}));
vi.mock('@nimbalyst/runtime/ai/server/SessionStateManager', () => ({
  getSessionStateManager: () => ({
    getSessionState: (id: string) => (h.running.has(id) ? { status: 'running' } : null),
    subscribe: (listener: (event: { type: string; sessionId: string }) => void) => {
      h.listeners.add(listener);
      return () => h.listeners.delete(listener);
    },
  }),
}));
import { windowStates } from '../../../../window/windowState';
import { registerExtensionChatHandlers } from '../registerExtensionChatHandlers';

windowStates.set(1, { workspacePath: '/ws' } as never);

const flush = () => new Promise((resolve) => setImmediate(resolve));
const turnEnded = () => h.listeners.forEach((listener) => listener({ type: 'session:completed', sessionId: 's1' }));

function sendPrompt(options: Record<string, unknown>) {
  registerExtensionChatHandlers({
    sessionManager: { createSession: async () => ({ id: 's1' }), updateSessionTitle: vi.fn() },
    isProviderEnabledForWorkspace: () => true,
    getProviderSetting: () => undefined,
    // A turn that backgrounds work returns while the provider keeps the session running.
    sendMessageHandler: async () => {
      h.running.add('s1');
      return { content: 'Gathers are running; I will report back.' };
    },
  } as any);
  let resolved = false;
  const result = h.handlers.get('extensions:ai-send-prompt')!({ sender: {} }, { prompt: 'refresh', ...options })
    .finally(() => { resolved = true; });
  return { result, isResolved: () => resolved };
}

describe('extensions:ai-send-prompt', () => {
  afterEach(() => {
    h.running.clear();
    h.wakeups = [];
    h.listeners.clear();
    vi.useRealTimers();
  });

  it('#1685: waitUntilSettled resolves with the final turn once background work and wakeups are done', async () => {
    h.dispatchMetaAgentTool.mockResolvedValue(JSON.stringify({ fullResponse: 'Final report' }));
    const run = sendPrompt({ waitUntilSettled: true });

    await flush();
    expect(run.isResolved()).toBe(false);

    // The background-results turn ends but schedules a wakeup.
    h.running.delete('s1');
    h.wakeups = [{ id: 'w1' }];
    turnEnded();
    await flush();
    expect(run.isResolved()).toBe(false);

    h.wakeups = [];
    turnEnded();
    await expect(run.result).resolves.toEqual({ sessionId: 's1', response: 'Final report' });
    expect(h.dispatchMetaAgentTool).toHaveBeenCalledWith('get_session_result', 's1', '/ws', expect.objectContaining({ sessionId: 's1' }));
  });

  it('keeps the first-turn response by default', async () => {
    await expect(sendPrompt({}).result).resolves.toEqual({ sessionId: 's1', response: 'Gathers are running; I will report back.' });
  });

  it('gives up on a session that never settles instead of holding the run forever', async () => {
    vi.useFakeTimers();
    const run = sendPrompt({ waitUntilSettled: true });
    const outcome = expect(run.result).rejects.toThrow(/still running/);
    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000);
    await outcome;
  });
});
