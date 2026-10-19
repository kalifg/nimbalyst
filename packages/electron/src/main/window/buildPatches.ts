import * as fs from 'fs';
import * as path from 'path';
import { parseBuildPatches, type BuildPatches } from '../../shared/buildPatches';

// Written into Resources by build/stamp-build-patches.js; absent from official builds.
const BUILD_PATCHES_FILE = 'build-patches.json';

export function readBuildPatches(resourcesDir: string): BuildPatches | null {
  try {
    return parseBuildPatches(JSON.parse(fs.readFileSync(path.join(resourcesDir, BUILD_PATCHES_FILE), 'utf8')));
  } catch {
    return null;
  }
}

export function getInstalledBuildPatches(isPackaged: boolean): BuildPatches | null {
  return isPackaged ? readBuildPatches(process.resourcesPath) : null;
}
