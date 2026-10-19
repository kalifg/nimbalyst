// Copies the patch list supplied by an external build pipeline into the packaged
// Resources, where the About window reads it. Official builds never set the variable.

const fs = require('fs');
const path = require('path');

const BUILD_PATCHES_FILE = 'build-patches.json';

function stampBuildPatches(resourcesDir, env = process.env) {
  const source = env.NIMBALYST_BUILD_PATCHES_FILE;
  if (!source) return false;
  const manifest = JSON.parse(fs.readFileSync(source, 'utf8'));
  if (!Array.isArray(manifest.patches)) {
    throw new Error(`${source}: expected a "patches" array`);
  }
  fs.writeFileSync(path.join(resourcesDir, BUILD_PATCHES_FILE), JSON.stringify(manifest, null, 2));
  console.log(`AfterPack: Stamped ${manifest.patches.length} build patch(es) from ${source}`);
  return true;
}

module.exports = { BUILD_PATCHES_FILE, stampBuildPatches };
