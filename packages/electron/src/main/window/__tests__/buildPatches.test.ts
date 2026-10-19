// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { readBuildPatches } from '../buildPatches';
import type { BuildPatches } from '../../../shared/buildPatches';

const require = createRequire(import.meta.url);
const { stampBuildPatches } = require('../../../../build/stamp-build-patches.js');
// jsdom ships no type declarations; this is the slice of its API the test uses.
const { JSDOM } = require('jsdom') as {
  JSDOM: new (html: string, options: { runScripts: 'dangerously'; beforeParse(window: Window): void }) => { window: Window };
};
const aboutHtml = readFileSync(resolve(import.meta.dirname, '../../../../about.html'), 'utf8');
const dirs: string[] = [];

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'nimbalyst-build-patches-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it('carries the pipeline patch list from packaging into the installed app with upstream links', () => {
  const resources = tempDir();
  const source = join(tempDir(), 'patches.json');
  writeFileSync(source, JSON.stringify({
    base: '79b8c560c',
    patches: [
      { branch: 'MD/fix-automation-owning-project', sha: 'a1b2c3d', issue: '1299', pr: '-', status: 'open', note: 'lands in the owning project' },
      { branch: 'MD/about-kalifg-mods', sha: 'e4f5a6b', issue: null, pr: 1712, status: 'carried' },
      { branch: '', sha: 'deadbee' },
    ],
  }));

  expect(stampBuildPatches(resources, { NIMBALYST_BUILD_PATCHES_FILE: source })).toBe(true);

  expect(readBuildPatches(resources)).toEqual({
    base: { sha: '79b8c560c', url: 'https://github.com/nimbalyst/nimbalyst/commit/79b8c560c' },
    patches: [
      {
        branch: 'MD/fix-automation-owning-project', sha: 'a1b2c3d', status: 'open', note: 'lands in the owning project',
        issue: { number: 1299, url: 'https://github.com/nimbalyst/nimbalyst/issues/1299' }, pr: undefined,
      },
      {
        branch: 'MD/about-kalifg-mods', sha: 'e4f5a6b', status: 'carried', note: undefined,
        issue: undefined, pr: { number: 1712, url: 'https://github.com/nimbalyst/nimbalyst/pull/1712' },
      },
    ],
  });
});

it('leaves official builds without a patch list and rejects a malformed one at build time', () => {
  const resources = tempDir();
  expect(stampBuildPatches(resources, {})).toBe(false);
  expect(existsSync(join(resources, 'build-patches.json'))).toBe(false);
  expect(readBuildPatches(resources)).toBeNull();

  const source = join(tempDir(), 'patches.json');
  writeFileSync(source, '{"patches": "MD/x"}');
  expect(() => stampBuildPatches(resources, { NIMBALYST_BUILD_PATCHES_FILE: source })).toThrow(/patches/);
  writeFileSync(join(resources, 'build-patches.json'), JSON.stringify({ patches: [] }));
  expect(readBuildPatches(resources)).toBeNull();
});

async function renderAbout(build: BuildPatches | null) {
  const openExternal = vi.fn();
  const dom = new JSDOM(aboutHtml, {
    runScripts: 'dangerously',
    beforeParse(window) {
      Object.assign(window, {
        electronAPI: {
          getBuildPatches: async () => build,
          onThemeChange: () => () => {},
          getAppVersion: async () => '0.80.0',
          openExternal,
          analytics: { getDistinctId: async () => 'id' },
        },
      });
    },
  });
  await new Promise(done => setTimeout(done, 0));
  return { document: dom.window.document, openExternal };
}

it('shows the kalifg mods section only when the build carries patches', async () => {
  const official = await renderAbout(null);
  expect(official.document.getElementById('build-patches')!.hidden).toBe(true);
  expect(official.document.body.classList.contains('has-build-patches')).toBe(false);
  expect(official.document.querySelectorAll('#build-patches-list li')).toHaveLength(0);

  const local = await renderAbout({
    base: { sha: '79b8c560c', url: 'https://github.com/nimbalyst/nimbalyst/commit/79b8c560c' },
    patches: [
      { branch: 'MD/fix-persist-fullscreen', sha: 'a1b2c3d', issue: { number: 1310, url: 'https://github.com/nimbalyst/nimbalyst/issues/1310' } },
      { branch: 'MD/about-kalifg-mods', sha: 'e4f5a6b', note: 'local-only' },
    ],
  });
  expect(local.document.getElementById('build-patches')!.hidden).toBe(false);
  const rows = [...local.document.querySelectorAll('#build-patches-list li')];
  expect(rows.map(row => row.querySelector('code')!.textContent)).toEqual(['MD/fix-persist-fullscreen', 'MD/about-kalifg-mods']);
  expect(rows[1].querySelector('a')).toBeNull();

  rows[0].querySelector('a')!.dispatchEvent(new local.document.defaultView!.MouseEvent('click', { bubbles: true, cancelable: true }));
  expect(local.openExternal).toHaveBeenCalledWith('https://github.com/nimbalyst/nimbalyst/issues/1310');
});
