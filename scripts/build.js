'use strict';

/* Builds the Windows artifacts and prints their SHA-256 hashes.
   Usage:
     npm run build:dir        unpacked app in dist/win-unpacked
     npm run build:portable   portable exe
     npm run build:setup      NSIS installer
     npm run dist             both portable and installer */

const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { Arch, Platform, build } = require('electron-builder');

const root = path.join(__dirname, '..');
const pkg = require('../package.json');
const outDir = path.join(root, 'dist');

const MODES = {
  dir: { dir: true },
  portable: { targets: Platform.WINDOWS.createTarget(['portable'], Arch.x64) },
  setup: { targets: Platform.WINDOWS.createTarget(['nsis'], Arch.x64) },
  all: { targets: Platform.WINDOWS.createTarget(['portable', 'nsis'], Arch.x64) }
};

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function reportArtifacts(startedAt) {
  if (!fs.existsSync(outDir)) return;
  const artifacts = fs
    .readdirSync(outDir)
    .filter((name) => name.endsWith('.exe') && name.includes(pkg.version))
    .filter((name) => fs.statSync(path.join(outDir, name)).mtimeMs >= startedAt - 5000)
    .sort();

  if (!artifacts.length) {
    console.log('\nNo versioned .exe artifacts found yet.');
    return;
  }

  console.log('\nArtifacts:');
  for (const name of artifacts) {
    const file = path.join(outDir, name);
    const size = (fs.statSync(file).size / (1024 * 1024)).toFixed(1);
    const digest = sha256(file);
    console.log(`  ${name}  ${size} MB\n    sha256 ${digest}`);
  }
}

async function main() {
  const mode = process.argv[2] || 'all';
  const options = MODES[mode];
  if (!options) {
    console.error(`Unknown build mode "${mode}". Use one of: ${Object.keys(MODES).join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const dirty = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
  if (dirty.stdout && dirty.stdout.trim()) {
    console.log('Note: working tree has uncommitted changes; the build will include them.\n');
  }

  console.log(`Building Dymail ${pkg.version} (${mode}), unsigned...\n`);
  const startedAt = Date.now();
  await build({ ...options, publish: 'never' });
  if (mode === 'dir') {
    console.log(`\nUnpacked app: ${path.join(outDir, 'win-unpacked', 'Dymail.exe')}`);
  }
  reportArtifacts(startedAt);
  console.log('\nDone. The exe is unsigned: first launch shows a SmartScreen warning.');
}

main().catch((err) => {
  console.error('\nBuild failed:', err && err.message ? err.message : err);
  process.exitCode = 1;
});
