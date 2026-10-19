// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createYargs, configureBuildCommand } = require('electron-builder/out/builder');
const { Packager } = require('app-builder-lib');
const electronDir = resolve(import.meta.dirname, '../..');
const scripts = JSON.parse(readFileSync(join(electronDir, 'package.json'), 'utf8')).scripts;
const fixtures: string[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
});

it.runIf(process.platform !== 'win32').each(['build:mac:local', 'build:mac:notarized', 'build:mac:release'])(
  '%s produces the intended installed update policy without changing source metadata',
  async (script) => {
    const fixture = mkdtempSync(join(tmpdir(), 'nimbalyst-build-policy-'));
    fixtures.push(fixture);
    const capture = join(fixture, 'commands.jsonl');
    // Execute the real package script, replacing only the expensive build processes.
    const recorder = `#!${process.execPath}\nrequire('fs').appendFileSync(process.env.CAPTURE, JSON.stringify(process.argv.slice(2)) + '\\n');\n`;
    for (const command of ['node', 'pnpm']) {
      writeFileSync(join(fixture, command), recorder, { mode: 0o755 });
    }
    const result = spawnSync('/bin/sh', ['-c', scripts[script]], {
      cwd: electronDir,
      env: { ...process.env, PATH: `${fixture}:${process.env.PATH}`, CAPTURE: capture },
      encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(0);
    const calls = readFileSync(capture, 'utf8').trim().split('\n').map(line => JSON.parse(line) as string[]);
    const packagingCall = calls.find(call => call[0] === 'build/build-with-env.js');
    expect(packagingCall).toBeDefined();
    // Use electron-builder's real CLI parser and metadata merge, not a mock of its config.
    const options = configureBuildCommand(createYargs()).parse(packagingCall!.slice(1));
    const sourceMetadata = { name: 'policy-fixture', version: '1.0.0', description: 'Build policy fixture', author: 'Test', build: { electronVersion: '42.0.0' } };
    writeFileSync(join(fixture, 'package.json'), JSON.stringify(sourceMetadata));
    const packager = new Packager({ projectDir: fixture, config: options.config });
    await packager.validateConfig();
    expect(packager.metadata.nimbalystUpdatePolicy).toBe(script === 'build:mac:local' ? 'external' : undefined);
    expect(JSON.parse(readFileSync(join(fixture, 'package.json'), 'utf8'))).toEqual(sourceMetadata);
  },
);
