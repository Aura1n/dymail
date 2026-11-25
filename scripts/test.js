'use strict';

/* Runs the offline test suite: pure Node tests plus Electron-runtime tests.
   Usage: npm test [filter] */

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.join(__dirname, '..');
const testsDir = path.join(__dirname, 'tests');
const electronBin = path.join(
  root,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'electron.cmd' : 'electron'
);

const nodeTests = [
  'updater.test.js',
  'oauth-loopback.test.js',
  'oauth-refresh.test.js',
  'test-update-schedule.js',
  'test-idle-watch.js',
  'test-archive-create.js',
  'test-batch-move.js',
  'test-contacts-store.js',
  'test-restore-purge.js',
  'test-translate.js'
];
const electronTests = ['store-oauth.test.js'];

const filter = process.argv[2] || '';
const selected = (name) => !filter || name.includes(filter);

function run(command, args, label) {
  const started = Date.now();
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32' && /\.cmd$/i.test(command),
    env
  });
  const ok = result.status === 0;
  console.log(`\n${ok ? 'PASS' : 'FAIL'} ${label} (${((Date.now() - started) / 1000).toFixed(1)}s)\n`);
  return ok;
}

let passed = 0;
let failed = 0;

for (const name of nodeTests) {
  if (!selected(name)) continue;
  if (run(process.execPath, [path.join(testsDir, name)], name)) passed += 1;
  else failed += 1;
}

for (const name of electronTests) {
  if (!selected(name)) continue;
  if (run(electronBin, [path.join(testsDir, name)], name)) passed += 1;
  else failed += 1;
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
