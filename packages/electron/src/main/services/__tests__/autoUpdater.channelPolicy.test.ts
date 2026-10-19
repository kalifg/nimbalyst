// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const settings = vi.hoisted(() => ({ channel: 'stable' }));
const ipc = vi.hoisted(() => ({
  handles: new Map<string, (...args: any[]) => any>(),
  listeners: new Map<string, (...args: any[]) => any>(),
}));
const effects = vi.hoisted(() => ({
  send: vi.fn(), subscribe: vi.fn(), analytics: vi.fn(), save: vi.fn(),
  close: vi.fn(), restarting: vi.fn(),
}));
vi.mock('../../utils/store', () => ({ getReleaseChannel: () => settings.channel, store: {} }));
vi.mock('../../utils/ipcRegistry', () => ({
  safeHandle: (channel: string, handler: (...args: any[]) => any) => ipc.handles.set(channel, handler),
  safeOn: (channel: string, handler: (...args: any[]) => any) => ipc.listeners.set(channel, handler),
}));
vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: vi.fn(), getPath: vi.fn(), getVersion: () => '0.78.1', removeAllListeners: vi.fn(), relaunch: vi.fn(), exit: vi.fn() },
  BrowserWindow: {
    getFocusedWindow: () => ({ isDestroyed: () => false, webContents: { send: effects.send } }),
    getAllWindows: () => [],
  },
  dialog: { showMessageBox: vi.fn().mockResolvedValue({ response: 0 }) },
}));
vi.mock('electron-log/main', () => ({ default: { transports: { file: {} }, info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../analytics/AnalyticsService', () => ({ AnalyticsService: { getInstance: () => ({ sendEvent: effects.analytics }) } }));
vi.mock('../../ipc/SessionStateHandlers', () => ({ hasActiveStreamingSessions: vi.fn() }));
vi.mock('@nimbalyst/runtime/ai/server/SessionStateManager', () => ({ getSessionStateManager: () => ({ subscribe: effects.subscribe }) }));
vi.mock('../../database/initialize', () => ({ getDatabase: () => ({ close: effects.close }) }));
vi.mock('../electronUpdaterPatch', () => ({ installAtomFeedFilter: vi.fn() }));
vi.mock('electron-updater', async () => {
  // Keep the dependency's REAL channel setter and semver admission logic.
  const { AppUpdater } = await import('electron-updater/out/AppUpdater');
  class TestUpdater extends AppUpdater {
    constructor() {
      super(undefined, { version: '0.78.1', name: 'test', isPackaged: true } as never);
    }
    protected async doDownloadUpdate(): Promise<string[]> { return []; }
    quitAndInstall(): void { throw new Error('This test must never install an update'); }
  }
  const updater = new TestUpdater();
  updater.setFeedURL = vi.fn();
  updater.isUpdateSupported = async () => true;
  updater.isUserWithinRollout = async () => true;
  return { autoUpdater: updater };
});

vi.mock('../../index', () => ({ setRestarting: effects.restarting }));
vi.mock('../../session/SessionState', () => ({ saveSessionState: effects.save }));

import { app, dialog } from 'electron';
import { autoUpdater } from 'electron-updater';
import { AutoUpdaterService } from '../autoUpdater';

let appDir: string;
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  autoUpdater.removeAllListeners();
  ipc.handles.clear();
  ipc.listeners.clear();
  settings.channel = 'stable';
  appDir = mkdtempSync(join(tmpdir(), 'nimbalyst-updater-'));
  writeFileSync(join(appDir, 'package.json'), JSON.stringify({ version: '0.78.1' }));
  vi.mocked(app.getAppPath).mockReturnValue(appDir);
  vi.mocked(app.getPath).mockReturnValue(appDir);
  Object.defineProperty(app, 'isPackaged', { value: true, writable: true });
  vi.spyOn(autoUpdater, 'checkForUpdates').mockResolvedValue(null);
  vi.spyOn(autoUpdater, 'checkForUpdatesAndNotify').mockResolvedValue(null);
  vi.spyOn(autoUpdater, 'downloadUpdate').mockResolvedValue([]);
  vi.spyOn(autoUpdater, 'quitAndInstall').mockImplementation(() => {});
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  rmSync(appDir, { recursive: true, force: true });
});

it('refuses older releases through launch, repeated checks, and channel changes', async () => {
  const dependency = autoUpdater as unknown as { isUpdateAvailable(info: { version: string }): Promise<boolean> };
  for (let launch = 0; launch < 2; launch++) {
    const service = new AutoUpdaterService();
    for (const channel of ['stable', 'alpha', 'stable', 'stable']) {
      settings.channel = channel;
      service.reconfigureFeedURL();
      expect(autoUpdater.allowDowngrade).toBe(false);
      expect(await dependency.isUpdateAvailable({ version: '0.77.5' })).toBe(false);
      expect(await dependency.isUpdateAvailable({ version: '0.78.2' })).toBe(true);
    }
    autoUpdater.removeAllListeners();
  }
});

it('blocks startup, hourly and direct background checks for an externally maintained package', async () => {
  writeFileSync(join(appDir, 'package.json'), JSON.stringify({ nimbalystUpdatePolicy: 'external' }));
  const service = new AutoUpdaterService();
  service.startAutoUpdateCheck(60);
  await service.checkForUpdates();
  settings.channel = 'alpha';
  service.reconfigureFeedURL();
  await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);
  expect(autoUpdater.checkForUpdatesAndNotify).not.toHaveBeenCalled();
  expect(autoUpdater.setFeedURL).not.toHaveBeenCalled();
  expect(autoUpdater.autoDownload).toBe(false);
  expect(autoUpdater.autoInstallOnAppQuit).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});

it('explains external maintenance on the menu and IPC check without contacting the feed', async () => {
  writeFileSync(join(appDir, 'package.json'), JSON.stringify({ nimbalystUpdatePolicy: 'external' }));
  const service = new AutoUpdaterService();
  await service.checkForUpdatesWithUI();
  const result = await ipc.handles.get('check-for-updates')!();
  expect(result).toMatchObject({ disabled: true });
  expect(dialog.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({
    type: 'info', detail: expect.stringContaining('external build automation'),
  }));
  expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled();
  expect(autoUpdater.checkForUpdatesAndNotify).not.toHaveBeenCalled();
  expect(effects.send).not.toHaveBeenCalledWith('update-toast:checking');
});

it('blocks IPC download, immediate and deferred installation and ignores cached update notifications', async () => {
  writeFileSync(join(appDir, 'package.json'), JSON.stringify({ nimbalystUpdatePolicy: 'external' }));
  new AutoUpdaterService();
  const download = await ipc.handles.get('download-update')!();
  await ipc.handles.get('quit-and-install')!();
  for (const channel of ['update-toast:download', 'update-toast:install', 'update-toast:install-when-idle']) {
    await ipc.listeners.get(channel)!();
  }
  autoUpdater.emit('update-downloaded', {
    version: '99.0.0', downloadedFile: '/cached/update.zip', files: [],
    path: 'update.zip', sha512: 'test', releaseDate: '2026-10-19T00:00:00Z',
  });
  await vi.advanceTimersByTimeAsync(5000);
  expect(download).toMatchObject({ success: false, disabled: true });
  expect(autoUpdater.downloadUpdate).not.toHaveBeenCalled();
  expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  expect(autoUpdater.autoInstallOnAppQuit).toBe(false);
  expect(effects.subscribe).not.toHaveBeenCalled();
  expect(effects.close).not.toHaveBeenCalled();
  expect(effects.analytics).not.toHaveBeenCalled();
  expect(effects.send).not.toHaveBeenCalled();
  expect(app.relaunch).not.toHaveBeenCalled();
});

it('keeps official startup/hourly checks, manual checks, downloads and installation enabled', async () => {
  const service = new AutoUpdaterService();
  expect(autoUpdater.autoDownload).toBe(true);
  expect(autoUpdater.autoInstallOnAppQuit).toBe(true);
  service.startAutoUpdateCheck(60);
  await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
  expect(autoUpdater.checkForUpdatesAndNotify).toHaveBeenCalledTimes(2);
  await service.checkForUpdatesWithUI();
  expect(autoUpdater.checkForUpdates).toHaveBeenCalledOnce();
  await ipc.handles.get('check-for-updates')!();
  expect(autoUpdater.checkForUpdatesAndNotify).toHaveBeenCalledTimes(3);
  expect(await ipc.handles.get('download-update')!()).toEqual({ success: true });
  expect(autoUpdater.downloadUpdate).toHaveBeenCalledOnce();
  ipc.handles.get('quit-and-install')!();
  await vi.advanceTimersByTimeAsync(1);
  expect(effects.save).toHaveBeenCalledOnce();
  expect(effects.close).toHaveBeenCalledOnce();
  expect(autoUpdater.quitAndInstall).toHaveBeenCalledWith(true, true);
  expect(dialog.showMessageBox).not.toHaveBeenCalled();
  service.stopAutoUpdateCheck();
});

it('keeps official deferred installation waiting for sessions before quitting', async () => {
  const unsubscribe = vi.fn();
  effects.subscribe.mockReturnValue(unsubscribe);
  new AutoUpdaterService();
  ipc.listeners.get('update-toast:install-when-idle')!();
  expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  const onSessionChange = effects.subscribe.mock.calls[0][0];
  onSessionChange({ type: 'session:completed' });
  expect(unsubscribe).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1501);
  expect(autoUpdater.quitAndInstall).toHaveBeenCalledWith(true, true);
});

it('retains development-mode feedback without reading installed metadata', async () => {
  Object.defineProperty(app, 'isPackaged', { value: false });
  const service = new AutoUpdaterService();
  await service.checkForUpdatesWithUI();
  await vi.advanceTimersByTimeAsync(500);
  expect(app.getAppPath).not.toHaveBeenCalled();
  expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled();
  expect(effects.send).toHaveBeenCalledWith('update-toast:error', {
    message: expect.stringContaining('development mode'),
  });
});
